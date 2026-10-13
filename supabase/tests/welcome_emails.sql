-- Standalone disposable database only; never run this fixture in production.
\set ON_ERROR_STOP on
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz,
  deleted_at timestamptz, raw_user_meta_data jsonb default '{}');
create table public.profiles(id uuid primary key references auth.users(id), full_name text, account_type text);
create function public.test_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
insert into auth.users(id,email,email_confirmed_at) values
 ('70000000-0000-0000-0000-000000000001','old@example.com',now());
\ir ../migrations/202610140001_welcome_emails.sql
select test_assert(chanax_claim_welcome_email('70000000-0000-0000-0000-000000000001') is null,'Existing user is excluded');
insert into auth.users(id,email,email_confirmed_at) values
 ('70000000-0000-0000-0000-000000000002','new@example.com',now()),
 ('70000000-0000-0000-0000-000000000003','unverified@example.com',null);
insert into profiles(id,full_name,account_type) values
 ('70000000-0000-0000-0000-000000000002','New CA','ca');
select test_assert(chanax_claim_welcome_email('70000000-0000-0000-0000-000000000003') is null,'Unverified users never claim');
select test_assert(chanax_claim_welcome_email('70000000-0000-0000-0000-000000000002')->>'email'='new@example.com','Verified address comes from auth');
select test_assert((select account_type='ca' and recipient_name='New CA' from chanax_welcome_emails where user_id='70000000-0000-0000-0000-000000000002'),'Profile snapshot is stored');
select test_assert(chanax_claim_welcome_email('70000000-0000-0000-0000-000000000002') is null,'Concurrent requests cannot claim a sending email');
select test_assert(not chanax_finish_welcome_email('70000000-0000-0000-0000-000000000002',gen_random_uuid(),true),'Wrong lease cannot finish');
select test_assert(chanax_finish_welcome_email(user_id,lease_token,false),'Failed delivery releases lease') from chanax_welcome_emails where user_id='70000000-0000-0000-0000-000000000002';
select test_assert(chanax_claim_welcome_email('70000000-0000-0000-0000-000000000002') is null,'Retry cooldown applies');
update chanax_welcome_emails set next_attempt_at=now()-interval '1 minute' where user_id='70000000-0000-0000-0000-000000000002';
update profiles set full_name='Changed name',account_type='founder' where id='70000000-0000-0000-0000-000000000002';
select test_assert(chanax_claim_welcome_email('70000000-0000-0000-0000-000000000002')->>'name'='New CA','Retry keeps the identical provider payload');
select test_assert(chanax_finish_welcome_email(user_id,lease_token,true),'Accepted delivery is recorded') from chanax_welcome_emails where user_id='70000000-0000-0000-0000-000000000002';
select test_assert((select welcome_email_sent_at is not null from chanax_welcome_emails where user_id='70000000-0000-0000-0000-000000000002'),'Sent timestamp is stored');
select test_assert(chanax_claim_welcome_email('70000000-0000-0000-0000-000000000002') is null,'Repeat login never resends');
insert into auth.users(id,email,email_confirmed_at) values ('70000000-0000-0000-0000-000000000004','ambiguous@example.com',now());
select chanax_claim_welcome_email('70000000-0000-0000-0000-000000000004');
update chanax_welcome_emails set lease_expires_at=now()-interval '1 minute',first_attempt_at=now()-interval '24 hours' where user_id='70000000-0000-0000-0000-000000000004';
select test_assert(chanax_claim_welcome_email('70000000-0000-0000-0000-000000000004') is null,'Expired provider idempotency cannot resend');
select test_assert(not has_function_privilege('authenticated','chanax_claim_welcome_email(uuid)','execute'),'Browser cannot claim');
select test_assert(not has_function_privilege('authenticated','chanax_finish_welcome_email(uuid,uuid,boolean)','execute'),'Browser cannot forge sent timestamps');
select test_assert(not has_table_privilege('authenticated','chanax_welcome_emails','select'),'Email delivery records are private');
select test_assert(has_function_privilege('service_role','chanax_claim_welcome_email(uuid)','execute'),'Service backend can claim');
