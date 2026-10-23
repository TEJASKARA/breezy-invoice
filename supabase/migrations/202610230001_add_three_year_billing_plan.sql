-- Allow the server-priced three-year plan alongside the existing fixed plans.

begin;

alter table public.breezy_payment_orders
  drop constraint if exists breezy_payment_orders_plan_key_check;

alter table public.breezy_payment_orders
  add constraint breezy_payment_orders_plan_key_check
    check (plan_key in (
      'monthly', 'quarterly', 'half_yearly', 'annual', 'three_year',
      'custom_monthly', 'custom_quarterly', 'custom_annual'
    ));

insert into public.breezy_schema_versions(version)
values ('2026-10-23-add-three-year-billing-plan')
on conflict (version) do nothing;

commit;
