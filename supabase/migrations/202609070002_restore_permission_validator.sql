-- Restore the permission validator required by team invitations, member edits
-- and CA access approvals. Some production databases predate the migration
-- that originally introduced this helper.

begin;

create or replace function public.breezy_validate_permissions(candidate text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(candidate, '{}'::text[]) <@ array[
    'workspace.read', 'workspace.manage', 'team.manage',
    'entities.read', 'entities.manage',
    'invoices.read', 'invoices.manage',
    'payslips.read', 'payslips.manage',
    'expenses.read', 'expenses.manage',
    'data_export.read', 'data_export.manage',
    'templates.read', 'templates.manage'
  ]::text[];
$$;

revoke all on function public.breezy_validate_permissions(text[]) from public;
grant execute on function public.breezy_validate_permissions(text[]) to authenticated;

insert into public.breezy_schema_versions(version)
values ('2026-09-07-restore-permission-validator')
on conflict (version) do nothing;

commit;

notify pgrst, 'reload schema';
