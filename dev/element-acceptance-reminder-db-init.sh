#!/bin/sh
set -eu

app_password=${ELEMENT_ACCEPTANCE_REMINDER_APP_PASSWORD:?}
case "$app_password" in
  *[!A-Za-z0-9_-]*|'')
    exit 1
    ;;
esac

psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set ON_ERROR_STOP=1 <<SQL
CREATE ROLE matrix_calendar_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '$app_password';
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
CREATE DATABASE matrix_calendar_test OWNER matrix_calendar_app;
SQL
