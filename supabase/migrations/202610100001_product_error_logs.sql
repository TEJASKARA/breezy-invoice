-- Private diagnostic reports. Customers can submit, never read, error records.
begin;
create table if not exists public.chanax_error_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  workspace_id uuid references public.breezy_workspaces(id) on delete set null,
  subscription_code text,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  owner_email text,
  customer_message text not null,
  diagnostic text not null,
  error_code text,
  page_path text,
  source text not null default 'frontend',
  fingerprint text not null,
  occurrence_count integer not null default 1,
  status text not null default 'new' check (status in ('new', 'investigating', 'resolved'))
);
create index if not exists chanax_error_logs_recent on public.chanax_error_logs(actor_user_id, created_at desc);
alter table public.chanax_error_logs enable row level security;
revoke all on public.chanax_error_logs from public, anon, authenticated;
grant select, update on public.chanax_error_logs to service_role;

create or replace function public.chanax_report_unexpected_error(
  target_workspace_id uuid, customer_message text, diagnostic text,
  error_code text, page_path text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  account_email text;
  company_email text;
  company_code text;
  signature text;
  existing_id uuid;
begin
  if actor is null then return null; end if;
  select u.email into account_email from auth.users u where u.id = actor;
  if account_email is null then return null; end if;
  if target_workspace_id is not null then
    select w.subscription_code, u.email into company_code, company_email
    from public.breezy_workspaces w join auth.users u on u.id = w.owner_user_id
    where w.id = target_workspace_id and (
      w.owner_user_id = actor or exists (
        select 1 from public.breezy_workspace_members m
        where m.workspace_id = w.id and m.user_id = actor and m.status = 'active'
      )
    );
    if not found then return null; end if;
  end if;
  -- Serialize reports per actor to enforce grouping and limit concurrent spam.
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
  signature := md5(concat_ws('|', target_workspace_id::text,
    left(diagnostic, 1500), left(error_code, 40), left(split_part(page_path, '?', 1), 300)));
  select l.id into existing_id from public.chanax_error_logs l
  where l.actor_user_id = actor and l.fingerprint = signature and l.status <> 'resolved'
    and l.created_at > now() - interval '5 minutes'
  order by l.created_at desc limit 1;
  if existing_id is not null then
    update public.chanax_error_logs set last_seen_at = now(), occurrence_count = occurrence_count + 1
    where id = existing_id;
    return existing_id;
  end if;
  if (select count(*) from public.chanax_error_logs l where l.actor_user_id = actor
      and l.created_at > now() - interval '5 minutes') >= 20 then return null; end if;
  insert into public.chanax_error_logs(workspace_id, subscription_code, actor_user_id,
    actor_email, owner_email, customer_message, diagnostic, error_code, page_path, fingerprint)
  values(target_workspace_id, company_code, actor, account_email, company_email,
    left(coalesce(customer_message, 'Unexpected error'), 500),
    left(coalesce(diagnostic, 'Unexpected error'), 1500), left(error_code, 40),
    left(split_part(page_path, '?', 1), 300), signature)
  returning id into existing_id;
  return existing_id;
end;
$$;
revoke all on function public.chanax_report_unexpected_error(uuid,text,text,text,text) from public, anon;
grant execute on function public.chanax_report_unexpected_error(uuid,text,text,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
