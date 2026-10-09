# Confirmed entity deletion

Implemented locally; not pushed, deployed or run in the production database.

The workspace owner can choose Delete on an active entity, review the irreversible
warning, type the exact company name and choose Yes, permanently delete entity
and data. Other team members cannot perform the deletion. Moved source archives
remain read-only; this action never deletes the receiving account's data.

The database removes entity-linked invoices, quotations/proformas, customers,
employees, payslips, employee letters, expenses, attendance and template overrides
in one transaction. Ambiguous legacy invoice attribution or incoming cross-company
dependencies block deletion; pending transfers must be cancelled first.

The workspace, subscription, other entities, used-credit/payment records and a
minimal deletion audit remain. A GSTIN in account setup remains registered even
if the corresponding entity is deleted. Downloaded or sent documents are outside
this deletion's reach, and existing backups are not individually rewritten.

Expense attachment paths are queued transactionally for the existing maintenance
worker. It checks surviving expense references across all workspaces before
removing exact paths. Shared files stay; storage failures remain queued for retry.
The confirmation and success message disclose background attachment cleanup.
The current production worker runs daily, so physical attachment cleanup may
take until its next scheduled run. Database records disappear immediately.

## Release order

1. Apply `202610090001_entity_account_transfers.sql` if it has not been applied.
2. Apply `202610090002_entity_deletion.sql` in Supabase SQL Editor.
3. Deploy the backend changes, including the existing deletion-purger service.
4. Deploy the frontend changes.
5. Verify with disposable companies that cancellation leaves records untouched,
   deletion removes all linked records after reload, and another company's records
   remain intact. Confirm the maintenance worker drains the attachment queue.

Local checks cover migration installation, ownership, name confirmation, rollback,
cross-company dependencies, pending transfers, surviving records, used credits,
attendance/template cleanup and storage retry/shared-file preservation. The local
fixture does not reproduce every production RLS policy or trigger; a controlled
account smoke test is still required after deployment.
