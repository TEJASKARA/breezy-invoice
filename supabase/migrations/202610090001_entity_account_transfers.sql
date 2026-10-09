-- Owner-approved moves to a separate company account. No subscriptions or seats move.
begin;

alter table public.breezy_entities
  add column if not exists transferred_at timestamptz,
  add column if not exists transferred_to_workspace_id uuid
    references public.breezy_workspaces(id) on delete set null;
alter table public.breezy_invoices add column if not exists entity_id uuid
  references public.breezy_entities(id) on delete restrict;
alter table public.breezy_workspace_settings
  add column if not exists transferred_attendance jsonb not null default '{}';

-- Deferred NO ACTION allows normal workspace/auth cascades to delete retained
-- history together, without allowing a standalone entity deletion with invoices.
do $$ declare constraint_name text; begin
  for constraint_name in select c.conname from pg_catalog.pg_constraint c
    where c.conrelid = 'public.breezy_invoices'::regclass
      and c.confrelid = 'public.breezy_entities'::regclass and c.contype = 'f'
  loop execute format('alter table public.breezy_invoices drop constraint %I', constraint_name); end loop;
end $$;
alter table public.breezy_invoices add constraint breezy_invoices_entity_id_fkey
  foreign key(entity_id) references public.breezy_entities(id) deferrable initially deferred;
update public.breezy_invoices i set entity_id = c.entity_id
  from public.breezy_customers c where i.entity_id is null and i.customer_id = c.id and i.workspace_id = c.workspace_id;
update public.breezy_invoices i set entity_id = matched.id
  from (select workspace_id, lower(trim(payload ->> 'companyName')) company_name,
      (array_agg(id))[1] id from public.breezy_entities group by workspace_id, lower(trim(payload ->> 'companyName')) having count(*) = 1) matched
  where i.entity_id is null and i.customer_id is null and i.workspace_id = matched.workspace_id
    and lower(trim(i.payload ->> 'entityName')) = matched.company_name;
update public.breezy_proformas p set entity_id = c.entity_id from public.breezy_customers c
  where p.entity_id is null and p.customer_id = c.id and p.workspace_id = c.workspace_id;

create table public.breezy_entity_transfers (
  id uuid primary key default gen_random_uuid(),
  source_workspace_id uuid not null references public.breezy_workspaces(id) on delete cascade,
  target_workspace_id uuid not null references public.breezy_workspaces(id) on delete cascade,
  source_entity_id uuid not null references public.breezy_entities(id) on delete cascade,
  target_entity_id uuid references public.breezy_entities(id) on delete set null,
  company_name text not null,
  company_snapshot jsonb not null,
  move_history boolean not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'cancelled', 'expired')),
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  resolved_at timestamptz
);
create unique index breezy_entity_pending_transfer on public.breezy_entity_transfers(source_entity_id)
  where status = 'pending';
alter table public.breezy_entity_transfers enable row level security;
revoke all on public.breezy_entity_transfers from anon, authenticated;
grant select on public.breezy_entity_transfers to authenticated;
create policy entity_transfer_owners_read on public.breezy_entity_transfers for select to authenticated
using (exists (select 1 from public.breezy_workspaces w
  where w.id in (source_workspace_id, target_workspace_id)
    and w.owner_user_id = auth.uid() and w.status = 'active'));

-- Private provenance survives deletion of the source account and its credit ledger.
create table public.breezy_transferred_documents (
  workspace_id uuid not null references public.breezy_workspaces(id) on delete cascade,
  document_type text not null check (document_type in ('invoice', 'proforma', 'payslip')),
  document_id uuid not null,
  primary key (workspace_id, document_type, document_id)
);
alter table public.breezy_transferred_documents enable row level security;
revoke all on public.breezy_transferred_documents from public, anon, authenticated;

create or replace function public.breezy_assert_unique_gstin(
  target_workspace_id uuid, target_entity_id uuid, target_gstin text
) returns void language plpgsql security definer set search_path = '' as $$
declare normalized_gstin text := public.breezy_normalize_gstin(target_gstin);
begin
  if normalized_gstin = '' then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(normalized_gstin, 109));
  if exists (select 1 from public.breezy_workspace_settings s
    where s.workspace_id <> target_workspace_id
      and public.breezy_normalize_gstin(s.setup ->> 'gstin') = normalized_gstin)
    or exists (select 1 from public.breezy_entities e where e.transferred_at is null
      and public.breezy_normalize_gstin(e.payload ->> 'gstin') = normalized_gstin
      and (e.workspace_id <> target_workspace_id
        or (target_entity_id is not null and e.id <> target_entity_id))) then
    raise exception 'This GST number is already registered in ChanaX.' using errcode = '23505';
  end if;
end;
$$;

create or replace function public.breezy_entities_unique_gstin_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.transferred_at is null then
    perform public.breezy_assert_unique_gstin(new.workspace_id, new.id, new.payload ->> 'gstin');
  end if;
  return new;
end;
$$;

create function public.breezy_request_entity_transfer(
  target_workspace_id uuid, target_entity_id uuid,
  destination_reference text, transfer_history boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  source public.breezy_workspaces;
  destination public.breezy_workspaces;
  company public.breezy_entities;
  request_id uuid;
begin
  select * into source from public.breezy_workspaces
    where id = target_workspace_id and owner_user_id = auth.uid() and status = 'active'
    for update;
  if not found then raise exception 'Only the active workspace owner can move a company.' using errcode = '42501'; end if;
  select * into company from public.breezy_entities
    where id = target_entity_id and workspace_id = source.id and transferred_at is null for update;
  if not found then raise exception 'This company is not available for transfer.'; end if;
  if exists (select 1 from public.breezy_workspace_settings s where s.workspace_id = source.id
    and public.breezy_normalize_gstin(company.payload ->> 'gstin') <> ''
    and public.breezy_normalize_gstin(s.setup ->> 'gstin') = public.breezy_normalize_gstin(company.payload ->> 'gstin')) then
    raise exception 'Your primary registered company cannot be moved using this additional-company transfer option.';
  end if;
  select w.* into destination from public.breezy_workspaces w join auth.users u on u.id = w.owner_user_id
    where w.status = 'active' and (lower(u.email) = lower(trim(destination_reference))
      or w.subscription_code = upper(trim(destination_reference)));
  if not found or destination.id = source.id then
    raise exception 'Enter the owner email or subscription code of a different active company account.';
  end if;
  if exists (select 1 from public.profiles p where p.id = destination.owner_user_id and p.account_type = 'ca') then
    raise exception 'Use a separate company account, not a client-access-only CA portal.';
  end if;
  if exists (select 1 from public.breezy_entities e where e.workspace_id = destination.id and e.transferred_at is null) then
    raise exception 'The receiving account must have no active companies. Create a separate account first.';
  end if;
  update public.breezy_entity_transfers set status = 'expired', resolved_at = now()
    where source_entity_id = company.id and status = 'pending' and expires_at <= now();
  insert into public.breezy_entity_transfers
    (source_workspace_id, target_workspace_id, source_entity_id, company_name, company_snapshot, move_history, requested_by)
    values (source.id, destination.id, company.id, company.payload ->> 'companyName', company.payload, transfer_history, auth.uid())
    returning id into request_id;
  insert into public.breezy_workspace_audit_log(workspace_id, actor_user_id, action, resource_type, resource_id, details)
    select w, auth.uid(), 'entity_transfer_requested', 'entity_transfer', request_id::text,
      jsonb_build_object('company', company.payload ->> 'companyName', 'move_history', transfer_history,
        'source_workspace_id', source.id, 'target_workspace_id', destination.id)
    from unnest(array[source.id, destination.id]) w;
  return request_id;
end;
$$;

create function public.breezy_review_entity_transfer(transfer_id uuid, approve_transfer boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  request public.breezy_entity_transfers;
  source public.breezy_workspaces;
  destination public.breezy_workspaces;
  company public.breezy_entities;
  new_entity uuid := gen_random_uuid();
  source_settings public.breezy_workspace_settings;
  target_settings public.breezy_workspace_settings;
  invoice_ids uuid[];
  customer_ids uuid[];
  proforma_ids uuid[];
  employee_ids uuid[];
  draft record;
  moved_attendance jsonb := '{}';
  new_template jsonb;
begin
  if approve_transfer is null then raise exception 'Choose accept or reject explicitly.'; end if;
  select * into request from public.breezy_entity_transfers where id = transfer_id for update;
  if not found then raise exception 'Transfer request not found.'; end if;
  -- Stable lock order serializes acceptance against account deletion and other moves.
  perform 1 from public.breezy_workspaces where id in (request.source_workspace_id, request.target_workspace_id)
    order by id for update;
  select * into source from public.breezy_workspaces where id = request.source_workspace_id;
  select * into destination from public.breezy_workspaces where id = request.target_workspace_id;
  if destination.owner_user_id is distinct from auth.uid() or auth.uid() is null or destination.status <> 'active' then
    raise exception 'Only the receiving account owner can review this transfer.' using errcode = '42501';
  end if;
  if request.status = 'accepted' then return request.target_entity_id; end if;
  if request.status <> 'pending' or request.expires_at <= now() then raise exception 'This transfer is no longer pending or has expired.'; end if;
  if not approve_transfer then
    update public.breezy_entity_transfers set status = 'rejected', resolved_at = now() where id = request.id;
  else
    if source.status <> 'active' then raise exception 'The source account is no longer active.'; end if;
    if exists (select 1 from public.profiles where id = destination.owner_user_id and account_type = 'ca') then
      raise exception 'Receive this company in a company account, not a CA portal.';
    end if;
    if exists (select 1 from public.breezy_entities where workspace_id = destination.id and transferred_at is null) then
      raise exception 'The receiving account must have no active companies.';
    end if;
    select * into company from public.breezy_entities where id = request.source_entity_id
      and workspace_id = source.id and transferred_at is null for update;
    if not found then raise exception 'The source company is no longer available.'; end if;
    if company.payload is distinct from request.company_snapshot then
      raise exception 'Company details or invoice numbering changed after this request. Cancel it and request approval again.';
    end if;
    select * into source_settings from public.breezy_workspace_settings where workspace_id = source.id for update;
    select * into target_settings from public.breezy_workspace_settings where workspace_id = destination.id for update;
    if public.breezy_normalize_gstin(company.payload ->> 'gstin') <> ''
      and public.breezy_normalize_gstin(source_settings.setup ->> 'gstin') = public.breezy_normalize_gstin(company.payload ->> 'gstin') then
      raise exception 'Your primary registered company cannot be moved using this option.';
    end if;
    select coalesce(array_agg(id), '{}'::uuid[]) into customer_ids from public.breezy_customers
      where workspace_id = source.id and entity_id = company.id;
    select coalesce(array_agg(id), '{}'::uuid[]) into employee_ids from public.breezy_employees
      where workspace_id = source.id and entity_id = company.id;
    if request.move_history and exists (select 1 from public.breezy_entities e
      where e.workspace_id = source.id and e.id <> company.id
        and lower(trim(e.payload ->> 'companyName')) = lower(trim(company.payload ->> 'companyName')))
      and exists (select 1 from public.breezy_invoices i where i.workspace_id = source.id and i.entity_id is null
        and i.customer_id is null and lower(trim(i.payload ->> 'entityName')) = lower(trim(company.payload ->> 'companyName'))) then
      raise exception 'Legacy invoices have an ambiguous company name. Resolve their company links before transferring history.';
    end if;
    select coalesce(array_agg(id), '{}'::uuid[]) into invoice_ids from public.breezy_invoices i
      where i.workspace_id = source.id and (i.entity_id = company.id or (i.entity_id is null and
        (i.customer_id = any(customer_ids) or (i.customer_id is null
          and lower(trim(i.payload ->> 'entityName')) = lower(trim(company.payload ->> 'companyName'))))));
    select coalesce(array_agg(id), '{}'::uuid[]) into proforma_ids from public.breezy_proformas p
      where p.workspace_id = source.id and (p.entity_id = company.id
        or (p.entity_id is null and p.customer_id = any(customer_ids)));
    if request.move_history then
      -- Refuse inconsistent cross-company links rather than silently breaking them.
      if exists (select 1 from public.breezy_invoices i where i.id = any(invoice_ids)
        and ((i.customer_id is not null and not i.customer_id = any(customer_ids))
          or (i.source_proforma_id is not null and not i.source_proforma_id = any(proforma_ids))
          or (nullif(i.payload ->> 'sourceProformaId', '') is not null and not (i.payload ->> 'sourceProformaId')::uuid = any(proforma_ids))
          or (nullif(i.payload ->> 'correctsInvoiceId', '') is not null and not (i.payload ->> 'correctsInvoiceId')::uuid = any(invoice_ids))
          or (nullif(i.payload #>> '{correction,replacementInvoiceId}', '') is not null and not (i.payload #>> '{correction,replacementInvoiceId}')::uuid = any(invoice_ids))))
        or exists (select 1 from public.breezy_proformas p where p.id = any(proforma_ids)
          and ((p.customer_id is not null and not p.customer_id = any(customer_ids))
            or (p.converted_invoice_id is not null and not p.converted_invoice_id = any(invoice_ids))
            or (nullif(p.payload ->> 'convertedInvoiceId', '') is not null and not (p.payload ->> 'convertedInvoiceId')::uuid = any(invoice_ids))))
        or exists (select 1 from public.breezy_payslips p where p.entity_id = company.id
          and p.employee_id is not null and not p.employee_id = any(employee_ids))
        or exists (select 1 from public.breezy_employee_letters l where l.entity_id = company.id
          and not l.employee_id = any(employee_ids)) then
        raise exception 'Some records link to another company. Resolve these links before moving history.';
      end if;
      -- Also check links from documents that will remain in the source account.
      if exists (select 1 from public.breezy_invoices i where i.workspace_id = source.id and not i.id = any(invoice_ids)
        and ((i.customer_id = any(customer_ids))
          or (i.source_proforma_id = any(proforma_ids))
          or (nullif(i.payload ->> 'sourceProformaId', '')::uuid = any(proforma_ids))
          or (nullif(i.payload ->> 'correctsInvoiceId', '')::uuid = any(invoice_ids))
          or (nullif(i.payload #>> '{correction,replacementInvoiceId}', '')::uuid = any(invoice_ids))))
        or exists (select 1 from public.breezy_proformas p where p.workspace_id = source.id and not p.id = any(proforma_ids)
          and (p.customer_id = any(customer_ids) or p.converted_invoice_id = any(invoice_ids)
            or nullif(p.payload ->> 'convertedInvoiceId', '')::uuid = any(invoice_ids))) then
        raise exception 'Other company documents depend on these records. Resolve their links before moving history.';
      end if;
    end if;
    update public.breezy_entities set transferred_at = now(), transferred_to_workspace_id = destination.id where id = company.id;
    insert into public.breezy_entities(id, user_id, workspace_id, payload)
      values (new_entity, destination.owner_user_id, destination.id, company.payload);
    new_template := coalesce(source_settings.template #> array['entityTemplates', company.id::text], source_settings.template - 'entityTemplates', '{}'::jsonb);
    -- Freeze the source's historical document styling even when its default changes.
    insert into public.breezy_workspace_settings(user_id, workspace_id, setup, template)
      values(source.owner_user_id, source.id, null, jsonb_build_object('entityTemplates', jsonb_build_object(company.id::text, new_template)))
      on conflict(user_id) do update set template = jsonb_set(coalesce(breezy_workspace_settings.template, '{}'), '{entityTemplates}',
        coalesce(breezy_workspace_settings.template -> 'entityTemplates', '{}') || jsonb_build_object(company.id::text, new_template));
    insert into public.breezy_workspace_settings(user_id, workspace_id, setup, template)
      values (destination.owner_user_id, destination.id, null,
        jsonb_build_object('entityTemplates', jsonb_build_object(new_entity::text, new_template)))
      on conflict (user_id) do update set template = jsonb_set(
        coalesce(breezy_workspace_settings.template, '{}'), '{entityTemplates}',
        coalesce(breezy_workspace_settings.template -> 'entityTemplates', '{}') || jsonb_build_object(new_entity::text, new_template));
    if request.move_history then
      insert into public.breezy_transferred_documents select destination.id, 'invoice', unnest(invoice_ids) on conflict do nothing;
      insert into public.breezy_transferred_documents select destination.id, 'proforma', unnest(proforma_ids) on conflict do nothing;
      insert into public.breezy_transferred_documents select destination.id, 'payslip', id from public.breezy_payslips
        where workspace_id = source.id and entity_id = company.id on conflict do nothing;
      update public.breezy_customers set workspace_id = destination.id, user_id = destination.owner_user_id, entity_id = new_entity where id = any(customer_ids);
      update public.breezy_employees set workspace_id = destination.id, user_id = destination.owner_user_id, entity_id = new_entity where id = any(employee_ids);
      update public.breezy_invoices set workspace_id = destination.id, user_id = destination.owner_user_id, entity_id = new_entity where id = any(invoice_ids);
      update public.breezy_proformas set workspace_id = destination.id, user_id = destination.owner_user_id, entity_id = new_entity,
        payload = jsonb_set(payload, '{entityId}', to_jsonb(new_entity::text)) where id = any(proforma_ids);
      update public.breezy_payslips set workspace_id = destination.id, user_id = destination.owner_user_id, entity_id = new_entity,
        payload = jsonb_set(payload, '{entityId}', to_jsonb(new_entity::text)) where workspace_id = source.id and entity_id = company.id;
      update public.breezy_employee_letters set workspace_id = destination.id, user_id = destination.owner_user_id, entity_id = new_entity,
        payload = jsonb_set(payload, '{entityId}', to_jsonb(new_entity::text)) where workspace_id = source.id and entity_id = company.id;
      update public.breezy_expenses set workspace_id = destination.id, user_id = destination.owner_user_id, entity_id = new_entity where workspace_id = source.id and entity_id = company.id;
      for draft in select * from jsonb_each(coalesce(source_settings.setup -> 'attendanceDrafts', '{}')) loop
        if draft.value ->> 'entityId' = company.id::text then
          moved_attendance := moved_attendance || jsonb_build_object(
            replace(draft.key, company.id::text, new_entity::text), jsonb_set(draft.value, '{entityId}', to_jsonb(new_entity::text)));
        end if;
      end loop;
      update public.breezy_workspace_settings set setup = jsonb_set(setup, '{attendanceDrafts}',
        coalesce((select jsonb_object_agg(key, value) from jsonb_each(coalesce(setup -> 'attendanceDrafts', '{}'))
          where value ->> 'entityId' is distinct from company.id::text), '{}')) where workspace_id = source.id and setup is not null;
      update public.breezy_workspace_settings set transferred_attendance = transferred_attendance || moved_attendance where workspace_id = destination.id;
    end if;
    update public.profiles set account_type = 'founder' where id = destination.owner_user_id and account_type = 'unselected';
    update public.breezy_entity_transfers set status = 'accepted', target_entity_id = new_entity, resolved_at = now() where id = request.id;
  end if;
  insert into public.breezy_workspace_audit_log(workspace_id, actor_user_id, action, resource_type, resource_id, details)
    select w, auth.uid(), case when approve_transfer then 'entity_transfer_accepted' else 'entity_transfer_rejected' end,
      'entity_transfer', request.id::text, jsonb_build_object('company', request.company_name, 'move_history', request.move_history,
        'source_workspace_id', source.id, 'target_workspace_id', destination.id)
    from unnest(array[source.id, destination.id]) w;
  return case when approve_transfer then new_entity else null end;
end;
$$;

create function public.breezy_cancel_entity_transfer(transfer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare request public.breezy_entity_transfers;
begin
  update public.breezy_entity_transfers t set status = 'cancelled', resolved_at = now()
    where t.id = transfer_id and t.status = 'pending' and exists
      (select 1 from public.breezy_workspaces w where w.id = t.source_workspace_id and w.owner_user_id = auth.uid() and w.status = 'active')
    returning t.* into request;
  if not found then raise exception 'Only the source owner can cancel a pending transfer.' using errcode = '42501'; end if;
  insert into public.breezy_workspace_audit_log(workspace_id, actor_user_id, action, resource_type, resource_id, details)
    select w, auth.uid(), 'entity_transfer_cancelled', 'entity_transfer', request.id::text,
      jsonb_build_object('company', request.company_name, 'move_history', request.move_history)
    from unnest(array[request.source_workspace_id, request.target_workspace_id]) w;
end;
$$;

-- Invoker checks: only the locked SECURITY DEFINER transfer and trusted maintenance
-- roles can change archive metadata or move ownership. JWT role claims are not used.
create function public.breezy_transfer_privileged()
returns boolean language sql stable set search_path = '' as $$
  select current_user in ('service_role', 'supabase_auth_admin') or current_user =
    (select pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc
      where oid = 'public.breezy_review_entity_transfer(uuid,boolean)'::regprocedure);
$$;
create function public.breezy_transfer_entity_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.breezy_transfer_privileged() then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'INSERT' then
    if new.transferred_at is not null or new.transferred_to_workspace_id is not null then raise exception 'Transfer metadata is managed by ChanaX.'; end if;
  elsif old.transferred_at is not null then
    -- Unchanged upserts from the workspace autosaver are harmless.
    if tg_op = 'UPDATE' and to_jsonb(new) - 'updated_at' = to_jsonb(old) - 'updated_at' then return new; end if;
    raise exception 'This company has moved. Its original records are read-only.';
  elsif tg_op = 'UPDATE' and (new.workspace_id <> old.workspace_id or new.transferred_at is distinct from old.transferred_at
    or new.transferred_to_workspace_id is distinct from old.transferred_to_workspace_id) then
    raise exception 'Use the owner-approved company transfer option.';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
create trigger breezy_transfer_entity_guard before insert or update or delete on public.breezy_entities
  for each row execute function public.breezy_transfer_entity_guard();

create function public.breezy_transfer_record_guard()
returns trigger language plpgsql set search_path = '' as $$
declare entity uuid; current_workspace uuid; company public.breezy_entities; linked_entity uuid; linked_id uuid;
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
          select i.entity_id into linked_entity from public.breezy_invoices i
            where i.id = linked_id and i.workspace_id = current_workspace;
          if not found or linked_entity is distinct from entity then raise exception 'Invoice corrections must stay within the same active company.'; end if;
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
do $$ declare table_name text; begin
  foreach table_name in array array['breezy_customers', 'breezy_invoices', 'breezy_proformas', 'breezy_employees', 'breezy_payslips', 'breezy_employee_letters', 'breezy_expenses'] loop
    execute format('create trigger breezy_transfer_record_guard before insert or update or delete on public.%I for each row execute function public.breezy_transfer_record_guard()', table_name);
  end loop;
end $$;

create function public.breezy_transfer_settings_guard()
returns trigger language plpgsql set search_path = '' as $$
declare archived record;
begin
  if not public.breezy_transfer_privileged() then
    if (tg_op = 'INSERT' and new.transferred_attendance <> '{}') or
      (tg_op = 'UPDATE' and new.transferred_attendance is distinct from old.transferred_attendance) then
      raise exception 'Transferred attendance is managed by ChanaX.';
    end if;
    if exists (select 1 from jsonb_each(coalesce(new.setup -> 'attendanceDrafts', '{}')) d
      join public.breezy_entities e on e.id::text = d.value ->> 'entityId'
      where e.transferred_at is not null and (tg_op = 'INSERT' or d.value is distinct from old.setup #> array['attendanceDrafts', d.key])) then
      raise exception 'Attendance for a moved company is read-only.';
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from jsonb_each(coalesce(old.setup -> 'attendanceDrafts', '{}')) d
      join public.breezy_entities e on e.id::text = d.value ->> 'entityId'
      where e.transferred_at is not null and d.value is distinct from new.setup #> array['attendanceDrafts', d.key]) then
      raise exception 'Attendance for a moved company is read-only.';
    end if;
    if tg_op = 'UPDATE' then
      -- Keep frozen overrides intact, including during client-side normalization
      -- or edits to the workspace-wide default template.
      for archived in select id from public.breezy_entities where workspace_id = new.workspace_id and transferred_at is not null loop
        new.template := jsonb_set(coalesce(new.template, '{}'), '{entityTemplates}',
          coalesce(new.template -> 'entityTemplates', '{}') || jsonb_build_object(archived.id::text,
            coalesce(old.template #> array['entityTemplates', archived.id::text], '{}'::jsonb)));
      end loop;
    end if;
  end if;
  if new.setup is not null and new.transferred_attendance <> '{}' then
    new.setup := jsonb_set(new.setup, '{attendanceDrafts}',
      new.transferred_attendance || coalesce(new.setup -> 'attendanceDrafts', '{}'));
    new.transferred_attendance := '{}';
  end if;
  return new;
end;
$$;
create trigger breezy_transfer_settings_guard before insert or update on public.breezy_workspace_settings
  for each row execute function public.breezy_transfer_settings_guard();

revoke all on function public.breezy_request_entity_transfer(uuid,uuid,text,boolean) from public;
revoke all on function public.breezy_review_entity_transfer(uuid,boolean) from public;
revoke all on function public.breezy_cancel_entity_transfer(uuid) from public;
grant execute on function public.breezy_request_entity_transfer(uuid,uuid,text,boolean),
  public.breezy_review_entity_transfer(uuid,boolean), public.breezy_cancel_entity_transfer(uuid) to authenticated;
revoke all on function public.breezy_transfer_entity_guard(), public.breezy_transfer_record_guard(), public.breezy_transfer_settings_guard() from public;
-- Keep the existing credit policy, except that imported documents are already paid.
create or replace function public.breezy_consume_document_credit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  account public.breezy_credit_accounts%rowtype;
  source_name text;
  kind text := case when tg_table_name = 'breezy_invoices' then 'invoice'
    when tg_table_name = 'breezy_proformas' then 'proforma' else 'payslip' end;
  is_quotation boolean := tg_table_name = 'breezy_proformas';
begin
  if exists (select 1 from public.breezy_transferred_documents where workspace_id = new.workspace_id
    and document_type = kind and document_id = new.id)
    or exists (select 1 from public.breezy_credit_transactions where workspace_id = new.workspace_id
      and document_type = kind and document_id = new.id) then return new; end if;
  select * into account from public.breezy_credit_accounts where workspace_id = new.workspace_id for update;
  if not found then
    insert into public.breezy_credit_accounts(workspace_id, gst_status, free_credits_granted, free_quotation_credits_granted)
      values (new.workspace_id, 'provisional', 10, 10) returning * into account;
  end if;
  if account.monthly_credits_reset_at is not null and account.monthly_credits_reset_at <= now() then
    update public.breezy_credit_accounts set monthly_credits_remaining = 0, monthly_quotation_credits_remaining = 0,
      monthly_credits_reset_at = null, updated_at = now() where workspace_id = new.workspace_id;
    account.monthly_credits_remaining := 0;
    account.monthly_quotation_credits_remaining := 0;
    update public.breezy_subscriptions set status = 'expired', updated_at = now()
      where workspace_id = new.workspace_id and status = 'active' and current_period_ends_at <= now();
  end if;
  if is_quotation then
    if account.free_quotation_credits_used < account.free_quotation_credits_granted then
      source_name := 'free';
      update public.breezy_credit_accounts set free_quotation_credits_used = free_quotation_credits_used + 1,
        updated_at = now() where workspace_id = new.workspace_id;
    elsif account.monthly_quotation_credits_remaining > 0 then
      source_name := 'monthly';
      update public.breezy_credit_accounts set monthly_quotation_credits_remaining = monthly_quotation_credits_remaining - 1,
        updated_at = now() where workspace_id = new.workspace_id;
    elsif account.topup_quotation_credits_remaining > 0 then
      source_name := 'topup';
      update public.breezy_credit_accounts set topup_quotation_credits_remaining = topup_quotation_credits_remaining - 1,
        updated_at = now() where workspace_id = new.workspace_id;
    else raise exception 'No quotation credits remain. Add quotation credits to generate another quotation.' using errcode = 'P0001';
    end if;
  else
    if account.free_credits_used < account.free_credits_granted then
      source_name := 'free';
      update public.breezy_credit_accounts set free_credits_used = free_credits_used + 1,
        updated_at = now() where workspace_id = new.workspace_id;
    elsif account.monthly_credits_remaining > 0 then
      source_name := 'monthly';
      update public.breezy_credit_accounts set monthly_credits_remaining = monthly_credits_remaining - 1,
        updated_at = now() where workspace_id = new.workspace_id;
    elsif account.topup_credits_remaining > 0 then
      source_name := 'topup';
      update public.breezy_credit_accounts set topup_credits_remaining = topup_credits_remaining - 1,
        updated_at = now() where workspace_id = new.workspace_id;
    else raise exception 'No document credits remain. Add credits to generate another invoice or payslip.' using errcode = 'P0001';
    end if;
  end if;
  insert into public.breezy_credit_transactions(workspace_id, document_type, document_id, credit_source, credits)
    values(new.workspace_id, kind, new.id, source_name, 1)
    on conflict(workspace_id, document_type, document_id) do nothing;
  return new;
end;
$$;
notify pgrst, 'reload schema';
commit;
