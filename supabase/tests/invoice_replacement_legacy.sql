-- Disposable database only, after entity_transfers_fixture.sql.
-- Correcting an invoice saved before invoices were linked to a company (entity_id is null).
\set ON_ERROR_STOP on
\ir ../migrations/202610100004_legacy_invoice_corrections.sql
begin;
insert into auth.users values ('71000000-0000-0000-0000-000000000001','legacy-replacement@example.com');
insert into breezy_workspaces(id,owner_user_id,name,subscription_code) values
 ('71000000-0000-0000-0000-000000000011','71000000-0000-0000-0000-000000000001','Legacy replacement','LEGACY-REPLACEMENT');
insert into breezy_credit_accounts(workspace_id,free_credits_granted) values ('71000000-0000-0000-0000-000000000011',100);
insert into breezy_entities(id,user_id,workspace_id,payload) values
 ('71000000-0000-0000-0000-000000000021','71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000011','{"companyName":"Axigear Autoventure LLP"}'),
 ('71000000-0000-0000-0000-000000000022','71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000011','{"companyName":"Other Co"}');
insert into breezy_customers(id,user_id,workspace_id,entity_id,payload) values
 ('71000000-0000-0000-0000-000000000041','71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000011','71000000-0000-0000-0000-000000000021','{"companyName":"Customer"}');
-- Legacy rows, written as the table owner so no company link is added.
insert into breezy_invoices(id,user_id,workspace_id,entity_id,customer_id,payload) values
 ('71000000-0000-0000-0000-000000000031','71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000011',null,null,'{"number":"INV-1","status":"Generated","entityName":" axigear autoventure llp "}'),
 ('71000000-0000-0000-0000-000000000035','71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000011',null,'71000000-0000-0000-0000-000000000041','{"number":"INV-5","status":"Generated","entityName":"Renamed long ago"}');
select test_assert((select count(*)=2 from breezy_invoices where workspace_id='71000000-0000-0000-0000-000000000011' and entity_id is null), 'Legacy invoices start without a company link');
set role authenticated;
set request.user_id='71000000-0000-0000-0000-000000000001';
-- Matched by issuing-company name (case and spaces ignored).
insert into breezy_invoices(id,user_id,workspace_id,entity_id,payload) values
 ('71000000-0000-0000-0000-000000000032','71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000011','71000000-0000-0000-0000-000000000021','{"number":"INV-2","status":"Generated","correctsInvoiceId":"71000000-0000-0000-0000-000000000031"}'),
 ('71000000-0000-0000-0000-000000000031','71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000011','71000000-0000-0000-0000-000000000021','{"number":"INV-1","status":"Cancelled","correction":{"replacementInvoiceId":"71000000-0000-0000-0000-000000000032"}}')
 on conflict(id) do update set payload=excluded.payload,entity_id=excluded.entity_id;
select test_assert((select entity_id='71000000-0000-0000-0000-000000000021' and payload->>'status'='Cancelled' from breezy_invoices where id='71000000-0000-0000-0000-000000000031'), 'Legacy original is linked and cancelled');
-- Matched through its customer even though the stored company name no longer matches.
insert into breezy_invoices(id,user_id,workspace_id,entity_id,payload) values
 ('71000000-0000-0000-0000-000000000036','71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000011','71000000-0000-0000-0000-000000000021','{"number":"INV-6","status":"Generated","correctsInvoiceId":"71000000-0000-0000-0000-000000000035"}'),
 ('71000000-0000-0000-0000-000000000035','71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000011','71000000-0000-0000-0000-000000000021','{"number":"INV-5","status":"Cancelled","correction":{"replacementInvoiceId":"71000000-0000-0000-0000-000000000036"}}')
 on conflict(id) do update set payload=excluded.payload,entity_id=excluded.entity_id;
select test_assert((select payload->>'status'='Cancelled' from breezy_invoices where id='71000000-0000-0000-0000-000000000035'), 'Legacy original resolved through its customer');
-- A legacy invoice still cannot be "corrected" into a different company.
reset role;
insert into breezy_invoices(id,user_id,workspace_id,entity_id,customer_id,payload) values
 ('71000000-0000-0000-0000-000000000037','71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000011',null,null,'{"number":"INV-7","status":"Generated","entityName":"Axigear Autoventure LLP"}');
set role authenticated;
select test_fails($q$insert into breezy_invoices(id,user_id,workspace_id,entity_id,payload) values
 ('71000000-0000-0000-0000-000000000038','71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000011','71000000-0000-0000-0000-000000000022','{"status":"Generated","correctsInvoiceId":"71000000-0000-0000-0000-000000000037"}')$q$, 'same active company');
reset role;
rollback;
\echo PASS: legacy invoices without a company link can be corrected within their own company only
