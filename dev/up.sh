#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT_DIR/dev/compose.yaml")
MATRIX_USER="${MATRIX_CALENDAR_DEV_USER:-calendar}"
MATRIX_PASSWORD="${MATRIX_CALENDAR_DEV_PASSWORD:-calendar-dev-password}"
startup_failure_stage=untracked

emit_startup_failure_marker() {
  local exit_code="$1"
  if [[ "$exit_code" == 0 ]]; then
    return 0
  fi
  case "$startup_failure_stage" in
    docker-preflight|curl-preflight|homeserver-probe|homeserver-generate|fixture-permission|registration-update|uid991-access-assertion|synapse-compose-start)
      node "$ROOT_DIR/dev/synapse-startup-diagnostic.mjs" \
        --stage-failure "$startup_failure_stage" "$exit_code" 2>/dev/null || true
      ;;
  esac
}
trap 'emit_startup_failure_marker "$?"' EXIT

startup_failure_stage=docker-preflight
command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }
startup_failure_stage=curl-preflight
command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }

echo "==> Preparing Synapse configuration"
startup_failure_stage=homeserver-probe
if ! "${COMPOSE[@]}" run --rm --entrypoint sh synapse -c 'test -f /data/homeserver.yaml' >/dev/null 2>&1; then
  startup_failure_stage=homeserver-generate
  "${COMPOSE[@]}" run --rm synapse generate >/dev/null 2>&1
fi

echo "==> Registering the synthetic local application service"
startup_failure_stage=fixture-permission
chmod 0644 "$ROOT_DIR/dev/appservice-calendar-contract.yaml" >/dev/null 2>&1
startup_failure_stage=registration-update
"${COMPOSE[@]}" run --rm --entrypoint python synapse -c '
import os
import sys
import tempfile
import yaml

sys.path.insert(0, "/data")
from synapse_contract_config import configure_contract_login_limits

config_path = "/data/homeserver.yaml"
registration = "/data/appservice-calendar-contract.yaml"
with open(config_path, encoding="utf-8") as config_file:
    config = yaml.safe_load(config_file)
if not os.path.isfile(registration):
    raise SystemExit("synthetic application-service registration is missing")
registrations = config.setdefault("app_service_config_files", [])
if registration not in registrations:
    registrations.append(registration)
configure_contract_login_limits(config)
directory = os.path.dirname(config_path)
with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=directory, delete=False) as output:
    yaml.safe_dump(config, output, sort_keys=False)
    temporary_path = output.name
os.chown(temporary_path, 991, 991)
os.replace(temporary_path, config_path)
' >/dev/null 2>&1

echo "==> Verifying Synapse can read its config and registration"
startup_failure_stage=uid991-access-assertion
"${COMPOSE[@]}" run --rm --user 991:991 --entrypoint sh synapse -c \
  'test -r /data/homeserver.yaml && test -w /data/homeserver.yaml && test -w /data && test -r /data/appservice-calendar-contract.yaml' \
  >/dev/null 2>&1

echo "==> Starting Synapse"
startup_failure_stage=synapse-compose-start
"${COMPOSE[@]}" up -d --force-recreate synapse >/dev/null 2>&1

echo "==> Waiting for Synapse"
startup_failure_stage=readiness
for _ in $(seq 1 90); do
  if curl --silent --fail http://localhost:8008/_matrix/client/versions >/dev/null; then
    break
  fi
  sleep 1
done
if ! curl --silent --fail http://localhost:8008/_matrix/client/versions >/dev/null; then
  synapse_status="$(
    node -e '
        const { spawnSync } = require("node:child_process");
        const compose = spawnSync(
          "docker",
          ["compose", "-f", process.argv[1], "ps", "--all", "--format", "json", "synapse"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        );
        const states = new Set(["created", "running", "paused", "restarting", "removing", "exited", "dead"]);
        const healthStates = new Set(["starting", "healthy", "unhealthy"]);
        const emit = (reason, state = "unavailable", health = "unavailable") => {
          process.stdout.write(`reason=${reason} state=${state} health=${health}`);
        };
        if (compose.error || compose.status !== 0) {
          emit("compose-query-failed");
          process.exit(0);
        }
        try {
          const output = compose.stdout.trim();
          const entries = output
            ? output.split(/\r?\n/).flatMap((line) => {
                const parsed = JSON.parse(line);
                return Array.isArray(parsed) ? parsed : [parsed];
              })
            : [];
          const service = entries.find((entry) => entry?.Service === "synapse");
          if (!service) {
            emit("synapse-not-listed");
            process.exit(0);
          }
          if (!states.has(service.State)) {
            emit("state-unrecognized");
            process.exit(0);
          }
          const health = service.Health
            ? healthStates.has(service.Health) ? service.Health : "unavailable"
            : "not-reported";
          if (service.Health && health === "unavailable") {
            emit("health-unrecognized", service.State);
            process.exit(0);
          }
          emit("status-valid", service.State, health);
        } catch {
          emit("status-json-invalid");
        }
      ' "$ROOT_DIR/dev/compose.yaml" 2>/dev/null || printf 'reason=compose-query-failed state=unavailable health=unavailable'
  )"
  echo "Synapse readiness failed; service state/health: $synapse_status" >&2
  if ! synapse_diagnostic="$(
    "${COMPOSE[@]}" logs --no-color synapse 2>/dev/null |
      node "$ROOT_DIR/dev/synapse-startup-diagnostic.mjs" "$ROOT_DIR/dev/compose.yaml" 2>/dev/null
  )"; then
    synapse_diagnostic='category=unclassified exit_code=unavailable oom=unavailable'
  fi
  echo "Synapse startup diagnostic: $synapse_diagnostic" >&2
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
