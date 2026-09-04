-- Razorpay prepaid subscription orders and idempotent credit fulfilment.
-- Run after 202608280001_remaining_product_features.sql.

begin;

create table if not exists public.breezy_payment_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.breezy_workspaces(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  provider text not null default 'razorpay' check (provider = 'razorpay'),
  provider_order_id text not null unique,
  provider_payment_id text unique,
  plan_key text not null check (plan_key in ('quarterly', 'half_yearly', 'annual')),
  amount_paise integer not null check (amount_paise > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  credits integer not null check (credits > 0),
  duration_months integer not null check (duration_months in (3, 6, 12)),
  status text not null default 'created' check (status in ('created', 'paid', 'failed', 'refunded')),
  paid_at timestamptz,
  failed_at timestamptz,
  refunded_at timestamptz,
  refunded_paise integer not null default 0 check (refunded_paise >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists breezy_payment_orders_workspace_created_idx
  on public.breezy_payment_orders(workspace_id, created_at desc);

alter table public.breezy_payment_orders
  add column if not exists refunded_paise integer not null default 0 check (refunded_paise >= 0);

create table if not exists public.breezy_payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'razorpay' check (provider = 'razorpay'),
  provider_event_id text not null unique,
  event_type text not null,
  provider_order_id text,
  provider_payment_id text,
  received_at timestamptz not null default now()
);

alter table public.breezy_payment_orders enable row level security;
alter table public.breezy_payment_events enable row level security;

drop policy if exists "Workspace reads payment orders" on public.breezy_payment_orders;
create policy "Workspace reads payment orders" on public.breezy_payment_orders
for select to authenticated
using (public.breezy_has_permission(workspace_id, 'workspace.read'));

-- Webhook events are deliberately backend-only. They contain operational IDs
-- and do not need to be exposed directly to workspace members.

create or replace function public.breezy_apply_razorpay_payment(
  target_provider_order_id text,
  target_provider_payment_id text,
  target_event_id text default null,
  target_event_type text default 'payment.captured'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_order public.breezy_payment_orders%rowtype;
  existing_event boolean := false;
  period_base timestamptz;
  period_end timestamptz;
  new_credit_balance integer;
begin
  if nullif(trim(target_provider_order_id), '') is null
     or nullif(trim(target_provider_payment_id), '') is null then
    raise exception 'Razorpay order and payment IDs are required.' using errcode = '22023';
  end if;

  if nullif(trim(coalesce(target_event_id, '')), '') is not null then
    select exists (
      select 1 from public.breezy_payment_events
      where provider_event_id = trim(target_event_id)
    ) into existing_event;
    if existing_event then
      select * into payment_order
      from public.breezy_payment_orders
      where provider_order_id = trim(target_provider_order_id);
      return jsonb_build_object(
        'already_processed', true,
        'workspace_id', payment_order.workspace_id,
        'plan_key', payment_order.plan_key,
        'credits_added', 0
      );
    end if;
  end if;

  select * into payment_order
  from public.breezy_payment_orders
  where provider_order_id = trim(target_provider_order_id)
  for update;

  if not found then
    raise exception 'The Razorpay order is not registered in ChanaX.' using errcode = 'P0002';
  end if;

  if payment_order.provider_payment_id is not null
     and payment_order.provider_payment_id <> trim(target_provider_payment_id) then
    raise exception 'This Razorpay order is already linked to another payment.' using errcode = '23505';
  end if;

  if nullif(trim(coalesce(target_event_id, '')), '') is not null then
    insert into public.breezy_payment_events (
      provider_event_id, event_type, provider_order_id, provider_payment_id
    ) values (
      trim(target_event_id), trim(target_event_type),
      trim(target_provider_order_id), trim(target_provider_payment_id)
    );
  end if;

  if payment_order.status = 'paid' then
    return jsonb_build_object(
      'already_processed', true,
      'workspace_id', payment_order.workspace_id,
      'plan_key', payment_order.plan_key,
      'credits_added', 0
    );
  end if;

  if payment_order.status = 'refunded' then
    raise exception 'A refunded order cannot be fulfilled.' using errcode = 'P0001';
  end if;

  update public.breezy_payment_orders
  set provider_payment_id = trim(target_provider_payment_id),
      status = 'paid', paid_at = now(), updated_at = now()
  where id = payment_order.id;

  select greatest(now(), coalesce(current_period_ends_at, now()))
  into period_base
  from public.breezy_subscriptions
  where workspace_id = payment_order.workspace_id
  for update;

  period_end := coalesce(period_base, now())
    + make_interval(months => payment_order.duration_months);

  insert into public.breezy_credit_accounts (
    workspace_id, monthly_credits_remaining, monthly_credits_reset_at
  ) values (
    payment_order.workspace_id, payment_order.credits, period_end
  )
  on conflict (workspace_id) do update set
    monthly_credits_remaining = public.breezy_credit_accounts.monthly_credits_remaining
      + excluded.monthly_credits_remaining,
    monthly_credits_reset_at = excluded.monthly_credits_reset_at,
    updated_at = now()
  returning monthly_credits_remaining into new_credit_balance;

  insert into public.breezy_subscriptions (
    workspace_id, plan_key, status, trial_ends_at,
    current_period_ends_at, cancel_at_period_end, limits
  ) values (
    payment_order.workspace_id, payment_order.plan_key, 'active', null,
    period_end, true,
    jsonb_build_object('creditsPurchased', payment_order.credits)
  )
  on conflict (workspace_id) do update set
    plan_key = excluded.plan_key,
    status = 'active',
    trial_ends_at = null,
    current_period_ends_at = period_end,
    cancel_at_period_end = true,
    limits = coalesce(public.breezy_subscriptions.limits, '{}'::jsonb)
      || jsonb_build_object('creditsPurchased', payment_order.credits),
    updated_at = now();

  return jsonb_build_object(
    'already_processed', false,
    'workspace_id', payment_order.workspace_id,
    'plan_key', payment_order.plan_key,
    'credits_added', payment_order.credits,
    'credit_balance', new_credit_balance,
    'current_period_ends_at', period_end
  );
end;
$$;

revoke all on function public.breezy_apply_razorpay_payment(text, text, text, text) from public;
revoke all on function public.breezy_apply_razorpay_payment(text, text, text, text) from anon;
revoke all on function public.breezy_apply_razorpay_payment(text, text, text, text) from authenticated;
grant execute on function public.breezy_apply_razorpay_payment(text, text, text, text) to service_role;

create or replace function public.breezy_record_razorpay_event(
  target_provider_order_id text,
  target_provider_payment_id text,
  target_event_id text,
  target_event_type text,
  target_amount_paise integer default 0
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_order public.breezy_payment_orders%rowtype;
  credits_to_remove integer;
  new_refunded_paise integer;
begin
  if exists (
    select 1 from public.breezy_payment_events
    where provider_event_id = trim(target_event_id)
  ) then
    return false;
  end if;

  select * into payment_order
  from public.breezy_payment_orders
  where provider_order_id = trim(target_provider_order_id)
  for update;

  if not found then
    raise exception 'The Razorpay order is not registered in ChanaX.' using errcode = 'P0002';
  end if;

  insert into public.breezy_payment_events (
    provider_event_id, event_type, provider_order_id, provider_payment_id
  ) values (
    trim(target_event_id), trim(target_event_type),
    trim(target_provider_order_id), nullif(trim(target_provider_payment_id), '')
  );

  if target_event_type = 'payment.failed' and payment_order.status = 'created' then
    update public.breezy_payment_orders
    set status = 'failed', failed_at = now(), updated_at = now()
    where id = payment_order.id;
  elsif target_event_type = 'refund.processed' and payment_order.status in ('paid', 'refunded') then
    new_refunded_paise := least(
      payment_order.amount_paise,
      payment_order.refunded_paise + case
        when target_amount_paise <= 0 then payment_order.amount_paise
        else target_amount_paise
      end
    );
    credits_to_remove := greatest(
      0,
      ceil(payment_order.credits::numeric * new_refunded_paise / payment_order.amount_paise)::integer
      - ceil(payment_order.credits::numeric * payment_order.refunded_paise / payment_order.amount_paise)::integer
    );
    update public.breezy_payment_orders
    set status = case when new_refunded_paise >= amount_paise then 'refunded' else 'paid' end,
        refunded_paise = new_refunded_paise,
        refunded_at = now(), updated_at = now()
    where id = payment_order.id;
    update public.breezy_credit_accounts
    set monthly_credits_remaining = greatest(0, monthly_credits_remaining - credits_to_remove),
        updated_at = now()
    where workspace_id = payment_order.workspace_id;
  end if;

  return true;
end;
$$;

revoke all on function public.breezy_record_razorpay_event(text, text, text, text, integer) from public;
revoke all on function public.breezy_record_razorpay_event(text, text, text, text, integer) from anon;
revoke all on function public.breezy_record_razorpay_event(text, text, text, text, integer) from authenticated;
grant execute on function public.breezy_record_razorpay_event(text, text, text, text, integer) to service_role;

-- Paid plan credits roll over when a plan is renewed, but expire when the
-- active prepaid period ends. Free and separately granted top-up credits are
-- unaffected.
create or replace function public.breezy_consume_document_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.breezy_credit_accounts%rowtype;
  source_name text;
  kind text := case
    when tg_table_name = 'breezy_invoices' then 'invoice'
    when tg_table_name = 'breezy_proformas' then 'proforma'
    else 'payslip'
  end;
begin
  if exists (
    select 1 from public.breezy_credit_transactions
    where workspace_id = new.workspace_id
      and document_type = kind
      and document_id = new.id
  ) then
    return new;
  end if;

  select * into account
  from public.breezy_credit_accounts
  where workspace_id = new.workspace_id
  for update;

  if not found then
    insert into public.breezy_credit_accounts (
      workspace_id, gst_status, free_credits_granted
    ) values (
      new.workspace_id, 'provisional', 10
    ) returning * into account;
  end if;

  if account.monthly_credits_reset_at is not null
     and account.monthly_credits_reset_at <= now()
     and account.monthly_credits_remaining > 0 then
    update public.breezy_credit_accounts
    set monthly_credits_remaining = 0,
        monthly_credits_reset_at = null,
        updated_at = now()
    where workspace_id = new.workspace_id;
    account.monthly_credits_remaining := 0;
    update public.breezy_subscriptions
    set status = 'expired', updated_at = now()
    where workspace_id = new.workspace_id
      and status = 'active'
      and current_period_ends_at <= now();
  end if;

  if account.free_credits_used < account.free_credits_granted then
    source_name := 'free';
    update public.breezy_credit_accounts
    set free_credits_used = free_credits_used + 1, updated_at = now()
    where workspace_id = new.workspace_id;
  elsif account.monthly_credits_remaining > 0 then
    source_name := 'monthly';
    update public.breezy_credit_accounts
    set monthly_credits_remaining = monthly_credits_remaining - 1, updated_at = now()
    where workspace_id = new.workspace_id;
  elsif account.topup_credits_remaining > 0 then
    source_name := 'topup';
    update public.breezy_credit_accounts
    set topup_credits_remaining = topup_credits_remaining - 1, updated_at = now()
    where workspace_id = new.workspace_id;
  else
    raise exception 'No document credits remain. Add credits to generate another document.'
      using errcode = 'P0001';
  end if;

  insert into public.breezy_credit_transactions (
    workspace_id, document_type, document_id, credit_source, credits
  ) values (
    new.workspace_id, kind, new.id, source_name, 1
  ) on conflict (workspace_id, document_type, document_id) do nothing;

  return new;
end;
$$;

revoke all on function public.breezy_consume_document_credit() from public;

insert into public.breezy_schema_versions(version)
values ('2026-09-04-razorpay-billing')
on conflict (version) do nothing;

commit;
