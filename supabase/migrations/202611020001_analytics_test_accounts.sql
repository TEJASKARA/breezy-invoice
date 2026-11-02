-- Test accounts hidden from the developer usage analytics.
-- Platform admins pick accounts by email on the Usage analytics tab. Their
-- activity, sign-ups and workspaces are left out of platform-wide reports
-- (a direct search for the email still shows it). Nothing is deleted.
-- Run after 202610280001_signup_phone_and_admin_analytics.sql. Safe to re-run.
begin;

create table if not exists public.breezy_analytics_excluded_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.breezy_analytics_excluded_users enable row level security;
revoke all on public.breezy_analytics_excluded_users from anon, authenticated;

create or replace function public.breezy_admin_analytics_exclusions()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', excluded.user_id,
    'email', coalesce(users.email, excluded.email),
    'note', excluded.note,
    'created_at', excluded.created_at
  ) order by lower(coalesce(users.email, excluded.email))), '[]'::jsonb)
  from public.breezy_analytics_excluded_users excluded
  left join auth.users users on users.id = excluded.user_id;
$$;

create or replace function public.breezy_admin_add_analytics_exclusion(
  target_email text,
  actor_user_id uuid,
  exclusion_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target auth.users;
begin
  select * into target from auth.users
  where lower(email) = lower(trim(target_email))
  limit 1;
  if target.id is null then
    raise exception 'No ChanaX account uses that email address.' using errcode = 'P0002';
  end if;
  insert into public.breezy_analytics_excluded_users (user_id, email, note, created_by)
  values (target.id, target.email, nullif(trim(exclusion_note), ''), actor_user_id)
  on conflict (user_id) do update
    set note = coalesce(excluded.note, public.breezy_analytics_excluded_users.note);
  return jsonb_build_object('user_id', target.id, 'email', target.email);
end;
$$;

create or replace function public.breezy_admin_remove_analytics_exclusion(target_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.breezy_analytics_excluded_users where user_id = target_user_id;
$$;

create or replace function public.breezy_admin_usage_extras(
  since_days integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  started timestamptz := now() - make_interval(days => since_days);
  result jsonb;
begin
  if since_days < 1 or since_days > 365 then
    raise exception 'The reporting period must be between 1 and 365 days.';
  end if;

  select jsonb_build_object(
    'anonymous_site_views', (
      select count(*)
      from public.breezy_anonymous_site_visits
      where first_seen_at >= started
    ),
    'new_users', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'day', to_char(users.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD'),
          'email', users.email,
          'phone', profiles.phone
        )
        order by users.created_at desc
      )
      from auth.users users
      left join public.profiles profiles on profiles.id = users.id
      where users.created_at >= started
        and not exists (select 1 from public.breezy_analytics_excluded_users test_account
                        where test_account.user_id = users.id)
    ), '[]'::jsonb),
    'daily_signups', coalesce((
      select jsonb_agg(to_jsonb(signups))
      from (
        select
          to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as "day",
          count(*) as users
        from auth.users
        where created_at >= started
          and not exists (select 1 from public.breezy_analytics_excluded_users test_account
                          where test_account.user_id = auth.users.id)
        group by 1
        order by 1
      ) signups
    ), '[]'::jsonb),
    'page_features', coalesce((
      select jsonb_agg(to_jsonb(features))
      from (
        select
          case
            when event_name like 'invoice_%' then '/invoices'
            when event_name like 'quotation_%' then '/proformas'
            when event_name like 'expense_%' then '/expenses'
            when event_name like 'attendance_%' then '/attendance'
            when event_name like 'template_%' then '/settings/templates'
            when event_name like 'tally_%'
              or event_name in ('complete_data_export', 'zip_downloaded') then '/tally-export'
            when event_name like 'employee_letter_%' then '/employees/letters'
            when event_name like 'employee_%'
              or event_name like 'payslip_%' then '/employees'
            when event_name like 'customer_%'
              or event_name like 'entity_%' then '/customers'
            else coalesce(nullif(metadata->>'page', ''), '/workspace')
          end as page,
          event_name as name,
          count(*) as uses,
          count(distinct user_id) as users
        from public.breezy_usage_events
        where event_type = 'action' and occurred_at >= started
          and not exists (select 1 from public.breezy_analytics_excluded_users test_account
                          where test_account.user_id = public.breezy_usage_events.user_id)
        group by 1, 2
        order by uses desc
      ) features
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.breezy_admin_analytics_exclusions() from public, anon, authenticated;
revoke all on function public.breezy_admin_add_analytics_exclusion(text, uuid, text) from public, anon, authenticated;
revoke all on function public.breezy_admin_remove_analytics_exclusion(uuid) from public, anon, authenticated;
revoke all on function public.breezy_admin_usage_extras(integer) from public, anon, authenticated;
grant execute on function public.breezy_admin_analytics_exclusions() to service_role;
grant execute on function public.breezy_admin_add_analytics_exclusion(text, uuid, text) to service_role;
grant execute on function public.breezy_admin_remove_analytics_exclusion(uuid) to service_role;
grant execute on function public.breezy_admin_usage_extras(integer) to service_role;

insert into public.breezy_schema_versions(version)
values ('2026-11-02-analytics-test-accounts')
on conflict (version) do nothing;

commit;
