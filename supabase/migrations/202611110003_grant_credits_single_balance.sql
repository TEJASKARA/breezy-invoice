-- Platform admin credit grants: record the subscription code in the audit log
-- and add credits to the single balance used for invoices, quotations and
-- payslips. Replaces any older version of this function. Safe to re-run.

begin;

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
begin
  if target_actor_user_id is null
     or not exists (select 1 from auth.users where id = target_actor_user_id) then
    raise exception 'A valid platform administrator is required.' using errcode = '22023';
  end if;
  if credit_amount <= 0 or credit_amount > 100000 then
    raise exception 'Credit amount must be between 1 and 100000.' using errcode = '22023';
  end if;
  if length(trim(coalesce(adjustment_reason, ''))) < 3 then
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
    workspace_id, gst_status, free_credits_granted, topup_credits_remaining
  ) values (
    target_workspace_id,
    case when exists (
      select 1 from public.breezy_workspace_settings
      where workspace_id = target_workspace_id
        and coalesce(setup ->> 'hasGstin', 'false') = 'true'
    ) then 'provisional' else 'no_gst' end,
    20,
    credit_amount
  )
  on conflict (workspace_id) do update set
    topup_credits_remaining = public.breezy_credit_accounts.topup_credits_remaining
      + excluded.topup_credits_remaining,
    updated_at = now()
  returning topup_credits_remaining into new_balance;

  insert into public.breezy_credit_adjustments (
    workspace_id, subscription_code, credits, bucket, reason, created_by
  ) values (
    target_workspace_id, resolved_subscription_code, credit_amount, 'topup',
    trim(adjustment_reason), target_actor_user_id
  );

  return jsonb_build_object(
    'workspace_id', target_workspace_id,
    'credits_added', credit_amount,
    'quotation_credits_added', 0,
    'topup_credits_remaining', new_balance,
    'topup_quotation_credits_remaining', 0
  );
end;
$$;

revoke all on function public.breezy_grant_special_credits(text, integer, text, uuid) from public;
revoke all on function public.breezy_grant_special_credits(text, integer, text, uuid) from anon;
revoke all on function public.breezy_grant_special_credits(text, integer, text, uuid) from authenticated;
grant execute on function public.breezy_grant_special_credits(text, integer, text, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
