-- Fix production installations where the invitation function was created
-- without pgcrypto available in its empty search path.

begin;

create extension if not exists pgcrypto with schema extensions;

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
  seat_limit integer;
  seats_reserved integer;
  already_reserved boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_workspace_id::text, 0));

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
  already_reserved := exists (
    select 1 from public.breezy_workspace_invitations
    where workspace_id = target_workspace_id and lower(email) = normalized_email and status = 'pending'
  ) or (invited_user_id is not null and exists (
    select 1 from public.breezy_workspace_members
    where workspace_id = target_workspace_id and user_id = invited_user_id and status in ('active', 'invited')
  ));

  select included_seats + extra_seats into seat_limit
  from public.breezy_subscriptions where workspace_id = target_workspace_id;
  select
    (select count(*) from public.breezy_workspace_members where workspace_id = target_workspace_id and status in ('active', 'invited'))
    + (select count(*) from public.breezy_workspace_invitations where workspace_id = target_workspace_id and status = 'pending')
  into seats_reserved;
  if not already_reserved and seats_reserved >= coalesce(seat_limit, 3) then
    raise exception 'This plan includes % team accounts. Purchase an additional monthly seat before adding another email.', coalesce(seat_limit, 3) using errcode = 'P0001';
  end if;

  if invited_user_id is not null then
    if exists (select 1 from public.breezy_workspaces where id = target_workspace_id and owner_user_id = invited_user_id) then
      raise exception 'This email already belongs to the workspace owner.' using errcode = '22023';
    end if;
    insert into public.breezy_workspace_members
      (workspace_id, user_id, role, permissions, status, invited_by, joined_at)
    values
      (target_workspace_id, invited_user_id, target_role, coalesce(target_permissions, '{}'::text[]), 'active', auth.uid(), now())
    on conflict (workspace_id, user_id) do update set
      role = excluded.role, permissions = excluded.permissions, status = 'active', invited_by = excluded.invited_by,
      joined_at = coalesce(public.breezy_workspace_members.joined_at, now()), updated_at = now()
    returning id into record_id;
    return jsonb_build_object('kind', 'member', 'id', record_id, 'email', normalized_email);
  end if;

  insert into public.breezy_workspace_invitations
    (workspace_id, email, role, permissions, token_hash, invited_by, status, expires_at)
  values
    (target_workspace_id, normalized_email, target_role, coalesce(target_permissions, '{}'::text[]),
     encode(extensions.digest(gen_random_uuid()::text || clock_timestamp()::text, 'sha256'), 'hex'), auth.uid(), 'pending', now() + interval '7 days')
  on conflict (workspace_id, (lower(email))) where status = 'pending'
  do update set role = excluded.role, permissions = excluded.permissions, token_hash = excluded.token_hash,
    invited_by = excluded.invited_by, expires_at = excluded.expires_at, updated_at = now()
  returning id into record_id;
  return jsonb_build_object('kind', 'invitation', 'id', record_id, 'email', normalized_email);
end;
$$;

revoke all on function public.breezy_invite_workspace_user(uuid, text, text, text[]) from public;
grant execute on function public.breezy_invite_workspace_user(uuid, text, text, text[]) to authenticated;

insert into public.breezy_schema_versions(version)
values ('2026-09-17-fix-team-invitation-digest')
on conflict (version) do nothing;

commit;
