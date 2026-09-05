-- Super-admin workspace lookup by email or subscription code, with complete
-- credit-allocation audit snapshots. Run after 202609050004.

begin;

alter table public.breezy_credit_adjustments
  add column if not exists subscription_code text;

update public.breezy_credit_adjustments adjustments
set subscription_code = workspaces.subscription_code
from public.breezy_workspaces workspaces
where workspaces.id = adjustments.workspace_id
  and adjustments.subscription_code is null;

alter table public.breezy_credit_adjustments
  alter column subscription_code set not null;

create index if not exists breezy_credit_adjustments_subscription_code_idx
  on public.breezy_credit_adjustments (subscription_code);

create or replace function public.breezy_admin_find_workspaces(
  search_identifier text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_identifier text := lower(trim(search_identifier));
  result jsonb;
begin
  if length(normalized_identifier) < 3 then
    raise exception 'Enter an email address or subscription code.' using errcode = '22023';
  end if;

  with matches as (
    select
      workspaces.id,
      workspaces.name,
      workspaces.subscription_code,
      workspaces.status,
      workspaces.created_at,
      case
        when lower(coalesce(owner_account.email, '')) = normalized_identifier
          then owner_account.email
        when bool_or(lower(coalesce(member_account.email, '')) = normalized_identifier)
          then min(member_account.email) filter (
            where lower(coalesce(member_account.email, '')) = normalized_identifier
          )
        when bool_or(lower(coalesce(invitations.email, '')) = normalized_identifier)
          then min(invitations.email) filter (
            where lower(coalesce(invitations.email, '')) = normalized_identifier
          )
        else owner_account.email
      end as matched_email
    from public.breezy_workspaces workspaces
    left join auth.users owner_account
      on owner_account.id = workspaces.owner_user_id
    left join public.breezy_workspace_members members
      on members.workspace_id = workspaces.id
      and members.status in ('active', 'invited')
    left join auth.users member_account
      on member_account.id = members.user_id
    left join public.breezy_workspace_invitations invitations
      on invitations.workspace_id = workspaces.id
      and invitations.status = 'pending'
    where lower(workspaces.subscription_code) = normalized_identifier
       or lower(coalesce(owner_account.email, '')) = normalized_identifier
       or lower(coalesce(member_account.email, '')) = normalized_identifier
       or lower(coalesce(invitations.email, '')) = normalized_identifier
    group by
      workspaces.id,
      workspaces.name,
      workspaces.subscription_code,
      workspaces.status,
      workspaces.created_at,
      owner_account.email
    order by workspaces.created_at desc
    limit 25
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'workspace_id', matches.id,
        'name', matches.name,
        'subscription_code', matches.subscription_code,
        'status', matches.status,
        'matched_email', matches.matched_email,
        'document_credits_remaining',
          greatest(
            0,
            coalesce(credits.free_credits_granted, 0)
              - coalesce(credits.free_credits_used, 0)
          )
          + coalesce(credits.monthly_credits_remaining, 0)
          + coalesce(credits.topup_credits_remaining, 0),
        'quotation_credits_remaining',
          greatest(
            0,
            coalesce(credits.free_quotation_credits_granted, 0)
              - coalesce(credits.free_quotation_credits_used, 0)
          )
          + coalesce(credits.monthly_quotation_credits_remaining, 0)
          + coalesce(credits.topup_quotation_credits_remaining, 0)
      ) order by matches.name
    ),
    '[]'::jsonb
  ) into result
  from matches
  left join public.breezy_credit_accounts credits
    on credits.workspace_id = matches.id;

  return result;
end;
$$;

revoke all on function public.breezy_admin_find_workspaces(text) from public;
revoke all on function public.breezy_admin_find_workspaces(text) from anon;
revoke all on function public.breezy_admin_find_workspaces(text) from authenticated;
grant execute on function public.breezy_admin_find_workspaces(text) to service_role;

create or replace function public.breezy_grant_special_credits(
  target_subscription_code text,
  credit_amount integer,
  adjustment_reason text,
  target_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace_id uuid;
  resolved_subscription_code text;
  new_balance integer;
  new_quotation_balance integer;
begin
  if target_actor_user_id is null
     or not exists (
       select 1 from auth.users where id = target_actor_user_id
     ) then
    raise exception 'A valid platform administrator is required.' using errcode = '22023';
  end if;
  if credit_amount <= 0 or credit_amount > 100000 then
    raise exception 'Credit amount must be between 1 and 100000.' using errcode = '22023';
  end if;
  if length(trim(adjustment_reason)) < 3 then
    raise exception 'Enter a reason for this credit allocation.' using errcode = '22023';
  end if;

  select id, subscription_code
  into target_workspace_id, resolved_subscription_code
  from public.breezy_workspaces
  where upper(subscription_code) = upper(trim(target_subscription_code))
  limit 1;

  if target_workspace_id is null then
    raise exception 'No workspace matches that subscription code.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_workspace_id::text, 0));

  insert into public.breezy_credit_accounts (
    workspace_id,
    gst_status,
    free_credits_granted,
    free_quotation_credits_granted,
    topup_credits_remaining,
    topup_quotation_credits_remaining
  ) values (
    target_workspace_id,
    case when exists (
      select 1 from public.breezy_workspace_settings
      where workspace_id = target_workspace_id
        and coalesce(setup ->> 'hasGstin', 'false') = 'true'
    ) then 'provisional' else 'no_gst' end,
    10,
    10,
    credit_amount,
    credit_amount
  )
  on conflict (workspace_id) do update set
    topup_credits_remaining = public.breezy_credit_accounts.topup_credits_remaining
      + excluded.topup_credits_remaining,
    topup_quotation_credits_remaining = public.breezy_credit_accounts.topup_quotation_credits_remaining
      + excluded.topup_quotation_credits_remaining,
    updated_at = now()
  returning topup_credits_remaining, topup_quotation_credits_remaining
  into new_balance, new_quotation_balance;

  insert into public.breezy_credit_adjustments (
    workspace_id, subscription_code, credits, bucket, reason, created_by
  ) values (
    target_workspace_id,
    resolved_subscription_code,
    credit_amount,
    'topup',
    trim(adjustment_reason),
    target_actor_user_id
  );

  return jsonb_build_object(
    'workspace_id', target_workspace_id,
    'credits_added', credit_amount,
    'quotation_credits_added', credit_amount,
    'topup_credits_remaining', new_balance,
    'topup_quotation_credits_remaining', new_quotation_balance
  );
end;
$$;

revoke all on function public.breezy_grant_special_credits(text, integer, text, uuid) from public;
revoke all on function public.breezy_grant_special_credits(text, integer, text, uuid) from anon;
revoke all on function public.breezy_grant_special_credits(text, integer, text, uuid) from authenticated;
grant execute on function public.breezy_grant_special_credits(text, integer, text, uuid) to service_role;

insert into public.breezy_schema_versions(version)
values ('2026-09-05-admin-email-credit-grants')
on conflict (version) do nothing;

commit;
