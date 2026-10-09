-- Isolated PostgreSQL test database only. Never run this fixture in production.
\set ON_ERROR_STOP on
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.user_id', true), '')::uuid;
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
create table public.profiles(id uuid primary key references auth.users on delete cascade, account_type text);
create table public.breezy_workspaces(id uuid primary key, owner_user_id uuid references auth.users on delete cascade,
  name text, subscription_code text unique, status text default 'active');
create table public.breezy_workspace_settings(user_id uuid primary key references auth.users on delete cascade,
  workspace_id uuid unique references breezy_workspaces on delete cascade, setup jsonb, template jsonb default '{}');
create table public.breezy_entities(id uuid primary key, user_id uuid references auth.users on delete cascade,
  workspace_id uuid references breezy_workspaces on delete cascade, payload jsonb default '{}', created_at timestamptz default now());
create table public.breezy_customers(id uuid primary key, user_id uuid references auth.users on delete cascade,
  workspace_id uuid references breezy_workspaces on delete cascade, entity_id uuid references breezy_entities on delete cascade, payload jsonb default '{}');
create table public.breezy_invoices(id uuid primary key, user_id uuid references auth.users on delete cascade,
  workspace_id uuid references breezy_workspaces on delete cascade, customer_id uuid references breezy_customers on delete set null,
  payload jsonb default '{}', source_proforma_id uuid);
create table public.breezy_proformas(id uuid primary key, user_id uuid references auth.users on delete cascade,
  workspace_id uuid references breezy_workspaces on delete cascade, entity_id uuid references breezy_entities on delete set null,
  customer_id uuid references breezy_customers on delete set null, payload jsonb default '{}', converted_invoice_id uuid references breezy_invoices on delete set null);
alter table breezy_invoices add foreign key(source_proforma_id) references breezy_proformas on delete set null;
create table public.breezy_employees(id uuid primary key, user_id uuid references auth.users on delete cascade,
  workspace_id uuid references breezy_workspaces on delete cascade, entity_id uuid references breezy_entities on delete cascade, payload jsonb default '{}');
create table public.breezy_payslips(id uuid primary key, user_id uuid references auth.users on delete cascade,
  workspace_id uuid references breezy_workspaces on delete cascade, entity_id uuid references breezy_entities on delete cascade, employee_id uuid, payload jsonb default '{}');
create table public.breezy_employee_letters(id uuid primary key, user_id uuid references auth.users on delete cascade,
  workspace_id uuid references breezy_workspaces on delete cascade, entity_id uuid references breezy_entities on delete cascade,
  employee_id uuid references breezy_employees on delete cascade, payload jsonb default '{}');
create table public.breezy_expenses(id uuid primary key, user_id uuid references auth.users on delete cascade,
  workspace_id uuid references breezy_workspaces on delete cascade, entity_id uuid references breezy_entities on delete cascade, payload jsonb default '{}');
create table public.breezy_workspace_audit_log(id bigint generated always as identity primary key,
  workspace_id uuid references breezy_workspaces on delete cascade, actor_user_id uuid references auth.users on delete set null,
  action text, resource_type text, resource_id text, details jsonb);
create table public.breezy_credit_accounts(workspace_id uuid primary key references breezy_workspaces on delete cascade,
  gst_status text, free_credits_granted int default 0, free_credits_used int default 0,
  free_quotation_credits_granted int default 0, free_quotation_credits_used int default 0,
  monthly_credits_remaining int default 0, monthly_quotation_credits_remaining int default 0,
  topup_credits_remaining int default 0, topup_quotation_credits_remaining int default 0,
  monthly_credits_reset_at timestamptz, updated_at timestamptz);
create table public.breezy_credit_transactions(workspace_id uuid references breezy_workspaces on delete cascade,
  document_type text, document_id uuid, credit_source text, credits int, unique(workspace_id, document_type, document_id));
create table public.breezy_subscriptions(workspace_id uuid references breezy_workspaces on delete cascade,
  status text, current_period_ends_at timestamptz, updated_at timestamptz);
create table public.breezy_schema_versions(version text primary key);
create function public.breezy_has_permission(target_workspace_id uuid, required_permission text)
returns boolean language sql security definer as $$
  select exists(select 1 from public.breezy_workspaces where id = target_workspace_id and owner_user_id = auth.uid());
$$;
do $$ declare t text; begin
  foreach t in array array['breezy_workspaces','breezy_workspace_settings','breezy_entities','breezy_customers','breezy_invoices',
    'breezy_proformas','breezy_employees','breezy_payslips','breezy_employee_letters','breezy_expenses'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I add column updated_at timestamptz default now()', t);
    if t = 'breezy_workspaces' then
      execute 'create policy test_owner on breezy_workspaces for all to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid())';
    else
      execute format('create policy test_owner on %I for all to authenticated using (breezy_has_permission(workspace_id, ''workspace.manage'')) with check (breezy_has_permission(workspace_id, ''workspace.manage''))', t);
    end if;
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;
\ir ../migrations/202610070001_unique_workspace_gstin.sql
\ir ../migrations/202609070006_proforma_invoice_conversion.sql
\ir ../migrations/202610090001_entity_account_transfers.sql
\ir ../migrations/202610090002_entity_deletion.sql
create trigger test_invoice_credit before insert on breezy_invoices for each row execute function breezy_consume_document_credit();
create trigger test_proforma_credit before insert on breezy_proformas for each row execute function breezy_consume_document_credit();
create trigger test_payslip_credit before insert on breezy_payslips for each row execute function breezy_consume_document_credit();
create function public.test_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %', label; end if; end $$;
create function public.test_fails(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if position(expected in sqlerrm) > 0 then return; end if;
    raise exception 'Wrong failure: % (expected %)', sqlerrm, expected;
  end;
  raise exception 'Expected failure: %', expected;
end $$;
