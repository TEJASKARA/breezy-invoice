-- Restore the audit table used by Platform admin credit grants.
-- breezy_grant_special_credits() writes here; some databases never received
-- 202608260003_credit_adjustments.sql. Safe to run more than once.

begin;

create table if not exists public.breezy_credit_adjustments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.breezy_workspaces(id) on delete cascade,
  subscription_code text not null,
  credits integer not null check (credits <> 0),
  bucket text not null default 'topup' check (bucket in ('topup', 'monthly', 'free')),
  reason text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.breezy_credit_adjustments
  add column if not exists subscription_code text;

create index if not exists breezy_credit_adjustments_subscription_code_idx
  on public.breezy_credit_adjustments (subscription_code);

alter table public.breezy_credit_adjustments enable row level security;

drop policy if exists "Workspace reads credit adjustments" on public.breezy_credit_adjustments;
create policy "Workspace reads credit adjustments" on public.breezy_credit_adjustments
for select to authenticated
using ((select public.breezy_is_workspace_member(workspace_id)));

notify pgrst, 'reload schema';
commit;
