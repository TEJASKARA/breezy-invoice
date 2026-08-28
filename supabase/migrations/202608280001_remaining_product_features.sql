-- ChanaX proforma invoices, employee letters and recoverable account deletion.
-- Run after 202608270001_team_invitation_delivery.sql.

begin;

-- Auth Admin deletion after the recovery period must remove the owned workspace
-- atomically. Team-member deletion already cascades only that membership.
alter table public.breezy_workspaces
  drop constraint if exists breezy_workspaces_owner_user_id_fkey;
alter table public.breezy_workspaces
  add constraint breezy_workspaces_owner_user_id_fkey
  foreign key (owner_user_id) references auth.users(id) on delete cascade;

create table if not exists public.breezy_proformas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.breezy_workspaces(id) on delete cascade,
  entity_id uuid references public.breezy_entities(id) on delete set null,
  customer_id uuid references public.breezy_customers(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists breezy_proformas_workspace_created_idx
  on public.breezy_proformas(workspace_id, created_at desc);

create table if not exists public.breezy_employee_letters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.breezy_workspaces(id) on delete cascade,
  entity_id uuid not null references public.breezy_entities(id) on delete cascade,
  employee_id uuid not null references public.breezy_employees(id) on delete cascade,
  letter_type text not null check (letter_type in ('offer', 'termination')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists breezy_employee_letters_employee_idx
  on public.breezy_employee_letters(workspace_id, employee_id, created_at desc);

create table if not exists public.breezy_account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.breezy_workspaces(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'cancelled', 'completed')),
  requested_at timestamptz not null default now(),
  purge_after timestamptz not null default now() + interval '30 days',
  cancelled_at timestamptz,
  completed_at timestamptz,
  member_statuses jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.breezy_account_deletion_requests
  add column if not exists member_statuses jsonb not null default '{}'::jsonb;

alter table public.breezy_proformas enable row level security;
alter table public.breezy_employee_letters enable row level security;
alter table public.breezy_account_deletion_requests enable row level security;

-- A suspended workspace must immediately lose operational data access, even
-- while an already-issued access token is still valid during its short TTL.
create or replace function public.breezy_has_permission(target_workspace_id uuid, requested_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.breezy_workspace_members as member
    join public.breezy_workspaces as workspace on workspace.id = member.workspace_id
    where member.workspace_id = target_workspace_id
      and workspace.status = 'active'
      and member.user_id = auth.uid()
      and member.status = 'active'
      and (
        member.role in ('owner', 'admin')
        or requested_permission = any(member.permissions)
        or (requested_permission like '%.read' and replace(requested_permission, '.read', '.manage') = any(member.permissions))
      )
  );
$$;

drop policy if exists "Members read proformas" on public.breezy_proformas;
drop policy if exists "Managers create proformas" on public.breezy_proformas;
drop policy if exists "Managers update proformas" on public.breezy_proformas;
drop policy if exists "Managers delete proformas" on public.breezy_proformas;
drop policy if exists "Members read employee letters" on public.breezy_employee_letters;
drop policy if exists "Managers create employee letters" on public.breezy_employee_letters;
drop policy if exists "Managers update employee letters" on public.breezy_employee_letters;
drop policy if exists "Managers delete employee letters" on public.breezy_employee_letters;
drop policy if exists "Owner reads deletion request" on public.breezy_account_deletion_requests;
drop policy if exists "Members read expenses" on public.breezy_expenses;
drop policy if exists "Workspace members read expense bills" on storage.objects;
drop policy if exists "Workspace managers delete expense bills" on storage.objects;

create policy "Members read proformas" on public.breezy_proformas
for select to authenticated using (
  public.breezy_has_permission(workspace_id, 'invoices.read')
  or public.breezy_has_permission(workspace_id, 'data_export.read')
);
create policy "Managers create proformas" on public.breezy_proformas
for insert to authenticated with check (public.breezy_has_permission(workspace_id, 'invoices.manage'));
create policy "Managers update proformas" on public.breezy_proformas
for update to authenticated using (public.breezy_has_permission(workspace_id, 'invoices.manage'))
with check (public.breezy_has_permission(workspace_id, 'invoices.manage'));
create policy "Managers delete proformas" on public.breezy_proformas
for delete to authenticated using (public.breezy_has_permission(workspace_id, 'invoices.manage'));

create policy "Members read employee letters" on public.breezy_employee_letters
for select to authenticated using (public.breezy_has_permission(workspace_id, 'payslips.read'));
create policy "Managers create employee letters" on public.breezy_employee_letters
for insert to authenticated with check (public.breezy_has_permission(workspace_id, 'payslips.manage'));
create policy "Managers update employee letters" on public.breezy_employee_letters
for update to authenticated using (public.breezy_has_permission(workspace_id, 'payslips.manage'))
with check (public.breezy_has_permission(workspace_id, 'payslips.manage'));
create policy "Managers delete employee letters" on public.breezy_employee_letters
for delete to authenticated using (public.breezy_has_permission(workspace_id, 'payslips.manage'));

create policy "Owner reads deletion request" on public.breezy_account_deletion_requests
for select to authenticated using (
  exists (select 1 from public.breezy_workspaces where id = workspace_id and owner_user_id = auth.uid())
);

create policy "Members read expenses" on public.breezy_expenses
for select to authenticated using (
  public.breezy_has_permission(workspace_id, 'expenses.read')
  or public.breezy_has_permission(workspace_id, 'data_export.read')
);

create policy "Workspace members read expense bills" on storage.objects
for select to authenticated using (
  bucket_id = 'expense-bills'
  and exists (
    select 1 from public.breezy_expenses
    where breezy_expenses.payload ->> 'billPath' = storage.objects.name
      and (
        public.breezy_has_permission(breezy_expenses.workspace_id, 'expenses.read')
        or public.breezy_has_permission(breezy_expenses.workspace_id, 'data_export.read')
      )
  )
);

create policy "Workspace managers delete expense bills" on storage.objects
for delete to authenticated using (
  bucket_id = 'expense-bills'
  and (
    (
      (storage.foldername(name))[1] = auth.uid()::text
      and not exists (
        select 1 from public.breezy_expenses
        where breezy_expenses.payload ->> 'billPath' = storage.objects.name
      )
    )
    or exists (
      select 1 from public.breezy_expenses
      where breezy_expenses.payload ->> 'billPath' = storage.objects.name
        and public.breezy_has_permission(breezy_expenses.workspace_id, 'expenses.manage')
    )
  )
);

alter table public.breezy_credit_transactions
  drop constraint if exists breezy_credit_transactions_document_type_check;
alter table public.breezy_credit_transactions
  add constraint breezy_credit_transactions_document_type_check
  check (document_type in ('invoice', 'payslip', 'proforma'));

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
    where workspace_id = new.workspace_id and document_type = kind and document_id = new.id
  ) then return new; end if;

  select * into account from public.breezy_credit_accounts
  where workspace_id = new.workspace_id for update;

  if not found then
    insert into public.breezy_credit_accounts (workspace_id, gst_status, free_credits_granted)
    values (new.workspace_id, 'provisional', 10) returning * into account;
  end if;

  if account.free_credits_used < account.free_credits_granted then
    source_name := 'free';
    update public.breezy_credit_accounts set free_credits_used = free_credits_used + 1, updated_at = now()
    where workspace_id = new.workspace_id;
  elsif account.monthly_credits_remaining > 0 then
    source_name := 'monthly';
    update public.breezy_credit_accounts set monthly_credits_remaining = monthly_credits_remaining - 1, updated_at = now()
    where workspace_id = new.workspace_id;
  elsif account.topup_credits_remaining > 0 then
    source_name := 'topup';
    update public.breezy_credit_accounts set topup_credits_remaining = topup_credits_remaining - 1, updated_at = now()
    where workspace_id = new.workspace_id;
  else
    raise exception 'No document credits remain. Add credits to generate another document.' using errcode = 'P0001';
  end if;

  insert into public.breezy_credit_transactions
    (workspace_id, document_type, document_id, credit_source, credits)
  values (new.workspace_id, kind, new.id, source_name, 1)
  on conflict (workspace_id, document_type, document_id) do nothing;
  return new;
end;
$$;

drop trigger if exists breezy_proforma_credit_usage on public.breezy_proformas;
create trigger breezy_proforma_credit_usage before insert on public.breezy_proformas
for each row execute function public.breezy_consume_document_credit();

create or replace function public.breezy_request_account_deletion(target_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  request_row public.breezy_account_deletion_requests%rowtype;
  saved_member_statuses jsonb;
begin
  if not exists (select 1 from public.breezy_workspaces where id = target_workspace_id and owner_user_id = auth.uid()) then
    raise exception 'Only the workspace owner can request account deletion.' using errcode = '42501';
  end if;
  select coalesce(jsonb_object_agg(user_id::text, status), '{}'::jsonb) into saved_member_statuses
  from public.breezy_workspace_members where workspace_id = target_workspace_id and user_id <> auth.uid();
  insert into public.breezy_account_deletion_requests (workspace_id, requested_by, status, requested_at, purge_after, member_statuses)
  values (target_workspace_id, auth.uid(), 'pending', now(), now() + interval '30 days', saved_member_statuses)
  on conflict (workspace_id) do update set requested_by = auth.uid(), status = 'pending', requested_at = now(),
    purge_after = now() + interval '30 days', member_statuses = saved_member_statuses,
    cancelled_at = null, completed_at = null, updated_at = now()
  returning * into request_row;
  update public.breezy_workspace_members set status = 'disabled', updated_at = now()
  where workspace_id = target_workspace_id and user_id <> auth.uid();
  update public.breezy_workspaces set status = 'suspended', updated_at = now() where id = target_workspace_id;
  return jsonb_build_object('status', request_row.status, 'purge_after', request_row.purge_after);
end $$;

create or replace function public.breezy_cancel_account_deletion(target_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare request_row public.breezy_account_deletion_requests%rowtype;
begin
  if not exists (select 1 from public.breezy_workspaces where id = target_workspace_id and owner_user_id = auth.uid()) then
    raise exception 'Only the workspace owner can cancel account deletion.' using errcode = '42501';
  end if;
  update public.breezy_account_deletion_requests set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where workspace_id = target_workspace_id and status = 'pending' returning * into request_row;
  if not found then raise exception 'No pending deletion request was found.' using errcode = 'P0001'; end if;
  update public.breezy_workspace_members
  set status = case
      when user_id = auth.uid() then 'active'
      when request_row.member_statuses ->> user_id::text in ('invited', 'active', 'disabled')
        then request_row.member_statuses ->> user_id::text
      else status
    end,
    updated_at = now()
  where workspace_id = target_workspace_id;
  update public.breezy_workspaces set status = 'active', updated_at = now() where id = target_workspace_id;
  return jsonb_build_object('status', request_row.status, 'cancelled_at', request_row.cancelled_at);
end $$;

revoke all on function public.breezy_request_account_deletion(uuid) from public;
revoke all on function public.breezy_request_account_deletion(uuid) from anon;
revoke all on function public.breezy_cancel_account_deletion(uuid) from public;
revoke all on function public.breezy_cancel_account_deletion(uuid) from anon;
grant execute on function public.breezy_request_account_deletion(uuid) to authenticated;
grant execute on function public.breezy_cancel_account_deletion(uuid) to authenticated;

insert into public.breezy_schema_versions(version)
values ('2026-08-28-remaining-product-features') on conflict (version) do nothing;

commit;
