-- Disposable fixture database only.
create table if not exists public.breezy_workspace_members(
 workspace_id uuid, user_id uuid, status text
);
\ir ../migrations/202610100001_product_error_logs.sql
insert into auth.users(id,email) values
 ('30000000-0000-0000-0000-000000000001','owner@example.com'),
 ('30000000-0000-0000-0000-000000000002','ca@example.com'),
 ('30000000-0000-0000-0000-000000000003','stranger@example.com');
insert into public.breezy_workspaces(id,owner_user_id,subscription_code) values
 ('30000000-0000-0000-0000-000000000010','30000000-0000-0000-0000-000000000001','CHX-TEST');
insert into public.breezy_workspace_members values
 ('30000000-0000-0000-0000-000000000010','30000000-0000-0000-0000-000000000002','active');
set role authenticated;
set request.user_id='30000000-0000-0000-0000-000000000002';
select public.chanax_report_unexpected_error('30000000-0000-0000-0000-000000000010','Try again','Missing function','PGRST202','/entities?secret=hidden');
select public.chanax_report_unexpected_error('30000000-0000-0000-0000-000000000010','Try again','Missing function','PGRST202','/entities?secret=hidden');
select public.test_fails('select * from public.chanax_error_logs','permission denied');
select public.test_fails($q$insert into public.chanax_error_logs(customer_message,diagnostic,fingerprint) values('x','x','x')$q$,'permission denied');
set request.user_id='30000000-0000-0000-0000-000000000003';
select public.test_assert(public.chanax_report_unexpected_error('30000000-0000-0000-0000-000000000010','x','x','500','/entities') is null, 'Reject inaccessible workspace');
set request.user_id='';
select public.test_assert(public.chanax_report_unexpected_error(null,'x','x','500','/setup') is null, 'Reject unauthenticated report');
reset role;
select public.test_assert((select count(*)=1 from public.chanax_error_logs), 'Group repeated errors');
select public.test_assert((select actor_email='ca@example.com' and owner_email='owner@example.com'
 and subscription_code='CHX-TEST' and occurrence_count=2 and page_path='/entities'
 from public.chanax_error_logs limit 1), 'Trusted identity and private route');
set role authenticated;
set request.user_id='30000000-0000-0000-0000-000000000002';
select public.chanax_report_unexpected_error(null,'Try again','Setup failure','500','/setup');
reset role;
select public.test_assert((select count(*)=1 from public.chanax_error_logs where workspace_id is null and subscription_code is null), 'Onboarding has no fabricated subscription');
