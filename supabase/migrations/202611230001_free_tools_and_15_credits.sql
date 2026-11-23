-- Free tools for guests, and 15 free credits for new accounts.
-- Run after 202611220001_test_accounts_by_phone.sql. Safe to re-run.
--
-- * New accounts start with 15 free credits (was 20). Existing accounts keep
--   their balance. GSTIN verification still raises the free grant to 60.
-- * breezy_guest_downloads records downloads made from the free tools by
--   visitors who are not signed in (hashed browser id only).

begin;

alter table public.breezy_credit_accounts
  alter column free_credits_granted set default 15;

create or replace function public.breezy_consume_document_credit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  account public.breezy_credit_accounts%rowtype;
  source_name text;
  kind text := case when tg_table_name = 'breezy_invoices' then 'invoice'
    when tg_table_name = 'breezy_proformas' then 'proforma' else 'payslip' end;
begin
  if exists (select 1 from public.breezy_transferred_documents where workspace_id = new.workspace_id
    and document_type = kind and document_id = new.id)
    or exists (select 1 from public.breezy_credit_transactions where workspace_id = new.workspace_id
      and document_type = kind and document_id = new.id) then return new; end if;
  select * into account from public.breezy_credit_accounts where workspace_id = new.workspace_id for update;
  if not found then
    insert into public.breezy_credit_accounts(workspace_id, gst_status, free_credits_granted)
      values (new.workspace_id, 'provisional', 15) returning * into account;
  end if;
  if account.monthly_credits_reset_at is not null and account.monthly_credits_reset_at <= now() then
    update public.breezy_credit_accounts set monthly_credits_remaining = 0,
      monthly_credits_reset_at = null, updated_at = now() where workspace_id = new.workspace_id;
    account.monthly_credits_remaining := 0;
    update public.breezy_subscriptions set status = 'expired', updated_at = now()
      where workspace_id = new.workspace_id and status = 'active' and current_period_ends_at <= now();
  end if;
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
  else
    raise exception 'No credits remain. Add credits to create more invoices, quotations or payslips.' using errcode = 'P0001';
  end if;
  insert into public.breezy_credit_transactions(workspace_id, document_type, document_id, credit_source, credits)
    values(new.workspace_id, kind, new.id, source_name, 1)
    on conflict(workspace_id, document_type, document_id) do nothing;
  return new;
end;
$$;
revoke all on function public.breezy_consume_document_credit() from public;

create table if not exists public.breezy_guest_downloads (
  id bigint generated always as identity primary key,
  visitor_hash text not null,
  tool text not null check (tool ~ '^[a-z_-]{2,40}$'),
  downloaded_at timestamptz not null default now()
);
create index if not exists breezy_guest_downloads_visitor_idx
  on public.breezy_guest_downloads (visitor_hash, downloaded_at desc);
alter table public.breezy_guest_downloads enable row level security;
revoke all on public.breezy_guest_downloads from anon, authenticated;
grant select, insert on public.breezy_guest_downloads to service_role;

insert into public.breezy_schema_versions(version)
values ('2026-11-23-free-tools-and-15-credits')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
commit;
