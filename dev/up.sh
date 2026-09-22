#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT_DIR/dev/compose.yaml")
MATRIX_USER="${MATRIX_CALENDAR_DEV_USER:-calendar}"
MATRIX_PASSWORD="${MATRIX_CALENDAR_DEV_PASSWORD:-calendar-dev-password}"

command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }

echo "==> Preparing Synapse configuration"
if ! "${COMPOSE[@]}" run --rm --entrypoint sh synapse -c 'test -f /data/homeserver.yaml' >/dev/null 2>&1; then
  "${COMPOSE[@]}" run --rm synapse generate
fi

echo "==> Starting Synapse"
"${COMPOSE[@]}" up -d synapse

echo "==> Waiting for Synapse"
for _ in $(seq 1 90); do
  if curl --silent --fail http://localhost:8008/_matrix/client/versions >/dev/null; then
    break
  fi
  sleep 1
done
curl --silent --fail http://localhost:8008/_matrix/client/versions >/dev/null

login_payload="$(printf '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"%s"},"password":"%s"}' "$MATRIX_USER" "$MATRIX_PASSWORD")"
if ! curl --silent --fail -H 'Content-Type: application/json' -d "$login_payload" http://localhost:8008/_matrix/client/v3/login >/dev/null; then
  echo "==> Registering dev Matrix user @$MATRIX_USER:localhost"
  "${COMPOSE[@]}" exec -T synapse register_new_matrix_user     -c /data/homeserver.yaml     -u "$MATRIX_USER"     -p "$MATRIX_PASSWORD"     -a     http://localhost:8008
else
  echo "==> Dev Matrix user already exists"
fi

echo "==> Starting Matrix-authenticated Radicale"
"${COMPOSE[@]}" up -d radicale

echo "==> Waiting for Radicale"
for _ in $(seq 1 60); do
  if curl --silent --fail -u "$MATRIX_USER:$MATRIX_PASSWORD" http://localhost:5232/ >/dev/null; then
    break
  fi
  sleep 1
done
curl --silent --fail -u "$MATRIX_USER:$MATRIX_PASSWORD" http://localhost:5232/ >/dev/null

cat <<EOF
Development services are ready.

Matrix homeserver: http://localhost:8008
Matrix user:       @$MATRIX_USER:localhost
Matrix password:   $MATRIX_PASSWORD

Radicale:          http://localhost:5232
CalDAV username:   $MATRIX_USER
CalDAV password:   $MATRIX_PASSWORD

These credentials are for local development only.
EOF
