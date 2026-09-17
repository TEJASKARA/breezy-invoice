-- Allow workspace managers to permanently remove a disabled member from the
-- current workspace. This removes only the workspace membership, never the
-- person's ChanaX authentication account or another workspace membership.

begin;

create or replace function public.breezy_remove_workspace_member(
  target_workspace_id uuid,
  target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.breezy_has_permission(target_workspace_id, 'team.manage') then
    raise exception 'You do not have permission to manage this workspace team.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.breezy_workspaces
    where id = target_workspace_id and owner_user_id = target_user_id
  ) then
    raise exception 'The workspace owner cannot be removed.' using errcode = '22023';
  end if;

  delete from public.breezy_workspace_members
  where workspace_id = target_workspace_id
    and user_id = target_user_id
    and status = 'disabled';

  if not found then
    raise exception 'Only a disabled team member can be permanently removed.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.breezy_remove_workspace_member(uuid, uuid) from public;
grant execute on function public.breezy_remove_workspace_member(uuid, uuid) to authenticated;

insert into public.breezy_schema_versions(version)
values ('2026-09-17-remove-disabled-team-member')
on conflict (version) do nothing;

commit;
