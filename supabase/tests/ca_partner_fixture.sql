-- Isolated PostgreSQL test database only. Never run in a real Supabase project.
\set ON_ERROR_STOP on
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.user_id',true),'')::uuid$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
create table public.profiles(id uuid primary key references auth.users, email text, account_type text, ca_firm_name text, updated_at timestamptz default now());
create table public.breezy_workspaces(id uuid primary key, owner_user_id uuid references auth.users, name text, status text default 'active', created_at timestamptz default now());
create table public.breezy_workspace_members(id uuid primary key default gen_random_uuid(), workspace_id uuid references breezy_workspaces,
  user_id uuid references auth.users, role text, permissions text[] default '{}', status text default 'active',
  invited_by uuid, joined_at timestamptz, updated_at timestamptz default now(), unique(workspace_id,user_id));
create table public.breezy_workspace_invitations(workspace_id uuid, email text, status text);
create table public.breezy_subscriptions(workspace_id uuid unique, included_seats int default 3, extra_seats int default 0);
create table public.breezy_workspace_settings(workspace_id uuid primary key, setup jsonb);
create table public.breezy_entities(workspace_id uuid, payload jsonb, transferred_at timestamptz);
create table public.breezy_invoices(workspace_id uuid, payload jsonb);
create table public.breezy_proformas(workspace_id uuid, payload jsonb);
create table public.breezy_payslips(workspace_id uuid, payload jsonb);
create table public.breezy_expenses(workspace_id uuid, payload jsonb);
create table public.breezy_usage_events(workspace_id uuid, user_id uuid, occurred_at timestamptz default now());
create table public.breezy_workspace_audit_log(workspace_id uuid, actor_user_id uuid, actor_email text, actor_account_type text,
  action text, resource_type text, resource_id text, details jsonb default '{}');
create function public.breezy_has_permission(target_workspace_id uuid, required_permission text) returns boolean
language sql security definer set search_path='' as $$
 select exists(select 1 from public.breezy_workspace_members where workspace_id=target_workspace_id and user_id=auth.uid() and status='active'
 and (role in ('owner','admin') or required_permission=any(permissions) or replace(required_permission,'.read','.manage')=any(permissions)));
$$;
create function public.breezy_validate_permissions(candidate text[]) returns boolean language sql immutable as $$
 select coalesce(candidate,'{}'::text[]) <@ array['workspace.read','workspace.manage','team.manage','entities.read','entities.manage',
 'invoices.read','invoices.manage','payslips.read','payslips.manage','expenses.read','expenses.manage','data_export.read','data_export.manage','templates.read','templates.manage'];
$$;
create function public.breezy_additional_seats_reserved(target_workspace_id uuid) returns integer
language sql security definer set search_path='' as $$
 select (select count(*)::int from public.breezy_workspace_members m where m.workspace_id=target_workspace_id and m.role<>'owner' and m.status in ('active','invited'))
 + (select count(*)::int from public.breezy_workspace_invitations i where i.workspace_id=target_workspace_id and i.status='pending' and not exists(
 select 1 from public.breezy_workspace_members m join auth.users u on u.id=m.user_id where m.workspace_id=target_workspace_id and m.status in ('active','invited') and lower(u.email)=lower(i.email)));
$$;
create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAILED: %',label; end if; end $$;
create function public.test_fails(statement text,expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if position(expected in sqlerrm)>0 then return; end if; raise;
  end;
  raise exception 'Statement unexpectedly succeeded: %',statement;
end $$;
\ir ../migrations/202610100002_ca_partner_invitations.sql
