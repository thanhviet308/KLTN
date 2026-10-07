#!/usr/bin/env bash
set -euo pipefail
: "${APP_DB_USER:?APP_DB_USER is required}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"
[[ "$APP_DB_USER" != "$POSTGRES_USER" ]] || { echo 'App and admin users must differ' >&2; exit 1; }

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 \
  --set app_user="$APP_DB_USER" --set app_password="$APP_DB_PASSWORD" --set app_db="$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'app_user', :'app_password') \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'app_db', :'app_user') \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'app_user') \gexec
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
