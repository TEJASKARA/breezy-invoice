#!/usr/bin/env bash
# Prints "<label> <name>=<number>" lines used to check a restore: row counts of the main
# business tables plus how many tables have row-level security and how many policies exist.
# Usage: counts.sh <database url> <label>
set -Eeuo pipefail
url="$1"
label="$2"

tables="profiles breezy_workspaces breezy_workspace_members breezy_entities breezy_invoices breezy_proformas breezy_employees breezy_payslips breezy_expenses breezy_payment_orders breezy_credit_accounts"

q() { psql -X -A -t -v ON_ERROR_STOP=1 -c "$1" "$url"; }

for t in $tables; do
  if [ "$(q "select to_regclass('public.$t') is not null")" = "t" ]; then
    echo "$label $t=$(q "select count(*) from public.$t")"
  fi
done
echo "$label auth_users=$(q "select count(*) from auth.users")"
echo "$label rls_tables=$(q "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity")"
echo "$label policies=$(q "select count(*) from pg_policies where schemaname='public'")"
