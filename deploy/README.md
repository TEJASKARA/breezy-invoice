# ChanaX backend deployment

The production API runs in its own Docker Compose project and binds only to
`127.0.0.1:8010`, so it does not expose the container directly or interfere
with the existing n8n deployment.

## One-time VPS setup

1. Point the DNS `A` record for `api.chanax.in` to the Hostinger VPS IP.
2. Create a deploy user with access to Docker and clone this repository into
   `/opt/chanax` on the VPS.
3. Copy `backend/.env.example` to `backend/.env` on the VPS and set:
   - `APP_ENV=production`
   - `FRONTEND_ORIGINS=https://chanax.in,https://www.chanax.in`
   - `FRONTEND_URL=https://chanax.in`
   - the three Supabase values
   - `WHITEBOOKS_CLIENT_ID`, `WHITEBOOKS_CLIENT_SECRET`, and
     `WHITEBOOKS_EMAIL` (the email used for the WhiteBooks API account)
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and a verified
     `SMTP_FROM_EMAIL` so employee letters can be sent with their PDF attachment
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and a separate random
     `RAZORPAY_WEBHOOK_SECRET`
   - a long random `ACCOUNT_DELETION_CRON_SECRET` (for example, generate one
     with `openssl rand -hex 32`)
   - `PLATFORM_ADMIN_USER_IDS` containing your Supabase Authentication user
     UUID. Multiple platform owners can be comma-separated. Use UUIDs rather
     than email addresses so changing an email cannot transfer this access.
4. Install the reverse-proxy configuration from
   `deploy/nginx/api.chanax.in.conf` only if the VPS already uses Nginx. If n8n
   uses Traefik or Caddy, add the equivalent route there instead.
5. Issue an HTTPS certificate for `api.chanax.in` using the VPS's existing
   reverse-proxy/certificate setup (for nginx: `sudo certbot --nginx -d api.chanax.in`).
   The API must only ever be reached over HTTPS: the nginx file redirects port 80 to
   443 and sends HSTS. After any nginx change, check:

   ```sh
   sudo nginx -t && sudo systemctl reload nginx
   curl -I http://api.chanax.in            # expect 301 and Location: https://api.chanax.in/
   curl -I https://api.chanax.in           # expect Strict-Transport-Security in the reply
   sudo certbot renew --dry-run            # expect success: certificates renew themselves
   ```
6. Start the service:

   ```sh
   cd /opt/chanax
   docker compose -f compose.production.yaml up -d --build
   curl http://127.0.0.1:8010/health
   ```

## GitHub Actions secrets

Add these repository secrets in GitHub under **Settings → Secrets and
variables → Actions**:

- `VPS_HOST`: VPS public IP or SSH hostname
- `VPS_USER`: the restricted deploy user's name
- `VPS_SSH_PRIVATE_KEY`: private half of the deploy key
- `VPS_KNOWN_HOSTS`: output produced locally by `ssh-keyscan -H YOUR_VPS_HOST`

Never put the WhiteBooks client secret, Supabase service-role key, or SSH
private key in Git. They belong only in the VPS `.env` or GitHub secrets.

After the first setup, a push to `main` that changes backend/deployment files
runs tests and then updates the VPS automatically. Vercel continues deploying
frontend changes from the same branch.

The production Compose project also starts a small daily deletion worker. It
permanently removes workspaces whose 30-day recovery period has expired. Keep
`ACCOUNT_DELETION_CRON_SECRET` only in the VPS environment file.

## Vercel production variable

Set `VITE_API_URL=https://api.chanax.in` for Production and Preview, then
redeploy the frontend once. The frontend never receives the WhiteBooks client
secret.

## Team invitation email setup

Run `supabase/migrations/202608270001_team_invitation_delivery.sql` in the
Supabase SQL Editor. In Supabase Authentication → URL Configuration, allow
`https://chanax.in/workspace` as a redirect URL. The backend uses Supabase Auth
to email new team members; configure custom SMTP in Supabase before production
so invitation delivery is not limited by the development mail service.

The employee-letter sender uses the SMTP values in `backend/.env`. If Resend is
also your Supabase custom SMTP provider, use the same Resend SMTP host,
username and API-key password, plus a sender address on your verified domain.

## Razorpay billing setup

Run `supabase/migrations/202609040001_razorpay_billing.sql` before enabling
checkout, followed by
`supabase/migrations/202609050001_separate_quotation_credits.sql` so every
purchase receives matching, separately restricted quotation credits. Configure
the Razorpay webhook URL as
`https://api.chanax.in/api/v1/billing/webhook` and enter exactly the same
webhook secret saved on the VPS. Enable `payment.captured`, `payment.failed`,
`order.paid`, and `refund.processed`. Test Mode and Live Mode should use
separate API keys and separate webhook secrets.

Run `supabase/migrations/202609050003_custom_subscription_plans.sql` after the
private super-admin migration, followed by
`supabase/migrations/202609050004_fixed_subscription_plans.sql`, to enable the
current fixed and server-priced custom plans. Custom-plan
monthly usage is invoices plus employees, with 20% additional credits for a
monthly term, 25% for a quarterly term, and 30% for an annual term. Every plan
receives the same separate quantity of quotation credits. Custom pricing is
₹0.60 per expected monthly document with a ₹100 minimum monthly charge. The
fixed plans are ₹100/month for 240 credits, ₹300/quarter for 750 credits, and
₹1,200/year for 3,120 credits.

## Private platform administration

Run `supabase/migrations/202609050002_private_super_admin.sql` after the
quotation-credit migration. Find your own user UUID under **Supabase →
Authentication → Users**, add it to `PLATFORM_ADMIN_USER_IDS` in the VPS
`backend/.env`, and rebuild the backend container. After signing in, the profile
menu will show **Platform administration** only for an approved UUID.

Run `supabase/migrations/202609050005_admin_email_credit_grants.sql` to let the
private administration page find subscriptions by owner, active member or
pending-invitation email as well as subscription code. The migration also stores
a subscription-code snapshot and the exact entered reason with every credit
adjustment, so the allocation remains auditable in Supabase. Every allocation
adds the same number of document and quotation top-up credits and records the
authenticated platform administrator. The service-role key and administrator
UUID list remain backend-only and must never be placed in Vercel variables.

## WhatsApp document sending (n8n)

"Share → WhatsApp → Send PDF" calls `POST /api/v1/documents/document-whatsapp`.
The API checks the user's `invoices.read` permission and that the invoice or
quotation belongs to the workspace, then POSTs this JSON to the n8n webhook:

```json
{
  "event": "document.whatsapp",
  "to": "919876543210",
  "message": "Invoice INV-0001 from Acme for Sample Client.",
  "document": { "type": "invoice", "number": "INV-0001", "id": "<uuid>" },
  "file": {
    "filename": "Sample-Client_2026-10-05.pdf",
    "mime_type": "application/pdf",
    "size_bytes": 48211,
    "base64": "JVBERi0xLjQK..."
  },
  "workspace_id": "<uuid>",
  "sent_by": { "user_id": "<uuid>", "email": "owner@example.com" },
  "sent_at": "2026-10-05T06:30:00+00:00"
}
```

- `to` is digits only with country code; `file.base64` is the raw PDF (no `data:` prefix, max 10 MB).
- Header `X-ChanaX-Secret: <N8N_WHATSAPP_SECRET>` is sent when the secret is set.
- Set the Webhook to respond using a Respond to Webhook node, after Meta's send
  request completes. Return a 2xx JSON response with `{"success": true, "message":
  "WhatsApp accepted the message for delivery."}` for success. An empty response
  or a "workflow started" response does not count as a confirmed send.
- Return `{"success": false, "error": "..."}` for failures; `message` is also
  supported as the failure text. These errors are shown for both 2xx and non-2xx
  responses. Connect upload and send error outputs to the failure response.
- Accepted means queued by WhatsApp, not confirmed delivered. Later delivery
  failures require Meta status callbacks; this endpoint confirms the immediate
  sending result only.

Set in `backend/.env` on the server, then restart the API:

```
N8N_WHATSAPP_WEBHOOK_URL=https://n8n.example.com/webhook/<id>
N8N_WHATSAPP_SECRET=<optional shared secret>
```

## Sign-up phone verification (n8n)

The sign-up dialog calls `POST /api/v1/account/phone/send-code`. The API creates a
6-digit code (stored only as a keyed hash; 10-minute expiry, 30 s resend cooldown,
5 codes/hour, 5 attempts) and POSTs this JSON to `N8N_OTP_WEBHOOK_URL`:

```json
{
  "event": "phone.verification",
  "phone": "919876543210",
  "phone_e164": "+919876543210",
  "otp": "123456",
  "expires_in_minutes": 10,
  "user_id": "<uuid>",
  "email": "user@example.com",
  "sent_at": "2026-11-05T11:45:00+00:00"
}
```

- Send `otp` with the WhatsApp authentication template (body + copy-code button parameter).
- Header `X-ChanaX-Secret` carries `N8N_OTP_SECRET` (or `N8N_WHATSAPP_SECRET` when empty).
- Reply with any 2xx when the message is accepted; a non-2xx tells the user it could not be sent.
- `POST /api/v1/account/phone/verify` checks the code and sets `profiles.phone_verified_at`.

## Phone sign-up / sign-in (Supabase phone auth + WhatsApp)

Users can sign up or sign in with a phone number on the login page. Supabase
generates the code and calls ChanaX's Send SMS hook, which forwards it to the
same n8n OTP webhook (`purpose: "login"`), so n8n sends it on WhatsApp.

One-time setup in the Supabase dashboard:

1. Run migration `202611100002_supabase_phone_auth.sql`.
2. Authentication → Sign In / Providers → **Phone**: enable it. Turn on phone
   confirmations. Set the OTP expiry to 600 seconds and OTP length to 6.
3. Authentication → Hooks → **Send SMS hook** → HTTPS, URL
   `https://<api-domain>/api/v1/account/sms-hook`. Generate the secret.
4. Put that secret (it starts with `v1,whsec_`) in the VPS `backend/.env` as
   `SUPABASE_SMS_HOOK_SECRET`, then
   `docker compose -f compose.production.yaml up -d --force-recreate`.

Profile → Phone changes use ChanaX's own WhatsApp verification and update the
sign-in phone. One number can be the sign-in phone of only one account.

## Custom-quote payment links (Platform admin → Payment links)

Admins price a custom quote (price + 18% GST, credits, months) and create a
Razorpay Payment Link; Razorpay emails/texts it to the subscriber. When paid,
the link becomes a normal `custom_quote` payment order and credits/months are
applied like any plan purchase.

1. Run migration `202611100003_admin_analytics_payment_links.sql`.
2. Razorpay Dashboard → Webhooks → the existing ChanaX webhook
   (`/api/v1/billing/webhook`): also tick **payment_link.paid**.
3. If a payment ever doesn't show as paid, use **Check status** on the link.

## Sign-in security check (Cloudflare Turnstile)

Sign-in, sign-up, phone codes and password reset go from the browser straight to
Supabase Auth, so the API rate limiter does not cover them. Protect them like this:

1. In Cloudflare, create a free Turnstile widget for `chanax.in` and copy the **site key**
   and **secret key**.
2. In Supabase → Authentication → Attack Protection, turn on **Enable Captcha protection**,
   choose **Cloudflare Turnstile** and paste the **secret key**.
3. In Vercel, set `VITE_TURNSTILE_SITE_KEY` to the **site key** (Production and Preview)
   and redeploy the frontend.
4. In Supabase → Authentication → Rate Limits, keep sign-in, sign-up and SMS/OTP limits low.

Turn on steps 2 and 3 together. With the site key unset the login page shows no check
(and Supabase must not require one), and with Supabase requiring one but no site key,
sign-in fails with a captcha error.

## Request rate limits

Two layers protect the endpoints that send messages or cost money (phone codes,
email, WhatsApp, invitations, GST lookups, billing, public analytics):

1. **nginx** (`deploy/nginx/api.chanax.in.conf`): 10 requests/second per IP overall,
   and 30/minute per IP for send endpoints. Reload nginx after updating the file
   (`nginx -t && systemctl reload nginx`). The two `limit_req_zone` lines must sit in
   the `http {}` context; a file included from `conf.d/` or `sites-enabled/` already does.
2. **API** (`backend/app/core/rate_limit.py`): per-IP and per-signed-in-user limits,
   for example 5 phone codes per 10 minutes and 10 emails/WhatsApp sends per minute.
   Over the limit the API answers HTTP 429 with a `Retry-After` header. Webhooks
   (Razorpay, Supabase SMS hook), `/health` and the deletion worker are exempt.
   Set `RATE_LIMIT_ENABLED=false` only to debug.

The API reads the client address from `X-Real-IP`, which nginx sets. This is safe
because the container binds to `127.0.0.1` only; never expose port 8010 publicly.
Counters are in memory, so run the API as a single uvicorn process (the current
setup). With several workers, move the counters to Redis.

After deploying, check it: send 15 quick requests to a send endpoint and expect 429s,
for example `for i in $(seq 1 15); do curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.chanax.in/api/v1/analytics/visit -H 'Content-Type: application/json' -d '{"visitor_id":"xxxxxxxxxxxxxxxxxxxxxxxx"}'; done`

## Platform-admin multi-factor authentication (authenticator app)

Platform administration can require a second sign-in step: a 6-digit code from an
authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, etc.).

1. In Supabase → Authentication → Sign In / Providers → **Multi-Factor**, make sure
   **TOTP** is enabled.
2. Each platform admin opens **Platform administration** once. The page shows a QR code;
   scan it and enter the code to enrol. Save the setup key somewhere safe as a backup.
3. Once every admin has enrolled, set `ADMIN_REQUIRE_MFA=true` in the VPS `backend/.env` and
   run `docker compose -f compose.production.yaml up -d --force-recreate`.
4. From then on every `/api/v1/admin/*` call without an MFA-verified sign-in (`aal2`)
   returns HTTP 403, so a stolen password alone cannot open platform administration.

Leave `ADMIN_REQUIRE_MFA` off until step 2 is complete, or admins will be locked out of
the page. If one is locked out, set it to `false`, restart, and enrol them.

## Uploaded file checks (expense bills)

Expense bills are uploaded through `POST /api/v1/expense-bills`, not straight to Supabase
Storage. The API reads the file's real content, so renaming an executable or script to
`.pdf` / `.png` does not work:

- Only PDF, PNG, JPEG and WebP are accepted, judged by their first bytes, not their name
  or declared type. The stored file's extension always matches its real type.
- Images are decoded and re-saved, which removes anything hidden inside or appended to
  them. Images over 40 megapixels are refused before decoding.
- PDFs containing JavaScript or launch actions (`/JavaScript`, `/JS`, `/Launch`) are refused.
- 5 MB limit; 20 uploads per minute per user.

Deploy order matters: deploy the backend (new `pillow` dependency, so rebuild the image)
and the frontend first, then run
`supabase/migrations/202611240002_expense_bills_upload_via_api.sql`, which removes the
browser's direct upload permission. Running it earlier breaks bill uploads.

Not covered: antivirus scanning. For malware signatures, add ClamAV (for example a
`clamav/clamav` container that the API calls before storing) as a later step.

## Virus scanning for uploads (ClamAV)

Uploaded expense bills and PDFs shared by link are scanned with ClamAV before they are
stored. Scanning is off until you turn it on, and once on it is mandatory: if the
scanner is down, uploads are refused (HTTP 503) rather than let through.

1. Make sure the VPS has about 1.5 GB of free RAM (ClamAV loads its signatures into memory).
2. In `/opt/chanax/.env` (next to `compose.production.yaml`) add `COMPOSE_PROFILES=scan`.
3. In `backend/.env` add `CLAMAV_HOST=clamav` (port 3310 is the default).
4. `docker compose -f compose.production.yaml up -d --build`. The first start downloads
   signatures and takes a few minutes; uploads return 503 until `docker compose logs clamav`
   shows it is ready. Signatures then update themselves daily.
5. Test with the harmless EICAR test string (a text file containing
   `X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*` saved inside a
   PDF-style file starting with `%PDF-`): the upload must be blocked as a virus.

Not scanned: PDFs and attachments the app emails or sends on WhatsApp for a signed-in
user, and logos, signatures and QR images, which the browser saves in workspace settings.

## Payment reconciliation (hourly)

A `payment-reconciler` container calls `POST /api/v1/maintenance/reconcile-payments`
every hour (same `X-ChanaX-Cron-Secret` as the deletion worker). It compares Razorpay
with ChanaX's payment records for the last 7 days:

- **Missed webhook:** an order still "created" for 15+ minutes that Razorpay shows as
  captured is applied (credits and plan period added). The amount and currency must match
  the order, and applying uses the same one-time function as checkout and the webhook, so
  running twice never double-credits.
- **Amount mismatch:** a captured payment whose amount differs from the order is NOT
  applied; it is listed under `amount_mismatches` and logged as an error.
- **Refund mismatch:** if Razorpay has refunded more or less than ChanaX recorded, it is
  listed under `refund_mismatches` (reported only; fix by hand after checking Razorpay).

Read the result with `docker compose logs payment-reconciler`. A healthy run shows empty
`recovered`, `amount_mismatches`, `refund_mismatches` and `errors` lists. Anything in
`recovered` means a webhook was missed: check that the Razorpay webhook URL and secret
are still correct. To run it by hand, POST to
`http://127.0.0.1:8010/api/v1/maintenance/reconcile-payments` with the header
`X-ChanaX-Cron-Secret` set to your `ACCOUNT_DELETION_CRON_SECRET`.

Monthly, also compare Razorpay Dashboard, Reports, Settlements with the paid rows in
`breezy_payment_orders` for the month: the totals should agree.

## VPS hardening checklist (firewall, SSH, root login)

The server's own settings are not in this repository, so this is the checklist to verify
on the VPS. Last checked from outside on 2026-11-24:

- Firewall works: only ports 22, 80, 443 and 5678 answer; 8010 (API), 3310, 5432, 6379,
  2375 and others are silent.
- SSH (OpenSSH 9.6) accepts keys only: `root` and `ubuntu` both answer
  `Permission denied (publickey)`, so password login is off.
- **n8n on port 5678 is open to the internet over plain HTTP** (editor page and `/healthz`
  answer). Fix below.

On the VPS, confirm each line (run as a sudo user):

```sh
sudo sshd -T | grep -E "^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|maxauthtries|x11forwarding) "
#   want: permitrootlogin no   passwordauthentication no   kbdinteractiveauthentication no
#         pubkeyauthentication yes   maxauthtries 3 or less
sudo ufw status verbose            # want: Status active, default deny incoming, allow 22/80/443 only
sudo ss -tlnp                      # what is listening, and on which address (0.0.0.0 = public)
systemctl is-active fail2ban unattended-upgrades    # want: active, active
```

Settings to apply if any line differs (put SSH ones in `/etc/ssh/sshd_config.d/99-chanax.conf`,
then `sudo sshd -t && sudo systemctl reload ssh`; keep your current SSH session open until
a second session confirms you can still log in):

```
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
X11Forwarding no
```

Firewall: `sudo ufw default deny incoming`, `sudo ufw allow 22/tcp`, `sudo ufw allow 80/tcp`,
`sudo ufw allow 443/tcp`, then `sudo ufw enable`. Consider `sudo ufw limit 22/tcp` and
`sudo apt install fail2ban unattended-upgrades`.

**Docker bypasses ufw.** A container published as `5678:5678` is reachable from the internet
even when ufw does not allow it. That is why n8n answers on 5678. Fix it in n8n's own
compose file by publishing it to the local machine only and letting the reverse proxy
(nginx, Traefik or Caddy, with HTTPS) reach it:

```yaml
    ports:
      - "127.0.0.1:5678:5678"
```

Then `docker compose up -d` for n8n and re-run the external check below; port 5678 must
stop answering. The ChanaX API already does this (`127.0.0.1:8010` in
`compose.production.yaml`). Make sure the n8n webhook URLs in `backend/.env`
(`N8N_WHATSAPP_WEBHOOK_URL`, `N8N_OTP_WEBHOOK_URL`) use `https://`.

Check from any other machine (replace with your server's address):

```sh
nc -zv -w 4 YOUR_SERVER_IP 22 80 443 5678 8010 3310 5432 6379
ssh -o BatchMode=yes -o PreferredAuthentications=none root@YOUR_SERVER_IP true
#   want: only 22, 80, 443 open; "Permission denied (publickey)"
```

## Secrets: never commit them, and what to do if one leaks

Secrets live only in `backend/.env` on the VPS, GitHub Actions secrets and Vercel
variables. `backend/.env.example` and `frontend/.env.example` must contain blanks.

A WhiteBooks client ID and secret were once committed in `backend/.env.example` (first
in commit `cf8e0b5`, still visible in Git history). They are blank now, but a value in
history is public to anyone who can read the repository, so treat it as leaked:

1. In the WhiteBooks dashboard, rotate or regenerate the client secret (and the client ID
   if it allows). Do this for the sandbox account and for the production account if it used
   the same values.
2. Put the new values only in `backend/.env` on the VPS, then
   `docker compose -f compose.production.yaml up -d --force-recreate`.
3. Confirm the OLD pair is rejected by WhiteBooks (a token request with the old credentials
   must fail), and that GSTIN lookups in ChanaX still work with the new pair.
4. Optional: remove the value from history with `git filter-repo --replace-text`, then
   force-push every branch and have everyone re-clone. Rotation already makes the old value
   useless, so this is only about tidiness; it is mandatory only if the repository is or was
   public AND rotation is impossible.

Secret scanning runs in CI (`.github/workflows/secret-scan.yml`, rules in `.gitleaks.toml`):
every pull request and push to `main` is scanned and fails on a new secret. To scan the whole
history, run the workflow manually with "full_history" ticked; the old WhiteBooks commit will
keep being reported until history is rewritten. Locally:
`gitleaks git . --config .gitleaks.toml --redact`.

## Backups and restore testing

**What holds what, and what protects it**

| Data | Lives in | Protected by |
|---|---|---|
| Customers, invoices, payroll, accounts (`public` and `auth` schemas) | Supabase Postgres | Supabase's own backups **plus** `deploy/backup/backup.sh` |
| Expense bills and shared PDFs | Supabase Storage | `backup.sh` only. **Supabase database backups do not include uploaded files**, and a deleted file cannot be recovered |
| n8n workflows and credentials (WhatsApp, OTP) | VPS disk | `backup.sh` (set `N8N_DATA_DIR`) |
| `backend/.env`, nginx config | VPS disk | `backup.sh`, encrypted only |
| Code | GitHub | Git |

**Check in the Supabase dashboard (the repository cannot show this).** Database, Backups:
which plan you are on and how many days of daily backups it keeps (Free: none; Pro: 7 days;
point-in-time recovery is a paid add-on). If you are on Free, `backup.sh` is your only
database backup. Write down what you see; the recovery targets below depend on it.

**One-time setup on the VPS**

1. `sudo apt install postgresql-client age rclone` (age encrypts, rclone copies off-site).
2. `age-keygen -o ~/chanax-backup.key`. Copy the `age1...` public line into `BACKUP_AGE_RECIPIENT`
   and store the private key file somewhere safe and OFF this server. Without it the encrypted
   backups cannot be read.
3. `cp deploy/backup/backup.env.example /opt/chanax/backup.env`, `chmod 600` it, and fill in
   `SUPABASE_DB_URL` (Supabase, Connect, Session pooler), `RCLONE_REMOTE` (an off-server place) and,
   if you want alerts, `HEALTHCHECK_URL` (healthchecks.io gives a free URL that emails you when a
   backup does not run).
4. Run it once by hand and read the output: `sudo /opt/chanax/deploy/backup/backup.sh`.
5. Schedule it nightly: `0 2 * * * root /opt/chanax/deploy/backup/backup.sh >> /var/log/chanax-backup.log 2>&1`

Each run makes a dated folder in `/var/backups/chanax` (kept 14 days, `latest` points at the newest)
with the database dump, the uploaded-files archive, n8n data, config, row counts and checksums, and
copies it off the server. A backup only appears under its final name when every step succeeded.

**Prove restores work, monthly.** A backup that has never been restored is a guess.

```sh
docker run -d --name restore-test -e POSTGRES_PASSWORD=pw -p 5433:5432 postgres:16
sleep 5; createdb -h localhost -p 5433 -U postgres restore_test      # needs PGPASSWORD=pw
RESTORE_TEST_DB_URL=postgres://postgres:pw@localhost:5433/restore_test \
  BACKUP_AGE_IDENTITY=/path/to/chanax-backup.key \
  /opt/chanax/deploy/backup/restore-test.sh
docker rm -f restore-test
```

It checks the checksums, restores into the empty scratch database (it refuses a non-empty one),
and compares row counts of the main tables, the number of accounts, the number of tables with
row-level security and the number of policies with what was recorded at backup time. It ends
with `RESTORE TEST PASSED` or `FAILED`. Never point it at the Supabase production database.

**If production data is lost or damaged**

1. Stop writing: put the site in maintenance (stop the `api` container) so new data does not mix in.
2. Prefer Supabase's own restore (dashboard, Database, Backups) for the database. It restores the
   whole project to a recent day, or to the minute with point-in-time recovery.
3. If that is not possible, restore `database.dump` (decrypt with `age -d -i key database.dump.age`)
   into a new Supabase project with `pg_restore --no-owner --no-privileges --clean --if-exists
   -d "<new project URI>" database.dump`, re-run the migrations if the schema is missing, and
   point `SUPABASE_URL` and the keys in `backend/.env` and Vercel at the new project.
4. Re-upload files from `storage.tar` (the folder names are the bucket names: `expense-bills/`,
   `document-links/`) with the Supabase dashboard or the storage API.
5. Run `restore-test.sh` equivalents by hand: log in, open a customer, an invoice and an expense bill.

**Targets to agree on** (fill these in once you know your plan): data you can afford to lose
(with nightly backups, up to 24 hours), and time to be back online (a restore as above takes
roughly an hour once practised).

Not covered: backups of the Razorpay, WhiteBooks and Cloudflare accounts (they keep their own
records), and the encrypted-backup path has not been exercised in tests (it needs `age`).

## Python dependencies: pinned, hash-checked and audited

`backend/requirements.txt` and `backend/requirements-dev.txt` are **generated lock files**: every
package, including indirect ones, is pinned to an exact version with hashes, so a redeploy
installs exactly what was tested and a tampered package is refused. Edit the ranges in
`backend/requirements.in` (runtime) or `backend/requirements-dev.in` (tests and lint), then regenerate:

```sh
pip install uv pip-audit
cd backend
uv pip compile requirements.in -o requirements.txt --universal --python-version 3.11 --generate-hashes
uv pip compile requirements-dev.in -o requirements-dev.txt --universal --python-version 3.11 --generate-hashes
pip-audit --require-hashes -r requirements.txt     # expect: No known vulnerabilities found
```

To take newer versions of everything, add `--upgrade` to the two compile commands, run the tests,
and commit the new lock files. CI (`.github/workflows/backend-dependency-audit.yml`) fails if the
lock files are out of date or contain a package with a known vulnerability, and re-checks every Monday
even when nothing changed. The deploy workflow also runs `pip-audit` before it deploys.

## Browser security policy (CSP): switching from report-only to enforced

`frontend/vercel.json` sends the Content-Security-Policy as `Content-Security-Policy-Report-Only`
for now: browsers log anything the policy would block but block nothing, so checkout cannot break
while it is being checked. `X-Frame-Options: DENY` and the other headers are already enforced.

To finish: on chanax.in, sign in, open the dashboard, invoices, expenses (upload a bill), templates,
letterhead and Platform administration, and make a Razorpay test-mode payment, with the browser
console open. If no "Content Security Policy" messages appear, rename the header key in
`frontend/vercel.json` from `Content-Security-Policy-Report-Only` to `Content-Security-Policy`
and push. If messages appear, send them so the policy can be adjusted first.
