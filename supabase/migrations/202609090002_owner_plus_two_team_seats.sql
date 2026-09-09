-- Make the base team allowance explicit: the workspace owner plus two
-- additional active or invited users. Pending invitations that already have
-- a matching active membership must not consume a second seat.

begin;

alter table public.breezy_subscriptions
  alter column included_seats set default 3;

update public.breezy_subscriptions
set included_seats = 3, updated_at = now()
where included_seats < 3;

create or replace function public.breezy_additional_seats_reserved(target_workspace_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      select count(*)::integer
      from public.breezy_workspace_members as member
      where member.workspace_id = target_workspace_id
        and member.role <> 'owner'
        and member.status in ('active', 'invited')
    ) + (
      select count(*)::integer
      from public.breezy_workspace_invitations as invitation
      where invitation.workspace_id = target_workspace_id
        and invitation.status = 'pending'
        and not exists (
          select 1
          from public.breezy_workspace_members as member
          join auth.users as team_user on team_user.id = member.user_id
          where member.workspace_id = target_workspace_id
            and member.status in ('active', 'invited')
            and lower(team_user.email) = lower(invitation.email)
        )
    );
$$;

revoke all on function public.breezy_additional_seats_reserved(uuid) from public;

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
  additional_seat_limit integer;
  additional_seats_reserved integer;
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

  select greatest(included_seats - 1, 2) + extra_seats
  into additional_seat_limit
  from public.breezy_subscriptions
  where workspace_id = target_workspace_id;

  additional_seats_reserved := public.breezy_additional_seats_reserved(target_workspace_id);
  if not already_reserved and additional_seats_reserved >= coalesce(additional_seat_limit, 2) then
    raise exception 'Both included additional-user seats are already reserved. Purchase an additional monthly seat before adding another email.' using errcode = 'P0001';
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

    update public.breezy_workspace_invitations
    set status = 'accepted', accepted_at = coalesce(accepted_at, now()), updated_at = now()
    where workspace_id = target_workspace_id and lower(email) = normalized_email and status = 'pending';

    return jsonb_build_object('kind', 'member', 'id', record_id, 'email', normalized_email);
  end if;

  insert into public.breezy_workspace_invitations
    (workspace_id, email, role, permissions, token_hash, invited_by, status, expires_at)
  values
    (target_workspace_id, normalized_email, target_role, coalesce(target_permissions, '{}'::text[]),
     encode(digest(gen_random_uuid()::text || clock_timestamp()::text, 'sha256'), 'hex'), auth.uid(), 'pending', now() + interval '7 days')
  on conflict (workspace_id, (lower(email))) where status = 'pending'
  do update set role = excluded.role, permissions = excluded.permissions, token_hash = excluded.token_hash,
    invited_by = excluded.invited_by, expires_at = excluded.expires_at, updated_at = now()
  returning id into record_id;
  return jsonb_build_object('kind', 'invitation', 'id', record_id, 'email', normalized_email);
end;
$$;

revoke all on function public.breezy_invite_workspace_user(uuid, text, text, text[]) from public;
grant execute on function public.breezy_invite_workspace_user(uuid, text, text, text[]) to authenticated;

create or replace function public.breezy_decide_ca_access_request(
  target_request_id uuid,
  approve_request boolean,
  target_permissions text[] default array[
    'entities.read', 'invoices.read', 'invoices.manage',
    'expenses.read', 'expenses.manage',
    'data_export.read', 'data_export.manage'
  ]::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  access_request public.breezy_ca_access_requests;
  additional_seat_limit integer;
  additional_seats_reserved integer;
  already_reserved boolean;
begin
  select * into access_request
  from public.breezy_ca_access_requests
  where id = target_request_id and status = 'pending'
  for update;

  if access_request.id is null then
    raise exception 'This access request is no longer pending.' using errcode = 'P0001';
  end if;
  if not public.breezy_has_permission(access_request.workspace_id, 'team.manage') then
    raise exception 'You do not have permission to review this request.' using errcode = '42501';
  end if;

  if approve_request then
    if not public.breezy_validate_permissions(target_permissions) then
      raise exception 'One or more selected permissions are not valid.' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(access_request.workspace_id::text, 0));

    already_reserved := exists (
      select 1 from public.breezy_workspace_members
      where workspace_id = access_request.workspace_id
        and user_id = access_request.requester_user_id
        and status in ('active', 'invited')
    );
    select greatest(included_seats - 1, 2) + extra_seats
    into additional_seat_limit
    from public.breezy_subscriptions
    where workspace_id = access_request.workspace_id;
    additional_seats_reserved := public.breezy_additional_seats_reserved(access_request.workspace_id);

    if not already_reserved and additional_seats_reserved >= coalesce(additional_seat_limit, 2) then
      raise exception 'Both included additional-user seats are already reserved. Add a paid seat before approving this CA.' using errcode = 'P0001';
    end if;

    insert into public.breezy_workspace_members (
      workspace_id, user_id, role, permissions, status, invited_by, joined_at
    ) values (
      access_request.workspace_id, access_request.requester_user_id,
      'accountant', coalesce(target_permissions, '{}'::text[]),
      'active', auth.uid(), now()
    )
    on conflict (workspace_id, user_id) do update set
      role = 'accountant', permissions = excluded.permissions, status = 'active',
      invited_by = auth.uid(), joined_at = coalesce(public.breezy_workspace_members.joined_at, now()),
      updated_at = now();
  end if;

  update public.breezy_ca_access_requests
  set status = case when approve_request then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = access_request.id;

  insert into public.breezy_workspace_audit_log (
    workspace_id, actor_user_id, actor_email, actor_account_type,
    action, resource_type, resource_id, details
  )
  select
    access_request.workspace_id, auth.uid(), profile.email, profile.account_type,
    case when approve_request then 'approved' else 'rejected' end,
    'ca_access_request', access_request.id::text,
    jsonb_build_object('requester_email', access_request.requester_email)
  from public.profiles as profile where profile.id = auth.uid();

  return jsonb_build_object(
    'status', case when approve_request then 'approved' else 'rejected' end,
    'workspace_id', access_request.workspace_id
  );
end;
$$;

revoke all on function public.breezy_decide_ca_access_request(uuid, boolean, text[]) from public;
grant execute on function public.breezy_decide_ca_access_request(uuid, boolean, text[]) to authenticated;

insert into public.breezy_schema_versions(version)
values ('2026-09-09-owner-plus-two-team-seats')
on conflict (version) do nothing;

commit;
