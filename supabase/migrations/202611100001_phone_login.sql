-- Sign in with a verified phone number. The API sends a WhatsApp code (same n8n
-- webhook as sign-up verification); a correct code signs the user in.
-- Login codes share breezy_phone_verifications (and its limits) but are tagged
-- purpose = 'login', so they can never mark a phone as verified.
-- Run after 202611050001_phone_verification.sql. Safe to re-run.
begin;

alter table public.breezy_phone_verifications
  add column if not exists purpose text not null default 'verify'
  check (purpose in ('verify', 'login'));

-- Sign-up verification only ever consumes 'verify' codes.
create or replace function public.breezy_phone_otp_verify(
  target_user_id uuid,
  target_phone text,
  target_code_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending public.breezy_phone_verifications;
begin
  select * into pending from public.breezy_phone_verifications
  where user_id = target_user_id and phone = target_phone and purpose = 'verify'
    and verified_at is null and superseded_at is null
  order by created_at desc
  limit 1
  for update;

  if pending.id is null or pending.expires_at < now() then
    return jsonb_build_object('verified', false, 'reason', 'expired');
  end if;
  if pending.attempts >= 5 then
    return jsonb_build_object('verified', false, 'reason', 'locked');
  end if;
  if pending.code_hash <> target_code_hash then
    update public.breezy_phone_verifications set attempts = attempts + 1 where id = pending.id;
    return jsonb_build_object('verified', false, 'reason', 'mismatch',
                              'attempts_left', greatest(0, 4 - pending.attempts));
  end if;

  update public.breezy_phone_verifications set verified_at = now() where id = pending.id;
  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                           || jsonb_build_object('phone', '+' || target_phone)
  where id = target_user_id;
  update public.profiles
  set phone = '+' || target_phone, phone_verified_at = now(), updated_at = now()
  where id = target_user_id;
  return jsonb_build_object('verified', true, 'phone', '+' || target_phone);
end;
$$;

-- The one account whose verified phone is this number.
create or replace function public.breezy_phone_login_account(target_phone text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'matches', count(*),
    'user_id', case when count(*) = 1 then min(users.id::text) end,
    'email', case when count(*) = 1 then min(users.email) end
  )
  from public.profiles profiles
  join auth.users users on users.id = profiles.id
  where profiles.phone = '+' || target_phone
    and profiles.phone_verified_at is not null
    and users.deleted_at is null
    and (users.banned_until is null or users.banned_until < now())
    and nullif(trim(users.email), '') is not null;
$$;

-- Store a login code. Same cooldown and hourly limits as verification codes.
create or replace function public.breezy_phone_login_otp_create(
  target_user_id uuid,
  target_phone text,
  target_code_hash text,
  ttl_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_sent timestamptz;
  new_id uuid;
begin
  if not exists (select 1 from public.profiles where id = target_user_id
                 and phone = '+' || target_phone and phone_verified_at is not null) then
    raise exception 'This number is not verified on a ChanaX account.' using errcode = '22023';
  end if;
  select max(created_at) into last_sent from public.breezy_phone_verifications
  where user_id = target_user_id;
  if last_sent > now() - interval '30 seconds' then
    raise exception 'Please wait % seconds before requesting another code.',
      ceil(extract(epoch from (last_sent + interval '30 seconds' - now())))::integer
      using errcode = '22023';
  end if;
  if (select count(*) from public.breezy_phone_verifications
      where user_id = target_user_id and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.breezy_phone_verifications
         where phone = target_phone and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many codes requested. Please try again in an hour.' using errcode = '22023';
  end if;

  update public.breezy_phone_verifications
  set superseded_at = now()
  where user_id = target_user_id and purpose = 'login'
    and verified_at is null and superseded_at is null;

  insert into public.breezy_phone_verifications (user_id, phone, code_hash, expires_at, purpose)
  values (target_user_id, target_phone, target_code_hash,
          now() + make_interval(secs => greatest(60, least(coalesce(ttl_seconds, 600), 1800))),
          'login')
  returning id into new_id;
  return jsonb_build_object('id', new_id);
end;
$$;

-- Check a login code (5 attempts). Success only consumes the code.
create or replace function public.breezy_phone_login_otp_verify(
  target_user_id uuid,
  target_phone text,
  target_code_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending public.breezy_phone_verifications;
begin
  select * into pending from public.breezy_phone_verifications
  where user_id = target_user_id and phone = target_phone and purpose = 'login'
    and verified_at is null and superseded_at is null
  order by created_at desc
  limit 1
  for update;

  if pending.id is null or pending.expires_at < now() then
    return jsonb_build_object('verified', false, 'reason', 'expired');
  end if;
  if pending.attempts >= 5 then
    return jsonb_build_object('verified', false, 'reason', 'locked');
  end if;
  if pending.code_hash <> target_code_hash then
    update public.breezy_phone_verifications set attempts = attempts + 1 where id = pending.id;
    return jsonb_build_object('verified', false, 'reason', 'mismatch',
                              'attempts_left', greatest(0, 4 - pending.attempts));
  end if;
  update public.breezy_phone_verifications set verified_at = now() where id = pending.id;
  return jsonb_build_object('verified', true);
end;
$$;

revoke all on function public.breezy_phone_otp_verify(uuid, text, text) from public, anon, authenticated;
revoke all on function public.breezy_phone_login_account(text) from public, anon, authenticated;
revoke all on function public.breezy_phone_login_otp_create(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.breezy_phone_login_otp_verify(uuid, text, text) from public, anon, authenticated;
grant execute on function public.breezy_phone_otp_verify(uuid, text, text) to service_role;
grant execute on function public.breezy_phone_login_account(text) to service_role;
grant execute on function public.breezy_phone_login_otp_create(uuid, text, text, integer) to service_role;
grant execute on function public.breezy_phone_login_otp_verify(uuid, text, text) to service_role;

insert into public.breezy_schema_versions(version)
values ('2026-11-10-phone-login')
on conflict (version) do nothing;

commit;

notify pgrst, 'reload schema';
