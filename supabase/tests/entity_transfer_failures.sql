\set ON_ERROR_STOP on
-- Additional approval, expiry and full-transaction rollback scenarios.
insert into auth.users values('00000000-0000-0000-0000-000000000106','second-source@example.com');
insert into profiles values('00000000-0000-0000-0000-000000000106','founder');
insert into breezy_workspaces(id,owner_user_id,name,subscription_code)
 values('00000000-0000-0000-0000-000000000206','00000000-0000-0000-0000-000000000106','Second source','SECOND');
insert into breezy_credit_accounts(workspace_id,free_credits_granted,free_quotation_credits_granted)
 values('00000000-0000-0000-0000-000000000206',100,100);
insert into breezy_entities(id,user_id,workspace_id,payload) values
 ('00000000-0000-0000-0000-000000000306','00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000206','{"companyName":"Rollback","gstin":"ROLLBACK"}'),
 ('00000000-0000-0000-0000-000000000307','00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000206','{"companyName":"Other"}');
insert into breezy_invoices(id,user_id,workspace_id,payload) values
 ('00000000-0000-0000-0000-000000000706','00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000206','{"number":"R1","entityName":"Rollback"}');
insert into breezy_expenses(id,user_id,workspace_id,entity_id,payload) values
 ('00000000-0000-0000-0000-000000000916','00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000206','00000000-0000-0000-0000-000000000306','{}');

set role authenticated;
set request.user_id='00000000-0000-0000-0000-000000000106';
-- Normal entity creation is still allowed, but forging transfer metadata is not.
select test_fails($q$insert into breezy_entities(id,user_id,workspace_id,payload,transferred_at) values(gen_random_uuid(),'00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000206','{}',now())$q$,'Transfer metadata');
insert into breezy_customers(id,user_id,workspace_id,entity_id,payload)
 values(gen_random_uuid(),'00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000206','00000000-0000-0000-0000-000000000307','{}');
select test_fails($q$select breezy_request_entity_transfer('00000000-0000-0000-0000-000000000206','00000000-0000-0000-0000-000000000306','TARGET',true)$q$,'no active companies');
select breezy_request_entity_transfer('00000000-0000-0000-0000-000000000206','00000000-0000-0000-0000-000000000307','BLANK',false) as cancel_request \gset
select breezy_cancel_entity_transfer(:'cancel_request');
select test_assert((select status='cancelled' from breezy_entity_transfers where id=:'cancel_request'),'source cancellation');
select breezy_request_entity_transfer('00000000-0000-0000-0000-000000000206','00000000-0000-0000-0000-000000000307','BLANK',false) as reject_request \gset
set request.user_id='00000000-0000-0000-0000-000000000105';
select breezy_review_entity_transfer(:'reject_request',false);
select test_assert((select status='rejected' from breezy_entity_transfers where id=:'reject_request'),'destination rejection');
select test_fails(format('select breezy_cancel_entity_transfer(%L)', :'reject_request'),'Only the source owner');
set request.user_id='00000000-0000-0000-0000-000000000106';
select breezy_request_entity_transfer('00000000-0000-0000-0000-000000000206','00000000-0000-0000-0000-000000000307','BLANK',false) as expired_request \gset
reset role;
update breezy_entity_transfers set expires_at=now()-interval '1 second' where id=:'expired_request';
set role authenticated;
set request.user_id='00000000-0000-0000-0000-000000000105';
select test_fails(format('select breezy_review_entity_transfer(%L,true)', :'expired_request'),'expired');
set request.user_id='00000000-0000-0000-0000-000000000106';
select breezy_request_entity_transfer('00000000-0000-0000-0000-000000000206','00000000-0000-0000-0000-000000000307','BLANK',false) as renewed_request \gset
select test_assert((select status='expired' from breezy_entity_transfers where id=:'expired_request'),'expired request replaced safely');
select breezy_cancel_entity_transfer(:'renewed_request');
select breezy_request_entity_transfer('00000000-0000-0000-0000-000000000206','00000000-0000-0000-0000-000000000306','BLANK',true) as rollback_request \gset
select test_fails($q$select breezy_request_entity_transfer('00000000-0000-0000-0000-000000000206','00000000-0000-0000-0000-000000000306','BLANK',true)$q$,'duplicate key');
-- Destination becoming occupied after the request is also checked on approval.
set request.user_id='00000000-0000-0000-0000-000000000105';
insert into breezy_entities(id,user_id,workspace_id,payload) values
 ('00000000-0000-0000-0000-000000000308','00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-000000000205','{"companyName":"Occupant"}');
select test_fails(format('select breezy_review_entity_transfer(%L,true)', :'rollback_request'),'no active companies');
delete from breezy_entities where id='00000000-0000-0000-0000-000000000308';
reset role;
create function public.test_fail_transfer_expense() returns trigger language plpgsql as $$
begin if new.workspace_id='00000000-0000-0000-0000-000000000205' then raise exception 'forced rollback'; end if; return new; end $$;
create trigger test_fail_transfer_expense before update on breezy_expenses for each row execute function test_fail_transfer_expense();
set role authenticated;
set request.user_id='00000000-0000-0000-0000-000000000105';
select test_fails(format('select breezy_review_entity_transfer(%L,true)', :'rollback_request'),'forced rollback');
select test_assert((select count(*)=0 from breezy_entities),'late failure rolls back destination company');
select test_assert((select status='pending' from breezy_entity_transfers where id=:'rollback_request'),'late failure leaves request pending');
reset role;
select test_assert((select transferred_at is null from breezy_entities where id='00000000-0000-0000-0000-000000000306'),'late failure rolls back source archive');
select test_assert((select workspace_id='00000000-0000-0000-0000-000000000206' from breezy_invoices where id='00000000-0000-0000-0000-000000000706'),'late failure rolls back invoice ownership');
select test_assert((select count(*)=0 from breezy_transferred_documents where workspace_id='00000000-0000-0000-0000-000000000205'),'late failure rolls back credit provenance');
drop trigger test_fail_transfer_expense on breezy_expenses;
set role authenticated;
set request.user_id='00000000-0000-0000-0000-000000000106';
update breezy_entities set payload=payload || '{"companyName":"Changed"}' where id='00000000-0000-0000-0000-000000000306';
set request.user_id='00000000-0000-0000-0000-000000000105';
select test_fails(format('select breezy_review_entity_transfer(%L,true)', :'rollback_request'),'changed after this request');
reset role;
update breezy_entities set payload='{"companyName":"Rollback","gstin":"ROLLBACK"}' where id='00000000-0000-0000-0000-000000000306';
set role authenticated;
set request.user_id='00000000-0000-0000-0000-000000000105';
select breezy_review_entity_transfer(:'rollback_request',true) as rollback_received \gset
select test_assert((select count(*)=1 from breezy_invoices),'retry after rollback succeeds once');
reset role;
\echo 'PASS: rejection, cancellation, expiration, occupied destination, duplicate request, snapshot changes and rollback'

-- Archived quotations cannot be converted into another company's invoice, and
-- ambiguous pre-migration invoice names cannot be silently attributed.
insert into auth.users values
 ('00000000-0000-0000-0000-000000000107','another-fresh@example.com'),
 ('00000000-0000-0000-0000-000000000108','ambiguity-target@example.com');
insert into profiles select id,'founder' from auth.users where id in
 ('00000000-0000-0000-0000-000000000107','00000000-0000-0000-0000-000000000108');
insert into breezy_workspaces(id,owner_user_id,name,subscription_code) values
 ('00000000-0000-0000-0000-000000000207','00000000-0000-0000-0000-000000000107','Another fresh','ANOTHER'),
 ('00000000-0000-0000-0000-000000000208','00000000-0000-0000-0000-000000000108','Ambiguity target','AMBIGUITY');
select id as other_customer from breezy_customers where entity_id='00000000-0000-0000-0000-000000000307' \gset
insert into breezy_proformas(id,user_id,workspace_id,entity_id,customer_id,payload) values
 ('00000000-0000-0000-0000-000000000607','00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000206','00000000-0000-0000-0000-000000000307',:'other_customer','{"number":"Other Q1"}');
insert into breezy_entities(id,user_id,workspace_id,payload) values
 ('00000000-0000-0000-0000-000000000309','00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000206','{"companyName":"Ambiguous"}'),
 ('00000000-0000-0000-0000-000000000310','00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000206','{"companyName":"Ambiguous"}');
insert into breezy_invoices(id,user_id,workspace_id,payload) values
 ('00000000-0000-0000-0000-000000000709','00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000206','{"number":"Legacy1","entityName":"Ambiguous"}');
set role authenticated;
set request.user_id='00000000-0000-0000-0000-000000000106';
select breezy_request_entity_transfer('00000000-0000-0000-0000-000000000206','00000000-0000-0000-0000-000000000307','ANOTHER',false) as other_fresh \gset
set request.user_id='00000000-0000-0000-0000-000000000107';
select breezy_review_entity_transfer(:'other_fresh',true);
set request.user_id='00000000-0000-0000-0000-000000000106';
select test_fails($q$insert into breezy_invoices(id,user_id,workspace_id,entity_id,payload) values(gen_random_uuid(),'00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000206','00000000-0000-0000-0000-000000000309','{"entityName":"Ambiguous","sourceProformaId":"00000000-0000-0000-0000-000000000607"}')$q$,'source quotation must belong');
select breezy_request_entity_transfer('00000000-0000-0000-0000-000000000206','00000000-0000-0000-0000-000000000309','AMBIGUITY',true) as ambiguous_request \gset
set request.user_id='00000000-0000-0000-0000-000000000108';
select test_fails(format('select breezy_review_entity_transfer(%L,true)', :'ambiguous_request'),'ambiguous company name');
select test_assert((select count(*)=0 from breezy_entities),'ambiguous legacy invoices prevent the transfer');
reset role;
\echo 'PASS: archived conversion blocked and ambiguous legacy invoice attribution rejected'
