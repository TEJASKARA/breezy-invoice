-- breezy_schema_versions was the only public table without row-level security.
-- Supabase gives the anon and authenticated API roles full access to new public
-- tables by default, so anyone with the public anon key could read, add or delete
-- version rows. Only migrations (and the service role) need this table.
begin;

alter table public.breezy_schema_versions enable row level security;
revoke all on table public.breezy_schema_versions from anon, authenticated;

insert into public.breezy_schema_versions(version)
values ('2026-11-24-lock-schema-versions')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
commit;
