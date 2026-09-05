-- Add the fixed monthly plan while preserving historical half-yearly orders.
-- Run after 202609050003_custom_subscription_plans.sql.

begin;

alter table public.breezy_payment_orders
  drop constraint if exists breezy_payment_orders_plan_key_check;

alter table public.breezy_payment_orders
  add constraint breezy_payment_orders_plan_key_check
    check (plan_key in (
      'monthly', 'quarterly', 'half_yearly', 'annual',
      'custom_monthly', 'custom_quarterly', 'custom_annual'
    ));

insert into public.breezy_schema_versions(version)
values ('2026-09-05-fixed-subscription-plans')
on conflict (version) do nothing;

commit;
