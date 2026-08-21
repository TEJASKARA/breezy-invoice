-- Repair teammate profile visibility and lock down invitation acceptance.
-- Safe to run after the BreezyInvoice workspace/team migrations.

begin;

alter table public.profiles add column if not exists email text;

update public.profiles as profiles
set email = users.email
from auth.users as users
where profiles.id = users.id and profiles.email is distinct from users.email;

create or replace function public.breezy_shares_workspace_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.breezy_workspace_members as mine
    join public.breezy_workspace_members as teammate
      on teammate.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and teammate.user_id = target_user_id
      and teammate.status = 'active'
  );
$$;

drop policy if exists "Workspace members read teammate profiles" on public.profiles;
create policy "Workspace members read teammate profiles"
on public.profiles for select to authenticated
using (public.breezy_shares_workspace_with(id));

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

revoke all on function public.breezy_accept_pending_invitations(uuid, text) from public;
revoke all on function public.breezy_shares_workspace_with(uuid) from public;
grant execute on function public.breezy_shares_workspace_with(uuid) to authenticated;

-- Keep user-scoped uploads working while allowing teammates to access a bill when
-- its expense record belongs to a workspace they can read or manage.
drop policy if exists "Users upload their own expense bills" on storage.objects;
drop policy if exists "Users read their own expense bills" on storage.objects;
drop policy if exists "Users delete their own expense bills" on storage.objects;
drop policy if exists "Workspace members upload expense bills" on storage.objects;
drop policy if exists "Workspace members read expense bills" on storage.objects;
drop policy if exists "Workspace managers delete expense bills" on storage.objects;

create policy "Workspace members upload expense bills" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'expense-bills'
  and (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    or public.breezy_has_permission(((storage.foldername(name))[1])::uuid, 'expenses.manage')
  )
);

create policy "Workspace members read expense bills" on storage.objects
for select to authenticated
using (
  bucket_id = 'expense-bills'
  and (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    or public.breezy_has_permission(((storage.foldername(name))[1])::uuid, 'expenses.read')
    or exists (
      select 1 from public.breezy_expenses
      where breezy_expenses.payload ->> 'billPath' = storage.objects.name
        and public.breezy_has_permission(breezy_expenses.workspace_id, 'expenses.read')
    )
  )
);

create policy "Workspace managers delete expense bills" on storage.objects
for delete to authenticated
using (
  bucket_id = 'expense-bills'
  and (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    or public.breezy_has_permission(((storage.foldername(name))[1])::uuid, 'expenses.manage')
    or exists (
      select 1 from public.breezy_expenses
      where breezy_expenses.payload ->> 'billPath' = storage.objects.name
        and public.breezy_has_permission(breezy_expenses.workspace_id, 'expenses.manage')
    )
  )
);

insert into public.breezy_schema_versions(version)
values ('2026-08-21-security-profile-hardening-v1')
on conflict (version) do nothing;

commit;
