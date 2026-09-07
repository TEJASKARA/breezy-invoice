-- Let CA/accounting-firm profiles optionally create one subscription-backed
-- workspace for their own practice. Client workspaces remain client-owned.

begin;

create or replace function public.breezy_create_my_firm_workspace(
  target_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_name text := nullif(trim(target_name), '');
  current_account_type text;
  owned_workspace public.breezy_workspaces%rowtype;
  workspace_created boolean := false;
begin
  if current_user_id is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if normalized_name is null then
    raise exception 'Enter your CA practice or accounting firm name.' using errcode = '22023';
  end if;
  if char_length(normalized_name) > 160 then
    raise exception 'The firm name must be 160 characters or fewer.' using errcode = '22023';
  end if;

  select account_type into current_account_type
  from public.profiles
  where id = current_user_id;

  if current_account_type is distinct from 'ca' then
    raise exception 'Only CA or accounting-firm accounts can create a firm workspace.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(current_user_id::text));

  select * into owned_workspace
  from public.breezy_workspaces
  where owner_user_id = current_user_id
  limit 1;

  if owned_workspace.id is null then
    insert into public.breezy_workspaces (owner_user_id, name)
    values (current_user_id, normalized_name)
    returning * into owned_workspace;
    workspace_created := true;
  else
    insert into public.breezy_workspace_members (
      workspace_id, user_id, role, status, joined_at
    ) values (
      owned_workspace.id, current_user_id, 'owner', 'active', now()
    )
    on conflict (workspace_id, user_id) do update set
      role = 'owner',
      status = 'active',
      joined_at = coalesce(public.breezy_workspace_members.joined_at, now()),
      updated_at = now();
  end if;

  update public.profiles
  set ca_firm_name = coalesce(ca_firm_name, normalized_name),
      updated_at = now()
  where id = current_user_id;

  return jsonb_build_object(
    'workspace_id', owned_workspace.id,
    'workspace_name', owned_workspace.name,
    'created', workspace_created
  );
end;
$$;

revoke all on function public.breezy_create_my_firm_workspace(text) from public;
grant execute on function public.breezy_create_my_firm_workspace(text) to authenticated;

insert into public.breezy_schema_versions(version)
values ('2026-09-07-ca-my-firm-workspace')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
