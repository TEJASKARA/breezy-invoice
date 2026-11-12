-- Marketing uploads for the platform-admin "Marketing" tab.
-- Admins upload daily GST/MCA exports; ChanaX cleans them and inserts each
-- new address into public.email_outreach with email_status = 'pending'.
-- Addresses already in email_outreach (sent, failed, unsubscribed, ...) are
-- skipped, so nobody is emailed twice. Upload history is kept for the tab.
-- Service-role only: subscribers can never read these tables.
-- Requires public.email_outreach (with its unique index on lower(email)).
-- Safe to re-run.
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
alter table public.breezy_marketing_uploads enable row level security;
revoke all on public.breezy_marketing_uploads from anon, authenticated;
grant select, insert, update, delete on public.breezy_marketing_uploads to service_role;

-- Clean up the separate queue from an earlier draft of this migration, if it
-- was run and never used.
drop function if exists public.breezy_marketing_next_batch(integer);
drop function if exists public.breezy_marketing_mark(uuid[], text, text);
drop function if exists public.breezy_marketing_unsubscribe(text);
do $$
declare
  has_rows boolean;
begin
  if to_regclass('public.breezy_marketing_leads') is not null then
    execute 'select exists (select 1 from public.breezy_marketing_leads)' into has_rows;
    if not has_rows then
      execute 'drop table public.breezy_marketing_leads';
    end if;
  end if;
end $$;

-- Admin upload: records the upload and adds only addresses never seen before.
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
    select distinct on (lower(btrim(item ->> 'email')))
      lower(btrim(item ->> 'email')) as email,
      nullif(btrim(coalesce(item ->> 'contact_name', item ->> 'business_name', '')), '') as name
    from jsonb_array_elements(coalesce(leads, '[]'::jsonb)) item
    where coalesce(btrim(item ->> 'email'), '') <> ''
  ), inserted as (
    insert into public.email_outreach (name, email, email_status)
    select incoming.name, incoming.email, 'pending'
    from incoming
    on conflict ((lower(email))) do nothing
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
        select coalesce(email_status, 'none') as status, count(*) as total
        from public.email_outreach where not email_unsubscribed group by 1) by_status), '{}'::jsonb)
      || jsonb_build_object('unsubscribed',
        (select count(*) from public.email_outreach where email_unsubscribed)),
    'sent_today', (select count(*) from public.email_outreach
      where email_status = 'sent'
        and email_sent_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'),
    'uploads', coalesce((select jsonb_agg(to_jsonb(recent) order by recent.created_at desc) from (
      select id, source, file_name, uploaded_by_email, total_rows, valid_rows, missing_email,
        invalid_email, duplicate_in_file, inserted, already_contacted, created_at
      from public.breezy_marketing_uploads order by created_at desc limit 30) recent), '[]'::jsonb)
  );
$$;

revoke all on function public.breezy_admin_marketing_import(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.breezy_admin_marketing_summary() from public, anon, authenticated;
grant execute on function public.breezy_admin_marketing_import(jsonb, jsonb) to service_role;
grant execute on function public.breezy_admin_marketing_summary() to service_role;

insert into public.breezy_schema_versions(version)
values ('2026-11-02-marketing-email-outreach')
on conflict (version) do nothing;

commit;

notify pgrst, 'reload schema';
