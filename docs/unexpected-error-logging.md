# Unexpected error reports

Run `supabase/migrations/202610100001_product_error_logs.sql` in Supabase before deploying the frontend.

Table: `public.chanax_error_logs`. Actor email identifies the person experiencing the problem; owner email and subscription code identify the company. They are derived by the authenticated database function, not accepted from browser input. Reports without an active workspace (e.g. onboarding) have no subscription code. Owners and active members, including CAs, may report errors for accessible workspaces only.

Customers cannot read or directly insert/update logs. Use server-side service-role credentials in n8n, never in the frontend. Diagnostic text is untrusted troubleshooting information, not proof of the root cause. Customer-facing messages remain friendly.

Reporting covers unexpected failures passing through the common error formatter, API server failures explicitly tagged with status, and recognized unhandled runtime failures. Duplicate records, missing/invalid inputs, permissions, expired sessions and business-rule exceptions are excluded. Offline devices are excluded. Unknown plain-text messages are conservatively excluded rather than risking alerts for normal validation.

Reports are best-effort and non-blocking. Logging cannot be guaranteed while Supabase/network access is unavailable. No full request payloads, attachments or stacks are captured. URLs, emails embedded in diagnostics, bearer tokens and common secret assignments are redacted; structured account email fields are intentionally retained. Access to the table and tester emails must be restricted. Establish a retention period before production use; no automatic deletion is enabled.

Browser duplicates within one minute are suppressed; database duplicates within five minutes update `occurrence_count` and `last_seen_at` rather than inserting. At most 20 new incidents per actor per five minutes are accepted. Resolving an incident allows a new occurrence to create a new row.

## Your n8n email workflow (not configured by this change)

1. Publish an n8n Webhook trigger using its HTTPS production URL and header authentication.
2. In Supabase Database Webhooks, select `chanax_error_logs`, **INSERT only**, and that URL. Configure the matching secret header.
3. Read fields from the webhook's `body.record`, e.g. `actor_email`, `owner_email`, `subscription_code`, `customer_message`, `diagnostic`, `page_path`, `created_at` and `id`.
4. Send the tester email with Gmail. Deduplicate by row `id` before sending, since retries must not send duplicate alerts. The Supabase node can fetch/update rows but is not a new-row trigger.
5. Optionally update `status` with the Supabase node. Do not select UPDATE events in the database webhook, or status/count changes will create repeated emails.

Test with one unexpected failure, an invalid input, a duplicate report, a CA workspace, and another user's inaccessible workspace. No email automation or notification endpoint is installed here.
