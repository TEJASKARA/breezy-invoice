-- Phone-only sign-ups have no email. Team invitations are matched by email,
-- so there is nothing to accept yet: skip instead of failing the sign-up
-- ("Database error saving new user"). When the user later adds an email,
-- handle_new_auth_user runs again (on email update) and accepts invitations.
-- Run after 202611100003_admin_analytics_payment_links.sql. Safe to re-run.
begin;

create or replace function public.breezy_accept_pending_invitations(target_user_id uuid, target_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation record;
begin
  if nullif(trim(coalesce(target_email, '')), '') is null then
    return;
  end if;

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

revoke all on function public.breezy_accept_pending_invitations(uuid, text) from public;

insert into public.breezy_schema_versions(version)
values ('2026-11-10-phone-signup-invitations')
on conflict (version) do nothing;

commit;
