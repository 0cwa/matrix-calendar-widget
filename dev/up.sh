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
  printf '%s' "$MATRIX_PASSWORD" |
    "${COMPOSE[@]}" exec -T synapse register_new_matrix_user \
      -c /data/homeserver.yaml \
      -u "$MATRIX_USER" \
      --password-file /dev/stdin \
      -a \
      http://localhost:8008
else
  echo "==> Dev Matrix user already exists"
fi

echo "==> Building the project-owned OpenID-only Radicale image"
"${COMPOSE[@]}" build radicale

echo "==> Starting OpenID-authenticated Radicale"
"${COMPOSE[@]}" up -d radicale

echo "==> Minting a short-lived OpenID proof for the local Synapse fixture"
OPENID_CREDENTIAL="$(node "$ROOT_DIR/dev/mint-openid-credential.mjs")"

echo "==> Waiting for Radicale"
for _ in $(seq 1 60); do
  if curl --silent --fail --max-time 3 -u "$MATRIX_USER:$OPENID_CREDENTIAL" http://localhost:5232/ >/dev/null; then
    break
  fi
  sleep 1
done
curl --silent --fail --max-time 3 -u "$MATRIX_USER:$OPENID_CREDENTIAL" http://localhost:5232/ >/dev/null

cat <<EOF
Development services are ready.

Matrix homeserver: http://localhost:8008
Matrix user:       @$MATRIX_USER:localhost

Radicale:          http://localhost:5232
CalDAV username:   $MATRIX_USER
CalDAV auth:       short-lived Matrix OpenID proof

The local fixture password is used only to create/sign in the development
Synapse account and mint that proof. It is never sent to Radicale or the
calendar gateway, and the script does not print it or the proof.
EOF
