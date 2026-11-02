-- Repair: production was missing public.breezy_admin_find_workspaces(text),
-- so the platform-admin subscriber search failed with
-- "Could not find the function ... in the schema cache".
-- Same definition as 202609050005_admin_email_credit_grants.sql. Safe to re-run.
begin;

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

insert into public.breezy_schema_versions(version)
values ('2026-11-02-restore-admin-workspace-search')
on conflict (version) do nothing;

commit;

-- Make the API see the function immediately.
notify pgrst, 'reload schema';
