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
   - `WHITEBOOKS_CLIENT_ID` and `WHITEBOOKS_CLIENT_SECRET`
   - a long random `ACCOUNT_DELETION_CRON_SECRET` (for example, generate one
     with `openssl rand -hex 32`)
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
