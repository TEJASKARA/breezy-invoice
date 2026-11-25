-- Expense bills are now uploaded through the ChanaX API (POST /api/v1/expense-bills),
-- which checks the file's real content (magic bytes), refuses scripts and executables
-- and re-encodes images before storing it. Browsers can no longer write to the bucket
-- directly, because a direct upload would skip those checks. Reading and deleting
-- bills is unchanged.
--
-- IMPORTANT: run this only AFTER the new backend and frontend are deployed. Until then
-- the old frontend uploads straight to storage, and this migration would block it.
begin;

drop policy if exists "Workspace members upload expense bills" on storage.objects;
drop policy if exists "Users upload their own expense bills" on storage.objects;

insert into public.breezy_schema_versions(version)
values ('2026-11-24-expense-bills-upload-via-api')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
commit;
