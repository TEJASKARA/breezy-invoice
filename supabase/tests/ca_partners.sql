\set ON_ERROR_STOP on
insert into auth.users values
 ('40000000-0000-0000-0000-000000000001','ca@example.com',now()),
 ('40000000-0000-0000-0000-000000000002','otherca@example.com',now()),
 ('40000000-0000-0000-0000-000000000003','owner@example.com',now()),
 ('40000000-0000-0000-0000-000000000004','stranger@example.com',now()),
 ('40000000-0000-0000-0000-000000000005','unconfirmed@example.com',null),
 ('40000000-0000-0000-0000-000000000006','staff@example.com',now());
insert into profiles(id,email,account_type,ca_firm_name) select id,email,
 case when email like '%ca@%' or email='ca@example.com' then 'ca' else 'unselected' end,
 case when email like '%ca@%' or email='ca@example.com' then 'Test CA' end from auth.users;
insert into breezy_workspaces(id,owner_user_id,name) values
 ('40000000-0000-0000-0000-000000000010','40000000-0000-0000-0000-000000000003','Client company'),
 ('40000000-0000-0000-0000-000000000011','40000000-0000-0000-0000-000000000004','Other company');
insert into breezy_subscriptions(workspace_id) select id from breezy_workspaces;
insert into breezy_workspace_members(workspace_id,user_id,role) select id,owner_user_id,'owner' from breezy_workspaces;
set role authenticated;
set request.user_id='40000000-0000-0000-0000-000000000003';
select test_fails($q$select chanax_create_ca_client_invitation('Client','owner@example.com',null)$q$,'Only CA');
set request.user_id='40000000-0000-0000-0000-000000000001';
select test_fails($q$select chanax_create_ca_client_invitation('Client',null,null)$q$,'email or');
select test_fails($q$select chanax_create_ca_client_invitation('Client','bad email',null)$q$,'valid client email');
select test_fails($q$select chanax_create_ca_client_invitation('Client',null,'abcd')$q$,'country code');
select chanax_create_ca_client_invitation('Client','OWNER@example.com',null) as invitation \gset
select (:'invitation'::jsonb->>'token') as token, (:'invitation'::jsonb->>'id') as invite_id \gset
select test_assert(jsonb_array_length(chanax_ca_partner_dashboard()->'clients')=0,'No premature client access');
select test_fails($q$select * from chanax_ca_client_invitations$q$,'permission denied');
select test_fails($q$select chanax_create_ca_client_invitation('Client','owner@example.com',null)$q$,'pending invitation');
set request.user_id='40000000-0000-0000-0000-000000000002';
select test_assert(jsonb_array_length(chanax_ca_partner_dashboard()->'invitations')=0,'No other CA invitations');
select test_fails(format('select chanax_revoke_ca_client_invitation(%L)',:'invite_id'),'no longer pending');
set role anon;
select test_assert(chanax_preview_ca_client_invitation(:'token')->>'firm_name'='Test CA','Private link preview');
select test_assert(chanax_preview_ca_client_invitation('bad') is null,'Invalid token hidden');
select test_fails(format('select chanax_accept_ca_client_invitation(%L,%L,array[]::text[])',:'token','40000000-0000-0000-0000-000000000010'),'permission denied');
set role authenticated;
set request.user_id='40000000-0000-0000-0000-000000000004';
select test_fails(format('select chanax_accept_ca_client_invitation(%L,%L,array[]::text[])',:'token','40000000-0000-0000-0000-000000000011'),'client email');
set request.user_id='40000000-0000-0000-0000-000000000005';
select test_fails(format('select chanax_accept_ca_client_invitation(%L,%L,array[]::text[])',:'token','40000000-0000-0000-0000-000000000010'),'Confirm your email');
set request.user_id='40000000-0000-0000-0000-000000000003';
select chanax_register_ca_client_invitation(:'token');
select test_fails(format('select chanax_accept_ca_client_invitation(%L,%L,array[]::text[])',:'token','40000000-0000-0000-0000-000000000011'),'Only the company owner');
select test_fails(format('select chanax_accept_ca_client_invitation(%L,%L,array[''invalid.permission''])',:'token','40000000-0000-0000-0000-000000000010'),'valid page permissions');
set request.user_id='40000000-0000-0000-0000-000000000001';
select test_assert(chanax_ca_partner_dashboard()->'invitations'->0->>'status'='registered','Registered not yet approved');
set request.user_id='40000000-0000-0000-0000-000000000003';
select chanax_accept_ca_client_invitation(:'token','40000000-0000-0000-0000-000000000010',array['entities.read','invoices.read','expenses.read']);
select chanax_accept_ca_client_invitation(:'token','40000000-0000-0000-0000-000000000010',array['team.manage']);
reset role;
select test_assert((select count(*)=1 from breezy_workspace_members where user_id='40000000-0000-0000-0000-000000000001'),'Acceptance idempotent');
select test_assert((select not ('team.manage'=any(permissions)) from breezy_workspace_members where user_id='40000000-0000-0000-0000-000000000001'),'Replay cannot change permissions');
select test_assert((select account_type='founder' from profiles where email='owner@example.com'),'New client is business owner');
set role authenticated;
set request.user_id='40000000-0000-0000-0000-000000000001';
select test_assert(chanax_ca_partner_dashboard()->'clients'->0->>'status'='onboarding_incomplete','Missing setup shown');
reset role;
insert into breezy_workspace_settings values('40000000-0000-0000-0000-000000000010','{"firmName":"Client company","mailingAddress":"Test address"}');
insert into breezy_entities(workspace_id,payload) values('40000000-0000-0000-0000-000000000010','{"companyName":"Client company"}');
insert into breezy_invoices values('40000000-0000-0000-0000-000000000010','{"status":"Generated"}');
insert into breezy_usage_events(workspace_id,user_id) values('40000000-0000-0000-0000-000000000010','40000000-0000-0000-0000-000000000003');
set role authenticated;
set request.user_id='40000000-0000-0000-0000-000000000001';
select test_assert(chanax_ca_partner_dashboard()->'clients'->0->>'status'='ready','Useful workflow ready');
set request.user_id='40000000-0000-0000-0000-000000000002';
select test_assert(jsonb_array_length(chanax_ca_partner_dashboard()->'clients')=0,'No other CA clients');
reset role;
update breezy_usage_events set occurred_at=now()-interval '31 days';
update breezy_workspaces set created_at=now()-interval '40 days' where name='Client company';
insert into breezy_usage_events(workspace_id,user_id) values('40000000-0000-0000-0000-000000000010','40000000-0000-0000-0000-000000000001');
set role authenticated;
set request.user_id='40000000-0000-0000-0000-000000000001';
select test_assert(chanax_ca_partner_dashboard()->'clients'->0->>'status'='inactive','CA visits do not inflate activity');
select chanax_disconnect_ca_client('40000000-0000-0000-0000-000000000010');
select test_assert((chanax_ca_partner_dashboard()->'clients'->0->>'can_open')::boolean=false,'Disconnect revokes access');
reset role;
select test_assert((select count(*)=1 from breezy_invoices),'Disconnect preserves client records');
select test_assert((select count(*)>=2 from breezy_workspace_audit_log),'Approval and disconnect audited');
-- Owner + two extra users is allowed. A third extra user is not.
update breezy_workspace_members set status='active' where user_id='40000000-0000-0000-0000-000000000001';
insert into breezy_workspace_members(workspace_id,user_id,role,status) values
 ('40000000-0000-0000-0000-000000000010','40000000-0000-0000-0000-000000000006','viewer','active');
set role authenticated;
set request.user_id='40000000-0000-0000-0000-000000000002';
select chanax_create_ca_client_invitation('Client','owner@example.com',null) as second_invitation \gset
select (:'second_invitation'::jsonb->>'token') as second_token \gset
set request.user_id='40000000-0000-0000-0000-000000000003';
select test_fails(format('select chanax_accept_ca_client_invitation(%L,%L,array[''entities.read'',''invoices.read''])',:'second_token','40000000-0000-0000-0000-000000000010'),'Both included');
reset role;
update breezy_workspace_members set status='disabled' where user_id='40000000-0000-0000-0000-000000000001';
set role authenticated;
set request.user_id='40000000-0000-0000-0000-000000000003';
select chanax_accept_ca_client_invitation(:'second_token','40000000-0000-0000-0000-000000000010',array['entities.read','invoices.read']);
reset role;
select test_assert(public.breezy_additional_seats_reserved('40000000-0000-0000-0000-000000000010')=2,'Owner does not occupy an extra seat');
-- Permission-limited summaries must not inspect hidden workflow tables.
update breezy_workspace_members set permissions='{}' where user_id='40000000-0000-0000-0000-000000000002';
set role authenticated;
set request.user_id='40000000-0000-0000-0000-000000000002';
select test_assert(chanax_ca_partner_dashboard()->'clients'->0->>'status'='limited_visibility','Limited permissions not reported as missing private data');
select test_assert(chanax_ca_partner_dashboard()->'clients'->0->>'has_workflow' is null,'Hidden workflow not disclosed');
-- Expired and cancelled phone links can never grant access.
set request.user_id='40000000-0000-0000-0000-000000000001';
select chanax_create_ca_client_invitation('Phone client',null,'+91 98765 43210') as phone_invitation \gset
select (:'phone_invitation'::jsonb->>'token') as phone_token,( :'phone_invitation'::jsonb->>'id') as phone_invite_id \gset
select test_assert(:'phone_invitation'::jsonb->>'phone'='919876543210','International phone normalized');
reset role;
update chanax_ca_client_invitations set expires_at=now()-interval '1 second' where id=:'phone_invite_id';
set role anon;
select test_assert(chanax_preview_ca_client_invitation(:'phone_token') is null,'Expired link hidden');
set role authenticated;
set request.user_id='40000000-0000-0000-0000-000000000004';
select test_fails(format('select chanax_accept_ca_client_invitation(%L,%L,array[]::text[])',:'phone_token','40000000-0000-0000-0000-000000000011'),'expired or cancelled');
reset role;
update chanax_ca_client_invitations set expires_at=now()+interval '1 day' where id=:'phone_invite_id';
set role authenticated;
set request.user_id='40000000-0000-0000-0000-000000000001';
select chanax_revoke_ca_client_invitation(:'phone_invite_id');
set request.user_id='40000000-0000-0000-0000-000000000004';
select test_fails(format('select chanax_accept_ca_client_invitation(%L,%L,array[]::text[])',:'phone_token','40000000-0000-0000-0000-000000000011'),'expired or cancelled');
reset role;
-- Removing a membership entirely still leaves only a minimal inactive relationship.
delete from breezy_workspace_members where user_id='40000000-0000-0000-0000-000000000001';
set role authenticated;
set request.user_id='40000000-0000-0000-0000-000000000001';
select test_assert(chanax_ca_partner_dashboard()->'clients'->0->>'status'='inactive','Removed membership stays inactive in invitation history');
select test_assert(jsonb_array_length(chanax_ca_partner_dashboard()->'clients'->0->'missing')=0,'No private details after revocation');
reset role;
