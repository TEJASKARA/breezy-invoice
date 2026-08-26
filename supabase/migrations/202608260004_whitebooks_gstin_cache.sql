-- Private, service-only cache for paid WhiteBooks GSTIN lookups.
-- A GSTIN is fetched from WhiteBooks once and then reused by every workspace.

begin;

create table if not exists public.breezy_gstin_cache (
  gstin text primary key check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  provider text not null default 'whitebooks',
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table public.breezy_gstin_cache enable row level security;

-- No anon/authenticated policies are intentional. Only the FastAPI service-role
-- connection can read or write paid provider results.
revoke all on table public.breezy_gstin_cache from anon;
revoke all on table public.breezy_gstin_cache from authenticated;
grant select, insert on table public.breezy_gstin_cache to service_role;

insert into public.breezy_schema_versions(version)
values ('2026-08-26-whitebooks-gstin-cache')
on conflict (version) do nothing;

commit;
