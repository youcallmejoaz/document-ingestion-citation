#!/usr/bin/env bash
# Applies the migration to a throwaway Postgres database (with a Supabase shim)
# and runs the RLS / retrieval test suite.
#   DATABASE_URL=postgres://user@host/postgres scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ADMIN_URL="${DATABASE_URL:-postgres://postgres@localhost:5432/postgres}"
DB="kh_test_$$"
base="${ADMIN_URL%/*}"

psql "$ADMIN_URL" -qc "create database $DB" >/dev/null
trap 'psql "$ADMIN_URL" -qc "drop database if exists $DB" >/dev/null' EXIT

TEST_URL="$base/$DB"
psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f supabase/tests/supabase_shim.sql
for f in supabase/migrations/*.sql; do
  psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f "$f"
done
psql "$TEST_URL" -q -o /dev/null -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
echo "Database tests passed."
