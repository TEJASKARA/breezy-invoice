#!/usr/bin/env bash
# Proves a backup can actually be restored. Restores the database dump into an EMPTY
# scratch database, then compares it with the numbers recorded at backup time.
#
# Usage:  RESTORE_TEST_DB_URL=postgres://postgres:pw@localhost:5433/restore_test \
#         restore-test.sh [backup folder]        (default: /var/backups/chanax/latest)
#
# RESTORE_TEST_DB_URL must point at a throwaway database (never Supabase production). The
# script refuses to run if that database already holds tables. Example scratch database:
#   docker run -d --name restore-test -e POSTGRES_PASSWORD=pw -p 5433:5432 postgres:16
#   createdb -h localhost -p 5433 -U postgres restore_test
# For encrypted backups also set BACKUP_AGE_IDENTITY to the path of your age private key.
# Exit status 0 = PASS, anything else = FAIL.
set -Eeuo pipefail

dir="${1:-/var/backups/chanax/latest}"
: "${RESTORE_TEST_DB_URL:?RESTORE_TEST_DB_URL is required (an empty scratch database)}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
failures=0
check() { if [ "$2" = "ok" ]; then echo "PASS  $1"; else echo "FAIL  $1 ($2)"; failures=$((failures + 1)); fi; }

[ -d "$dir" ] || { echo "FAIL  backup folder not found: $dir"; exit 1; }
dump="$dir/database.dump"
tmp=""
if [ ! -f "$dump" ] && [ -f "$dump.age" ]; then
  : "${BACKUP_AGE_IDENTITY:?the backup is encrypted: set BACKUP_AGE_IDENTITY to your age key file}"
  tmp="$(mktemp)"
  age -d -i "$BACKUP_AGE_IDENTITY" "$dump.age" > "$tmp"
  dump="$tmp"
fi
[ -f "$dump" ] || { echo "FAIL  database.dump missing in $dir"; exit 1; }

# 1. The files are exactly what was written.
if (cd "$dir" && sha256sum -c --quiet SHA256SUMS 2>/dev/null); then
  check "checksums match" ok
else
  check "checksums match" "a file is damaged or missing"
  echo "RESTORE TEST FAILED: do not restore from this backup"
  exit 1
fi

# 2. The scratch database must be empty, so a real database is never overwritten.
existing="$(psql -X -A -t -c "select count(*) from pg_tables where schemaname in ('public','auth')" "$RESTORE_TEST_DB_URL")"
if [ "$existing" != "0" ]; then echo "FAIL  the scratch database is not empty ($existing tables); use a new one"; exit 1; fi

# 3. Roles that policies and grants refer to exist on Supabase but not on plain Postgres.
psql -X -q -v ON_ERROR_STOP=1 "$RESTORE_TEST_DB_URL" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;
create schema if not exists extensions;
SQL

# 4. Restore. "already exists" notes (schemas Postgres creates itself) are harmless.
errors="$(mktemp)"
pg_restore --no-owner --no-privileges --dbname="$RESTORE_TEST_DB_URL" -- "$dump" 2> "$errors" || true
real="$(grep -E '^pg_restore: error:' "$errors" | grep -viE 'already exists' || true)"
if [ -z "$real" ]; then check "pg_restore finished without errors" ok; else check "pg_restore finished without errors" "$(echo "$real" | head -1)"; fi

# 5. The restored data matches the numbers recorded around the dump (a live system can
#    change a little while it is being dumped, so a value anywhere between 'before' and
#    'after' passes).
restored="$("$HERE/counts.sh" "$RESTORE_TEST_DB_URL" restored)"
names="$(grep -E '^(before|after) ' "$dir/counts.txt" | sed -E 's/^[a-z]+ ([^=]+)=.*/\1/' | sort -u)"
for name in $names; do
  b="$(grep -E "^before $name=" "$dir/counts.txt" | cut -d= -f2)"
  a="$(grep -E "^after $name=" "$dir/counts.txt" | cut -d= -f2)"
  r="$(echo "$restored" | grep -E "^restored $name=" | cut -d= -f2 || true)"
  lo=$(( b < a ? b : a )); hi=$(( b > a ? b : a ))
  if [ -n "$r" ] && [ "$r" -ge "$lo" ] && [ "$r" -le "$hi" ]; then check "$name = $r" ok; else check "$name" "restored '${r:-missing}', expected $lo to $hi"; fi
done

# 6. If uploaded files were backed up, the archive must be readable.
if [ -f "$dir/storage.tar" ] || [ -f "$dir/storage.tar.age" ]; then
  if [ -f "$dir/storage.tar" ]; then files="$(tar -tf "$dir/storage.tar" | wc -l)"; else files="$(age -d -i "${BACKUP_AGE_IDENTITY:-/dev/null}" "$dir/storage.tar.age" | tar -t | wc -l)"; fi
  check "uploaded files archive readable ($files files)" ok
fi

[ -n "$tmp" ] && rm -f "$tmp"
rm -f "$errors"
if [ "$failures" -eq 0 ]; then echo "RESTORE TEST PASSED"; else echo "RESTORE TEST FAILED ($failures problems)"; exit 1; fi
