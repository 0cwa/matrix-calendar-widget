#!/bin/sh
# Initialize the dedicated application role and database in a fresh volume.
# The bootstrap password comes from PostgreSQL's POSTGRES_PASSWORD_FILE. The
# application password stays in its separate, file-backed secret.
set -eu

secret_file=${MATRIX_CALENDAR_PG_APP_PASSWORD_FILE:-/run/secrets/matrix_calendar_pg_app_password}
if [ ! -r "$secret_file" ]; then
  printf '%s\n' 'PostgreSQL app-role secret file is unavailable.' >&2
  exit 1
fi

app_password=$(cat "$secret_file")
case "$app_password" in
  ''|*[!A-Za-z0-9_-]*)
    unset app_password
    printf '%s\n' 'PostgreSQL app-role secret has an unsupported format.' >&2
    exit 1
    ;;
esac

export MATRIX_CALENDAR_PG_APP_PASSWORD="$app_password"
unset app_password

# Keep interpolated SQL and server diagnostics out of logs. The password is
# supplied through the psql process environment and never through argv.
export PGOPTIONS='-c log_statement=none -c log_min_error_statement=panic'
if ! psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set ON_ERROR_STOP=1 \
  >/dev/null 2>&1 <<'SQL'
\getenv app_password MATRIX_CALENDAR_PG_APP_PASSWORD
CREATE ROLE matrix_calendar_app
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';
CREATE DATABASE matrix_calendar OWNER matrix_calendar_app;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
REVOKE CONNECT ON DATABASE matrix_calendar FROM PUBLIC;
GRANT CONNECT ON DATABASE matrix_calendar TO matrix_calendar_app;
SQL
then
  unset MATRIX_CALENDAR_PG_APP_PASSWORD PGOPTIONS
  printf '%s\n' 'PostgreSQL app-role bootstrap failed; details suppressed.' >&2
  exit 1
fi

unset MATRIX_CALENDAR_PG_APP_PASSWORD PGOPTIONS
