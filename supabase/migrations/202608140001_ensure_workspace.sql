-- Ensure every authenticated BreezyInvoice user has an active workspace.
-- Safe to run more than once and also repairs accounts created before this migration.

begin;

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

  -- Both app providers can request this during startup, so serialize per user.
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));

  select
    email,
    coalesce(
      nullif(raw_user_meta_data ->> 'full_name', ''),
      nullif(raw_user_meta_data ->> 'name', ''),
      split_part(email, '@', 1),
      'BreezyInvoice workspace'
    )
  into current_email, current_name
  from auth.users
  where id = current_user_id;

  -- An invited user must join the shared workspace instead of receiving a new one.
  perform public.breezy_accept_pending_invitations(current_user_id, current_email);

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

commit;
