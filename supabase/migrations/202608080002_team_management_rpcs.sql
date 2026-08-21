-- Secure team-management functions for the BreezyInvoice Workspace Settings UI.
-- Run after the 2026-08-08 SaaS workspace upgrade.

begin;

-- Every active member needs the shared setup record in order to enter the app.
drop policy if exists "Workspace reads settings" on public.breezy_workspace_settings;
create policy "Workspace reads settings" on public.breezy_workspace_settings
for select to authenticated
using ((select public.breezy_is_workspace_member(workspace_id)));

create or replace function public.breezy_validate_permissions(candidate text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(candidate, '{}'::text[]) <@ array[
    'workspace.read', 'workspace.manage', 'team.manage',
    'entities.read', 'entities.manage',
    'invoices.read', 'invoices.manage',
    'payslips.read', 'payslips.manage',
    'expenses.read', 'expenses.manage',
    'data_export.read', 'data_export.manage',
    'templates.read', 'templates.manage'
  ]::text[];
$$;

create or replace function public.breezy_invite_workspace_user(
  target_workspace_id uuid,
  target_email text,
  target_role text,
  target_permissions text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(target_email));
  invited_user_id uuid;
  record_id uuid;
begin
  if not public.breezy_has_permission(target_workspace_id, 'team.manage') then
    raise exception 'You do not have permission to manage this workspace team.' using errcode = '42501';
  end if;
  if normalized_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  if target_role not in ('admin', 'hr', 'accountant', 'viewer', 'custom') then
    raise exception 'The selected role is not valid.' using errcode = '22023';
  end if;
  if not public.breezy_validate_permissions(target_permissions) then
    raise exception 'One or more selected permissions are not valid.' using errcode = '22023';
  end if;

  select id into invited_user_id from auth.users where lower(email) = normalized_email limit 1;
  if invited_user_id is not null then
    if exists (
      select 1 from public.breezy_workspaces
      where id = target_workspace_id and owner_user_id = invited_user_id
    ) then
      raise exception 'This email already belongs to the workspace owner.' using errcode = '22023';
    end if;
    insert into public.breezy_workspace_members
      (workspace_id, user_id, role, permissions, status, invited_by, joined_at)
    values
      (target_workspace_id, invited_user_id, target_role, coalesce(target_permissions, '{}'::text[]), 'active', auth.uid(), now())
    on conflict (workspace_id, user_id) do update set
      role = excluded.role,
      permissions = excluded.permissions,
      status = 'active',
      invited_by = excluded.invited_by,
      joined_at = coalesce(public.breezy_workspace_members.joined_at, now()),
      updated_at = now()
    returning id into record_id;
    return jsonb_build_object('kind', 'member', 'id', record_id, 'email', normalized_email);
  end if;

  insert into public.breezy_workspace_invitations
    (workspace_id, email, role, permissions, token_hash, invited_by, status, expires_at)
  values
    (target_workspace_id, normalized_email, target_role, coalesce(target_permissions, '{}'::text[]),
     encode(digest(gen_random_uuid()::text || clock_timestamp()::text, 'sha256'), 'hex'), auth.uid(), 'pending', now() + interval '7 days')
  on conflict (workspace_id, (lower(email))) where status = 'pending'
  do update set
    role = excluded.role,
    permissions = excluded.permissions,
    token_hash = excluded.token_hash,
    invited_by = excluded.invited_by,
    expires_at = excluded.expires_at,
    updated_at = now()
  returning id into record_id;
  return jsonb_build_object('kind', 'invitation', 'id', record_id, 'email', normalized_email);
end;
$$;

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
  if not found then raise exception 'Workspace member was not found.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.breezy_revoke_workspace_invitation(
  target_workspace_id uuid,
  target_invitation_id uuid
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
  update public.breezy_workspace_invitations
  set status = 'revoked', updated_at = now()
  where id = target_invitation_id and workspace_id = target_workspace_id and status = 'pending';
end;
$$;

-- Automatically activate invitations when that email signs up or logs in.
create or replace function public.breezy_accept_pending_invitations(target_user_id uuid, target_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation record;
begin
  if not exists (
    select 1 from auth.users
    where id = target_user_id and lower(email) = lower(target_email)
  ) then
    raise exception 'The invitation identity could not be verified.' using errcode = '42501';
  end if;

  for invitation in
    select * from public.breezy_workspace_invitations
    where lower(email) = lower(target_email)
      and status = 'pending'
      and expires_at > now()
  loop
    insert into public.breezy_workspace_members
      (workspace_id, user_id, role, permissions, status, invited_by, joined_at)
    values
      (invitation.workspace_id, target_user_id, invitation.role, invitation.permissions, 'active', invitation.invited_by, now())
    on conflict (workspace_id, user_id) do update set
      role = excluded.role,
      permissions = excluded.permissions,
      status = 'active',
      joined_at = coalesce(public.breezy_workspace_members.joined_at, now()),
      updated_at = now();

    update public.breezy_workspace_invitations
    set status = 'accepted', accepted_at = now(), updated_at = now()
    where id = invitation.id;
  end loop;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_path, last_seen_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), 'User'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    now()
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    avatar_path = excluded.avatar_path,
    last_seen_at = excluded.last_seen_at,
    updated_at = now();
  perform public.breezy_accept_pending_invitations(new.id, new.email);
  if not exists (
    select 1 from public.breezy_workspace_members
    where user_id = new.id and status = 'active'
  ) then
    insert into public.breezy_workspaces (owner_user_id, name)
    values (
      new.id,
      coalesce(
        nullif(new.raw_user_meta_data ->> 'full_name', ''),
        nullif(new.raw_user_meta_data ->> 'name', ''),
        split_part(new.email, '@', 1),
        'BreezyInvoice workspace'
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of raw_user_meta_data, email on auth.users
for each row execute function public.handle_new_auth_user();

revoke all on function public.breezy_invite_workspace_user(uuid, text, text, text[]) from public;
revoke all on function public.breezy_update_workspace_member(uuid, uuid, text, text[], text) from public;
revoke all on function public.breezy_revoke_workspace_invitation(uuid, uuid) from public;
revoke all on function public.breezy_accept_pending_invitations(uuid, text) from public;
grant execute on function public.breezy_invite_workspace_user(uuid, text, text, text[]) to authenticated;
grant execute on function public.breezy_update_workspace_member(uuid, uuid, text, text[], text) to authenticated;
grant execute on function public.breezy_revoke_workspace_invitation(uuid, uuid) to authenticated;

insert into public.breezy_schema_versions(version)
values ('2026-08-08-team-management-rpcs-v1')
on conflict (version) do nothing;

commit;
