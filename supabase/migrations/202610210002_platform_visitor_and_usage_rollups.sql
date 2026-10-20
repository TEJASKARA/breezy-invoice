begin;
create table if not exists public.breezy_anonymous_site_visits (
  visitor_hash text not null,
  visit_day date not null default (now() at time zone 'Asia/Kolkata')::date,
  first_seen_at timestamptz not null default now(),
  primary key(visitor_hash, visit_day)
);
alter table public.breezy_anonymous_site_visits enable row level security;
revoke all on public.breezy_anonymous_site_visits from anon, authenticated;
insert into public.breezy_schema_versions(version) values ('2026-10-21-platform-visitor-and-usage-rollups') on conflict (version) do nothing;
commit;
