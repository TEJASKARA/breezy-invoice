-- Disposable database only, after the transfer/deletion regression fixtures.
\set ON_ERROR_STOP on
set role authenticated;
set request.user_id = '10000000-0000-0000-0000-000000000111';
insert into public.breezy_invoices(id,user_id,workspace_id,entity_id,payload) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000111','10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000312',
 '{"gstTaxMode":"split","cgstAmount":9,"sgstAmount":9,"lineItems":[{"cgstAmount":9,"sgstAmount":9},{}]}'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000111','10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000312',
 '{"gstTaxMode":"igst","igstAmount":23,"lineItems":[{"igstAmount":18},{"igstAmount":5}]}'),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000111','10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000312', '{}');
select test_fails($q$update breezy_invoices set payload='{"lineItems":[{"cgstAmount":9,"sgstAmount":9},{"igstAmount":18}]}' where id='20000000-0000-0000-0000-000000000001'$q$, 'entire invoice');
select test_fails($q$update breezy_invoices set payload='{"cgstAmount":9,"igstAmount":18}' where id='20000000-0000-0000-0000-000000000001'$q$, 'entire invoice');
select test_fails($q$update breezy_invoices set payload='{"gstTaxMode":"split","lineItems":[{"igstAmount":18}]}' where id='20000000-0000-0000-0000-000000000001'$q$, 'entire invoice');
select test_fails($q$update breezy_invoices set payload='{"igstAmount":18,"lineItems":[{"cgstAmount":9}]}' where id='20000000-0000-0000-0000-000000000002'$q$, 'entire invoice');
select test_fails($q$update breezy_invoices set payload='{"gstTaxMode":"igst","sgstAmount":9}' where id='20000000-0000-0000-0000-000000000002'$q$, 'entire invoice');
select test_fails($q$update breezy_invoices set payload='{"igstAmount":-1}' where id='20000000-0000-0000-0000-000000000002'$q$, 'non-negative');
select test_fails($q$update breezy_invoices set payload='{"igstAmount":"NaN"}' where id='20000000-0000-0000-0000-000000000002'$q$, 'non-negative');
select test_fails($q$update breezy_invoices set payload='{"igstAmount":"bad"}' where id='20000000-0000-0000-0000-000000000002'$q$, 'non-negative');
select test_fails($q$update breezy_invoices set payload='{"lineItems":{}}' where id='20000000-0000-0000-0000-000000000002'$q$, 'line items could not be read');
select test_fails($q$insert into breezy_invoices(id,user_id,workspace_id,entity_id,payload) values
 ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000111','10000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000312',
 '{"lineItems":[{"cgstAmount":9},{"igstAmount":18}]}')$q$, 'entire invoice');
select test_assert((select payload ->> 'gstTaxMode' = 'split' from breezy_invoices where id='20000000-0000-0000-0000-000000000001'), 'Rejected writes preserve original document');
reset role;
select test_assert(not exists(select 1 from breezy_credit_transactions where document_id='20000000-0000-0000-0000-000000000004'), 'Rejected invoice consumes no credit');
\echo PASS: invoice-wide tax mode, mixed lines, aggregate conflicts, zero tax, updates and credit rollback
