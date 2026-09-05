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
   reverse-proxy/certificate setup.
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

## Private platform administration

Run `supabase/migrations/202609050002_private_super_admin.sql` after the
quotation-credit migration. Find your own user UUID under **Supabase →
Authentication → Users**, add it to `PLATFORM_ADMIN_USER_IDS` in the VPS
`backend/.env`, and rebuild the backend container. After signing in, the profile
menu will show **Platform administration** only for an approved UUID.

The page searches by exact subscription code. Every allocation adds the same
number of document and quotation top-up credits, requires a confirmation and
reason, and records the authenticated platform administrator in the credit
adjustment audit table. The service-role key and administrator UUID list remain
backend-only and must never be placed in Vercel variables.
