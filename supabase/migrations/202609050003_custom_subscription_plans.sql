-- Server-priced custom monthly, quarterly and annual prepaid plans.
-- Run after 202609050002_private_super_admin.sql.

begin;

alter table public.breezy_payment_orders
  add column if not exists estimated_monthly_invoices integer
    check (estimated_monthly_invoices >= 0),
  add column if not exists estimated_employees integer
    check (estimated_employees >= 0);

alter table public.breezy_payment_orders
  drop constraint if exists breezy_payment_orders_plan_key_check,
  drop constraint if exists breezy_payment_orders_duration_months_check;

alter table public.breezy_payment_orders
  add constraint breezy_payment_orders_plan_key_check
    check (plan_key in (
      'quarterly', 'half_yearly', 'annual',
      'custom_monthly', 'custom_quarterly', 'custom_annual'
    )),
  add constraint breezy_payment_orders_duration_months_check
    check (duration_months in (1, 3, 6, 12));

insert into public.breezy_schema_versions(version)
values ('2026-09-05-custom-subscription-plans')
on conflict (version) do nothing;

commit;
