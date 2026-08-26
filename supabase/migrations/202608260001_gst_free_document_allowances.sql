-- Enforce lifetime free-document allowances for ChanaX workspaces.
-- GST-registered free workspaces receive 15 invoices and 15 payslips.
-- Non-GST free workspaces receive 5 invoices and 5 payslips.

begin;

update public.breezy_subscriptions as subscriptions
set limits = jsonb_set(
  jsonb_set(
    coalesce(subscriptions.limits, '{}'::jsonb),
    '{invoiceUsage}',
    to_jsonb(greatest(
      coalesce((subscriptions.limits ->> 'invoiceUsage')::integer, 0),
      (select count(*)::integer from public.breezy_invoices where workspace_id = subscriptions.workspace_id)
    )),
    true
  ),
  '{payslipUsage}',
  to_jsonb(greatest(
    coalesce((subscriptions.limits ->> 'payslipUsage')::integer, 0),
    (select count(*)::integer from public.breezy_payslips where workspace_id = subscriptions.workspace_id)
  )),
  true
);

create or replace function public.breezy_record_free_document_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscription_plan text;
  subscription_limits jsonb;
  setup_data jsonb;
  document_kind text;
  usage_key text;
  current_usage integer;
  document_limit integer;
  has_gstin boolean;
begin
  select plan_key, limits
  into subscription_plan, subscription_limits
  from public.breezy_subscriptions
  where workspace_id = new.workspace_id
  for update;

  if not found then
    raise exception 'The workspace subscription could not be found.';
  end if;

  select setup into setup_data
  from public.breezy_workspace_settings
  where workspace_id = new.workspace_id;

  has_gstin := case
    when coalesce(setup_data, '{}'::jsonb) ? 'hasGstin'
      then setup_data ->> 'hasGstin' = 'true'
    else coalesce(setup_data ->> 'gstin', '') <> ''
  end;
  document_limit := case when has_gstin then 15 else 5 end;
  document_kind := case when tg_table_name = 'breezy_invoices' then 'invoice' else 'payslip' end;
  usage_key := case when document_kind = 'invoice' then 'invoiceUsage' else 'payslipUsage' end;
  current_usage := coalesce((subscription_limits ->> usage_key)::integer, 0);

  if subscription_plan = 'free' and current_usage >= document_limit then
    raise exception 'Free plan limit reached: this workspace includes % %.', document_limit, document_kind || 's'
      using errcode = 'P0001';
  end if;

  update public.breezy_subscriptions
  set limits = jsonb_set(coalesce(limits, '{}'::jsonb), array[usage_key], to_jsonb(current_usage + 1), true),
      updated_at = now()
  where workspace_id = new.workspace_id;

  return new;
end;
$$;

drop trigger if exists breezy_invoice_free_usage on public.breezy_invoices;
create trigger breezy_invoice_free_usage
after insert on public.breezy_invoices
for each row execute function public.breezy_record_free_document_usage();

drop trigger if exists breezy_payslip_free_usage on public.breezy_payslips;
create trigger breezy_payslip_free_usage
after insert on public.breezy_payslips
for each row execute function public.breezy_record_free_document_usage();

revoke all on function public.breezy_record_free_document_usage() from public;

insert into public.breezy_schema_versions(version)
values ('2026-08-26-gst-free-document-allowances')
on conflict (version) do nothing;

commit;
