-- Marketing outreach queue for the platform-admin "Marketing" tab.
-- Admins upload daily GST/MCA exports; ChanaX cleans them and queues each new
-- email once (an address is never queued twice, so nobody is emailed twice).
-- The n8n 9 AM workflow claims pending rows, sends, and reports back.
-- Everything is service-role only: subscribers can never read these tables.
-- Run after 202611020002_restore_admin_workspace_search.sql. Safe to re-run.
begin;

create table if not exists public.breezy_marketing_uploads (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('gst', 'mca')),
  file_name text not null,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_by_email text,
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  missing_email integer not null default 0,
  invalid_email integer not null default 0,
  duplicate_in_file integer not null default 0,
  inserted integer not null default 0,
  already_contacted integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.breezy_marketing_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  contact_name text,
  business_name text,
  phone text,
  state text,
  city text,
  source text not null check (source in ('gst', 'mca')),
  source_ref text,
  registered_on date,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'bounced', 'unsubscribed')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  upload_id uuid references public.breezy_marketing_uploads(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint breezy_marketing_leads_email_key unique (email)
);
create index if not exists breezy_marketing_leads_queue_idx
  on public.breezy_marketing_leads (status, created_at);

alter table public.breezy_marketing_uploads enable row level security;
alter table public.breezy_marketing_leads enable row level security;
revoke all on public.breezy_marketing_uploads from anon, authenticated;
revoke all on public.breezy_marketing_leads from anon, authenticated;
grant select, insert, update, delete on public.breezy_marketing_uploads to service_role;
grant select, insert, update, delete on public.breezy_marketing_leads to service_role;

-- Admin upload: records the upload and queues only emails never seen before.
create or replace function public.breezy_admin_marketing_import(upload jsonb, leads jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_upload_id uuid;
  inserted_count integer;
  lead_count integer := coalesce(jsonb_array_length(leads), 0);
begin
  if lead_count > 20000 then
    raise exception 'Upload at most 20,000 contacts at a time.' using errcode = '22023';
  end if;
  insert into public.breezy_marketing_uploads (
    source, file_name, uploaded_by, uploaded_by_email, total_rows, valid_rows,
    missing_email, invalid_email, duplicate_in_file
  ) values (
    upload ->> 'source', left(coalesce(upload ->> 'file_name', 'upload'), 240),
    nullif(upload ->> 'uploaded_by', '')::uuid, upload ->> 'uploaded_by_email',
    coalesce((upload ->> 'total_rows')::integer, 0), lead_count,
    coalesce((upload ->> 'missing_email')::integer, 0),
    coalesce((upload ->> 'invalid_email')::integer, 0),
    coalesce((upload ->> 'duplicate_in_file')::integer, 0)
  ) returning id into new_upload_id;

  with incoming as (
    select distinct on (lower(btrim(item ->> 'email'))) item
    from jsonb_array_elements(coalesce(leads, '[]'::jsonb)) item
    where coalesce(item ->> 'email', '') <> ''
  ), inserted as (
    insert into public.breezy_marketing_leads (
      email, contact_name, business_name, phone, state, city, source, source_ref,
      registered_on, details, upload_id
    )
    select lower(btrim(item ->> 'email')), item ->> 'contact_name', item ->> 'business_name',
      item ->> 'phone', item ->> 'state', item ->> 'city', upload ->> 'source',
      item ->> 'source_ref', nullif(item ->> 'registered_on', '')::date,
      coalesce(item -> 'details', '{}'::jsonb), new_upload_id
    from incoming
    on conflict (email) do nothing
    returning 1
  )
  select count(*) into inserted_count from inserted;

  update public.breezy_marketing_uploads
  set inserted = inserted_count, already_contacted = lead_count - inserted_count
  where id = new_upload_id;

  return jsonb_build_object(
    'upload_id', new_upload_id,
    'inserted', inserted_count,
    'already_contacted', lead_count - inserted_count
  );
end;
$$;

create or replace function public.breezy_admin_marketing_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'counts', coalesce((select jsonb_object_agg(status, total) from (
      select status, count(*) as total from public.breezy_marketing_leads group by status) by_status), '{}'::jsonb),
    'sent_today', (select count(*) from public.breezy_marketing_leads
      where status = 'sent' and sent_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'),
    'uploads', coalesce((select jsonb_agg(to_jsonb(recent) order by recent.created_at desc) from (
      select id, source, file_name, uploaded_by_email, total_rows, valid_rows, missing_email,
        invalid_email, duplicate_in_file, inserted, already_contacted, created_at
      from public.breezy_marketing_uploads order by created_at desc limit 30) recent), '[]'::jsonb)
  );
$$;

-- n8n: claim the next batch to email. Rows stuck in 'sending' for 6 hours are retried.
create or replace function public.breezy_marketing_next_batch(batch_size integer default 100)
returns setof public.breezy_marketing_leads
language sql
security definer
set search_path = ''
as $$
  update public.breezy_marketing_leads lead
  set status = 'sending', claimed_at = now(), attempts = lead.attempts + 1, updated_at = now()
  where lead.id in (
    select id from public.breezy_marketing_leads
    where status = 'pending' or (status = 'sending' and claimed_at < now() - interval '6 hours')
    order by created_at, id
    limit greatest(1, least(coalesce(batch_size, 100), 1000))
    for update skip locked
  )
  returning lead.*;
$$;

-- n8n: report the outcome for the claimed rows.
create or replace function public.breezy_marketing_mark(
  lead_ids uuid[],
  new_status text,
  error_message text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if new_status not in ('sent', 'failed', 'bounced', 'unsubscribed', 'pending') then
    raise exception 'Status must be sent, failed, bounced, unsubscribed or pending.' using errcode = '22023';
  end if;
  update public.breezy_marketing_leads
  set status = new_status,
      sent_at = case when new_status = 'sent' then now() else sent_at end,
      last_error = case when new_status in ('failed', 'bounced') then left(error_message, 500) else null end,
      updated_at = now()
  where id = any(lead_ids)
    and status <> 'unsubscribed';
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- n8n unsubscribe link: the address is kept so it is never queued again.
create or replace function public.breezy_marketing_unsubscribe(target_email text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.breezy_marketing_leads (email, source, status)
  values (lower(btrim(target_email)), 'gst', 'unsubscribed')
  on conflict (email) do update set status = 'unsubscribed', updated_at = now();
$$;

revoke all on function public.breezy_admin_marketing_import(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.breezy_admin_marketing_summary() from public, anon, authenticated;
revoke all on function public.breezy_marketing_next_batch(integer) from public, anon, authenticated;
revoke all on function public.breezy_marketing_mark(uuid[], text, text) from public, anon, authenticated;
revoke all on function public.breezy_marketing_unsubscribe(text) from public, anon, authenticated;
grant execute on function public.breezy_admin_marketing_import(jsonb, jsonb) to service_role;
grant execute on function public.breezy_admin_marketing_summary() to service_role;
grant execute on function public.breezy_marketing_next_batch(integer) to service_role;
grant execute on function public.breezy_marketing_mark(uuid[], text, text) to service_role;
grant execute on function public.breezy_marketing_unsubscribe(text) to service_role;

insert into public.breezy_schema_versions(version)
values ('2026-11-02-marketing-leads')
on conflict (version) do nothing;

commit;

notify pgrst, 'reload schema';
