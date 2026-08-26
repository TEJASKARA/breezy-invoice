-- Shared document credits and subscription seat limits for ChanaX.
-- Run after 202608260001_gst_free_document_allowances.sql.

begin;

alter table public.breezy_subscriptions
  add column if not exists included_seats integer not null default 3 check (included_seats >= 1),
  add column if not exists extra_seats integer not null default 0 check (extra_seats >= 0);

create table if not exists public.breezy_credit_accounts (
  workspace_id uuid primary key references public.breezy_workspaces(id) on delete cascade,
  gst_status text not null default 'provisional' check (gst_status in ('no_gst', 'provisional', 'verified', 'rejected')),
  verified_gstin text,
  free_credits_granted integer not null default 10 check (free_credits_granted >= 0),
  free_credits_used integer not null default 0 check (free_credits_used >= 0),
  monthly_credits_remaining integer not null default 0 check (monthly_credits_remaining >= 0),
  topup_credits_remaining integer not null default 0 check (topup_credits_remaining >= 0),
  monthly_credits_reset_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (free_credits_used <= free_credits_granted)
);

create table if not exists public.breezy_credit_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.breezy_workspaces(id) on delete cascade,
  document_type text not null check (document_type in ('invoice', 'payslip')),
  document_id uuid not null,
  credit_source text not null check (credit_source in ('free', 'monthly', 'topup')),
  credits integer not null default 1 check (credits > 0),
  created_at timestamptz not null default now(),
  unique (workspace_id, document_type, document_id)
);

insert into public.breezy_credit_accounts (
  workspace_id, gst_status, free_credits_granted, free_credits_used
)
select subscriptions.workspace_id,
       case when coalesce(settings.setup ->> 'hasGstin', 'false') = 'true' then 'provisional' else 'no_gst' end,
       10,
       least(10, (
         select count(*)::integer from (
           select id from public.breezy_invoices where workspace_id = subscriptions.workspace_id
           union all
           select id from public.breezy_payslips where workspace_id = subscriptions.workspace_id
         ) documents
       ))
from public.breezy_subscriptions subscriptions
left join public.breezy_workspace_settings settings on settings.workspace_id = subscriptions.workspace_id
on conflict (workspace_id) do nothing;

alter table public.breezy_credit_accounts enable row level security;
alter table public.breezy_credit_transactions enable row level security;

drop policy if exists "Workspace reads credit account" on public.breezy_credit_accounts;
create policy "Workspace reads credit account" on public.breezy_credit_accounts
for select to authenticated
using ((select public.breezy_is_workspace_member(workspace_id)));

drop policy if exists "Workspace reads credit transactions" on public.breezy_credit_transactions;
create policy "Workspace reads credit transactions" on public.breezy_credit_transactions
for select to authenticated
using ((select public.breezy_is_workspace_member(workspace_id)));

create or replace function public.breezy_consume_document_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.breezy_credit_accounts%rowtype;
  source_name text;
  kind text := case when tg_table_name = 'breezy_invoices' then 'invoice' else 'payslip' end;
begin
  -- Supabase upserts use INSERT ... ON CONFLICT. Existing documents are edits and
  -- must not consume another credit before the conflict becomes an UPDATE.
  if kind = 'invoice' and exists (
    select 1 from public.breezy_invoices where workspace_id = new.workspace_id and id = new.id
  ) then
    return new;
  end if;
  if kind = 'payslip' and exists (
    select 1 from public.breezy_payslips where workspace_id = new.workspace_id and id = new.id
  ) then
    return new;
  end if;

  select * into account
  from public.breezy_credit_accounts
  where workspace_id = new.workspace_id
  for update;

  if not found then
    insert into public.breezy_credit_accounts (workspace_id, gst_status, free_credits_granted)
    values (
      new.workspace_id,
      case when exists (
        select 1 from public.breezy_workspace_settings
        where workspace_id = new.workspace_id
          and coalesce(setup ->> 'hasGstin', 'false') = 'true'
      ) then 'provisional' else 'no_gst' end,
      10
    )
    returning * into account;
  end if;

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
    raise exception 'No document credits remain. Purchase credits to generate another invoice or payslip.' using errcode = 'P0001';
  end if;

  insert into public.breezy_credit_transactions
    (workspace_id, document_type, document_id, credit_source, credits)
  values (new.workspace_id, kind, new.id, source_name, 1)
  on conflict (workspace_id, document_type, document_id) do nothing;

  return new;
end;
$$;

drop trigger if exists breezy_invoice_free_usage on public.breezy_invoices;
drop trigger if exists breezy_payslip_free_usage on public.breezy_payslips;
drop trigger if exists breezy_invoice_credit_usage on public.breezy_invoices;
drop trigger if exists breezy_payslip_credit_usage on public.breezy_payslips;

create trigger breezy_invoice_credit_usage
before insert on public.breezy_invoices
for each row execute function public.breezy_consume_document_credit();

create trigger breezy_payslip_credit_usage
before insert on public.breezy_payslips
for each row execute function public.breezy_consume_document_credit();

revoke all on function public.breezy_consume_document_credit() from public;

create or replace function public.breezy_invite_workspace_user(
  target_workspace_id uuid,
  target_email text,
  target_role text,
  target_permissions text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(target_email));
  invited_user_id uuid;
  record_id uuid;
  seat_limit integer;
  seats_reserved integer;
  already_reserved boolean;
begin
  -- Serialize seat reservations for this workspace so two simultaneous invites
  -- cannot both pass the limit check.
  perform pg_advisory_xact_lock(hashtextextended(target_workspace_id::text, 0));

  if not public.breezy_has_permission(target_workspace_id, 'team.manage') then
    raise exception 'You do not have permission to manage this workspace team.' using errcode = '42501';
  end if;
  if normalized_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  if target_role not in ('admin', 'hr', 'accountant', 'viewer', 'custom') then
    raise exception 'The selected role is not valid.' using errcode = '22023';
  end if;
  if not public.breezy_validate_permissions(target_permissions) then
    raise exception 'One or more selected permissions are not valid.' using errcode = '22023';
  end if;

  select id into invited_user_id from auth.users where lower(email) = normalized_email limit 1;
  already_reserved := exists (
    select 1 from public.breezy_workspace_invitations
    where workspace_id = target_workspace_id and lower(email) = normalized_email and status = 'pending'
  ) or (invited_user_id is not null and exists (
    select 1 from public.breezy_workspace_members
    where workspace_id = target_workspace_id and user_id = invited_user_id and status in ('active', 'invited')
  ));

  select included_seats + extra_seats into seat_limit
  from public.breezy_subscriptions where workspace_id = target_workspace_id;
  select
    (select count(*) from public.breezy_workspace_members where workspace_id = target_workspace_id and status in ('active', 'invited'))
    + (select count(*) from public.breezy_workspace_invitations where workspace_id = target_workspace_id and status = 'pending')
  into seats_reserved;
  if not already_reserved and seats_reserved >= coalesce(seat_limit, 3) then
    raise exception 'This plan includes % team accounts. Purchase an additional monthly seat before adding another email.', coalesce(seat_limit, 3) using errcode = 'P0001';
  end if;

  if invited_user_id is not null then
    if exists (select 1 from public.breezy_workspaces where id = target_workspace_id and owner_user_id = invited_user_id) then
      raise exception 'This email already belongs to the workspace owner.' using errcode = '22023';
    end if;
    insert into public.breezy_workspace_members
      (workspace_id, user_id, role, permissions, status, invited_by, joined_at)
    values
      (target_workspace_id, invited_user_id, target_role, coalesce(target_permissions, '{}'::text[]), 'active', auth.uid(), now())
    on conflict (workspace_id, user_id) do update set
      role = excluded.role, permissions = excluded.permissions, status = 'active', invited_by = excluded.invited_by,
      joined_at = coalesce(public.breezy_workspace_members.joined_at, now()), updated_at = now()
    returning id into record_id;
    return jsonb_build_object('kind', 'member', 'id', record_id, 'email', normalized_email);
  end if;

  insert into public.breezy_workspace_invitations
    (workspace_id, email, role, permissions, token_hash, invited_by, status, expires_at)
  values
    (target_workspace_id, normalized_email, target_role, coalesce(target_permissions, '{}'::text[]),
     encode(digest(gen_random_uuid()::text || clock_timestamp()::text, 'sha256'), 'hex'), auth.uid(), 'pending', now() + interval '7 days')
  on conflict (workspace_id, (lower(email))) where status = 'pending'
  do update set role = excluded.role, permissions = excluded.permissions, token_hash = excluded.token_hash,
    invited_by = excluded.invited_by, expires_at = excluded.expires_at, updated_at = now()
  returning id into record_id;
  return jsonb_build_object('kind', 'invitation', 'id', record_id, 'email', normalized_email);
end;
$$;

revoke all on function public.breezy_invite_workspace_user(uuid, text, text, text[]) from public;
grant execute on function public.breezy_invite_workspace_user(uuid, text, text, text[]) to authenticated;

insert into public.breezy_schema_versions(version)
values ('2026-08-26-shared-credits-and-seats')
on conflict (version) do nothing;

commit;
