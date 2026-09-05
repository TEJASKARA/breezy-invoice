-- Separate proforma/quotation credits from invoice and payslip credits.
-- Run after 202609040001_razorpay_billing.sql.

begin;

alter table public.breezy_credit_accounts
  add column if not exists free_quotation_credits_granted integer not null default 10,
  add column if not exists free_quotation_credits_used integer not null default 0,
  add column if not exists monthly_quotation_credits_remaining integer not null default 0,
  add column if not exists topup_quotation_credits_remaining integer not null default 0;

-- Existing workspaces receive quotation credits equal to each currently
-- available document-credit bucket. Document credits are not reduced.
update public.breezy_credit_accounts
set free_quotation_credits_granted = greatest(0, free_credits_granted - free_credits_used),
    free_quotation_credits_used = 0,
    monthly_quotation_credits_remaining = monthly_credits_remaining,
    topup_quotation_credits_remaining = topup_credits_remaining,
    updated_at = now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'breezy_credit_accounts_free_quotation_granted_check'
      and conrelid = 'public.breezy_credit_accounts'::regclass
  ) then
    alter table public.breezy_credit_accounts
      add constraint breezy_credit_accounts_free_quotation_granted_check
      check (free_quotation_credits_granted >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'breezy_credit_accounts_free_quotation_used_check'
      and conrelid = 'public.breezy_credit_accounts'::regclass
  ) then
    alter table public.breezy_credit_accounts
      add constraint breezy_credit_accounts_free_quotation_used_check
      check (
        free_quotation_credits_used >= 0
        and free_quotation_credits_used <= free_quotation_credits_granted
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'breezy_credit_accounts_monthly_quotation_check'
      and conrelid = 'public.breezy_credit_accounts'::regclass
  ) then
    alter table public.breezy_credit_accounts
      add constraint breezy_credit_accounts_monthly_quotation_check
      check (monthly_quotation_credits_remaining >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'breezy_credit_accounts_topup_quotation_check'
      and conrelid = 'public.breezy_credit_accounts'::regclass
  ) then
    alter table public.breezy_credit_accounts
      add constraint breezy_credit_accounts_topup_quotation_check
      check (topup_quotation_credits_remaining >= 0);
  end if;
end $$;

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
  new_quotation_balance integer;
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
      select * into payment_order from public.breezy_payment_orders
      where provider_order_id = trim(target_provider_order_id);
      return jsonb_build_object(
        'already_processed', true,
        'workspace_id', payment_order.workspace_id,
        'plan_key', payment_order.plan_key,
        'credits_added', 0,
        'quotation_credits_added', 0
      );
    end if;
  end if;

  select * into payment_order from public.breezy_payment_orders
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
      'credits_added', 0,
      'quotation_credits_added', 0
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
  into period_base from public.breezy_subscriptions
  where workspace_id = payment_order.workspace_id
  for update;

  period_end := coalesce(period_base, now())
    + make_interval(months => payment_order.duration_months);

  insert into public.breezy_credit_accounts (
    workspace_id,
    monthly_credits_remaining,
    monthly_quotation_credits_remaining,
    monthly_credits_reset_at
  ) values (
    payment_order.workspace_id,
    payment_order.credits,
    payment_order.credits,
    period_end
  )
  on conflict (workspace_id) do update set
    monthly_credits_remaining = public.breezy_credit_accounts.monthly_credits_remaining
      + excluded.monthly_credits_remaining,
    monthly_quotation_credits_remaining = public.breezy_credit_accounts.monthly_quotation_credits_remaining
      + excluded.monthly_quotation_credits_remaining,
    monthly_credits_reset_at = excluded.monthly_credits_reset_at,
    updated_at = now()
  returning monthly_credits_remaining, monthly_quotation_credits_remaining
  into new_credit_balance, new_quotation_balance;

  insert into public.breezy_subscriptions (
    workspace_id, plan_key, status, trial_ends_at,
    current_period_ends_at, cancel_at_period_end, limits
  ) values (
    payment_order.workspace_id, payment_order.plan_key, 'active', null,
    period_end, true,
    jsonb_build_object(
      'creditsPurchased', payment_order.credits,
      'quotationCreditsPurchased', payment_order.credits
    )
  )
  on conflict (workspace_id) do update set
    plan_key = excluded.plan_key,
    status = 'active',
    trial_ends_at = null,
    current_period_ends_at = period_end,
    cancel_at_period_end = true,
    limits = coalesce(public.breezy_subscriptions.limits, '{}'::jsonb)
      || jsonb_build_object(
        'creditsPurchased', payment_order.credits,
        'quotationCreditsPurchased', payment_order.credits
      ),
    updated_at = now();

  return jsonb_build_object(
    'already_processed', false,
    'workspace_id', payment_order.workspace_id,
    'plan_key', payment_order.plan_key,
    'credits_added', payment_order.credits,
    'quotation_credits_added', payment_order.credits,
    'credit_balance', new_credit_balance,
    'quotation_credit_balance', new_quotation_balance,
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
  ) then return false; end if;

  select * into payment_order from public.breezy_payment_orders
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
        monthly_quotation_credits_remaining = greatest(0, monthly_quotation_credits_remaining - credits_to_remove),
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
  is_quotation boolean := tg_table_name = 'breezy_proformas';
begin
  if exists (
    select 1 from public.breezy_credit_transactions
    where workspace_id = new.workspace_id
      and document_type = kind
      and document_id = new.id
  ) then return new; end if;

  select * into account from public.breezy_credit_accounts
  where workspace_id = new.workspace_id for update;

  if not found then
    insert into public.breezy_credit_accounts (
      workspace_id, gst_status, free_credits_granted,
      free_quotation_credits_granted
    ) values (new.workspace_id, 'provisional', 10, 10)
    returning * into account;
  end if;

  if account.monthly_credits_reset_at is not null
     and account.monthly_credits_reset_at <= now() then
    update public.breezy_credit_accounts
    set monthly_credits_remaining = 0,
        monthly_quotation_credits_remaining = 0,
        monthly_credits_reset_at = null,
        updated_at = now()
    where workspace_id = new.workspace_id;
    account.monthly_credits_remaining := 0;
    account.monthly_quotation_credits_remaining := 0;
    update public.breezy_subscriptions
    set status = 'expired', updated_at = now()
    where workspace_id = new.workspace_id
      and status = 'active'
      and current_period_ends_at <= now();
  end if;

  if is_quotation then
    if account.free_quotation_credits_used < account.free_quotation_credits_granted then
      source_name := 'free';
      update public.breezy_credit_accounts
      set free_quotation_credits_used = free_quotation_credits_used + 1, updated_at = now()
      where workspace_id = new.workspace_id;
    elsif account.monthly_quotation_credits_remaining > 0 then
      source_name := 'monthly';
      update public.breezy_credit_accounts
      set monthly_quotation_credits_remaining = monthly_quotation_credits_remaining - 1, updated_at = now()
      where workspace_id = new.workspace_id;
    elsif account.topup_quotation_credits_remaining > 0 then
      source_name := 'topup';
      update public.breezy_credit_accounts
      set topup_quotation_credits_remaining = topup_quotation_credits_remaining - 1, updated_at = now()
      where workspace_id = new.workspace_id;
    else
      raise exception 'No quotation credits remain. Add quotation credits to generate another quotation.'
        using errcode = 'P0001';
    end if;
  else
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
      raise exception 'No document credits remain. Add credits to generate another invoice or payslip.'
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.breezy_credit_transactions (
    workspace_id, document_type, document_id, credit_source, credits
  ) values (new.workspace_id, kind, new.id, source_name, 1)
  on conflict (workspace_id, document_type, document_id) do nothing;
  return new;
end;
$$;

revoke all on function public.breezy_consume_document_credit() from public;

-- Platform-owner allocations keep both balances matched unless a future admin
-- tool deliberately introduces separate adjustment controls.
create or replace function public.breezy_grant_special_credits(
  target_subscription_code text,
  credit_amount integer,
  adjustment_reason text default 'Manual platform-owner allocation'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace_id uuid;
  new_balance integer;
  new_quotation_balance integer;
begin
  if credit_amount <= 0 or credit_amount > 100000 then
    raise exception 'Credit amount must be between 1 and 100000.' using errcode = '22023';
  end if;
  if length(trim(adjustment_reason)) < 3 then
    raise exception 'Enter a reason for this credit allocation.' using errcode = '22023';
  end if;

  select id into target_workspace_id from public.breezy_workspaces
  where upper(subscription_code) = upper(trim(target_subscription_code)) limit 1;
  if target_workspace_id is null then
    raise exception 'No workspace matches that subscription code.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_workspace_id::text, 0));
  insert into public.breezy_credit_accounts (
    workspace_id, gst_status, free_credits_granted,
    free_quotation_credits_granted,
    topup_credits_remaining, topup_quotation_credits_remaining
  ) values (
    target_workspace_id,
    case when exists (
      select 1 from public.breezy_workspace_settings
      where workspace_id = target_workspace_id
        and coalesce(setup ->> 'hasGstin', 'false') = 'true'
    ) then 'provisional' else 'no_gst' end,
    10, 10, credit_amount, credit_amount
  )
  on conflict (workspace_id) do update set
    topup_credits_remaining = public.breezy_credit_accounts.topup_credits_remaining
      + excluded.topup_credits_remaining,
    topup_quotation_credits_remaining = public.breezy_credit_accounts.topup_quotation_credits_remaining
      + excluded.topup_quotation_credits_remaining,
    updated_at = now()
  returning topup_credits_remaining, topup_quotation_credits_remaining
  into new_balance, new_quotation_balance;

  insert into public.breezy_credit_adjustments (
    workspace_id, credits, bucket, reason, created_by
  ) values (
    target_workspace_id, credit_amount, 'topup',
    trim(adjustment_reason) || ' (document + quotation)', auth.uid()
  );

  return jsonb_build_object(
    'workspace_id', target_workspace_id,
    'credits_added', credit_amount,
    'quotation_credits_added', credit_amount,
    'topup_credits_remaining', new_balance,
    'topup_quotation_credits_remaining', new_quotation_balance
  );
end;
$$;

revoke all on function public.breezy_grant_special_credits(text, integer, text) from public;
revoke all on function public.breezy_grant_special_credits(text, integer, text) from anon;
revoke all on function public.breezy_grant_special_credits(text, integer, text) from authenticated;
grant execute on function public.breezy_grant_special_credits(text, integer, text) to service_role;

insert into public.breezy_schema_versions(version)
values ('2026-09-05-separate-quotation-credits')
on conflict (version) do nothing;

commit;
