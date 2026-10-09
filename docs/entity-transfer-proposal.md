# Move a managed entity to a separate subscription account

## Customer choices

The source workspace owner chooses a company and the destination owner's email
or subscription code. The destination account must already exist.

1. **Move company and all history**
   Transfer the company, customers, invoices, quotations, employees, attendance,
   payslips, employee letters, expenses and bill attachments. Preserve document
   numbers, invoice sequences, correction links, templates and record IDs.
2. **Start fresh in the new account**
   Transfer company details, templates and invoice numbering only. Keep existing
   records accessible as read-only history in the original workspace. Hide the
   old entity from new-document creation. No records are deleted.

Both options must explicitly state that subscription payments, credit balances,
team members and permissions stay with their respective accounts. Receiving
history must not consume credits or grant extra free credits.

## Ownership and approval

- Only the source workspace owner may request a transfer.
- The destination workspace owner must accept before any company data moves.
- The receiving workspace must be a separately registered company account with
  no existing active entities. Incoming requests must also appear during setup,
  so an owner need not register the same GSTIN before accepting the transfer.
- Pending requests expire after seven days and can be cancelled or rejected.
- Final confirmation displays the company, destination, chosen history option
  and the effect on access, subscriptions and credits.
- The source workspace's own registered company cannot be moved through this
  additional-entity transfer flow; that requires a separate subscription-owner
  transfer policy.

## Database and lifecycle requirements

- One atomic transaction performs acceptance and data changes. A failure must
  leave both workspaces unchanged. Acceptance must be idempotent.
- GSTIN registration must transfer without allowing a second active registration.
  Historical source records retain GSTIN for invoice rendering but cannot register
  it again or issue new documents.
- Related references must all remain within the correct destination workspace.
  Legacy invoices identified only by company name need ambiguity checks.
- Destination permissions replace source permissions. Source members must not
  retain access to moved records or bill attachments.
- Preserve attachment access when data moves, and ensure deleting the source
  account later cannot delete files owned by the receiving company.
- Prevent existing moved documents from being charged again when saved, even if
  the original account and credit ledger are later deleted.
- Respect normal account deletion for both accounts; transfer history must not
  accidentally prevent deletion or reactivate an archived company.
- Record transfer choices and approvals in both workspace audit logs.

## Required verification before release

Exercise owner and non-owner requests, destination approval and rejection,
expired requests, repeat acceptance and rollback on a failed transfer. Exercise
both history options with every document type, invoice number continuity,
quotation conversions, correction links, attendance, templates and attachments.
Verify GST uniqueness, permission isolation and unchanged credit balances.
Verify editing a moved document does not charge again, and deleting either
account does not damage the other account's records or files.

## Status

Implemented locally after explicit approval of these cross-account rules.
Not applied to production, committed or deployed by this task.

## Release order

1. Back up the production database and check for ambiguous legacy company names.
2. Deploy the backend file-purge protection **before accepting any transfers**.
   The old purger deletes the original owner's entire upload folder, including
   files subsequently transferred to another account.
3. Run `supabase/migrations/202610090001_entity_account_transfers.sql` in the
   Supabase SQL editor (after the existing GST and quotation-conversion migrations).
   Apply the whole migration in one execution. Do not paste any test fixture.
4. Deploy the frontend. It now reads archive and invoice-company metadata.
5. Test with two controlled company accounts before customer rollout.

With automatic Git deployments, publish the backend-only changes first, apply
the migration, then publish the frontend changes. Do not deploy the new frontend
before the migration, because it reads the new database columns.

## Customer flow

- Register the separate receiving account first. Choose company owner rather
  than CA-only access. Its workspace must contain no active companies.
- In the original account, the owner opens Entities and chooses **Move to
  separate account**, enters the receiving owner's email or subscription code,
  and chooses all history or start fresh.
- Review the confirmation and send the request. Nothing moves yet.
- The receiving owner sees **Company transfer requests** during setup or on
  Entities, reviews the history choice and explicitly confirms acceptance.
- Reload source workspace data after approval. The original company becomes
  read-only; the destination keeps its own subscription, credits and permissions.
- Complete the receiving company's setup and buy its own plan if needed.
- If company details or invoice numbering change after requesting, cancel and
  issue a new request so the receiving owner approves current company details.

## Verification

`supabase/tests/entity_transfers_fixture.sql` is for a disposable database only.
It recreates the relevant Supabase schemas and owner-scoped policies. Follow it
with `entity_transfers.sql` and `entity_transfer_failures.sql`; the GitHub
company-transfer workflow runs the same tests with PostgreSQL 16.

Local tests cover both modes, owner isolation, primary-company blocking,
metadata protection, duplicate/occupied destinations, repeat acceptance,
rejection, cancellation, expiry, forced late rollback, GST uniqueness,
templates, attendance, all record types, document links, source/destination
deletion, credit preservation and saving imported documents after source purge.
They also reject ambiguous legacy invoice names and conversions from archived
quotations into another active company's invoices.
Backend tests also cover nested transferred bills, paginated lookup and safely
aborting deletion if the protected-file lookup fails.

Production authentication, real storage RLS and browser interaction still need
the controlled-account smoke test after deployment; the disposable fixture does
not reproduce every live Supabase policy or trigger.
