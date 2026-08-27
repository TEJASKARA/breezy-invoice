-- Supporting RPC for FastAPI invitation-email delivery rollback.
-- Existing invitation RPCs and RLS remain the source of truth for role,
-- page-access and seat-limit checks.

begin;

create or replace function public.breezy_revoke_workspace_invitation_by_email(
  target_workspace_id uuid,
  target_email text
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
  where workspace_id = target_workspace_id
    and lower(email) = lower(trim(target_email))
    and status = 'pending';
end;
$$;

revoke all on function public.breezy_revoke_workspace_invitation_by_email(uuid, text) from public;
grant execute on function public.breezy_revoke_workspace_invitation_by_email(uuid, text) to authenticated;

insert into public.breezy_schema_versions(version)
values ('2026-08-27-team-invitation-delivery-v1')
on conflict (version) do nothing;

commit;
