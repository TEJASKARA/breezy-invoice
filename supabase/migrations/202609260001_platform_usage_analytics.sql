-- Platform usage analytics for the ChanaX developer admin.
-- Signed-in users can only INSERT their own events. Nobody except the backend
-- service role can read them, through breezy_admin_usage_report().
-- Run after 202609170003_remove_disabled_team_member.sql.

begin;

create table if not exists public.breezy_usage_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workspace_id uuid references public.breezy_workspaces(id) on delete cascade,
  event_type text not null check (event_type in ('page_view', 'action')),
  event_name text not null check (length(event_name) between 1 and 80),
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 2048)
);

create index if not exists breezy_usage_events_occurred_idx
  on public.breezy_usage_events (occurred_at desc);
create index if not exists breezy_usage_events_workspace_idx
  on public.breezy_usage_events (workspace_id, occurred_at desc);
create index if not exists breezy_usage_events_user_idx
  on public.breezy_usage_events (user_id, occurred_at desc);

alter table public.breezy_usage_events enable row level security;

drop policy if exists "Users record their own usage" on public.breezy_usage_events;
create policy "Users record their own usage"
  on public.breezy_usage_events
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (workspace_id is null or public.breezy_is_workspace_member(workspace_id))
  );
-- Deliberately no select/update/delete policies: subscribers cannot read analytics.

revoke all on public.breezy_usage_events from anon;
revoke all on public.breezy_usage_events from authenticated;
grant insert (user_id, workspace_id, event_type, event_name, metadata)
  on public.breezy_usage_events to authenticated;

create or replace function public.breezy_admin_usage_report(
  since_days integer default 30,
  search_identifier text default null,
  excluded_user_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_identifier text := nullif(lower(trim(coalesce(search_identifier, ''))), '');
  window_start timestamptz;
  scope_type text := 'platform';
  scope_workspace_id uuid;
  scope_user_id uuid;
  scope jsonb;
  result jsonb;
begin
  if since_days is null or since_days < 1 or since_days > 365 then
    raise exception 'The reporting period must be between 1 and 365 days.' using errcode = '22023';
  end if;
  window_start := now() - make_interval(days => since_days);

  if normalized_identifier is not null then
    if position('@' in normalized_identifier) > 0 then
      select id into scope_user_id
      from auth.users
      where lower(email) = normalized_identifier
      limit 1;
      if scope_user_id is null then
        raise exception 'No user matches that email address.' using errcode = 'P0002';
      end if;
      scope_type := 'user';
      select jsonb_build_object(
        'type', 'user',
        'user_id', users.id,
        'email', users.email,
        'signed_up_at', users.created_at,
        'last_sign_in_at', users.last_sign_in_at,
        'workspaces', coalesce((
          select jsonb_agg(jsonb_build_object(
            'workspace_id', workspaces.id,
            'name', workspaces.name,
            'subscription_code', workspaces.subscription_code,
            'role', members.role
          ) order by workspaces.created_at)
          from public.breezy_workspace_members members
          join public.breezy_workspaces workspaces on workspaces.id = members.workspace_id
          where members.user_id = users.id and members.status = 'active'
        ), '[]'::jsonb)
      ) into scope
      from auth.users users
      where users.id = scope_user_id;
    else
      select id into scope_workspace_id
      from public.breezy_workspaces
      where lower(subscription_code) = normalized_identifier
      limit 1;
      if scope_workspace_id is null then
        raise exception 'No workspace matches that subscription code.' using errcode = 'P0002';
      end if;
      scope_type := 'workspace';
      select jsonb_build_object(
        'type', 'workspace',
        'workspace_id', workspaces.id,
        'name', workspaces.name,
        'subscription_code', workspaces.subscription_code,
        'status', workspaces.status,
        'owner_email', owners.email,
        'created_at', workspaces.created_at
      ) into scope
      from public.breezy_workspaces workspaces
      left join auth.users owners on owners.id = workspaces.owner_user_id
      where workspaces.id = scope_workspace_id;
    end if;
  else
    scope := jsonb_build_object('type', 'platform');
  end if;

  with scoped as (
    select events.*
    from public.breezy_usage_events events
    where events.occurred_at >= window_start
      and (scope_workspace_id is null or events.workspace_id = scope_workspace_id)
      and (scope_user_id is null or events.user_id = scope_user_id)
      -- Platform administrators' own activity is left out, unless they are looked up directly.
      and (scope_user_id is not null or not (events.user_id = any(coalesce(excluded_user_ids, '{}'::uuid[]))))
  ),
  totals as (
    select
      count(*) filter (where event_type = 'page_view') as page_views,
      count(*) filter (where event_type = 'action') as actions,
      count(distinct user_id) as active_users,
      count(distinct workspace_id) as active_workspaces,
      max(occurred_at) as last_activity_at
    from scoped
  ),
  pages as (
    select event_name as name, count(*) as views, count(distinct user_id) as users,
           count(distinct workspace_id) as workspaces, max(occurred_at) as last_used_at
    from scoped where event_type = 'page_view'
    group by event_name order by views desc limit 50
  ),
  features as (
    select event_name as name, count(*) as uses,
           coalesce(sum(case when jsonb_typeof(metadata -> 'count') = 'number' then (metadata ->> 'count')::numeric else 1 end), 0) as items,
           count(distinct user_id) as users, count(distinct workspace_id) as workspaces,
           max(occurred_at) as last_used_at
    from scoped where event_type = 'action'
    group by event_name order by uses desc limit 50
  ),
  daily as (
    select to_char(date_trunc('day', occurred_at at time zone 'Asia/Kolkata'), 'YYYY-MM-DD') as day,
           count(*) filter (where event_type = 'page_view') as page_views,
           count(*) filter (where event_type = 'action') as actions,
           count(distinct user_id) as active_users
    from scoped group by 1 order by 1
  ),
  top_users as (
    select scoped.user_id, users.email, count(*) as events,
           count(*) filter (where event_type = 'action') as actions,
           max(occurred_at) as last_seen_at,
           (array_agg(scoped.event_name order by scoped.occurred_at desc) filter (where event_type = 'page_view'))[1] as last_page
    from scoped left join auth.users users on users.id = scoped.user_id
    group by scoped.user_id, users.email
    order by events desc limit 50
  ),
  top_workspaces as (
    select scoped.workspace_id, workspaces.name, workspaces.subscription_code, owners.email as owner_email,
           count(*) as events, count(*) filter (where event_type = 'action') as actions,
           count(distinct scoped.user_id) as users, max(occurred_at) as last_seen_at
    from scoped
    join public.breezy_workspaces workspaces on workspaces.id = scoped.workspace_id
    left join auth.users owners on owners.id = workspaces.owner_user_id
    group by scoped.workspace_id, workspaces.name, workspaces.subscription_code, owners.email
    order by events desc limit 50
  ),
  recent as (
    select scoped.occurred_at, scoped.event_type, scoped.event_name, users.email,
           workspaces.subscription_code
    from scoped
    left join auth.users users on users.id = scoped.user_id
    left join public.breezy_workspaces workspaces on workspaces.id = scoped.workspace_id
    order by scoped.occurred_at desc limit 100
  )
  select jsonb_build_object(
    'since_days', since_days,
    'generated_at', now(),
    'scope', scope,
    'totals', (select to_jsonb(totals) from totals),
    'pages', coalesce((select jsonb_agg(to_jsonb(pages)) from pages), '[]'::jsonb),
    'features', coalesce((select jsonb_agg(to_jsonb(features)) from features), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(to_jsonb(daily)) from daily), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(to_jsonb(top_users)) from top_users), '[]'::jsonb),
    'workspaces', coalesce((select jsonb_agg(to_jsonb(top_workspaces)) from top_workspaces), '[]'::jsonb),
    'recent', case when scope_type = 'platform' then '[]'::jsonb
                   else coalesce((select jsonb_agg(to_jsonb(recent)) from recent), '[]'::jsonb) end
  ) into result;

  return result;
end;
$$;

revoke all on function public.breezy_admin_usage_report(integer, text, uuid[]) from public;
revoke all on function public.breezy_admin_usage_report(integer, text, uuid[]) from anon;
revoke all on function public.breezy_admin_usage_report(integer, text, uuid[]) from authenticated;
grant execute on function public.breezy_admin_usage_report(integer, text, uuid[]) to service_role;

insert into public.breezy_schema_versions(version)
values ('2026-09-26-platform-usage-analytics')
on conflict (version) do nothing;

commit;
