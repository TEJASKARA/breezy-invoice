-- One-time backfill: turns records that already exist into past "created" events
-- for the developer usage dashboard. Run AFTER 202609260001_platform_usage_analytics.sql.
--
-- * Reads only: user_id, workspace_id, created_at (and letter_type) from existing tables.
-- * Writes only: public.breezy_usage_events. No existing table is modified.
-- * Safe to re-run: every imported event carries {"backfilled": true, "source_id": <record id>}
--   and records that were already imported are skipped.
-- * Limits: page views, downloads, shares and emails were never recorded and cannot be
--   rebuilt; bulk and single creations are all counted as "created"; user_id is the user
--   who last saved the record.

begin;

create index if not exists breezy_usage_events_backfill_source_idx
  on public.breezy_usage_events ((metadata ->> 'source_id'), event_name)
  where metadata ? 'source_id';

create temporary table usage_backfill_source (
  source_id text not null,
  user_id uuid not null,
  workspace_id uuid not null,
  occurred_at timestamptz not null,
  event_name text not null,
  extra jsonb not null default '{}'::jsonb
) on commit drop;

insert into usage_backfill_source (source_id, user_id, workspace_id, occurred_at, event_name)
select id::text, user_id, workspace_id, created_at, 'entity_created'
from public.breezy_entities where workspace_id is not null;

insert into usage_backfill_source (source_id, user_id, workspace_id, occurred_at, event_name)
select id::text, user_id, workspace_id, created_at, 'customer_created'
from public.breezy_customers where workspace_id is not null;

insert into usage_backfill_source (source_id, user_id, workspace_id, occurred_at, event_name)
select id::text, user_id, workspace_id, created_at, 'invoice_created'
from public.breezy_invoices where workspace_id is not null;

insert into usage_backfill_source (source_id, user_id, workspace_id, occurred_at, event_name)
select id::text, user_id, workspace_id, created_at, 'quotation_created'
from public.breezy_proformas where workspace_id is not null;

insert into usage_backfill_source (source_id, user_id, workspace_id, occurred_at, event_name)
select id::text, user_id, workspace_id, created_at, 'employee_created'
from public.breezy_employees where workspace_id is not null;

insert into usage_backfill_source (source_id, user_id, workspace_id, occurred_at, event_name, extra)
select id::text, user_id, workspace_id, created_at, 'employee_letter_created',
       jsonb_build_object('letter_type', letter_type)
from public.breezy_employee_letters where workspace_id is not null;

insert into usage_backfill_source (source_id, user_id, workspace_id, occurred_at, event_name)
select id::text, user_id, workspace_id, created_at, 'payslip_created'
from public.breezy_payslips where workspace_id is not null;

insert into usage_backfill_source (source_id, user_id, workspace_id, occurred_at, event_name)
select id::text, user_id, workspace_id, created_at, 'expense_created'
from public.breezy_expenses where workspace_id is not null;

insert into public.breezy_usage_events (occurred_at, user_id, workspace_id, event_type, event_name, metadata)
select source.occurred_at, source.user_id, source.workspace_id, 'action', source.event_name,
       source.extra || jsonb_build_object('backfilled', true, 'source_id', source.source_id)
from usage_backfill_source source
where exists (select 1 from auth.users users where users.id = source.user_id)
  and exists (select 1 from public.breezy_workspaces workspaces where workspaces.id = source.workspace_id)
  and not exists (
    select 1 from public.breezy_usage_events existing
    where existing.metadata ? 'source_id'
      and existing.metadata ->> 'source_id' = source.source_id
      and existing.event_name = source.event_name
  );

insert into public.breezy_schema_versions(version)
values ('2026-09-26-backfill-usage-history')
on conflict (version) do nothing;

commit;

-- Summary of everything imported so far (shown in the SQL editor results).
select event_name as feature,
       count(*) as imported_events,
       min(occurred_at)::date as earliest,
       max(occurred_at)::date as latest
from public.breezy_usage_events
where metadata ->> 'backfilled' = 'true'
group by event_name
order by imported_events desc;
