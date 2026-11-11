-- One credit balance for invoices, payslips and quotations.
-- Run after 202611100004_phone_signup_invitations.sql.
--
-- * Remaining quotation credits are added into the matching document-credit
--   bucket (free, monthly, top-up), so no customer loses credits.
-- * Quotations now use the same balance as invoices and payslips.
-- * The quotation columns are kept for compatibility but are always zero:
--   older functions that still add to them (payments, admin grants) are
--   harmless because a trigger folds nothing in and resets them to zero.
-- * Paid plans now grant double the old document credits (set in the
--   backend), and new free accounts start with 20 instead of 10 + 10.

begin;

-- 1. Merge existing balances.
update public.breezy_credit_accounts
set free_credits_granted = free_credits_granted
      + greatest(0, free_quotation_credits_granted - free_quotation_credits_used),
    monthly_credits_remaining = monthly_credits_remaining + monthly_quotation_credits_remaining,
    topup_credits_remaining = topup_credits_remaining + topup_quotation_credits_remaining,
    free_quotation_credits_used = 0,
    free_quotation_credits_granted = 0,
    monthly_quotation_credits_remaining = 0,
    topup_quotation_credits_remaining = 0,
    updated_at = now()
where free_quotation_credits_granted > 0
   or monthly_quotation_credits_remaining > 0
   or topup_quotation_credits_remaining > 0;

alter table public.breezy_credit_accounts
  alter column free_credits_granted set default 20,
  alter column free_quotation_credits_granted set default 0;

-- 2. Keep the legacy quotation columns at zero.
create or replace function public.breezy_zero_quotation_credits()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.free_quotation_credits_used := 0;
  new.free_quotation_credits_granted := 0;
  new.monthly_quotation_credits_remaining := 0;
  new.topup_quotation_credits_remaining := 0;
  return new;
end;
$$;

drop trigger if exists breezy_zero_quotation_credits on public.breezy_credit_accounts;
create trigger breezy_zero_quotation_credits
  before insert or update on public.breezy_credit_accounts
  for each row execute function public.breezy_zero_quotation_credits();

-- 3. Invoices, payslips and quotations all use one balance.
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
      values (new.workspace_id, 'provisional', 20) returning * into account;
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
revoke all on function public.breezy_zero_quotation_credits() from public;

insert into public.breezy_schema_versions(version)
values ('2026-11-11-single-credit-balance')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
commit;
