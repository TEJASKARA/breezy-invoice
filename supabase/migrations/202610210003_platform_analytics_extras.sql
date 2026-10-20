begin;
create or replace function public.breezy_admin_usage_extras(since_days integer default 5)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare started timestamptz := now() - make_interval(days => since_days); result jsonb;
begin
 if since_days < 1 or since_days > 365 then raise exception 'The reporting period must be between 1 and 365 days.'; end if;
 select jsonb_build_object(
  'anonymous_site_views', (select count(*) from public.breezy_anonymous_site_visits where first_seen_at >= started),
  'new_users', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(users.created_at at time zone 'Asia/Kolkata','YYYY-MM-DD'),'email',users.email) order by users.created_at desc) from auth.users users where users.created_at >= started),'[]'::jsonb),
  'daily_signups', coalesce((select jsonb_agg(to_jsonb(x)) from (select to_char(created_at at time zone 'Asia/Kolkata','YYYY-MM-DD') day, count(*) users from auth.users where created_at >= started group by 1 order by 1) x),'[]'::jsonb),
  'page_features', coalesce((select jsonb_agg(to_jsonb(x)) from (select coalesce(metadata->>'page','/workspace') page, event_name name, count(*) uses, count(distinct user_id) users from public.breezy_usage_events where event_type='action' and occurred_at >= started group by 1,2 order by uses desc) x),'[]'::jsonb)
 ) into result; return result;
end $$;
revoke all on function public.breezy_admin_usage_extras(integer) from public, anon, authenticated;
grant execute on function public.breezy_admin_usage_extras(integer) to service_role;
insert into public.breezy_schema_versions(version) values ('2026-10-21-platform-analytics-extras') on conflict (version) do nothing;
commit;
