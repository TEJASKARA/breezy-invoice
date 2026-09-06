-- ChanaX CA/accounting-firm portal, client access requests and CA audit trail.
-- Run after 202609050006_chanax_brand_defaults.sql.

begin;

alter table public.profiles
  add column if not exists account_type text not null default 'unselected'
    check (account_type in ('unselected', 'ca', 'founder', 'employee')),
  add column if not exists ca_firm_name text;

-- Persona changes go through breezy_set_account_type so a client-only CA
-- cannot bypass the workspace ownership checks with a direct REST update.
revoke update on public.profiles from authenticated;
grant update (email, full_name, avatar_path, last_seen_at, updated_at)
  on public.profiles to authenticated;

-- Preserve the persona already collected from existing workspace setup records.
update public.profiles as profile
set account_type = case settings.setup ->> 'accountType'
  when 'ca' then 'ca'
  when 'employee' then 'employee'
  else 'founder'
end,
ca_firm_name = case
  when settings.setup ->> 'accountType' = 'ca'
    then nullif(settings.setup ->> 'firmName', '')
  else profile.ca_firm_name
end,
updated_at = now()
from public.breezy_workspaces as workspace
join public.breezy_workspace_settings as settings on settings.workspace_id = workspace.id
where workspace.owner_user_id = profile.id
  and settings.setup is not null
  and profile.account_type = 'unselected';

create table if not exists public.breezy_ca_access_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.breezy_workspaces(id) on delete cascade,
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  requester_email text not null,
  requester_name text not null,
  ca_firm_name text,
  message text,
  requested_permissions text[] not null default array[
    'entities.read', 'invoices.read', 'invoices.manage',
    'expenses.read', 'expenses.manage',
    'data_export.read', 'data_export.manage'
  ]::text[],
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists breezy_ca_access_requests_pending_idx
on public.breezy_ca_access_requests (workspace_id, requester_user_id)
where status = 'pending';

create index if not exists breezy_ca_access_requests_requester_idx
on public.breezy_ca_access_requests (requester_user_id, created_at desc);

create table if not exists public.breezy_workspace_audit_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.breezy_workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  actor_account_type text,
  action text not null,
  resource_type text not null,
  resource_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists breezy_workspace_audit_workspace_idx
on public.breezy_workspace_audit_log (workspace_id, created_at desc);

alter table public.breezy_ca_access_requests enable row level security;
alter table public.breezy_workspace_audit_log enable row level security;

drop policy if exists "CAs read their access requests" on public.breezy_ca_access_requests;
create policy "CAs read their access requests"
on public.breezy_ca_access_requests for select to authenticated
using (requester_user_id = auth.uid());

drop policy if exists "Team managers read CA requests" on public.breezy_ca_access_requests;
create policy "Team managers read CA requests"
on public.breezy_ca_access_requests for select to authenticated
using (public.breezy_has_permission(workspace_id, 'team.manage'));

drop policy if exists "Team managers read workspace audit" on public.breezy_workspace_audit_log;
create policy "Team managers read workspace audit"
on public.breezy_workspace_audit_log for select to authenticated
using (public.breezy_has_permission(workspace_id, 'team.manage'));

create or replace function public.breezy_set_account_type(
  target_account_type text,
  target_ca_firm_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_firm_name text := nullif(trim(target_ca_firm_name), '');
  owned_workspace_id uuid;
  workspace_has_business_data boolean := false;
begin
  if current_user_id is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if target_account_type not in ('ca', 'founder', 'employee') then
    raise exception 'Select a valid account type.' using errcode = '22023';
  end if;
  if target_account_type = 'ca' and normalized_firm_name is null then
    raise exception 'Enter your CA practice or accounting firm name.' using errcode = '22023';
  end if;

  if target_account_type = 'ca' then
    select id into owned_workspace_id
    from public.breezy_workspaces
    where owner_user_id = current_user_id
    limit 1;

    if owned_workspace_id is not null then
      select
        exists (select 1 from public.breezy_workspace_settings where workspace_id = owned_workspace_id and setup is not null)
        or exists (select 1 from public.breezy_entities where workspace_id = owned_workspace_id)
        or exists (select 1 from public.breezy_customers where workspace_id = owned_workspace_id)
        or exists (select 1 from public.breezy_invoices where workspace_id = owned_workspace_id)
        or exists (select 1 from public.breezy_employees where workspace_id = owned_workspace_id)
        or exists (select 1 from public.breezy_payslips where workspace_id = owned_workspace_id)
      into workspace_has_business_data;

      if workspace_has_business_data then
        raise exception 'This account already owns a configured company workspace and cannot be converted automatically.' using errcode = 'P0001';
      end if;

      delete from public.breezy_workspaces where id = owned_workspace_id;
    end if;
  end if;

  update public.profiles
  set account_type = target_account_type,
      ca_firm_name = case when target_account_type = 'ca' then normalized_firm_name else null end,
      updated_at = now()
  where id = current_user_id;

  return jsonb_build_object(
    'account_type', target_account_type,
    'ca_firm_name', case when target_account_type = 'ca' then normalized_firm_name else null end
  );
end;
$$;

revoke all on function public.breezy_set_account_type(text, text) from public;
grant execute on function public.breezy_set_account_type(text, text) to authenticated;

create or replace function public.breezy_request_ca_access(
  target_company_reference text,
  request_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_reference text := lower(trim(target_company_reference));
  target_workspace public.breezy_workspaces;
  requester public.profiles;
  result_id uuid;
begin
  if current_user_id is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select * into requester from public.profiles where id = current_user_id;
  if coalesce(requester.account_type, 'unselected') <> 'ca' then
    raise exception 'Only verified CA portal accounts can request client access.' using errcode = '42501';
  end if;

  select workspace.* into target_workspace
  from public.breezy_workspaces as workspace
  join auth.users as owner on owner.id = workspace.owner_user_id
  where workspace.status = 'active'
    and (
      lower(owner.email) = normalized_reference
      or lower(workspace.subscription_code) = normalized_reference
    )
  limit 1;

  if target_workspace.id is null or target_workspace.owner_user_id = current_user_id then
    raise exception 'No active client workspace matches that owner email or subscription code.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.breezy_workspace_members
    where workspace_id = target_workspace.id and user_id = current_user_id and status = 'active'
  ) then
    raise exception 'You already have access to this client workspace.' using errcode = 'P0001';
  end if;

  insert into public.breezy_ca_access_requests (
    workspace_id, requester_user_id, requester_email, requester_name,
    ca_firm_name, message
  ) values (
    target_workspace.id,
    current_user_id,
    coalesce(requester.email, ''),
    coalesce(nullif(requester.full_name, ''), requester.email, 'CA user'),
    requester.ca_firm_name,
    nullif(left(trim(request_message), 500), '')
  )
  on conflict (workspace_id, requester_user_id) where status = 'pending'
  do update set
    message = excluded.message,
    requester_email = excluded.requester_email,
    requester_name = excluded.requester_name,
    ca_firm_name = excluded.ca_firm_name,
    updated_at = now()
  returning id into result_id;

  return jsonb_build_object('id', result_id, 'status', 'pending');
end;
$$;

revoke all on function public.breezy_request_ca_access(text, text) from public;
grant execute on function public.breezy_request_ca_access(text, text) to authenticated;

create or replace function public.breezy_cancel_ca_access_request(target_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.breezy_ca_access_requests
  set status = 'cancelled', updated_at = now()
  where id = target_request_id and requester_user_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'The pending access request could not be found.' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.breezy_cancel_ca_access_request(uuid) from public;
grant execute on function public.breezy_cancel_ca_access_request(uuid) to authenticated;

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
  seat_limit integer;
  seats_reserved integer;
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
    select included_seats + extra_seats into seat_limit
    from public.breezy_subscriptions where workspace_id = access_request.workspace_id;
    select
      (select count(*) from public.breezy_workspace_members where workspace_id = access_request.workspace_id and status in ('active', 'invited'))
      + (select count(*) from public.breezy_workspace_invitations where workspace_id = access_request.workspace_id and status = 'pending')
    into seats_reserved;
    if seats_reserved >= coalesce(seat_limit, 3) then
      raise exception 'All included team accounts are already reserved. Add a paid seat before approving this CA.' using errcode = 'P0001';
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

create or replace function public.breezy_audit_ca_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  audit_workspace_id uuid;
  audit_resource_id text;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  select * into actor from public.profiles where id = auth.uid();
  if coalesce(actor.account_type, 'unselected') <> 'ca' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then
    audit_workspace_id := nullif(to_jsonb(old) ->> 'workspace_id', '')::uuid;
    audit_resource_id := to_jsonb(old) ->> 'id';
  else
    audit_workspace_id := nullif(to_jsonb(new) ->> 'workspace_id', '')::uuid;
    audit_resource_id := to_jsonb(new) ->> 'id';
  end if;
  if audit_workspace_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  insert into public.breezy_workspace_audit_log (
    workspace_id, actor_user_id, actor_email, actor_account_type,
    action, resource_type, resource_id
  ) values (
    audit_workspace_id, auth.uid(), actor.email, actor.account_type,
    lower(tg_op), tg_table_name, audit_resource_id
  );
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.breezy_audit_ca_change() from public;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'breezy_workspace_settings', 'breezy_entities', 'breezy_customers',
    'breezy_invoices', 'breezy_proformas', 'breezy_employees',
    'breezy_payslips', 'breezy_expenses', 'breezy_employee_letters'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop trigger if exists breezy_ca_audit_change on public.%I', table_name);
      execute format(
        'create trigger breezy_ca_audit_change after insert or update or delete on public.%I for each row execute function public.breezy_audit_ca_change()',
        table_name
      );
    end if;
  end loop;
end $$;

-- CA portal users without a client membership must not receive an accidental
-- subscriber workspace during application startup.
create or replace function public.breezy_ensure_my_workspace()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text;
  current_name text;
  current_account_type text;
  result_workspace_id uuid;
begin
  if current_user_id is null then
    raise exception 'You must be signed in to create a workspace.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));

  select users.email,
    coalesce(nullif(users.raw_user_meta_data ->> 'full_name', ''), nullif(users.raw_user_meta_data ->> 'name', ''), split_part(users.email, '@', 1), 'ChanaX workspace'),
    coalesce(profile.account_type, 'unselected')
  into current_email, current_name, current_account_type
  from auth.users as users
  left join public.profiles as profile on profile.id = users.id
  where users.id = current_user_id;

  if pg_catalog.to_regprocedure('public.breezy_accept_pending_invitations(uuid,text)') is not null then
    execute 'select public.breezy_accept_pending_invitations($1, $2)' using current_user_id, current_email;
  end if;

  select workspace_id into result_workspace_id
  from public.breezy_workspace_members
  where user_id = current_user_id and status = 'active'
  order by created_at limit 1;
  if result_workspace_id is not null then return result_workspace_id; end if;
  if current_account_type = 'ca' then return null; end if;

  select id into result_workspace_id from public.breezy_workspaces
  where owner_user_id = current_user_id order by created_at limit 1;
  if result_workspace_id is null then
    insert into public.breezy_workspaces (owner_user_id, name)
    values (current_user_id, current_name) returning id into result_workspace_id;
  end if;
  insert into public.breezy_workspace_members (workspace_id, user_id, role, permissions, status, joined_at)
  values (result_workspace_id, current_user_id, 'owner', '{}'::text[], 'active', now())
  on conflict (workspace_id, user_id) do update set
    role = 'owner', status = 'active', joined_at = coalesce(public.breezy_workspace_members.joined_at, now()), updated_at = now();
  return result_workspace_id;
end;
$$;

revoke all on function public.breezy_ensure_my_workspace() from public;
grant execute on function public.breezy_ensure_my_workspace() to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_account_type text;
begin
  select account_type into saved_account_type from public.profiles where id = new.id;
  insert into public.profiles (id, email, full_name, avatar_path, last_seen_at, account_type)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), 'User'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    now(),
    coalesce(saved_account_type, 'unselected')
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    avatar_path = excluded.avatar_path,
    last_seen_at = excluded.last_seen_at,
    updated_at = now();

  perform public.breezy_accept_pending_invitations(new.id, new.email);

  select account_type into saved_account_type from public.profiles where id = new.id;
  if saved_account_type <> 'ca' and not exists (
    select 1 from public.breezy_workspace_members where user_id = new.id and status = 'active'
  ) then
    insert into public.breezy_workspaces (owner_user_id, name)
    values (
      new.id,
      coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1), 'ChanaX workspace')
    )
    on conflict (owner_user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of raw_user_meta_data, email on auth.users
for each row execute function public.handle_new_auth_user();

insert into public.breezy_schema_versions(version)
values ('2026-09-06-ca-multi-workspace-portal')
on conflict (version) do nothing;

commit;
