-- Platform admin: phone-vs-email sign-ups, subscriber overview (company, GST,
-- invoice/quotation counts) and Razorpay payment links for custom quotes.
-- All functions are service-role only; the API checks platform-admin access.
-- Run after 202611100002_supabase_phone_auth.sql. Safe to re-run.
begin;

-- Daily sign-ups split by how the account was created.
create or replace function public.breezy_admin_signup_methods(since_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with signups as (
    select
      to_char(users.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day,
      case
        when users.raw_app_meta_data ->> 'provider' = 'phone'
          or (nullif(users.email, '') is null and nullif(users.phone, '') is not null)
          then 'phone'
        else 'email'
      end as method
    from auth.users users
    where users.created_at >= now() - make_interval(days => greatest(1, least(since_days, 365)))
      and users.deleted_at is null
  )
  select coalesce(jsonb_agg(jsonb_build_object('day', day, 'phone', phone, 'email', email) order by day), '[]'::jsonb)
  from (
    select day,
      count(*) filter (where method = 'phone') as phone,
      count(*) filter (where method = 'email') as email
    from signups
    group by day
  ) daily;
$$;

-- Company, GST and document counts for subscriber workspaces.
create or replace function public.breezy_admin_workspace_overview(
  target_workspace_ids uuid[],
  since_days integer default 30
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'workspace_id', workspace.id,
    'name', workspace.name,
    'subscription_code', workspace.subscription_code,
    'status', workspace.status,
    'business', jsonb_build_object(
      'firm_name', settings.setup ->> 'firmName',
      'legal_name', settings.setup ->> 'legalName',
      'trade_name', settings.setup ->> 'tradeName',
      'gstin', nullif(settings.setup ->> 'gstin', ''),
      'pan', nullif(settings.setup ->> 'pan', ''),
      'gst_registration_status', nullif(settings.setup ->> 'gstRegistrationStatus', ''),
      'has_gstin', coalesce((settings.setup ->> 'hasGstin')::boolean, nullif(settings.setup ->> 'gstin', '') is not null),
      'industry', settings.setup ->> 'industry',
      'mailing_address', settings.setup ->> 'mailingAddress',
      'setup_completed', settings.setup is not null
    ),
    'gst_status', credits.gst_status,
    'verified_gstin', credits.verified_gstin,
    'entities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', entities.payload ->> 'companyName',
        'gstin', nullif(entities.payload ->> 'gstin', ''),
        'moved', entities.transferred_at is not null
      ) order by entities.created_at)
      from public.breezy_entities entities
      where entities.workspace_id = workspace.id
    ), '[]'::jsonb),
    'invoices', (
      select jsonb_build_object(
        'total', count(*),
        'generated', count(*) filter (where coalesce(invoices.payload ->> 'status', 'Generated') not in ('Draft', 'Cancelled')),
        'draft', count(*) filter (where invoices.payload ->> 'status' = 'Draft'),
        'cancelled', count(*) filter (where invoices.payload ->> 'status' = 'Cancelled'),
        'in_period', count(*) filter (where invoices.created_at >= now() - make_interval(days => greatest(1, least(since_days, 365))))
      )
      from public.breezy_invoices invoices where invoices.workspace_id = workspace.id
    ),
    'quotations', (
      select jsonb_build_object(
        'total', count(*),
        'converted', count(*) filter (where nullif(proformas.payload ->> 'convertedInvoiceId', '') is not null),
        'in_period', count(*) filter (where proformas.created_at >= now() - make_interval(days => greatest(1, least(since_days, 365))))
      )
      from public.breezy_proformas proformas where proformas.workspace_id = workspace.id
    )
  ) order by workspace.name), '[]'::jsonb)
  from public.breezy_workspaces workspace
  left join public.breezy_workspace_settings settings on settings.workspace_id = workspace.id
  left join public.breezy_credit_accounts credits on credits.workspace_id = workspace.id
  where workspace.id = any(coalesce(target_workspace_ids, '{}'));
$$;

-- Custom-quote payment links. Paid links become a normal payment order so the
-- existing fulfilment (credits + subscription period) and refunds apply.
alter table public.breezy_payment_orders
  drop constraint if exists breezy_payment_orders_plan_key_check;
alter table public.breezy_payment_orders
  add constraint breezy_payment_orders_plan_key_check
    check (plan_key in (
      'monthly', 'quarterly', 'half_yearly', 'annual', 'three_year',
      'custom_monthly', 'custom_quarterly', 'custom_annual', 'custom_quote'
    ));
alter table public.breezy_payment_orders
  drop constraint if exists breezy_payment_orders_duration_months_check;
alter table public.breezy_payment_orders
  add constraint breezy_payment_orders_duration_months_check
    check (duration_months between 1 and 36);

create table if not exists public.breezy_payment_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.breezy_workspaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  provider_link_id text unique,
  short_url text,
  description text not null,
  base_amount_paise integer not null check (base_amount_paise >= 100),
  gst_amount_paise integer not null check (gst_amount_paise >= 0),
  amount_paise integer not null check (amount_paise = base_amount_paise + gst_amount_paise),
  credits integer not null check (credits between 1 and 1000000),
  duration_months integer not null check (duration_months between 1 and 36),
  customer_name text,
  customer_email text,
  customer_phone text,
  status text not null default 'creating'
    check (status in ('creating', 'created', 'paid', 'cancelled', 'expired', 'failed')),
  provider_order_id text,
  provider_payment_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists breezy_payment_links_workspace_idx
  on public.breezy_payment_links(workspace_id, created_at desc);
create index if not exists breezy_payment_links_created_idx
  on public.breezy_payment_links(created_at desc);
alter table public.breezy_payment_links enable row level security;
revoke all on public.breezy_payment_links from public, anon, authenticated;
grant select, insert, update on public.breezy_payment_links to service_role;

-- Mark a link paid and fulfil it exactly once (webhook or manual status check).
create or replace function public.breezy_settle_payment_link(
  target_provider_link_id text,
  target_provider_order_id text,
  target_provider_payment_id text,
  target_amount_paise integer,
  target_event_id text default null,
  target_event_type text default 'payment_link.paid'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.breezy_payment_links;
begin
  select * into link from public.breezy_payment_links
  where provider_link_id = trim(target_provider_link_id)
  for update;
  if link.id is null then
    raise exception 'This payment link is not registered in ChanaX.' using errcode = 'P0002';
  end if;
  if coalesce(target_amount_paise, 0) <> link.amount_paise then
    raise exception 'The paid amount does not match the payment link.' using errcode = '22023';
  end if;
  if nullif(trim(target_provider_order_id), '') is null or nullif(trim(target_provider_payment_id), '') is null then
    raise exception 'Razorpay order and payment IDs are required.' using errcode = '22023';
  end if;

  insert into public.breezy_payment_orders (
    workspace_id, requested_by, provider_order_id, plan_key,
    amount_paise, currency, credits, duration_months
  ) values (
    link.workspace_id, link.created_by, trim(target_provider_order_id), 'custom_quote',
    link.amount_paise, 'INR', link.credits, link.duration_months
  ) on conflict (provider_order_id) do nothing;

  update public.breezy_payment_links
  set status = 'paid',
      provider_order_id = trim(target_provider_order_id),
      provider_payment_id = trim(target_provider_payment_id),
      paid_at = coalesce(paid_at, now()),
      updated_at = now()
  where id = link.id;

  return public.breezy_apply_razorpay_payment(
    trim(target_provider_order_id), trim(target_provider_payment_id),
    target_event_id, target_event_type
  );
end;
$$;

revoke all on function public.breezy_admin_signup_methods(integer) from public, anon, authenticated;
revoke all on function public.breezy_admin_workspace_overview(uuid[], integer) from public, anon, authenticated;
revoke all on function public.breezy_settle_payment_link(text, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.breezy_admin_signup_methods(integer) to service_role;
grant execute on function public.breezy_admin_workspace_overview(uuid[], integer) to service_role;
grant execute on function public.breezy_settle_payment_link(text, text, text, integer, text, text) to service_role;

insert into public.breezy_schema_versions(version)
values ('2026-11-10-admin-analytics-payment-links')
on conflict (version) do nothing;

commit;

notify pgrst, 'reload schema';
