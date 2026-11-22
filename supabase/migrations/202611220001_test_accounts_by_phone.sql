-- Test accounts can be added by phone number as well as email.
-- Run after 202611190001_document_share_links.sql. Safe to re-run.
--
-- A phone number matches the account's sign-up phone (auth.users.phone) or the
-- phone saved on its profile. A 10-digit Indian mobile number is treated as +91.

begin;

alter table public.breezy_analytics_excluded_users
  alter column email drop not null,
  add column if not exists phone text;

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
    'phone', coalesce(nullif(users.phone, ''), profiles.phone, excluded.phone),
    'note', excluded.note,
    'created_at', excluded.created_at
  ) order by lower(coalesce(users.email, excluded.email, excluded.phone, ''))), '[]'::jsonb)
  from public.breezy_analytics_excluded_users excluded
  left join auth.users users on users.id = excluded.user_id
  left join public.profiles profiles on profiles.id = excluded.user_id;
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
  entered text := trim(coalesce(target_email, ''));
  digits text;
  target_id uuid;
  target_email_found text;
  target_phone text;
begin
  if position('@' in entered) > 0 then
    select users.id, users.email, coalesce(nullif(users.phone, ''), profiles.phone)
      into target_id, target_email_found, target_phone
    from auth.users users
    left join public.profiles profiles on profiles.id = users.id
    where lower(users.email) = lower(entered)
    limit 1;
  else
    digits := regexp_replace(entered, '\D', '', 'g');
    digits := regexp_replace(digits, '^00', '');
    if length(digits) = 11 and digits like '0%' then digits := substr(digits, 2); end if;
    if length(digits) = 10 and digits ~ '^[6-9]' then digits := '91' || digits; end if;
    if length(digits) < 10 or length(digits) > 15 then
      raise exception 'Enter an email address or a phone number with country code.' using errcode = '22023';
    end if;
    select users.id, users.email, coalesce(nullif(users.phone, ''), profiles.phone)
      into target_id, target_email_found, target_phone
    from auth.users users
    left join public.profiles profiles on profiles.id = users.id
    where regexp_replace(coalesce(users.phone, ''), '\D', '', 'g') = digits
       or regexp_replace(coalesce(profiles.phone, ''), '\D', '', 'g') in (digits, right(digits, 10))
    order by users.created_at
    limit 1;
  end if;

  if target_id is null then
    raise exception 'No ChanaX account uses that email address or phone number.' using errcode = 'P0002';
  end if;

  insert into public.breezy_analytics_excluded_users (user_id, email, phone, note, created_by)
  values (target_id, target_email_found, target_phone, nullif(trim(exclusion_note), ''), actor_user_id)
  on conflict (user_id) do update
    set note = coalesce(excluded.note, public.breezy_analytics_excluded_users.note),
        phone = coalesce(excluded.phone, public.breezy_analytics_excluded_users.phone);
  return jsonb_build_object('user_id', target_id, 'email', target_email_found, 'phone', target_phone);
end;
$$;

revoke all on function public.breezy_admin_analytics_exclusions() from public, anon, authenticated;
revoke all on function public.breezy_admin_add_analytics_exclusion(text, uuid, text) from public, anon, authenticated;
grant execute on function public.breezy_admin_analytics_exclusions() to service_role;
grant execute on function public.breezy_admin_add_analytics_exclusion(text, uuid, text) to service_role;

insert into public.breezy_schema_versions(version)
values ('2026-11-22-test-accounts-by-phone')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
commit;
