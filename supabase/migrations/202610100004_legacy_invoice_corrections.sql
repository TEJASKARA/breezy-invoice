-- Allow correcting invoices that were saved before invoices were linked to a company.
-- Such invoices have entity_id = null; the correction check now resolves their
-- company through the customer or the issuing-company name, exactly as new
-- invoices are resolved. Cross-company corrections stay forbidden.
-- Replaces public.breezy_transfer_record_guard() only. Safe to re-run.
begin;

create or replace function public.breezy_transfer_record_guard()
returns trigger language plpgsql set search_path = '' as $$
declare entity uuid; current_workspace uuid; company public.breezy_entities; linked_entity uuid; linked_id uuid;
  linked_customer uuid; linked_name text;
begin
  if public.breezy_transfer_privileged() then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op <> 'INSERT' then
    if tg_op = 'UPDATE' and new.workspace_id <> old.workspace_id then
      raise exception 'Use the owner-approved company transfer option to move records between accounts.';
    end if;
    entity := old.entity_id; current_workspace := old.workspace_id;
    if entity is null and tg_table_name = 'breezy_invoices' then
      select e.id into entity from public.breezy_entities e where e.workspace_id = current_workspace
        and lower(trim(e.payload ->> 'companyName')) = lower(trim(old.payload ->> 'entityName')) and e.transferred_at is not null limit 1;
    end if;
    if exists (select 1 from public.breezy_entities where id = entity and transferred_at is not null) then
      if tg_op = 'UPDATE' and to_jsonb(new) - 'updated_at' = to_jsonb(old) - 'updated_at' then return new; end if;
      raise exception 'Historical records of a moved company are read-only.';
    end if;
  end if;
  if tg_op <> 'DELETE' then
    entity := new.entity_id; current_workspace := new.workspace_id;
    if entity is null and tg_table_name = 'breezy_invoices' then
      if new.customer_id is not null then
        select c.entity_id into entity from public.breezy_customers c where c.id = new.customer_id and c.workspace_id = current_workspace;
      else
        select e.id into entity from public.breezy_entities e where e.workspace_id = current_workspace
          and lower(trim(e.payload ->> 'companyName')) = lower(trim(new.payload ->> 'entityName'))
          order by e.transferred_at nulls first limit 1;
      end if;
      new.entity_id := entity;
    end if;
    if entity is not null then
      select * into company from public.breezy_entities where id = entity and workspace_id = current_workspace for share;
      if not found or company.transferred_at is not null then raise exception 'Select an active company in this workspace.'; end if;
    end if;
    if tg_table_name in ('breezy_invoices', 'breezy_proformas') and nullif(to_jsonb(new) ->> 'customer_id', '') is not null then
      select c.entity_id into linked_entity from public.breezy_customers c
        where c.id = new.customer_id and c.workspace_id = current_workspace;
      if not found or linked_entity is distinct from entity then raise exception 'Select a customer belonging to this active company.'; end if;
    end if;
    if tg_table_name in ('breezy_payslips', 'breezy_employee_letters') and nullif(to_jsonb(new) ->> 'employee_id', '') is not null then
      select e.entity_id into linked_entity from public.breezy_employees e
        where e.id = new.employee_id and e.workspace_id = current_workspace;
      if not found or linked_entity is distinct from entity then raise exception 'Select an employee belonging to this active company.'; end if;
    end if;
    if tg_table_name = 'breezy_invoices' then
      linked_id := coalesce(new.source_proforma_id, nullif(new.payload ->> 'sourceProformaId', '')::uuid);
      if linked_id is not null then
        select p.entity_id into linked_entity from public.breezy_proformas p
          where p.id = linked_id and p.workspace_id = current_workspace;
        if not found or linked_entity is distinct from entity then raise exception 'The source quotation must belong to this active company.'; end if;
      end if;
      foreach linked_id in array array[nullif(new.payload ->> 'correctsInvoiceId', '')::uuid,
        nullif(new.payload #>> '{correction,replacementInvoiceId}', '')::uuid] loop
        if linked_id is not null then
          select i.entity_id, i.customer_id, i.payload ->> 'entityName'
            into linked_entity, linked_customer, linked_name from public.breezy_invoices i
            where i.id = linked_id and i.workspace_id = current_workspace;
          if not found then raise exception 'Invoice corrections must stay within the same active company.'; end if;
          -- Invoices saved before companies were linked have no entity_id yet:
          -- resolve them the same way new invoices are (customer, then issuing company name).
          if linked_entity is null and linked_customer is not null then
            select c.entity_id into linked_entity from public.breezy_customers c
              where c.id = linked_customer and c.workspace_id = current_workspace;
          end if;
          if linked_entity is null and entity is not null
            and lower(trim(linked_name)) = lower(trim(company.payload ->> 'companyName')) then
            linked_entity := entity;
          end if;
          if linked_entity is distinct from entity then raise exception 'Invoice corrections must stay within the same active company.'; end if;
        end if;
      end loop;
    end if;
    if tg_table_name = 'breezy_proformas' then
      linked_id := coalesce(new.converted_invoice_id, nullif(new.payload ->> 'convertedInvoiceId', '')::uuid);
      if linked_id is not null then
        select i.entity_id into linked_entity from public.breezy_invoices i where i.id = linked_id and i.workspace_id = current_workspace;
        if not found or linked_entity is distinct from entity then raise exception 'The converted invoice must belong to this active company.'; end if;
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

insert into public.breezy_schema_versions(version)
values ('2026-10-10-legacy-invoice-corrections')
on conflict (version) do nothing;

commit;
