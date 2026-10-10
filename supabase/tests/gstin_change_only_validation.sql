-- Disposable test database only. Run after entity_transfers_fixture and regressions.
\set ON_ERROR_STOP on
insert into auth.users values
 ('50000000-0000-0000-0000-000000000001','gst-legacy-a@example.com'),
 ('50000000-0000-0000-0000-000000000002','gst-legacy-b@example.com'),
 ('50000000-0000-0000-0000-000000000003','gst-new@example.com');
insert into breezy_workspaces(id,owner_user_id,name,subscription_code) values
 ('50000000-0000-0000-0000-000000000011','50000000-0000-0000-0000-000000000001','Legacy A','GST-LEGACY-A'),
 ('50000000-0000-0000-0000-000000000012','50000000-0000-0000-0000-000000000002','Legacy B','GST-LEGACY-B'),
 ('50000000-0000-0000-0000-000000000013','50000000-0000-0000-0000-000000000003','New registration','GST-NEW');
-- Mimic duplicates created before GST enforcement, not a production workaround.
alter table breezy_workspace_settings disable trigger breezy_workspace_settings_unique_gstin;
insert into breezy_workspace_settings(user_id,workspace_id,setup) values
 ('50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000011','{"gstin":"LEGACYGST","attendanceDrafts":{"50000000-0000-0000-0000-000000000021:2026-10":{"entityId":"50000000-0000-0000-0000-000000000021"}}}'),
 ('50000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000012','{"gstin":"LEGACYGST"}');
alter table breezy_workspace_settings enable trigger breezy_workspace_settings_unique_gstin;
insert into breezy_entities(id,user_id,workspace_id,payload) values
 ('50000000-0000-0000-0000-000000000021','50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000011','{"companyName":"Delete legacy entity"}');
set role authenticated;
set request.user_id='50000000-0000-0000-0000-000000000001';
-- Confirm the reported deletion fails before applying the fix.
select test_fails($q$select breezy_delete_entity('50000000-0000-0000-0000-000000000011','50000000-0000-0000-0000-000000000021','Delete legacy entity')$q$, 'GST number is already registered');
select test_assert(exists(select 1 from breezy_entities where id='50000000-0000-0000-0000-000000000021'), 'Failed deletion rolled back');
reset role;
\ir ../migrations/202610100003_gstin_change_only_validation.sql
set role authenticated;
select breezy_delete_entity('50000000-0000-0000-0000-000000000011','50000000-0000-0000-0000-000000000021','Delete legacy entity');
select test_assert(not exists(select 1 from breezy_entities where id='50000000-0000-0000-0000-000000000021'), 'Deletion works with unchanged legacy GST');
select test_assert((select setup->>'gstin'='LEGACYGST' and setup->'attendanceDrafts'='{}'::jsonb from breezy_workspace_settings where workspace_id='50000000-0000-0000-0000-000000000011'), 'Cleanup preserves registration and removes attendance');
-- Other setup edits and formatting-equivalent GST changes must work too.
update breezy_workspace_settings set setup=setup||'{"firmName":"Renamed firm","gstin":" legacygst "}' where workspace_id='50000000-0000-0000-0000-000000000011';
update breezy_workspace_settings set setup=setup||'{"gstin":"AVAILABLEGST"}' where workspace_id='50000000-0000-0000-0000-000000000011';
select test_fails($q$update breezy_workspace_settings set setup=setup||'{"gstin":"LEGACYGST"}' where workspace_id='50000000-0000-0000-0000-000000000011'$q$, 'GST number is already registered');
reset role;
select test_fails($q$insert into breezy_workspace_settings(user_id,workspace_id,setup) values('50000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000013','{"gstin":"LEGACYGST"}')$q$, 'GST number is already registered');
select test_fails($q$insert into breezy_entities(id,user_id,workspace_id,payload) values('50000000-0000-0000-0000-000000000022','50000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000013','{"gstin":"LEGACYGST"}')$q$, 'GST number is already registered');
-- Legacy entity edits work, but changing their GST/ownership still validates.
alter table breezy_entities disable trigger breezy_z_entities_unique_gstin;
insert into breezy_entities(id,user_id,workspace_id,payload) values
 ('50000000-0000-0000-0000-000000000023','50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000011','{"gstin":"LEGACYGST","companyName":"Legacy entity"}');
alter table breezy_entities enable trigger breezy_z_entities_unique_gstin;
update breezy_entities set payload=payload||'{"hsnCodes":["998314"]}' where id='50000000-0000-0000-0000-000000000023';
select test_assert((select payload->'hsnCodes'='["998314"]'::jsonb from breezy_entities where id='50000000-0000-0000-0000-000000000023'), 'HSN edits do not revalidate unchanged GST');
select test_fails($q$update breezy_entities set workspace_id='50000000-0000-0000-0000-000000000013' where id='50000000-0000-0000-0000-000000000023'$q$, 'GST number is already registered');
update breezy_entities set transferred_at=now() where id='50000000-0000-0000-0000-000000000023';
select test_fails($q$update breezy_entities set transferred_at=null where id='50000000-0000-0000-0000-000000000023'$q$, 'GST number is already registered');
select test_fails($q$update breezy_workspace_settings set workspace_id='50000000-0000-0000-0000-000000000013' where workspace_id='50000000-0000-0000-0000-000000000012'$q$, 'GST number is already registered');
\echo PASS: reproduced deletion error, cleanup fixed, unchanged GST edits allowed, new/changed/moved/reactivated registrations protected
