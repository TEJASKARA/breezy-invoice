-- Platform-owner credit adjustments for ChanaX.
-- Run after 202608260002_shared_credits_and_seats.sql.

begin;

create table if not exists public.breezy_credit_adjustments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.breezy_workspaces(id) on delete cascade,
  credits integer not null check (credits <> 0),
  bucket text not null default 'topup' check (bucket in ('topup', 'monthly', 'free')),
  reason text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.breezy_credit_adjustments enable row level security;

drop policy if exists "Workspace reads credit adjustments" on public.breezy_credit_adjustments;
create policy "Workspace reads credit adjustments" on public.breezy_credit_adjustments
for select to authenticated
using ((select public.breezy_is_workspace_member(workspace_id)));

create or replace function public.breezy_grant_special_credits(
  target_subscription_code text,
  credit_amount integer,
  adjustment_reason text default 'Manual platform-owner allocation'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace_id uuid;
  new_balance integer;
begin
  if credit_amount <= 0 or credit_amount > 100000 then
    raise exception 'Credit amount must be between 1 and 100000.' using errcode = '22023';
  end if;
  if length(trim(adjustment_reason)) < 3 then
    raise exception 'Enter a reason for this credit allocation.' using errcode = '22023';
  end if;

  select id into target_workspace_id
  from public.breezy_workspaces
  where upper(subscription_code) = upper(trim(target_subscription_code))
  limit 1;

  if target_workspace_id is null then
    raise exception 'No workspace matches that subscription code.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_workspace_id::text, 0));

  insert into public.breezy_credit_accounts
    (workspace_id, gst_status, free_credits_granted, topup_credits_remaining)
  values (
    target_workspace_id,
    case when exists (
      select 1 from public.breezy_workspace_settings
      where workspace_id = target_workspace_id
        and coalesce(setup ->> 'hasGstin', 'false') = 'true'
    ) then 'provisional' else 'no_gst' end,
    10,
    credit_amount
  )
  on conflict (workspace_id) do update set
    topup_credits_remaining = public.breezy_credit_accounts.topup_credits_remaining + excluded.topup_credits_remaining,
    updated_at = now()
  returning topup_credits_remaining into new_balance;

  insert into public.breezy_credit_adjustments
    (workspace_id, credits, bucket, reason, created_by)
  values
    (target_workspace_id, credit_amount, 'topup', trim(adjustment_reason), auth.uid());

  return jsonb_build_object(
    'workspace_id', target_workspace_id,
    'credits_added', credit_amount,
    'topup_credits_remaining', new_balance
  );
end;
$$;

revoke all on function public.breezy_grant_special_credits(text, integer, text) from public;
revoke all on function public.breezy_grant_special_credits(text, integer, text) from anon;
revoke all on function public.breezy_grant_special_credits(text, integer, text) from authenticated;
grant execute on function public.breezy_grant_special_credits(text, integer, text) to service_role;

insert into public.breezy_schema_versions(version)
values ('2026-08-26-credit-adjustments')
on conflict (version) do nothing;

commit;
