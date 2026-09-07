-- Link each converted quotation to exactly one final invoice.

begin;

alter table public.breezy_invoices
  add column if not exists source_proforma_id uuid
  references public.breezy_proformas(id) on delete set null;

alter table public.breezy_proformas
  add column if not exists converted_invoice_id uuid
  references public.breezy_invoices(id) on delete set null;

create unique index if not exists breezy_invoices_one_per_proforma_idx
  on public.breezy_invoices(workspace_id, source_proforma_id)
  where source_proforma_id is not null;

create or replace function public.breezy_prepare_invoice_conversion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(new.payload ->> 'sourceProformaId', '') is not null then
    new.source_proforma_id := (new.payload ->> 'sourceProformaId')::uuid;
  end if;
  return new;
end;
$$;

create or replace function public.breezy_finish_invoice_conversion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_invoice_id uuid;
  source_found boolean := false;
begin
  if new.source_proforma_id is null then
    return new;
  end if;

  select true, converted_invoice_id
    into source_found, existing_invoice_id
  from public.breezy_proformas
  where id = new.source_proforma_id
    and workspace_id = new.workspace_id
  for update;

  if not source_found then
    raise exception 'The source quotation does not exist in this workspace.' using errcode = 'P0001';
  end if;

  if existing_invoice_id is not null and existing_invoice_id <> new.id then
    raise exception 'This quotation has already been converted into an invoice.' using errcode = 'P0001';
  end if;

  update public.breezy_proformas
  set converted_invoice_id = new.id,
      payload = jsonb_set(
        jsonb_set(coalesce(payload, '{}'::jsonb), '{convertedInvoiceId}', to_jsonb(new.id::text), true),
        '{convertedInvoiceNumber}', to_jsonb(coalesce(new.payload ->> 'number', '')), true
      ),
      updated_at = now()
  where id = new.source_proforma_id;

  return new;
end;
$$;

drop trigger if exists breezy_prepare_invoice_conversion on public.breezy_invoices;
create trigger breezy_prepare_invoice_conversion
before insert or update of payload on public.breezy_invoices
for each row execute function public.breezy_prepare_invoice_conversion();

drop trigger if exists breezy_finish_invoice_conversion on public.breezy_invoices;
create trigger breezy_finish_invoice_conversion
after insert on public.breezy_invoices
for each row execute function public.breezy_finish_invoice_conversion();

revoke all on function public.breezy_prepare_invoice_conversion() from public;
revoke all on function public.breezy_finish_invoice_conversion() from public;

insert into public.breezy_schema_versions(version)
values ('2026-09-07-proforma-invoice-conversion')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
