-- Disposable database only, after entity_transfers_fixture.sql.
\set ON_ERROR_STOP on
begin;
insert into auth.users values ('70000000-0000-0000-0000-000000000001','replacement-test@example.com');
insert into breezy_workspaces(id,owner_user_id,name,subscription_code) values
 ('70000000-0000-0000-0000-000000000011','70000000-0000-0000-0000-000000000001','Replacement test','REPLACEMENT-TEST');
insert into breezy_credit_accounts(workspace_id,free_credits_granted) values ('70000000-0000-0000-0000-000000000011',100);
insert into breezy_entities(id,user_id,workspace_id,payload) values
 ('70000000-0000-0000-0000-000000000021','70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000011','{"companyName":"Issuer A"}'),
 ('70000000-0000-0000-0000-000000000022','70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000011','{"companyName":"Issuer B"}');
set role authenticated;
set request.user_id='70000000-0000-0000-0000-000000000001';
insert into breezy_invoices(id,user_id,workspace_id,entity_id,payload) values
 ('70000000-0000-0000-0000-000000000031','70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000011','70000000-0000-0000-0000-000000000021','{"number":"INV-47","status":"Generated","entityName":"Issuer A"}');
-- Original-first reproduces the reported failure even though both companies match.
select test_fails($q$insert into breezy_invoices(id,user_id,workspace_id,entity_id,payload) values
 ('70000000-0000-0000-0000-000000000031','70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000011','70000000-0000-0000-0000-000000000021','{"number":"INV-47","status":"Cancelled","correction":{"replacementInvoiceId":"70000000-0000-0000-0000-000000000032"}}'),
 ('70000000-0000-0000-0000-000000000032','70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000011','70000000-0000-0000-0000-000000000021','{"number":"INV-101","status":"Generated","correctsInvoiceId":"70000000-0000-0000-0000-000000000031"}')
 on conflict(id) do update set payload=excluded.payload,entity_id=excluded.entity_id$q$, 'same active company');
select test_assert((select payload->>'status'='Generated' from breezy_invoices where id='70000000-0000-0000-0000-000000000031'), 'Failed save does not cancel original');
-- Replacement-first uses the same single INSERT/upsert transaction as PostgREST.
insert into breezy_invoices(id,user_id,workspace_id,entity_id,payload) values
 ('70000000-0000-0000-0000-000000000032','70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000011','70000000-0000-0000-0000-000000000021','{"number":"INV-101","status":"Generated","correctsInvoiceId":"70000000-0000-0000-0000-000000000031"}'),
 ('70000000-0000-0000-0000-000000000031','70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000011','70000000-0000-0000-0000-000000000021','{"number":"INV-47","status":"Cancelled","correction":{"replacementInvoiceId":"70000000-0000-0000-0000-000000000032"}}')
 on conflict(id) do update set payload=excluded.payload,entity_id=excluded.entity_id;
select test_assert((select payload->>'number'='INV-47' and payload->>'status'='Cancelled' and payload#>>'{correction,replacementInvoiceId}'='70000000-0000-0000-0000-000000000032' from breezy_invoices where id='70000000-0000-0000-0000-000000000031'), 'Original number preserved and replacement linked');
select test_assert((select payload->>'correctsInvoiceId'='70000000-0000-0000-0000-000000000031' from breezy_invoices where id='70000000-0000-0000-0000-000000000032'), 'Replacement links back to original');
reset role;
select test_assert((select free_credits_used=2 from breezy_credit_accounts where workspace_id='70000000-0000-0000-0000-000000000011'), 'Only replacement consumes a new credit');
set role authenticated;
-- A genuine different-company replacement remains forbidden.
select test_fails($q$insert into breezy_invoices(id,user_id,workspace_id,entity_id,payload) values
 ('70000000-0000-0000-0000-000000000033','70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000011','70000000-0000-0000-0000-000000000022','{"status":"Generated","correctsInvoiceId":"70000000-0000-0000-0000-000000000031"}')$q$, 'same active company');
-- If the second row fails, the replacement insert and its credit are rolled back.
select test_fails($q$insert into breezy_invoices(id,user_id,workspace_id,entity_id,payload) values
 ('70000000-0000-0000-0000-000000000034','70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000011','70000000-0000-0000-0000-000000000021','{"status":"Generated","correctsInvoiceId":"70000000-0000-0000-0000-000000000031"}'),
 ('70000000-0000-0000-0000-000000000031','70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000011','70000000-0000-0000-0000-000000000021','{"status":"Cancelled","correction":{"replacementInvoiceId":"70000000-0000-0000-0000-000000000099"}}')
 on conflict(id) do update set payload=excluded.payload,entity_id=excluded.entity_id$q$, 'same active company');
select test_assert(not exists(select 1 from breezy_invoices where id in ('70000000-0000-0000-0000-000000000033','70000000-0000-0000-0000-000000000034')), 'Rejected replacements leave no partial document');
select test_assert((select payload#>>'{correction,replacementInvoiceId}'='70000000-0000-0000-0000-000000000032' from breezy_invoices where id='70000000-0000-0000-0000-000000000031'), 'Failed second row leaves original audit link unchanged');
reset role;
select test_assert((select free_credits_used=2 from breezy_credit_accounts where workspace_id='70000000-0000-0000-0000-000000000011'), 'Failed writes consume no credits');
rollback;
\echo PASS: original-first failure reproduced; replacement-first works atomically; audit links, company boundary and credit rollback protected
