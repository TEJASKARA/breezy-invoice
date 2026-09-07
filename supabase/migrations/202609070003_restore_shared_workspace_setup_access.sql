-- Every active workspace member needs the owner's shared setup record to
-- enter the application. Restore this policy for databases that predate the
-- complete team-access migration.

begin;

create or replace function public.breezy_is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.breezy_workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

revoke all on function public.breezy_is_workspace_member(uuid) from public;
grant execute on function public.breezy_is_workspace_member(uuid) to authenticated;
grant select on public.breezy_workspace_settings to authenticated;

drop policy if exists "Members read settings" on public.breezy_workspace_settings;
drop policy if exists "Workspace reads settings" on public.breezy_workspace_settings;
drop policy if exists "Workspace members read settings" on public.breezy_workspace_settings;

create policy "Workspace members read settings"
on public.breezy_workspace_settings
for select to authenticated
using (public.breezy_is_workspace_member(workspace_id));

insert into public.breezy_schema_versions(version)
values ('2026-09-07-restore-shared-workspace-setup-access')
on conflict (version) do nothing;

commit;

notify pgrst, 'reload schema';
