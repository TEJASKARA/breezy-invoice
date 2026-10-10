# CA-led client onboarding and readiness

## Release steps

1. Run `supabase/migrations/202610100002_ca_partner_invitations.sql` in Supabase. Requires the earlier CA portal, owner-plus-two seat, product usage and entity-transfer migrations.
2. Deploy the frontend and backend together. Backend `FRONTEND_URL` must be your public site URL, e.g. `https://chanax.in`, not localhost. Existing SMTP/Resend credentials send the invitations; no additional mail service is required.
3. Add `https://chanax.in/ca-invite` to Supabase Auth's allowed Redirect URLs, alongside the existing login and recovery URLs. Add the corresponding development URL only when testing locally.
4. Run the manual acceptance checks below using dedicated test accounts and a copied Tally company if applicable. Automated tests do not prove live email delivery.

## Invitation flow

The CA portal now contains an invitation form and a client-readiness dashboard. A CA can invite using email, international phone number, or both. Email sends a plain invitation using the configured ChanaX sender. A failed email returns an accurate warning and a usable private link, not a false "sent" success.

Phone invitations are private bearer links for the CA to share manually with WhatsApp. They do not send through the existing invoice template, verify ownership of the phone number, or grant access automatically. If strict recipient binding is required, supply an email too; email invitations require the same verified account email. Keep private links with the intended company owner only.

Opening a link shows the inviting firm. The recipient signs up/signs in and confirms their email. A session-only token preserves the invitation through sign-in, email signup and OAuth in the same browser. The token is in the link fragment, not a server URL query, and only its hash is stored in the database. Tokens expire after 14 days. If confirmation opens in another browser, reopen the original invitation there after signing in. Blocked browser storage also requires reopening the original link.

After signup, the owner chooses their active owned workspace and explicitly confirms page permissions. A new unconfigured business workspace can be connected before setup; it appears as onboarding incomplete until the setup and records are present. Approval uses one extra seat (owner plus two additional accounts), is idempotent, and is recorded in the company audit log. Neither signup nor merely opening the link grants access. No subscriptions or credits move to the CA.

Clients can skip the invitation and continue separately. CAs can cancel an unaccepted invitation. To replace a lost, expired or failed invitation, cancel the pending one if applicable and create a new one. Tokens cannot be retrieved later from the invitation history.

## Dashboard definitions

- **Invited:** unexpired pending invitation, not opened by an eligible verified signed-in recipient.
- **Registered:** eligible verified recipient opened the invitation. Still awaiting explicit owner approval; no financial data access.
- **Onboarding incomplete:** connected client's shared company details/billing address, first active entity, or first workflow record in the CA's accessible pages is missing.
- **Ready:** company details, active entity and at least one generated invoice, quotation, payslip or recorded expense are visible in authorised pages. No mandatory payroll for a business without employees.
- **Inactive:** access is disabled/removed, workspace is unavailable, or an otherwise ready client has no recorded client activity for 30 days. This is an activity/access indicator, not a statement that the subscription is unpaid.
- **Limited page access:** current permissions do not permit a complete readiness assessment. Hidden payroll/financial records are not queried or disclosed.

Counts represent pending invitations and distinct connected workspaces, not duplicate invitation history. Expired/cancelled invitations remain in history but do not inflate pending totals. "Ready" is operational readiness in shared pages, not compliance certification, subscription activation or a guarantee of data accuracy. Activity uses existing product usage events from non-CA users; missing telemetry is displayed as "Not recorded yet". CA portal visits do not make clients active.

CAs may disconnect their own client relationship with confirmation. Client records, subscriptions and credits are preserved; access is disabled and the action is audited. Reconnection requires new owner approval. The owner can also revoke access using existing team controls. Removed memberships linked through accepted invitations retain only a minimal inactive history entry.

## QA before live invitations

1. New client email invite: email arrives, link opens, signup confirms, invite survives sign-in, no access until approval, selected permissions apply.
2. Existing client invite: only matching verified email and workspace owner may approve. Another email, team member, different workspace, and CA self-approval fail.
3. Google sign-in and confirmation in another browser: return to the invitation; test redirect allowlist and reopening original link.
4. Phone-only invite: plus/spaces normalize; WhatsApp opens a manual share. Approve an owned workspace through the bearer link. No automatic document-template message is sent.
5. Expiry/cancellation: link cannot grant access. Duplicate pending invitation does not send another email. CA cannot cancel another CA's invite.
6. Seats: owner + existing employee + CA succeeds; owner + two extras + another CA fails; no duplicate seat on retry.
7. Readiness: empty setup → missing details/entity/workflow; complete setup + entity + generated document/expense → ready; payroll-only and limited permissions do not reveal hidden invoice records.
8. Inactivity: client activity older than 30 days → inactive when otherwise ready; CA views alone do not change it. Disabled/suspended clients cannot be opened.
9. Disconnect/remove: access stops, inactive summary remains without record details, operational records and credits stay intact, audit entry is present.
10. Privacy: CA A never sees CA B's invitations or clients. Anonymous users can only preview a valid private link, not query invitation tables or dashboards.

Automated backend, frontend-token, and isolated PostgreSQL tests are included in CI. No production invitations are sent by the test suite.
