-- Sign up / sign in with a phone number through Supabase Auth itself.
-- Supabase generates the code and calls the "Send SMS" auth hook
-- (ChanaX API -> n8n -> WhatsApp). auth.users.phone becomes the login phone;
-- profiles.phone / phone_verified_at mirror it so the rest of ChanaX keeps working.
-- Replaces the custom phone-login functions from 202611100001 (safe if that
-- file was never run). Run after 202611100001_phone_login.sql. Safe to re-run.
begin;

drop function if exists public.breezy_phone_login_account(text);
drop function if exists public.breezy_phone_login_otp_create(uuid, text, text, integer);
drop function if exists public.breezy_phone_login_otp_verify(uuid, text, text);

alter table public.breezy_phone_verifications
  add column if not exists purpose text not null default 'verify'
  check (purpose in ('verify', 'login'));

-- Mirror a confirmed login phone onto the ChanaX profile.
create or replace function public.breezy_sync_auth_phone_to_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(new.phone, '') is null or new.phone_confirmed_at is null then
    return new;
  end if;
  update public.profiles
  set phone = '+' || new.phone,
      phone_verified_at = new.phone_confirmed_at,
      updated_at = now()
  where id = new.id
    and (phone is distinct from '+' || new.phone or phone_verified_at is null);
  return new;
end;
$$;
revoke all on function public.breezy_sync_auth_phone_to_profile() from public, anon, authenticated;

-- Named to run after on_auth_user_created, which creates the profile row.
drop trigger if exists zz_breezy_sync_auth_phone on auth.users;
create trigger zz_breezy_sync_auth_phone
after insert or update of phone, phone_confirmed_at on auth.users
for each row execute function public.breezy_sync_auth_phone_to_profile();

-- Sign-up phone verification (WhatsApp code from the post-signup dialog) now
-- also becomes the login phone, unless another account already signs in with it.
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
  if not exists (select 1 from auth.users where phone = target_phone and id <> target_user_id) then
    update auth.users
    set phone = target_phone, phone_confirmed_at = now()
    where id = target_user_id;
  end if;
  update public.profiles
  set phone = '+' || target_phone, phone_verified_at = now(), updated_at = now()
  where id = target_user_id;
  return jsonb_build_object('verified', true, 'phone', '+' || target_phone);
end;
$$;
revoke all on function public.breezy_phone_otp_verify(uuid, text, text) from public, anon, authenticated;
grant execute on function public.breezy_phone_otp_verify(uuid, text, text) to service_role;

-- A number can be the sign-in phone of only one account: refuse codes for a
-- number another account already signs in with.
create or replace function public.breezy_phone_otp_create(
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
  if exists (select 1 from public.profiles where id = target_user_id
             and phone = '+' || target_phone and phone_verified_at is not null) then
    raise exception 'This phone number is already verified.' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users where phone = target_phone and id <> target_user_id) then
    raise exception 'This number is already used to sign in to another ChanaX account.' using errcode = '22023';
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
  where user_id = target_user_id and purpose = 'verify'
    and verified_at is null and superseded_at is null;

  insert into public.breezy_phone_verifications (user_id, phone, code_hash, expires_at, purpose)
  values (target_user_id, target_phone, target_code_hash,
          now() + make_interval(secs => greatest(60, least(coalesce(ttl_seconds, 600), 1800))),
          'verify')
  returning id into new_id;
  return jsonb_build_object('id', new_id);
end;
$$;
revoke all on function public.breezy_phone_otp_create(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.breezy_phone_otp_create(uuid, text, text, integer) to service_role;

-- Existing users with a verified phone can sign in with it. When several
-- accounts verified the same number, the earliest verification gets it.
update auth.users as users
set phone = candidates.digits,
    phone_confirmed_at = candidates.phone_verified_at
from (
  select distinct on (substr(profiles.phone, 2))
    profiles.id, substr(profiles.phone, 2) as digits, profiles.phone_verified_at
  from public.profiles profiles
  where profiles.phone_verified_at is not null
    and profiles.phone ~ '^\+[1-9][0-9]{9,14}$'
  order by substr(profiles.phone, 2), profiles.phone_verified_at, profiles.id
) candidates
where users.id = candidates.id
  and nullif(users.phone, '') is null
  and not exists (select 1 from auth.users taken where taken.phone = candidates.digits);

insert into public.breezy_schema_versions(version)
values ('2026-11-10-supabase-phone-auth')
on conflict (version) do nothing;

commit;

notify pgrst, 'reload schema';
