#!/usr/bin/env bash
# ChanaX nightly backup. Run from cron on the VPS (see deploy/README.md, "Backups").
#
# Saves, into one dated folder:
#   database.dump   Supabase Postgres: the public and auth schemas (all business data and
#                   user accounts), custom pg_dump format
#   storage.tar     every file in the expense-bills and document-links buckets
#                   (Supabase's own backups do NOT include uploaded files)
#   n8n.tgz         the n8n data folder (workflows and credentials), if N8N_DATA_DIR is set
#   config.tgz      backend/.env and nginx config (contains secrets: written only when
#                   encryption is on)
#   counts.txt      row counts taken before and after the dump, used by restore-test.sh
#   SHA256SUMS      checksums of the files above
#
# Settings come from /opt/chanax/backup.env (or $BACKUP_ENV_FILE). See deploy/backup/backup.env.example.
set -Eeuo pipefail

ENV_FILE="${BACKUP_ENV_FILE:-/opt/chanax/backup.env}"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required (Supabase > Connect > Session pooler URI)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/chanax}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STORAGE_EXPORT="${STORAGE_EXPORT:-1}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/chanax/compose.production.yaml}"
CONFIG_PATHS="${CONFIG_PATHS:-/opt/chanax/backend/.env /etc/nginx/sites-enabled}"
N8N_DATA_DIR="${N8N_DATA_DIR:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="$BACKUP_DIR/$stamp.partial"
final="$BACKUP_DIR/$stamp"
umask 077
mkdir -p "$work"

ping() { [ -n "${HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 "$HEALTHCHECK_URL$1" >/dev/null 2>&1 || true; }
fail() { echo "BACKUP FAILED at $(date -u +%FT%TZ)" >&2; rm -rf "$work"; ping /fail; exit 1; }
trap fail ERR
ping /start

# Optional encryption with age (https://age-encryption.org). Strongly recommended: the
# database contains customer, payroll and bank details.
suffix=""
seal() { cat; }
if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  command -v age >/dev/null || { echo "age is not installed but BACKUP_AGE_RECIPIENT is set" >&2; false; }
  suffix=".age"
  seal() { age -r "$BACKUP_AGE_RECIPIENT"; }
fi

# Row counts and security settings, before and after the dump, so a restore can be checked.
"$HERE/counts.sh" "$SUPABASE_DB_URL" before > "$work/counts.before"

echo "Dumping the database..."
# (Options first, address last: some builds of pg_dump refuse the other order.)
pg_dump --format=custom --no-owner --no-privileges --schema=public --schema=auth \
  "$SUPABASE_DB_URL" | seal > "$work/database.dump$suffix"

"$HERE/counts.sh" "$SUPABASE_DB_URL" after > "$work/counts.after"
cat "$work/counts.before" "$work/counts.after" > "$work/counts.txt"
rm -f "$work/counts.before" "$work/counts.after"

if [ "$STORAGE_EXPORT" = "1" ]; then
  echo "Exporting uploaded files..."
  docker compose -f "$COMPOSE_FILE" exec -T api python -m app.cli.export_storage \
    | seal > "$work/storage.tar$suffix"
fi

if [ -n "$N8N_DATA_DIR" ]; then
  echo "Saving n8n data..."
  tar -czf - -C "$(dirname "$N8N_DATA_DIR")" "$(basename "$N8N_DATA_DIR")" | seal > "$work/n8n.tgz$suffix"
fi

if [ -n "$suffix" ]; then
  echo "Saving configuration..."
  # shellcheck disable=SC2086
  tar -czf - $CONFIG_PATHS 2>/dev/null | seal > "$work/config.tgz$suffix"
else
  echo "WARNING: BACKUP_AGE_RECIPIENT is not set, so secrets (config.tgz) are NOT backed up." >&2
fi

(cd "$work" && sha256sum -- * > SHA256SUMS)
mv "$work" "$final"
ln -sfn "$final" "$BACKUP_DIR/latest"

if [ -n "${RCLONE_REMOTE:-}" ]; then
  echo "Copying off the server..."
  rclone copy "$final" "$RCLONE_REMOTE/$stamp"
fi

# Keep RETENTION_DAYS days of backups on this server.
find "$BACKUP_DIR" -maxdepth 1 -type d -name '2*T*Z' -mtime +"$RETENTION_DAYS" -exec rm -rf {} +

trap - ERR
ping ""
echo "Backup complete: $final ($(du -sh "$final" | cut -f1))"
