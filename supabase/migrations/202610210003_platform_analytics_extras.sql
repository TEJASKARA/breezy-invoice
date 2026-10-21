begin;

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
          'email', users.email
        )
        order by users.created_at desc
      )
      from auth.users users
      where users.created_at >= started
    ), '[]'::jsonb),
    'daily_signups', coalesce((
      select jsonb_agg(to_jsonb(signups))
      from (
        select
          to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as "day",
          count(*) as users
        from auth.users
        where created_at >= started
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
        group by 1, 2
        order by uses desc
      ) features
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;
revoke all on function public.breezy_admin_usage_extras(integer) from public, anon, authenticated;
grant execute on function public.breezy_admin_usage_extras(integer) to service_role;
insert into public.breezy_schema_versions(version) values ('2026-10-21-platform-analytics-extras') on conflict (version) do nothing;
commit;
