-- Confirmed, owner-only deletion. Apply after the entity transfer migration.
begin;

-- No workspace FK: cleanup must survive subsequent account removal.
create table public.breezy_entity_file_cleanup (
  id uuid primary key default gen_random_uuid(),
  bill_path text not null unique,
  created_at timestamptz not null default now()
);
alter table public.breezy_entity_file_cleanup enable row level security;
revoke all on public.breezy_entity_file_cleanup from public, anon, authenticated;
grant select, delete on public.breezy_entity_file_cleanup to service_role;

create function public.breezy_delete_entity(
  target_workspace_id uuid, target_entity_id uuid, confirmed_company_name text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  company public.breezy_entities;
  customer_ids uuid[];
  employee_ids uuid[];
  invoice_ids uuid[];
  quotation_ids uuid[];
  linked_table text;
  foreign_workspace boolean;
begin
  perform 1 from public.breezy_workspaces
    where id = target_workspace_id and owner_user_id = auth.uid()
      and auth.uid() is not null and status = 'active' for update;
  if not found then
    raise exception 'Only the active workspace owner can permanently delete a company.' using errcode = '42501';
  end if;
  select * into company from public.breezy_entities
    where id = target_entity_id and workspace_id = target_workspace_id for update;
  if not found then raise exception 'Company not found. Refresh your workspace.'; end if;
  if company.transferred_at is not null then
    raise exception 'Moved companies are read-only. This option cannot delete the receiving account data.';
  end if;
  if confirmed_company_name is null or confirmed_company_name <> company.payload ->> 'companyName' then
    raise exception 'Type the company name exactly to confirm permanent deletion.';
  end if;
  if exists(select 1 from public.breezy_entity_transfers
    where source_entity_id = company.id and status = 'pending' and expires_at > now()) then
    raise exception 'Cancel the pending account transfer before deleting this company.';
  end if;
  -- Legacy or corrupted rows must not be removed from another workspace by FK cascade.
  foreach linked_table in array array['breezy_customers', 'breezy_invoices',
    'breezy_proformas', 'breezy_employees', 'breezy_payslips',
    'breezy_employee_letters', 'breezy_expenses'] loop
    execute format('select exists(select 1 from public.%I where entity_id = $1 and workspace_id is distinct from $2)', linked_table)
      into foreign_workspace using company.id, target_workspace_id;
    if foreign_workspace then
      raise exception 'Other workspace records reference this entity. Resolve their links before deleting.';
    end if;
  end loop;
  select coalesce(array_agg(id), '{}'::uuid[]) into customer_ids
    from public.breezy_customers where workspace_id = target_workspace_id and entity_id = company.id;
  select coalesce(array_agg(id), '{}'::uuid[]) into employee_ids
    from public.breezy_employees where workspace_id = target_workspace_id and entity_id = company.id;
  if exists(select 1 from public.breezy_entities e where e.workspace_id = target_workspace_id
    and e.id <> company.id and lower(trim(e.payload ->> 'companyName')) = lower(trim(company.payload ->> 'companyName')))
    and (exists(select 1 from public.breezy_invoices i where i.workspace_id = target_workspace_id
      and i.entity_id is null and i.customer_id is null
      and lower(trim(i.payload ->> 'entityName')) = lower(trim(company.payload ->> 'companyName')))
      or exists(select 1 from public.breezy_proformas p where p.workspace_id = target_workspace_id
        and p.entity_id is null and p.customer_id is null
        and lower(trim(p.payload ->> 'entityName')) = lower(trim(company.payload ->> 'companyName')))) then
    raise exception 'Legacy documents have an ambiguous company name. Resolve their company links before deleting.';
  end if;
  select coalesce(array_agg(id), '{}'::uuid[]) into invoice_ids from public.breezy_invoices i
    where i.workspace_id = target_workspace_id and (i.entity_id = company.id or (i.entity_id is null
      and (i.customer_id = any(customer_ids) or (i.customer_id is null
        and lower(trim(i.payload ->> 'entityName')) = lower(trim(company.payload ->> 'companyName'))))));
  select coalesce(array_agg(id), '{}'::uuid[]) into quotation_ids from public.breezy_proformas p
    where p.workspace_id = target_workspace_id and (p.entity_id = company.id
      or (p.entity_id is null and (p.customer_id = any(customer_ids)
        or (p.customer_id is null and lower(trim(p.payload ->> 'entityName')) = lower(trim(company.payload ->> 'companyName'))))));

  -- Do not alter another company's documents via cascading or SET NULL links.
  if exists(select 1 from public.breezy_invoices i where not i.id = any(invoice_ids)
    and (i.customer_id = any(customer_ids) or i.source_proforma_id = any(quotation_ids)
      or i.payload ->> 'sourceProformaId' = any(quotation_ids::text[])
      or i.payload ->> 'correctsInvoiceId' = any(invoice_ids::text[])
      or i.payload #>> '{correction,replacementInvoiceId}' = any(invoice_ids::text[])))
    or exists(select 1 from public.breezy_proformas p where not p.id = any(quotation_ids)
      and (p.customer_id = any(customer_ids) or p.converted_invoice_id = any(invoice_ids)
        or p.payload ->> 'convertedInvoiceId' = any(invoice_ids::text[])))
    or exists(select 1 from public.breezy_employee_letters l
      where l.employee_id = any(employee_ids) and l.entity_id is distinct from company.id)
    or exists(select 1 from public.breezy_payslips p
      where p.employee_id = any(employee_ids) and p.entity_id is distinct from company.id) then
    raise exception 'Other company records depend on this entity. Resolve their links before deleting.';
  end if;

  insert into public.breezy_entity_file_cleanup(bill_path)
    select distinct payload ->> 'billPath' from public.breezy_expenses
    where workspace_id = target_workspace_id and entity_id = company.id
      and nullif(payload ->> 'billPath', '') is not null
    on conflict(bill_path) do nothing;

  delete from public.breezy_invoices where id = any(invoice_ids);
  delete from public.breezy_proformas where id = any(quotation_ids);
  delete from public.breezy_employee_letters where workspace_id = target_workspace_id and entity_id = company.id;
  delete from public.breezy_payslips where workspace_id = target_workspace_id and entity_id = company.id;
  delete from public.breezy_expenses where workspace_id = target_workspace_id and entity_id = company.id;
  delete from public.breezy_employees where id = any(employee_ids);
  delete from public.breezy_customers where id = any(customer_ids);
  update public.breezy_workspace_settings set
    setup = case when setup is null then null else jsonb_set(setup, '{attendanceDrafts}',
      coalesce((select jsonb_object_agg(key, value) from jsonb_each(coalesce(setup -> 'attendanceDrafts', '{}'))
        where value ->> 'entityId' is distinct from company.id::text and split_part(key, ':', 1) <> company.id::text), '{}')) end,
    template = coalesce(template, '{}') #- array['entityTemplates', company.id::text],
    transferred_attendance = coalesce((select jsonb_object_agg(key, value)
      from jsonb_each(transferred_attendance) where value ->> 'entityId' is distinct from company.id::text), '{}')
    where workspace_id = target_workspace_id;
  delete from public.breezy_entities where id = company.id;
  -- Keep credit debits, payment records and a minimal audit trail. No refund.
  insert into public.breezy_workspace_audit_log(workspace_id, actor_user_id, action, resource_type, resource_id, details)
    values(target_workspace_id, auth.uid(), 'entity_permanently_deleted', 'entity', company.id::text,
      jsonb_build_object('invoice_count', cardinality(invoice_ids), 'quotation_count', cardinality(quotation_ids)));
  return jsonb_build_object('invoice_ids', invoice_ids, 'quotation_ids', quotation_ids);
end;
$$;
revoke all on function public.breezy_delete_entity(uuid, uuid, text) from public, anon;
grant execute on function public.breezy_delete_entity(uuid, uuid, text) to authenticated;
notify pgrst, 'reload schema';
commit;
