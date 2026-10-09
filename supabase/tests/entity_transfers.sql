-- Run after entity_transfers_fixture.sql in a disposable database.
\set ON_ERROR_STOP on
insert into auth.users values
 ('00000000-0000-0000-0000-000000000101','source@example.com'),
 ('00000000-0000-0000-0000-000000000102','target@example.com'),
 ('00000000-0000-0000-0000-000000000103','stranger@example.com'),
 ('00000000-0000-0000-0000-000000000104','fresh@example.com'),
 ('00000000-0000-0000-0000-000000000105','blank@example.com');
insert into profiles select id,'founder' from auth.users;
insert into breezy_workspaces(id,owner_user_id,name,subscription_code) values
 ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101','Source','SOURCE'),
 ('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000102','Target','TARGET'),
 ('00000000-0000-0000-0000-000000000204','00000000-0000-0000-0000-000000000104','Fresh','FRESH'),
 ('00000000-0000-0000-0000-000000000205','00000000-0000-0000-0000-000000000105','Blank','BLANK');
insert into breezy_credit_accounts(workspace_id,free_credits_granted,free_quotation_credits_granted)
 select id,100,100 from breezy_workspaces;
insert into breezy_workspace_settings(user_id,workspace_id,setup,template) values
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201',
 '{"gstin":"PRIMARY","attendanceDrafts":{"00000000-0000-0000-0000-000000000301:2026-10":{"entityId":"00000000-0000-0000-0000-000000000301","month":"2026-10","employeeRecords":{"00000000-0000-0000-0000-000000000501":{"days":0.5}}}}}',
 '{"pageColor":"#ffeeaa","entityTemplates":{"00000000-0000-0000-0000-000000000301":{"pageColor":"#aabbcc"}}}');
insert into breezy_entities(id,user_id,workspace_id,payload) values
 ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201',
 '{"companyName":"Movable","gstin":"MOVABLE","invoiceNumbering":{"nextNumber":101,"prefix":"CHX/"}}'),
 ('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201','{"companyName":"Primary","gstin":"PRIMARY"}'),
 ('00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201','{"companyName":"Fresh company","gstin":"FRESHGST"}');
insert into breezy_customers values('00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000301','{"companyName":"Buyer"}');
insert into breezy_employees values('00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000301','{"employeeName":"Person"}');
insert into breezy_proformas(id,user_id,workspace_id,entity_id,customer_id,payload) values
 ('00000000-0000-0000-0000-000000000601','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000401','{"number":"Q47"}');
insert into breezy_invoices(id,user_id,workspace_id,customer_id,payload) values
 ('00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000401',
 '{"number":"CHX/47","entityName":"Movable","sourceProformaId":"00000000-0000-0000-0000-000000000601","correction":{"replacementInvoiceId":"00000000-0000-0000-0000-000000000702"}}'),
 ('00000000-0000-0000-0000-000000000702','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000401',
 '{"number":"CHX/101","entityName":"Movable","correctsInvoiceId":"00000000-0000-0000-0000-000000000701"}'),
 ('00000000-0000-0000-0000-000000000703','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201',null,'{"number":"F1","entityName":"Fresh company"}');
insert into breezy_payslips values('00000000-0000-0000-0000-000000000801','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000501','{"month":"2026-10"}');
insert into breezy_employee_letters values('00000000-0000-0000-0000-000000000901','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000501','{"letterType":"offer"}');
insert into breezy_expenses values('00000000-0000-0000-0000-000000000911','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000301','{"billPath":"00000000-0000-0000-0000-000000000101/old/bill.pdf"}');

set role authenticated;
set request.user_id = '00000000-0000-0000-0000-000000000103';
select test_fails($q$select breezy_request_entity_transfer('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000301','TARGET',true)$q$,'Only the active workspace owner');
set request.user_id = '00000000-0000-0000-0000-000000000101';
select test_fails($q$select breezy_request_entity_transfer('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000302','TARGET',true)$q$,'primary registered company');
select breezy_request_entity_transfer('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000301','target@example.com',true) as move_request \gset
select test_fails(format('select breezy_review_entity_transfer(%L,true)', :'move_request'),'Only the receiving account owner');
select test_assert((select count(*) = 1 from breezy_entity_transfers),'source can read its request');
set request.user_id = '00000000-0000-0000-0000-000000000103';
select test_assert((select count(*) = 0 from breezy_entity_transfers),'unrelated owner cannot see request');
select test_fails(format('select breezy_review_entity_transfer(%L,true)', :'move_request'),'Only the receiving account owner');
set request.user_id = '00000000-0000-0000-0000-000000000102';
select breezy_review_entity_transfer(:'move_request',true) as received_entity \gset
select test_assert(breezy_review_entity_transfer(:'move_request',true) = :'received_entity'::uuid,'repeated acceptance idempotent');
select test_assert((select count(*) = 2 from breezy_invoices),'invoices visible only in destination');
select test_assert((select payload ->> 'number' = 'CHX/47' from breezy_invoices where id='00000000-0000-0000-0000-000000000701'),'invoice number retained');
select test_assert((select converted_invoice_id = '00000000-0000-0000-0000-000000000701' from breezy_proformas),'conversion FK retained');
select test_assert((select payload #>> '{invoiceNumbering,nextNumber}' = '101' from breezy_entities),'number sequence retained');
select test_assert((select template #>> array['entityTemplates', :'received_entity','pageColor'] = '#aabbcc' from breezy_workspace_settings),'entity template retained');
select test_assert((select transferred_attendance #>> array[:'received_entity' || ':2026-10','entityId'] = :'received_entity' from breezy_workspace_settings),'attendance remapped');
update breezy_workspace_settings set setup = '{"gstin":"MOVABLE"}';
select test_assert((select setup #>> array['attendanceDrafts', :'received_entity' || ':2026-10','employeeRecords','00000000-0000-0000-0000-000000000501','days'] = '0.5' from breezy_workspace_settings),'attendance survives onboarding');
select test_assert((select count(*) = 1 from breezy_customers),'customers transferred');
select test_assert((select count(*) = 1 from breezy_employees),'employees transferred');
select test_assert((select count(*) = 1 from breezy_payslips),'payslips transferred');
select test_assert((select count(*) = 1 from breezy_employee_letters),'letters transferred');
select test_assert((select payload ->> 'billPath' = '00000000-0000-0000-0000-000000000101/old/bill.pdf' from breezy_expenses),'attachment reference preserved');
select test_fails($q$select * from breezy_transferred_documents$q$,'permission denied');

set request.user_id = '00000000-0000-0000-0000-000000000101';
select test_assert((select count(*) = 1 from breezy_invoices),'source cannot access moved invoices');
select test_assert((select transferred_at is not null from breezy_entities where id='00000000-0000-0000-0000-000000000301'),'source archived');
update breezy_workspace_settings set template=jsonb_set(template, '{entityTemplates,00000000-0000-0000-0000-000000000301}', '{"pageColor":"#000000"}');
select test_assert((select template #>> '{entityTemplates,00000000-0000-0000-0000-000000000301,pageColor}' = '#aabbcc' from breezy_workspace_settings),'historical templates cannot be overwritten by default edits or normalization');
select test_fails($q$update breezy_entities set transferred_at = null where id='00000000-0000-0000-0000-000000000301'$q$,'read-only');
select test_fails($q$insert into breezy_customers values(gen_random_uuid(),'00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000301','{}')$q$,'active company');
select test_fails($q$insert into breezy_entities(id,user_id,workspace_id,payload) values(gen_random_uuid(),'00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201','{"companyName":"Duplicate","gstin":"MOVABLE"}')$q$,'already registered');

-- Start fresh leaves the old invoice read-only and doesn't clone subscriptions.
select breezy_request_entity_transfer('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000303','FRESH',false) as fresh_request \gset
set request.user_id = '00000000-0000-0000-0000-000000000104';
select breezy_review_entity_transfer(:'fresh_request',true) as fresh_entity \gset
select test_assert((select count(*) = 0 from breezy_invoices),'fresh destination receives no historical invoices');
set request.user_id = '00000000-0000-0000-0000-000000000101';
select test_assert((select count(*) = 1 from breezy_invoices),'fresh source keeps history');
select test_fails($q$update breezy_invoices set payload='{"number":"changed"}' where id='00000000-0000-0000-0000-000000000703'$q$,'read-only');
select test_fails($q$delete from breezy_invoices where id='00000000-0000-0000-0000-000000000703'$q$,'read-only');

reset role;
select test_assert((select free_credits_used = 0 and free_quotation_credits_used = 0 from breezy_credit_accounts where workspace_id='00000000-0000-0000-0000-000000000202'),'receiving history has no credit charge');
select test_assert((select free_credits_used = 4 and free_quotation_credits_used = 1 from breezy_credit_accounts where workspace_id='00000000-0000-0000-0000-000000000201'),'source credits unchanged by transfer');
select test_assert((select count(*) = 8 from breezy_workspace_audit_log),'both accounts audited');
-- Delete the fresh receiving account: the old archive must never become active.
delete from auth.users where id='00000000-0000-0000-0000-000000000104';
select test_assert((select transferred_at is not null and transferred_to_workspace_id is null from breezy_entities where id='00000000-0000-0000-0000-000000000303'),'destination deletion does not unarchive source');
-- Delete the original owner, including the original debit ledger.
delete from auth.users where id='00000000-0000-0000-0000-000000000101';
select test_assert((select count(*) = 2 from breezy_invoices),'source account deletion preserves moved invoices');
select test_assert((select count(*) = 1 from breezy_expenses),'source deletion preserves moved bill reference');
set role authenticated;
set request.user_id='00000000-0000-0000-0000-000000000102';
insert into breezy_invoices(id,user_id,workspace_id,customer_id,payload)
 select id,user_id,workspace_id,customer_id,payload from breezy_invoices where id='00000000-0000-0000-0000-000000000701'
 on conflict(id) do update set payload=excluded.payload;
reset role;
select test_assert((select free_credits_used = 0 from breezy_credit_accounts where workspace_id='00000000-0000-0000-0000-000000000202'),'imported invoice upsert never charged after source purge');
\echo 'PASS: all-history, fresh, owner isolation, GST, templates, attendance, links, credits and deletion lifecycle'
