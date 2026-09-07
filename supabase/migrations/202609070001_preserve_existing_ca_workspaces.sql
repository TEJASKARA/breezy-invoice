-- Allow existing CA/accounting-firm users to adopt the CA portal without
-- deleting their configured legacy workspace, subscription, credits or data.

begin;

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

      if not workspace_has_business_data then
        delete from public.breezy_workspaces where id = owned_workspace_id;
      end if;
    end if;
  end if;

  update public.profiles
  set account_type = target_account_type,
      ca_firm_name = case when target_account_type = 'ca' then normalized_firm_name else null end,
      updated_at = now()
  where id = current_user_id;

  return jsonb_build_object(
    'account_type', target_account_type,
    'ca_firm_name', case when target_account_type = 'ca' then normalized_firm_name else null end,
    'existing_workspace_preserved', target_account_type = 'ca' and workspace_has_business_data
  );
end;
$$;

revoke all on function public.breezy_set_account_type(text, text) from public;
grant execute on function public.breezy_set_account_type(text, text) to authenticated;

insert into public.breezy_schema_versions(version)
values ('2026-09-07-preserve-existing-ca-workspaces')
on conflict (version) do nothing;

commit;
