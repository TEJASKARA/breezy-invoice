-- BreezyAccounts application data.
-- Run this migration after 202607290001_auth_profiles.sql.
-- Every table is protected by Row Level Security and scoped to auth.uid().

create table if not exists public.breezy_workspace_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  setup jsonb,
  template jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.breezy_entities (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.breezy_customers (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_id uuid not null references public.breezy_entities(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.breezy_invoices (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.breezy_employees (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_id uuid not null references public.breezy_entities(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entity_id, id)
);

create table if not exists public.breezy_payslips (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_id uuid not null references public.breezy_entities(id) on delete cascade,
  employee_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists breezy_entities_user_id_idx on public.breezy_entities(user_id);
create index if not exists breezy_customers_user_entity_idx on public.breezy_customers(user_id, entity_id);
create index if not exists breezy_invoices_user_id_idx on public.breezy_invoices(user_id);
create index if not exists breezy_employees_user_entity_idx on public.breezy_employees(user_id, entity_id);
create index if not exists breezy_payslips_user_entity_idx on public.breezy_payslips(user_id, entity_id);
create index if not exists breezy_payslips_employee_idx on public.breezy_payslips(employee_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger breezy_workspace_settings_set_updated_at before update on public.breezy_workspace_settings
for each row execute function public.set_updated_at();
create trigger breezy_entities_set_updated_at before update on public.breezy_entities
for each row execute function public.set_updated_at();
create trigger breezy_customers_set_updated_at before update on public.breezy_customers
for each row execute function public.set_updated_at();
create trigger breezy_invoices_set_updated_at before update on public.breezy_invoices
for each row execute function public.set_updated_at();
create trigger breezy_employees_set_updated_at before update on public.breezy_employees
for each row execute function public.set_updated_at();
create trigger breezy_payslips_set_updated_at before update on public.breezy_payslips
for each row execute function public.set_updated_at();

alter table public.breezy_workspace_settings enable row level security;
alter table public.breezy_entities enable row level security;
alter table public.breezy_customers enable row level security;
alter table public.breezy_invoices enable row level security;
alter table public.breezy_employees enable row level security;
alter table public.breezy_payslips enable row level security;

create policy "Users manage their Breezy workspace settings" on public.breezy_workspace_settings
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users manage their Breezy entities" on public.breezy_entities
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users manage their Breezy customers" on public.breezy_customers
for all to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.breezy_entities
    where breezy_entities.id = breezy_customers.entity_id
      and breezy_entities.user_id = (select auth.uid())
  )
);

create policy "Users manage their Breezy invoices" on public.breezy_invoices
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users manage their Breezy employees" on public.breezy_employees
for all to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.breezy_entities
    where breezy_entities.id = breezy_employees.entity_id
      and breezy_entities.user_id = (select auth.uid())
  )
);

create policy "Users manage their Breezy payslips" on public.breezy_payslips
for all to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.breezy_entities
    where breezy_entities.id = breezy_payslips.entity_id
      and breezy_entities.user_id = (select auth.uid())
  )
);
