#!/usr/bin/env bash
# Runs Supabase Auth + PostgREST + a storage-emulating gateway against a local
# Postgres. See README.md in this folder.
set -euo pipefail
cd "$(dirname "$0")/../.."

ADMIN_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/postgres}"
DB_NAME="${KH_DB_NAME:-knowledgehub}"
BIN="${KH_STACK_BIN:-$PWD/.local-stack/bin}"
STATE="$PWD/.local-stack"
JWT_SECRET="${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}"
POSTGREST_VERSION=v12.2.3
AUTH_VERSION=v2.177.0

base="${ADMIN_URL%/*}"
hostpart="${base#*@}"
DB_URL="$base/$DB_NAME"

mkdir -p "$BIN" "$STATE"
if [ ! -x "$BIN/postgrest" ]; then
  echo "Downloading PostgREST $POSTGREST_VERSION…"
  curl -sSL "https://github.com/PostgREST/postgrest/releases/download/$POSTGREST_VERSION/postgrest-$POSTGREST_VERSION-linux-static-x64.tar.xz" | tar xJ -C "$BIN"
fi
if [ ! -x "$BIN/auth/auth" ]; then
  echo "Downloading Supabase Auth $AUTH_VERSION…"
  mkdir -p "$BIN/auth"
  curl -sSL "https://github.com/supabase/auth/releases/download/$AUTH_VERSION/auth-$AUTH_VERSION-x86.tar.gz" | tar xz -C "$BIN/auth"
fi

if [ "${KH_RESET:-0}" = "1" ]; then
  psql "$ADMIN_URL" -qc "drop database if exists $DB_NAME with (force)"
  rm -rf "$STATE/storage"
fi

fresh=0
if ! psql "$ADMIN_URL" -tAc "select 1 from pg_database where datname='$DB_NAME'" | grep -q 1; then
  psql "$ADMIN_URL" -qc "create database $DB_NAME"
  psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f scripts/local-stack/init.sql
  fresh=1
fi

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "Starting Supabase Auth…"
(
  cd "$BIN/auth"
  GOTRUE_DB_DRIVER=postgres \
  DATABASE_URL="postgres://supabase_auth_admin:postgres@$hostpart/$DB_NAME" \
  GOTRUE_DB_NAMESPACE=auth \
  API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1 \
  GOTRUE_SITE_URL=http://localhost:3000 \
  GOTRUE_API_HOST=127.0.0.1 PORT=9999 \
  GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated \
  GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role \
  GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_DISABLE_SIGNUP=false \
  GOTRUE_LOG_LEVEL=warn \
  ./auth > "$STATE/auth.log" 2>&1
) &
pids+=($!)
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:9999/health >/dev/null && break; sleep 0.5; done
curl -sf http://127.0.0.1:9999/health >/dev/null || { echo "Auth failed to start:"; tail -20 "$STATE/auth.log"; exit 1; }

if [ "$fresh" = "1" ]; then
  echo "Applying migrations…"
  for f in supabase/migrations/*.sql; do psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$f"; done
fi

echo "Starting PostgREST…"
PGRST_DB_URI="postgres://authenticator:postgres@$hostpart/$DB_NAME" \
PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$JWT_SECRET" \
PGRST_DB_EXTRA_SEARCH_PATH=public,extensions PGRST_SERVER_PORT=54330 PGRST_SERVER_HOST=127.0.0.1 \
PGRST_LOG_LEVEL=warn \
  "$BIN/postgrest" > "$STATE/postgrest.log" 2>&1 &
pids+=($!)

JWT_SECRET="$JWT_SECRET" STORAGE_DIR="$STATE/storage" REST_URL=http://127.0.0.1:54330 AUTH_URL=http://127.0.0.1:9999 \
  node scripts/local-stack/gateway.mjs &
pids+=($!)
sleep 1

keys=$(JWT_SECRET="$JWT_SECRET" node --input-type=module -e "
import { apiKeys } from './scripts/local-stack/jwt.mjs';
const k = apiKeys(process.env.JWT_SECRET);
console.log('NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321');
console.log('NEXT_PUBLIC_SUPABASE_ANON_KEY=' + k.anon);
console.log('SUPABASE_SERVICE_ROLE_KEY=' + k.service);
")
echo "$keys" > "$STATE/env"
echo
echo "Local stack is up. Put these in .env.local (also saved to .local-stack/env):"
echo "$keys"
echo
wait
