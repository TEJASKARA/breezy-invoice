-- Two-person approval record for exceptional, early permanent workspace purges.
-- The workspace itself remains suspended until the existing purge worker removes it.
begin;

create table if not exists public.breezy_platform_purge_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  workspace_name text not null,
  subscription_code text not null,
  requested_by uuid not null,
  owner_user_id uuid not null,
  reason text not null check (length(reason) between 3 and 500),
  code_hash text not null,
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','approved','expired','cancelled')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists breezy_platform_purge_approvals_workspace_idx
  on public.breezy_platform_purge_approvals(workspace_id, created_at desc);

alter table public.breezy_platform_purge_approvals enable row level security;
revoke all on public.breezy_platform_purge_approvals from anon, authenticated;

insert into public.breezy_schema_versions(version)
values ('2026-10-21-platform-purge-approvals') on conflict (version) do nothing;
commit;
