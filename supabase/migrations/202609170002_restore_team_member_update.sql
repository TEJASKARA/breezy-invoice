-- Restore the RPC used by Workspace Settings to disable, restore, or edit a
-- team member. Some production databases were provisioned without the older
-- team-management RPC migration.

begin;

create or replace function public.breezy_update_workspace_member(
  target_workspace_id uuid,
  target_user_id uuid,
  target_role text,
  target_permissions text[] default '{}'::text[],
  target_status text default 'active'
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
    raise exception 'The workspace owner cannot be edited or disabled.' using errcode = '22023';
  end if;
  if target_role not in ('admin', 'hr', 'accountant', 'viewer', 'custom') then
    raise exception 'The selected role is not valid.' using errcode = '22023';
  end if;
  if target_status not in ('active', 'disabled') then
    raise exception 'The selected member status is not valid.' using errcode = '22023';
  end if;
  if not public.breezy_validate_permissions(target_permissions) then
    raise exception 'One or more selected permissions are not valid.' using errcode = '22023';
  end if;

  update public.breezy_workspace_members
  set role = target_role,
      permissions = coalesce(target_permissions, '{}'::text[]),
      status = target_status,
      updated_at = now()
  where workspace_id = target_workspace_id and user_id = target_user_id;

  if not found then
    raise exception 'Workspace member was not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.breezy_update_workspace_member(uuid, uuid, text, text[], text) from public;
grant execute on function public.breezy_update_workspace_member(uuid, uuid, text, text[], text) to authenticated;

insert into public.breezy_schema_versions(version)
values ('2026-09-17-restore-team-member-update')
on conflict (version) do nothing;

commit;
