-- Platform admin "User Management": find users who signed up but never finished
-- workspace setup, and complete that setup on their behalf (with their consent).
-- Every function here is service-role only; the backend checks platform-admin access.

begin;

create table if not exists public.breezy_admin_setup_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.breezy_workspaces(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  firm_name text not null,
  gstin text,
  created_at timestamptz not null default now()
);
alter table public.breezy_admin_setup_audit enable row level security;
revoke all on public.breezy_admin_setup_audit from public, anon, authenticated;
grant select, insert on public.breezy_admin_setup_audit to service_role;

-- Owners of an active workspace whose business setup was never saved.
create or replace function public.breezy_admin_setup_pending(
  excluded_user_ids uuid[] default '{}'
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(pending) order by pending.signed_up_at desc), '[]'::jsonb)
  from (
    select
      users.id as user_id,
      users.email,
      profiles.phone,
      profiles.full_name,
      users.created_at as signed_up_at,
      users.last_sign_in_at,
      workspace.id as workspace_id,
      workspace.subscription_code
    from public.breezy_workspaces workspace
    join auth.users users on users.id = workspace.owner_user_id
    left join public.profiles profiles on profiles.id = users.id
    where workspace.status = 'active'
      and users.deleted_at is null
      and coalesce(profiles.account_type, 'unselected') <> 'ca'
      and not (users.id = any(coalesce(excluded_user_ids, '{}')))
      and not exists (
        select 1 from public.breezy_workspace_settings settings
        where settings.workspace_id = workspace.id and settings.setup is not null
      )
    order by users.created_at desc
    limit 500
  ) pending;
$$;

-- One user by email or subscription code, with their owned workspace and setup state.
create or replace function public.breezy_admin_setup_target(search_identifier text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized text := lower(trim(coalesce(search_identifier, '')));
  target_user_id uuid;
  target_workspace public.breezy_workspaces;
  result jsonb;
begin
  if length(normalized) < 3 then
    raise exception 'Enter the user''s email or subscription code.' using errcode = '22023';
  end if;

  if position('@' in normalized) > 0 then
    select id into target_user_id from auth.users
    where lower(email) = normalized and deleted_at is null
    limit 1;
    if target_user_id is null then
      raise exception 'No user matches %.', trim(search_identifier) using errcode = 'P0002';
    end if;
    select * into target_workspace from public.breezy_workspaces where owner_user_id = target_user_id;
  else
    select * into target_workspace from public.breezy_workspaces
    where lower(subscription_code) = normalized;
    if target_workspace.id is null then
      raise exception 'No workspace matches subscription code %.', upper(trim(search_identifier)) using errcode = 'P0002';
    end if;
    target_user_id := target_workspace.owner_user_id;
  end if;

  select jsonb_build_object(
    'user_id', users.id,
    'email', users.email,
    'phone', profiles.phone,
    'full_name', profiles.full_name,
    'account_type', coalesce(profiles.account_type, 'unselected'),
    'signed_up_at', users.created_at,
    'last_sign_in_at', users.last_sign_in_at,
    'workspace_id', target_workspace.id,
    'workspace_name', target_workspace.name,
    'subscription_code', target_workspace.subscription_code,
    'workspace_status', target_workspace.status,
    'setup_completed', target_workspace.id is not null and exists (
      select 1 from public.breezy_workspace_settings settings
      where settings.workspace_id = target_workspace.id and settings.setup is not null
    ),
    'active_entities', case when target_workspace.id is null then 0 else (
      select count(*) from public.breezy_entities entities
      where entities.workspace_id = target_workspace.id and entities.transferred_at is null
    ) end
  ) into result
  from auth.users users
  left join public.profiles profiles on profiles.id = users.id
  where users.id = target_user_id;

  return result;
end;
$$;

-- Saves the business setup and first entity exactly as onboarding would.
create or replace function public.breezy_admin_complete_setup(
  target_workspace_id uuid,
  setup_payload jsonb,
  entity_id uuid,
  entity_payload jsonb,
  target_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace public.breezy_workspaces;
  owner_account_type text;
  owner_email text;
  owner_name text;
  normalized_gstin text := upper(regexp_replace(coalesce(setup_payload ->> 'gstin', ''), '\s+', '', 'g'));
begin
  if target_actor_user_id is null or not exists (select 1 from auth.users where id = target_actor_user_id) then
    raise exception 'A valid platform administrator is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(setup_payload) <> 'object' or jsonb_typeof(entity_payload) <> 'object' then
    raise exception 'The setup details are invalid.' using errcode = '22023';
  end if;
  if nullif(trim(setup_payload ->> 'firmName'), '') is null
     or nullif(trim(setup_payload ->> 'mailingAddress'), '') is null
     or nullif(trim(setup_payload ->> 'industry'), '') is null then
    raise exception 'Enter the business name, industry and mailing address.' using errcode = '22023';
  end if;
  if coalesce(setup_payload ->> 'accountType', '') <> 'founder' then
    raise exception 'Admin setup is available for business-owner accounts only.' using errcode = '22023';
  end if;

  select * into target_workspace from public.breezy_workspaces where id = target_workspace_id for update;
  if target_workspace.id is null then
    raise exception 'This workspace no longer exists.' using errcode = 'P0002';
  end if;
  if target_workspace.status <> 'active' then
    raise exception 'Only an active workspace can be set up.' using errcode = '22023';
  end if;

  select coalesce(profiles.account_type, 'unselected'), users.email, profiles.full_name
  into owner_account_type, owner_email, owner_name
  from auth.users users left join public.profiles profiles on profiles.id = users.id
  where users.id = target_workspace.owner_user_id;
  if owner_account_type not in ('unselected', 'founder') then
    raise exception 'This user chose a % account. Admin setup is for business-owner accounts only.', owner_account_type using errcode = '22023';
  end if;

  if exists (select 1 from public.breezy_workspace_settings where workspace_id = target_workspace.id and setup is not null) then
    raise exception 'This account has already completed setup.' using errcode = '23505';
  end if;

  update public.profiles
  set account_type = 'founder', ca_firm_name = null, updated_at = now()
  where id = target_workspace.owner_user_id;

  update public.breezy_workspace_settings
  set setup = setup_payload
  where workspace_id = target_workspace.id;
  if not found then
    insert into public.breezy_workspace_settings (user_id, workspace_id, setup)
    values (target_workspace.owner_user_id, target_workspace.id, setup_payload);
  end if;

  -- Same rule as onboarding: one initial entity, never a duplicate on retry.
  if not exists (
    select 1 from public.breezy_entities
    where workspace_id = target_workspace.id and transferred_at is null
  ) then
    insert into public.breezy_entities (id, user_id, workspace_id, payload)
    values (entity_id, target_workspace.owner_user_id, target_workspace.id, entity_payload - 'id' - 'transferredAt');
  end if;

  insert into public.breezy_admin_setup_audit (workspace_id, owner_user_id, actor_user_id, firm_name, gstin)
  values (target_workspace.id, target_workspace.owner_user_id, target_actor_user_id,
    trim(setup_payload ->> 'firmName'), nullif(normalized_gstin, ''));

  return jsonb_build_object(
    'workspace_id', target_workspace.id,
    'owner_user_id', target_workspace.owner_user_id,
    'email', owner_email,
    'full_name', owner_name,
    'subscription_code', target_workspace.subscription_code,
    'gstin', nullif(normalized_gstin, '')
  );
end;
$$;

-- Early GSTIN conflict check for a specific target workspace (the save also enforces it).
create or replace function public.breezy_admin_gstin_available(target_workspace_id uuid, target_gstin text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.breezy_assert_unique_gstin(target_workspace_id, null, target_gstin);
  return true;
exception
  when unique_violation then
    return false;
end;
$$;

revoke all on function public.breezy_admin_setup_pending(uuid[]) from public, anon, authenticated;
revoke all on function public.breezy_admin_setup_target(text) from public, anon, authenticated;
revoke all on function public.breezy_admin_complete_setup(uuid, jsonb, uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.breezy_admin_gstin_available(uuid, text) from public, anon, authenticated;
grant execute on function public.breezy_admin_setup_pending(uuid[]) to service_role;
grant execute on function public.breezy_admin_setup_target(text) to service_role;
grant execute on function public.breezy_admin_complete_setup(uuid, jsonb, uuid, jsonb, uuid) to service_role;
grant execute on function public.breezy_admin_gstin_available(uuid, text) to service_role;

insert into public.breezy_schema_versions(version)
values ('2026-10-31-admin-user-setup')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
commit;
