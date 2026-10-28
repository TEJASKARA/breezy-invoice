-- Collect the required phone number during sign-up, not in the follow-up survey.

begin;

alter table public.profiles
  add column if not exists phone text;

update public.profiles as profile
set phone = nullif(regexp_replace(coalesce(users.raw_user_meta_data ->> 'phone', ''), '[[:space:]()-]', '', 'g'), '')
from auth.users as users
where users.id = profile.id
  and profile.phone is null
  and nullif(users.raw_user_meta_data ->> 'phone', '') is not null;

-- Preserve phone numbers collected by the initial version of the survey when
-- that version's optional phone column still exists.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'chanax_signup_survey_responses'
      and column_name = 'phone'
  ) then
    execute $backfill$
      update public.profiles as profile
      set phone = survey.phone
      from public.chanax_signup_survey_responses as survey
      where survey.user_id = profile.id
        and profile.phone is null
        and survey.phone is not null
    $backfill$;
  end if;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_account_type text;
  normalised_phone text := nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '[[:space:]()-]', '', 'g'), '');
begin
  select account_type into saved_account_type from public.profiles where id = new.id;
  insert into public.profiles (id, email, full_name, avatar_path, phone, last_seen_at, account_type)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), 'User'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    normalised_phone,
    now(),
    coalesce(saved_account_type, 'unselected')
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    avatar_path = excluded.avatar_path,
    phone = coalesce(excluded.phone, public.profiles.phone),
    last_seen_at = excluded.last_seen_at,
    updated_at = now();

  perform public.breezy_accept_pending_invitations(new.id, new.email);

  select account_type into saved_account_type from public.profiles where id = new.id;
  if saved_account_type <> 'ca' and not exists (
    select 1 from public.breezy_workspace_members where user_id = new.id and status = 'active'
  ) then
    insert into public.breezy_workspaces (owner_user_id, name)
    values (
      new.id,
      coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1), 'ChanaX workspace')
    )
    on conflict (owner_user_id) do nothing;
  end if;
  return new;
end;
$$;

alter table public.chanax_signup_survey_responses
  drop column if exists phone;

drop function if exists public.chanax_submit_signup_survey(text, text, text[], text, text);
drop function if exists public.chanax_submit_signup_survey(text, text[], text, text);
create function public.chanax_submit_signup_survey(
  p_discovery_source text,
  p_intended_uses text[],
  p_business_type text,
  p_team_size text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null then
    raise exception 'You must be signed in to submit this survey.';
  end if;

  if p_discovery_source not in ('google_search', 'social_media', 'friend_or_colleague', 'accountant_or_ca', 'advertisement', 'other')
    or p_business_type not in ('freelancer_or_consultant', 'small_business', 'company', 'accountant_or_ca_firm', 'other')
    or cardinality(p_intended_uses) is null
    or cardinality(p_intended_uses) = 0
    or not (p_intended_uses <@ array['invoices_and_quotations', 'payroll_and_payslips', 'expenses_and_attendance', 'multiple_business_entities', 'everything']::text[])
    or (p_team_size is not null and p_team_size not in ('just_me', '2_5', '6_20', '21_50', 'more_than_50')) then
    raise exception 'The survey response contains an invalid value.';
  end if;

  insert into public.chanax_signup_survey_responses (
    user_id, discovery_source, intended_uses, business_type, team_size
  ) values (
    actor_id, p_discovery_source, p_intended_uses, p_business_type, p_team_size
  ) on conflict (user_id) do nothing;

  return true;
end;
$$;

revoke all on function public.chanax_submit_signup_survey(text, text[], text, text) from public;
grant execute on function public.chanax_submit_signup_survey(text, text[], text, text) to authenticated;

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

insert into public.breezy_schema_versions(version)
values ('2026-10-28-signup-phone-and-admin-analytics')
on conflict (version) do nothing;

commit;
