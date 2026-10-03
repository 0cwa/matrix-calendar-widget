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

echo "==> Registering the synthetic local application service"
"${COMPOSE[@]}" run --rm --entrypoint python synapse -c '
import os
import tempfile
import yaml

config_path = "/data/homeserver.yaml"
registration = "/data/appservice-calendar-contract.yaml"
with open(config_path, encoding="utf-8") as config_file:
    config = yaml.safe_load(config_file)
if not os.path.isfile(registration):
    raise SystemExit("synthetic application-service registration is missing")
registrations = config.setdefault("app_service_config_files", [])
if registration not in registrations:
    registrations.append(registration)
directory = os.path.dirname(config_path)
with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=directory, delete=False) as output:
    yaml.safe_dump(config, output, sort_keys=False)
    temporary_path = output.name
os.replace(temporary_path, config_path)
'

echo "==> Starting Synapse"
"${COMPOSE[@]}" up -d --force-recreate synapse

echo "==> Waiting for Synapse"
for _ in $(seq 1 90); do
  if curl --silent --fail http://localhost:8008/_matrix/client/versions >/dev/null; then
    break
  fi
  sleep 1
done
if ! curl --silent --fail http://localhost:8008/_matrix/client/versions >/dev/null; then
  synapse_status="$(
    "${COMPOSE[@]}" ps --format json synapse 2>/dev/null |
      node -e '
        const states = new Set(["created", "running", "paused", "restarting", "removing", "exited", "dead"]);
        const healthStates = new Set(["starting", "healthy", "unhealthy"]);
        try {
          const parsed = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
          const entries = Array.isArray(parsed) ? parsed : [parsed];
          const service = entries.find((entry) => entry?.Service === "synapse");
          const state = states.has(service?.State) ? service.State : "unavailable";
          const health = healthStates.has(service?.Health) ? service.Health : service?.Health ? "unavailable" : "not-reported";
          process.stdout.write(`state=${state} health=${health}`);
        } catch {
          process.stdout.write("state=unavailable health=unavailable");
        }
      ' 2>/dev/null || printf 'state=unavailable health=unavailable'
  )"
  echo "Synapse readiness failed; service state/health: $synapse_status" >&2
  exit 1
fi

login_payload="$(printf '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"%s"},"password":"%s"}' "$MATRIX_USER" "$MATRIX_PASSWORD")"
if ! printf '%s' "$login_payload" |
  curl --silent --fail \
    -H 'Content-Type: application/json' \
    --data-binary @- \
    http://localhost:8008/_matrix/client/v3/login >/dev/null; then
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
