-- Disposable fixtures only; run after the transfer regressions.
\set ON_ERROR_STOP on
insert into auth.users values ('10000000-0000-0000-0000-000000000111','delete@example.com');
insert into auth.users values ('10000000-0000-0000-0000-000000000112','delete-target@example.com');
insert into profiles values ('10000000-0000-0000-0000-000000000111','founder');
insert into profiles values ('10000000-0000-0000-0000-000000000112','founder');
insert into breezy_workspaces(id,owner_user_id,name,subscription_code) values ('10000000-0000-0000-0000-000000000212','10000000-0000-0000-0000-000000000112','Delete target','DELETE-TARGET');
insert into breezy_workspaces(id,owner_user_id,name,subscription_code) values ('10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000111','Delete tests','DELETE');
insert into breezy_credit_accounts(workspace_id,free_credits_granted,free_quotation_credits_granted) values ('10000000-0000-0000-0000-000000000211',100,100);
insert into breezy_entities(id,user_id,workspace_id,payload) values
 ('10000000-0000-0000-0000-000000000311','10000000-0000-0000-0000-000000000111','10000000-0000-0000-0000-000000000211','{"companyName":"Delete me","gstin":"DELETEGST"}'),
 ('10000000-0000-0000-0000-000000000312','10000000-0000-0000-0000-000000000111','10000000-0000-0000-0000-000000000211','{"companyName":"Keep me"}');
insert into breezy_workspace_settings(user_id,workspace_id,setup,template) values
 ('10000000-0000-0000-0000-000000000111','10000000-0000-0000-0000-000000000211','{"attendanceDrafts":{"10000000-0000-0000-0000-000000000311:2026-10":{"entityId":"10000000-0000-0000-0000-000000000311"},"10000000-0000-0000-0000-000000000312:2026-10":{"entityId":"10000000-0000-0000-0000-000000000312"}}}',
 '{"entityTemplates":{"10000000-0000-0000-0000-000000000311":{"pageColor":"red"},"10000000-0000-0000-0000-000000000312":{"pageColor":"blue"}}}');
insert into breezy_customers(id,user_id,workspace_id,entity_id,payload) values ('10000000-0000-0000-0000-000000000411','10000000-0000-0000-0000-000000000111','10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000311','{}');
insert into breezy_employees(id,user_id,workspace_id,entity_id,payload) values ('10000000-0000-0000-0000-000000000511','10000000-0000-0000-0000-000000000111','10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000311','{}');
insert into breezy_proformas(id,user_id,workspace_id,entity_id,customer_id,payload) values ('10000000-0000-0000-0000-000000000611','10000000-0000-0000-0000-000000000111','10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000311','10000000-0000-0000-0000-000000000411','{"number":"Q1"}');
insert into breezy_proformas(id,user_id,workspace_id,payload) values ('10000000-0000-0000-0000-000000000613','10000000-0000-0000-0000-000000000111','10000000-0000-0000-0000-000000000211','{"number":"Legacy Q","entityName":"Delete me"}');
insert into breezy_invoices(id,user_id,workspace_id,entity_id,customer_id,payload) values
 ('10000000-0000-0000-0000-000000000711','10000000-0000-0000-0000-000000000111','10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000311','10000000-0000-0000-0000-000000000411','{"number":"I1","entityName":"Delete me","sourceProformaId":"10000000-0000-0000-0000-000000000611"}'),
 ('10000000-0000-0000-0000-000000000712','10000000-0000-0000-0000-000000000111','10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000312',null,'{"number":"KEEP","entityName":"Keep me"}');
insert into breezy_payslips(id,user_id,workspace_id,entity_id,employee_id,payload) values ('10000000-0000-0000-0000-000000000811','10000000-0000-0000-0000-000000000111','10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000311','10000000-0000-0000-0000-000000000511','{}');
insert into breezy_employee_letters(id,user_id,workspace_id,entity_id,employee_id,payload) values ('10000000-0000-0000-0000-000000000911','10000000-0000-0000-0000-000000000111','10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000311','10000000-0000-0000-0000-000000000511','{}');
insert into breezy_expenses(id,user_id,workspace_id,entity_id,payload) values
 ('10000000-0000-0000-0000-000000000921','10000000-0000-0000-0000-000000000111','10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000311','{"billPath":"owner/delete.pdf"}'),
 ('10000000-0000-0000-0000-000000000922','10000000-0000-0000-0000-000000000111','10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000312','{"billPath":"owner/keep.pdf"}');
set role authenticated;
set request.user_id = '00000000-0000-0000-0000-000000000103';
select test_fails($q$select breezy_delete_entity('10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000311','Delete me')$q$, 'Only the active workspace owner');
set request.user_id = '10000000-0000-0000-0000-000000000111';
select test_fails($q$select breezy_delete_entity('10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000311',null)$q$, 'Type the company name');
select test_fails($q$select breezy_delete_entity('10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000311','wrong')$q$, 'Type the company name');
reset role;
create function public.test_deletion_failure() returns trigger language plpgsql as $$ begin raise exception 'forced delete failure'; end $$;
create trigger test_deletion_failure before delete on breezy_expenses for each row execute function test_deletion_failure();
set role authenticated;
select test_fails($q$select breezy_delete_entity('10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000311','Delete me')$q$, 'forced delete failure');
reset role;
select test_assert(exists(select 1 from breezy_invoices where id='10000000-0000-0000-0000-000000000711'), 'Failed deletion restores invoices');
select test_assert(not exists(select 1 from breezy_entity_file_cleanup), 'Failed deletion rolls back cleanup queue');
drop trigger test_deletion_failure on breezy_expenses;
-- Seed an inconsistent legacy link and confirm the operation refuses collateral deletion.
update breezy_invoices set customer_id='10000000-0000-0000-0000-000000000411' where id='10000000-0000-0000-0000-000000000712';
set role authenticated;
select test_fails($q$select breezy_delete_entity('10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000311','Delete me')$q$, 'Other company records depend');
reset role;
update breezy_invoices set customer_id=null where id='10000000-0000-0000-0000-000000000712';
set role authenticated;
select breezy_request_entity_transfer('10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000311','DELETE-TARGET',true) as pending_delete_transfer \gset
select test_fails($q$select breezy_delete_entity('10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000311','Delete me')$q$, 'Cancel the pending');
select breezy_cancel_entity_transfer(:'pending_delete_transfer');
select breezy_delete_entity('10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000311','Delete me') as deleted \gset
select test_assert(:'deleted'::jsonb -> 'invoice_ids' = '["10000000-0000-0000-0000-000000000711"]', 'Return exact deleted invoice IDs');
select test_fails($q$select breezy_delete_entity('10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000311','Delete me')$q$, 'Company not found');
reset role;
select test_assert(not exists(select 1 from breezy_entities where id='10000000-0000-0000-0000-000000000311'), 'Entity deleted');
select test_assert(not exists(select 1 from breezy_invoices where id='10000000-0000-0000-0000-000000000711'), 'Invoice deleted despite restrictive FK');
select test_assert(not exists(select 1 from breezy_proformas where id='10000000-0000-0000-0000-000000000611'), 'Converted quotation deleted');
select test_assert(not exists(select 1 from breezy_proformas where id='10000000-0000-0000-0000-000000000613'), 'Legacy name-linked quotation deleted');
select test_assert(not exists(select 1 from breezy_customers where entity_id='10000000-0000-0000-0000-000000000311'), 'Customers deleted');
select test_assert(not exists(select 1 from breezy_employees where entity_id='10000000-0000-0000-0000-000000000311'), 'Employees deleted');
select test_assert(not exists(select 1 from breezy_employee_letters where entity_id='10000000-0000-0000-0000-000000000311'), 'Letters deleted');
select test_assert(not exists(select 1 from breezy_payslips where entity_id='10000000-0000-0000-0000-000000000311'), 'Payslips deleted');
select test_assert(not exists(select 1 from breezy_expenses where entity_id='10000000-0000-0000-0000-000000000311'), 'Expenses deleted');
select test_assert(exists(select 1 from breezy_invoices where id='10000000-0000-0000-0000-000000000712'), 'Other invoice preserved');
select test_assert(exists(select 1 from breezy_expenses where id='10000000-0000-0000-0000-000000000922'), 'Other expense preserved');
select test_assert(exists(select 1 from breezy_entity_file_cleanup where bill_path='owner/delete.pdf'), 'Exact attachment queued');
select test_assert(not exists(select 1 from breezy_entity_file_cleanup where bill_path='owner/keep.pdf'), 'Other attachment not queued');
select test_assert(exists(select 1 from breezy_credit_transactions where document_id='10000000-0000-0000-0000-000000000711'), 'Used credits not refunded');
select test_assert(exists(select 1 from breezy_workspaces where id='10000000-0000-0000-0000-000000000211'), 'Account preserved');
select test_assert(exists(select 1 from breezy_workspace_audit_log where resource_id='10000000-0000-0000-0000-000000000311' and action='entity_permanently_deleted'), 'Audit retained');
select test_assert((select not (setup -> 'attendanceDrafts' ? '10000000-0000-0000-0000-000000000311:2026-10') and setup -> 'attendanceDrafts' ? '10000000-0000-0000-0000-000000000312:2026-10'
 and not (template -> 'entityTemplates' ? '10000000-0000-0000-0000-000000000311') and template -> 'entityTemplates' ? '10000000-0000-0000-0000-000000000312'
 from breezy_workspace_settings where workspace_id='10000000-0000-0000-0000-000000000211'), 'Only entity attendance and template removed');
\echo PASS: confirmed deletion, authorization, rollback, dependencies, cleanup, unrelated records and credits
