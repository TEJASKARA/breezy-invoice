-- Replace the retired public product name in workspace defaults.
-- Internal breezy_* identifiers remain unchanged for data compatibility.

begin;

update public.breezy_workspaces
set name = 'ChanaX workspace', updated_at = now()
where name = 'BreezyInvoice workspace';

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
  result_workspace_id uuid;
begin
  if current_user_id is null then
    raise exception 'You must be signed in to create a workspace.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));

  select
    email,
    coalesce(
      nullif(raw_user_meta_data ->> 'full_name', ''),
      nullif(raw_user_meta_data ->> 'name', ''),
      split_part(email, '@', 1),
      'ChanaX workspace'
    )
  into current_email, current_name
  from auth.users
  where id = current_user_id;

  if pg_catalog.to_regprocedure('public.breezy_accept_pending_invitations(uuid,text)') is not null then
    execute 'select public.breezy_accept_pending_invitations($1, $2)'
    using current_user_id, current_email;
  end if;

  select workspace_id
  into result_workspace_id
  from public.breezy_workspace_members
  where user_id = current_user_id and status = 'active'
  order by created_at
  limit 1;

  if result_workspace_id is not null then
    return result_workspace_id;
  end if;

  select id
  into result_workspace_id
  from public.breezy_workspaces
  where owner_user_id = current_user_id
  order by created_at
  limit 1;

  if result_workspace_id is null then
    insert into public.breezy_workspaces (owner_user_id, name)
    values (current_user_id, current_name)
    returning id into result_workspace_id;
  end if;

  insert into public.breezy_workspace_members
    (workspace_id, user_id, role, permissions, status, joined_at)
  values
    (result_workspace_id, current_user_id, 'owner', '{}'::text[], 'active', now())
  on conflict (workspace_id, user_id) do update set
    role = 'owner',
    status = 'active',
    joined_at = coalesce(public.breezy_workspace_members.joined_at, now()),
    updated_at = now();

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
        'ChanaX workspace'
      )
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
values ('2026-09-05-chanax-brand-defaults')
on conflict (version) do nothing;

commit;
