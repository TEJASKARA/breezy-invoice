-- Phone verification for sign-up. ChanaX's API generates a 6-digit code, stores
-- only its hash here, and sends the code through the n8n WhatsApp webhook.
-- A phone counts as verified only when profiles.phone_verified_at is set, which
-- only the API (service role) can do. Changing the phone clears verification.
-- Run after 202611020003_marketing_leads.sql. Safe to re-run.
begin;

alter table public.profiles add column if not exists phone_verified_at timestamptz;

create table if not exists public.breezy_phone_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null check (phone ~ '^[1-9][0-9]{9,14}$'),
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  verified_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists breezy_phone_verifications_user_idx
  on public.breezy_phone_verifications (user_id, created_at desc);
create index if not exists breezy_phone_verifications_phone_idx
  on public.breezy_phone_verifications (phone, created_at desc);
alter table public.breezy_phone_verifications enable row level security;
revoke all on public.breezy_phone_verifications from anon, authenticated;
grant select, insert, update, delete on public.breezy_phone_verifications to service_role;

-- Users may edit their own profile, but never mark their phone as verified.
create or replace function public.breezy_guard_phone_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.phone_verified_at is distinct from old.phone_verified_at then
    new.phone_verified_at := old.phone_verified_at;
  end if;
  if new.phone is distinct from old.phone
     and new.phone_verified_at is not distinct from old.phone_verified_at then
    new.phone_verified_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists breezy_guard_phone_verification on public.profiles;
create trigger breezy_guard_phone_verification
before update on public.profiles
for each row execute function public.breezy_guard_phone_verification();

-- API: store a new code. Enforces resend cooldown and hourly limits.
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
  where user_id = target_user_id and verified_at is null and superseded_at is null;

  insert into public.breezy_phone_verifications (user_id, phone, code_hash, expires_at)
  values (target_user_id, target_phone, target_code_hash,
          now() + make_interval(secs => greatest(60, least(coalesce(ttl_seconds, 600), 1800))))
  returning id into new_id;
  return jsonb_build_object('id', new_id);
end;
$$;

-- API: check a code. Wrong codes count towards 5 attempts; success marks the
-- profile phone as verified and keeps the auth metadata phone in sync.
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
  where user_id = target_user_id and phone = target_phone
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

revoke all on function public.breezy_phone_otp_create(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.breezy_phone_otp_verify(uuid, text, text) from public, anon, authenticated;
grant execute on function public.breezy_phone_otp_create(uuid, text, text, integer) to service_role;
grant execute on function public.breezy_phone_otp_verify(uuid, text, text) to service_role;

insert into public.breezy_schema_versions(version)
values ('2026-11-05-phone-verification')
on conflict (version) do nothing;

commit;

notify pgrst, 'reload schema';
