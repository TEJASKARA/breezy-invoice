-- BreezyInvoice subscription workspaces, team membership, and permission-aware RLS.
-- This migration upgrades the original single-user tables without deleting data.

begin;

create extension if not exists pgcrypto;

create table if not exists public.breezy_schema_versions (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists public.breezy_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null,
  subscription_code text not null default upper(substr(encode(gen_random_bytes(9), 'hex'), 1, 12)),
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id),
  unique (subscription_code)
);

create table if not exists public.breezy_workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.breezy_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner', 'admin', 'hr', 'accountant', 'viewer', 'custom')),
  permissions text[] not null default '{}'::text[],
  status text not null default 'active' check (status in ('invited', 'active', 'disabled')),
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists public.breezy_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.breezy_workspaces(id) on delete cascade,
  plan_key text not null default 'free',
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired')),
  trial_ends_at timestamptz default (now() + interval '14 days'),
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  limits jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.breezy_workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.breezy_workspaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'hr', 'accountant', 'viewer', 'custom')),
  permissions text[] not null default '{}'::text[],
  token_hash text not null,
  invited_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
update public.profiles as profiles
set email = users.email
from auth.users as users
where profiles.id = users.id and profiles.email is distinct from users.email;

create unique index if not exists breezy_pending_invitation_email_idx
on public.breezy_workspace_invitations (workspace_id, lower(email))
where status = 'pending';

alter table public.breezy_workspace_settings add column if not exists workspace_id uuid references public.breezy_workspaces(id) on delete cascade;
alter table public.breezy_entities add column if not exists workspace_id uuid references public.breezy_workspaces(id) on delete cascade;
alter table public.breezy_customers add column if not exists workspace_id uuid references public.breezy_workspaces(id) on delete cascade;
alter table public.breezy_invoices add column if not exists workspace_id uuid references public.breezy_workspaces(id) on delete cascade;
alter table public.breezy_invoices add column if not exists customer_id uuid references public.breezy_customers(id) on delete set null;
alter table public.breezy_employees add column if not exists workspace_id uuid references public.breezy_workspaces(id) on delete cascade;
alter table public.breezy_payslips add column if not exists workspace_id uuid references public.breezy_workspaces(id) on delete cascade;
alter table public.breezy_expenses add column if not exists workspace_id uuid references public.breezy_workspaces(id) on delete cascade;

insert into public.breezy_workspaces (owner_user_id, name)
select users.id,
       coalesce(nullif(users.raw_user_meta_data ->> 'full_name', ''), nullif(users.raw_user_meta_data ->> 'name', ''), split_part(users.email, '@', 1), 'BreezyInvoice workspace')
from auth.users as users
on conflict (owner_user_id) do nothing;

insert into public.breezy_workspace_members (workspace_id, user_id, role, status, joined_at)
select workspaces.id, workspaces.owner_user_id, 'owner', 'active', now()
from public.breezy_workspaces as workspaces
on conflict (workspace_id, user_id) do update set role = 'owner', status = 'active';

insert into public.breezy_subscriptions (workspace_id)
select id from public.breezy_workspaces
on conflict (workspace_id) do nothing;

update public.breezy_workspace_settings as settings set workspace_id = workspaces.id
from public.breezy_workspaces as workspaces where settings.workspace_id is null and workspaces.owner_user_id = settings.user_id;
update public.breezy_entities as records set workspace_id = workspaces.id
from public.breezy_workspaces as workspaces where records.workspace_id is null and workspaces.owner_user_id = records.user_id;
update public.breezy_customers as records set workspace_id = workspaces.id
from public.breezy_workspaces as workspaces where records.workspace_id is null and workspaces.owner_user_id = records.user_id;
update public.breezy_invoices as records set workspace_id = workspaces.id
from public.breezy_workspaces as workspaces where records.workspace_id is null and workspaces.owner_user_id = records.user_id;
update public.breezy_employees as records set workspace_id = workspaces.id
from public.breezy_workspaces as workspaces where records.workspace_id is null and workspaces.owner_user_id = records.user_id;
update public.breezy_payslips as records set workspace_id = workspaces.id
from public.breezy_workspaces as workspaces where records.workspace_id is null and workspaces.owner_user_id = records.user_id;
update public.breezy_expenses as records set workspace_id = workspaces.id
from public.breezy_workspaces as workspaces where records.workspace_id is null and workspaces.owner_user_id = records.user_id;

alter table public.breezy_workspace_settings alter column workspace_id set not null;
alter table public.breezy_entities alter column workspace_id set not null;
alter table public.breezy_customers alter column workspace_id set not null;
alter table public.breezy_invoices alter column workspace_id set not null;
alter table public.breezy_employees alter column workspace_id set not null;
alter table public.breezy_payslips alter column workspace_id set not null;
alter table public.breezy_expenses alter column workspace_id set not null;

create unique index if not exists breezy_workspace_settings_workspace_idx on public.breezy_workspace_settings(workspace_id);
create index if not exists breezy_entities_workspace_idx on public.breezy_entities(workspace_id);
create index if not exists breezy_customers_workspace_idx on public.breezy_customers(workspace_id);
create index if not exists breezy_invoices_workspace_idx on public.breezy_invoices(workspace_id);
create index if not exists breezy_employees_workspace_idx on public.breezy_employees(workspace_id);
create index if not exists breezy_payslips_workspace_idx on public.breezy_payslips(workspace_id);
create index if not exists breezy_expenses_workspace_idx on public.breezy_expenses(workspace_id);

create or replace function public.breezy_is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.breezy_workspace_members
    where workspace_id = target_workspace_id and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.breezy_has_permission(target_workspace_id uuid, requested_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.breezy_workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
      and status = 'active'
      and (
        role in ('owner', 'admin')
        or requested_permission = any(permissions)
        or (requested_permission like '%.read' and replace(requested_permission, '.read', '.manage') = any(permissions))
      )
  );
$$;

create or replace function public.breezy_shares_workspace_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.breezy_workspace_members as mine
    join public.breezy_workspace_members as teammate
      on teammate.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and teammate.user_id = target_user_id
      and teammate.status = 'active'
  );
$$;

create or replace function public.breezy_initialize_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.breezy_workspace_members (workspace_id, user_id, role, status, joined_at)
  values (new.id, new.owner_user_id, 'owner', 'active', now())
  on conflict (workspace_id, user_id) do update set role = 'owner', status = 'active';
  insert into public.breezy_subscriptions (workspace_id) values (new.id)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

drop trigger if exists breezy_workspace_initialize on public.breezy_workspaces;
create trigger breezy_workspace_initialize after insert on public.breezy_workspaces
for each row execute function public.breezy_initialize_workspace();

alter table public.breezy_workspaces enable row level security;
alter table public.breezy_workspace_members enable row level security;
alter table public.breezy_subscriptions enable row level security;
alter table public.breezy_workspace_invitations enable row level security;

drop policy if exists "Users manage their Breezy workspace settings" on public.breezy_workspace_settings;
drop policy if exists "Users manage their Breezy entities" on public.breezy_entities;
drop policy if exists "Users manage their Breezy customers" on public.breezy_customers;
drop policy if exists "Users manage their Breezy invoices" on public.breezy_invoices;
drop policy if exists "Users manage their Breezy employees" on public.breezy_employees;
drop policy if exists "Users manage their Breezy payslips" on public.breezy_payslips;
drop policy if exists "Users manage their Breezy expenses" on public.breezy_expenses;

create policy "Members read workspaces" on public.breezy_workspaces for select to authenticated using (public.breezy_is_workspace_member(id));
create policy "Owners create workspaces" on public.breezy_workspaces for insert to authenticated with check (owner_user_id = auth.uid());
create policy "Managers update workspaces" on public.breezy_workspaces for update to authenticated using (public.breezy_has_permission(id, 'workspace.manage')) with check (public.breezy_has_permission(id, 'workspace.manage'));
create policy "Members read membership" on public.breezy_workspace_members for select to authenticated using (user_id = auth.uid() or public.breezy_has_permission(workspace_id, 'team.manage'));
create policy "Members read subscriptions" on public.breezy_subscriptions for select to authenticated using (public.breezy_is_workspace_member(workspace_id));
create policy "Team managers read invitations" on public.breezy_workspace_invitations for select to authenticated using (public.breezy_has_permission(workspace_id, 'team.manage'));

drop policy if exists "Workspace members read teammate profiles" on public.profiles;
create policy "Workspace members read teammate profiles" on public.profiles for select to authenticated using (public.breezy_shares_workspace_with(id));

create policy "Members read settings" on public.breezy_workspace_settings for select to authenticated using (public.breezy_is_workspace_member(workspace_id));
create policy "Managers write settings" on public.breezy_workspace_settings for all to authenticated using (public.breezy_has_permission(workspace_id, 'workspace.manage') or public.breezy_has_permission(workspace_id, 'templates.manage')) with check (public.breezy_has_permission(workspace_id, 'workspace.manage') or public.breezy_has_permission(workspace_id, 'templates.manage'));
create policy "Members read entities" on public.breezy_entities for select to authenticated using (public.breezy_has_permission(workspace_id, 'entities.read'));
create policy "Managers write entities" on public.breezy_entities for all to authenticated using (public.breezy_has_permission(workspace_id, 'entities.manage')) with check (public.breezy_has_permission(workspace_id, 'entities.manage'));
create policy "Members read customers" on public.breezy_customers for select to authenticated using (public.breezy_has_permission(workspace_id, 'invoices.read') or public.breezy_has_permission(workspace_id, 'data_export.read'));
create policy "Managers write customers" on public.breezy_customers for all to authenticated using (public.breezy_has_permission(workspace_id, 'invoices.manage') or public.breezy_has_permission(workspace_id, 'data_export.manage')) with check (public.breezy_has_permission(workspace_id, 'invoices.manage') or public.breezy_has_permission(workspace_id, 'data_export.manage'));
create policy "Members read invoices" on public.breezy_invoices for select to authenticated using (public.breezy_has_permission(workspace_id, 'invoices.read') or public.breezy_has_permission(workspace_id, 'expenses.read') or public.breezy_has_permission(workspace_id, 'data_export.read'));
create policy "Managers write invoices" on public.breezy_invoices for all to authenticated using (public.breezy_has_permission(workspace_id, 'invoices.manage')) with check (public.breezy_has_permission(workspace_id, 'invoices.manage'));
create policy "Members read employees" on public.breezy_employees for select to authenticated using (public.breezy_has_permission(workspace_id, 'payslips.read') or public.breezy_has_permission(workspace_id, 'data_export.read'));
create policy "Managers write employees" on public.breezy_employees for all to authenticated using (public.breezy_has_permission(workspace_id, 'payslips.manage') or public.breezy_has_permission(workspace_id, 'data_export.manage')) with check (public.breezy_has_permission(workspace_id, 'payslips.manage') or public.breezy_has_permission(workspace_id, 'data_export.manage'));
create policy "Members read payslips" on public.breezy_payslips for select to authenticated using (public.breezy_has_permission(workspace_id, 'payslips.read') or public.breezy_has_permission(workspace_id, 'expenses.read') or public.breezy_has_permission(workspace_id, 'data_export.read'));
create policy "Managers write payslips" on public.breezy_payslips for all to authenticated using (public.breezy_has_permission(workspace_id, 'payslips.manage')) with check (public.breezy_has_permission(workspace_id, 'payslips.manage'));
create policy "Members read expenses" on public.breezy_expenses for select to authenticated using (public.breezy_has_permission(workspace_id, 'expenses.read'));
create policy "Managers write expenses" on public.breezy_expenses for all to authenticated using (public.breezy_has_permission(workspace_id, 'expenses.manage')) with check (public.breezy_has_permission(workspace_id, 'expenses.manage'));

revoke all on function public.breezy_is_workspace_member(uuid) from public;
revoke all on function public.breezy_has_permission(uuid, text) from public;
revoke all on function public.breezy_shares_workspace_with(uuid) from public;
grant execute on function public.breezy_is_workspace_member(uuid) to authenticated;
grant execute on function public.breezy_has_permission(uuid, text) to authenticated;
grant execute on function public.breezy_shares_workspace_with(uuid) to authenticated;

insert into public.breezy_schema_versions(version)
values ('2026-08-08-saas-workspace-v1')
on conflict (version) do nothing;

commit;
