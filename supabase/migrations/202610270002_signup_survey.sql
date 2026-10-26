-- Store a single, immutable post-signup survey response for product analytics.

begin;

-- Only accounts created after this migration are asked the survey. This makes the
-- prompt a genuine post-signup step and avoids interrupting existing customers.
create table if not exists public.chanax_signup_survey_eligible_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.chanax_signup_survey_eligible_users enable row level security;

drop policy if exists "Users can view their signup survey eligibility" on public.chanax_signup_survey_eligible_users;
create policy "Users can view their signup survey eligibility"
  on public.chanax_signup_survey_eligible_users for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.chanax_mark_signup_survey_eligible()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.chanax_signup_survey_eligible_users (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists chanax_mark_signup_survey_eligible on auth.users;
create trigger chanax_mark_signup_survey_eligible
  after insert on auth.users
  for each row execute function public.chanax_mark_signup_survey_eligible();

create table if not exists public.chanax_signup_survey_responses (
  user_id uuid primary key references auth.users(id) on delete cascade,
  discovery_source text not null check (discovery_source in (
    'google_search', 'social_media', 'friend_or_colleague', 'accountant_or_ca', 'advertisement', 'other'
  )),
  phone text check (phone is null or phone ~ '^\+?[1-9][0-9]{7,14}$'),
  intended_uses text[] not null check (
    cardinality(intended_uses) > 0
    and intended_uses <@ array[
      'invoices_and_quotations', 'payroll_and_payslips', 'expenses_and_attendance',
      'multiple_business_entities', 'everything'
    ]::text[]
  ),
  business_type text not null check (business_type in (
    'freelancer_or_consultant', 'small_business', 'company', 'accountant_or_ca_firm', 'other'
  )),
  team_size text check (team_size is null or team_size in (
    'just_me', '2_5', '6_20', '21_50', 'more_than_50'
  )),
  submitted_at timestamptz not null default now()
);

alter table public.chanax_signup_survey_responses enable row level security;

drop policy if exists "Users can view their signup survey response" on public.chanax_signup_survey_responses;
create policy "Users can view their signup survey response"
  on public.chanax_signup_survey_responses for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.chanax_submit_signup_survey(
  p_discovery_source text,
  p_phone text,
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
  normalised_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[[:space:]()-]', '', 'g'), '');
begin
  if actor_id is null then
    raise exception 'You must be signed in to submit this survey.';
  end if;

  if p_discovery_source not in ('google_search', 'social_media', 'friend_or_colleague', 'accountant_or_ca', 'advertisement', 'other')
    or p_business_type not in ('freelancer_or_consultant', 'small_business', 'company', 'accountant_or_ca_firm', 'other')
    or cardinality(p_intended_uses) is null
    or cardinality(p_intended_uses) = 0
    or not (p_intended_uses <@ array['invoices_and_quotations', 'payroll_and_payslips', 'expenses_and_attendance', 'multiple_business_entities', 'everything']::text[])
    or (p_team_size is not null and p_team_size not in ('just_me', '2_5', '6_20', '21_50', 'more_than_50'))
    or (normalised_phone is not null and normalised_phone !~ '^\+?[1-9][0-9]{7,14}$') then
    raise exception 'The survey response contains an invalid value.';
  end if;

  insert into public.chanax_signup_survey_responses (
    user_id, discovery_source, phone, intended_uses, business_type, team_size
  ) values (
    actor_id, p_discovery_source, normalised_phone, p_intended_uses, p_business_type, p_team_size
  ) on conflict (user_id) do nothing;

  return true;
end;
$$;

revoke all on function public.chanax_submit_signup_survey(text, text, text[], text, text) from public;
grant execute on function public.chanax_submit_signup_survey(text, text, text[], text, text) to authenticated;

insert into public.breezy_schema_versions(version)
values ('2026-10-27-signup-survey')
on conflict (version) do nothing;

commit;
