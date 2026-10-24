#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_PREBUILT="${MATRIX_CALENDAR_LOCAL_PREBUILT_REHEARSAL:-false}"
LOCAL_RUN_NUMBER=0
LOCAL_RUN_LABEL='io.matrix-calendar-widget.local-rehearsal'
LOCAL_PULL_ARGS=()
LOCAL_VALIDATION_COMPOSE=()
DEV_LOOPBACK_HOST=localhost
startup_failure_stage=untracked

emit_startup_failure_marker() {
  local exit_code="$1"
  if [[ "$exit_code" == 0 ]]; then
    return 0
  fi
  case "$startup_failure_stage" in
    configuration-preflight|docker-preflight|curl-preflight|homeserver-probe|homeserver-generate|fixture-permission|registration-update|uid991-access-assertion|synapse-compose-start)
      node "$ROOT_DIR/dev/synapse-startup-diagnostic.mjs" \
        --stage-failure "$startup_failure_stage" "$exit_code" 2>/dev/null || true
      ;;
  esac
}
trap 'emit_startup_failure_marker "$?"' EXIT

if [[ "$LOCAL_PREBUILT" == true ]]; then
  if [[ "${ELEMENT_ACCEPTANCE_PRIVATE_UI:-false}" != false ]]; then
    echo 'Private UI acceptance is not available in the local prebuilt rehearsal' >&2
    exit 2
  fi
  startup_failure_stage=configuration-preflight
  if ! node --input-type=module - "$ROOT_DIR" <<'NODE'
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const { loadElementAcceptanceOverrides } = await import(
  pathToFileURL(`${root}/dev/element-acceptance-overrides.mjs`).href
);
try {
  const settings = loadElementAcceptanceOverrides(process.env, root);
  if (!settings.localPrebuilt) process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
NODE
  then
    echo 'Local prebuilt rehearsal inputs are invalid' >&2
    exit 2
  fi
  startup_failure_stage=untracked
  COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:?COMPOSE_PROJECT_NAME is required}"
  MATRIX_CALENDAR_LOCAL_COMPOSE_OVERRIDE_FILE="${MATRIX_CALENDAR_LOCAL_COMPOSE_OVERRIDE_FILE:?local Compose override is required}"
  COMPOSE=(
    docker compose -p "$COMPOSE_PROJECT_NAME"
    --env-file "$MATRIX_CALENDAR_LOCAL_COMPOSE_ENV_FILE"
    -f "$ROOT_DIR/dev/compose.yaml"
    -f "$ROOT_DIR/dev/element-acceptance.compose.yaml"
    -f "$ROOT_DIR/dev/element-acceptance-reminder.compose.yaml"
    -f "$ROOT_DIR/dev/element-acceptance-local-prebuilt.compose.yaml"
    -f "$MATRIX_CALENDAR_LOCAL_COMPOSE_OVERRIDE_FILE"
  )
  LOCAL_VALIDATION_COMPOSE=("${COMPOSE[@]}")
  LOCAL_PULL_ARGS=(--pull never)
  DEV_LOOPBACK_HOST=127.0.0.1
else
  if [[ "$LOCAL_PREBUILT" != false ]]; then
    echo 'MATRIX_CALENDAR_LOCAL_PREBUILT_REHEARSAL must be true or false' >&2
    exit 2
  fi
  case "${ELEMENT_ACCEPTANCE_PRIVATE_UI:-false}" in
    false) COMPOSE=(docker compose -f "$ROOT_DIR/dev/compose.yaml") ;;
    true)
      private_ui_env_file="${ELEMENT_ACCEPTANCE_PRIVATE_UI_ENV_FILE:-}"
      if [[ -z "$private_ui_env_file" || ! -f "$private_ui_env_file" || -L "$private_ui_env_file" ]]; then
        echo 'Private UI acceptance environment is unavailable' >&2
        exit 2
      fi
      COMPOSE=(
        docker compose
        --env-file "$private_ui_env_file"
        -f "$ROOT_DIR/dev/compose.yaml"
        -f "$ROOT_DIR/dev/element-acceptance-private-ui-tls.compose.yaml"
      )
      ;;
    *)
      echo 'ELEMENT_ACCEPTANCE_PRIVATE_UI must be true or false' >&2
      exit 2
      ;;
  esac
fi

if [[ "$LOCAL_PREBUILT" == true ]]; then
  if ! local_compose_model="$(
    ELEMENT_ACCEPTANCE_BOT_ACCESS_TOKEN=local-preflight-token \
      ELEMENT_ACCEPTANCE_ROOM_BINDING='[]' \
      ELEMENT_ACCEPTANCE_REMINDER_BOOTSTRAP_PASSWORD=local-preflight-secret \
      ELEMENT_ACCEPTANCE_REMINDER_APP_PASSWORD=local-preflight-secret \
      ELEMENT_ACCEPTANCE_REMINDER_DATABASE_URL=postgresql://local:local@postgres:5432/matrix_calendar_test \
      ELEMENT_ACCEPTANCE_REMINDER_RESTORE_DATABASE_URL=postgresql://local:local@postgres:5432/matrix_calendar_restored \
      ELEMENT_ACCEPTANCE_RESTORE_VOLUME_NAME="${COMPOSE_PROJECT_NAME}_radicale-restore" \
      ROOM_CALENDAR_PRINCIPAL_MODE=bot-account \
      MATRIX_APPLICATION_SERVICE_TOKEN= \
      MATRIX_APPLICATION_SERVICE_USER_ID= \
      "${LOCAL_VALIDATION_COMPOSE[@]}" config --format json 2>/dev/null
  )"; then
    echo 'Local prebuilt Compose configuration could not be rendered' >&2
    exit 2
  fi
  if ! printf '%s\n' "$local_compose_model" |
    MATRIX_CALENDAR_LOCAL_PREBUILT_REHEARSAL=true \
      ELEMENT_ACCEPTANCE_LOCAL_RUN_ID="$ELEMENT_ACCEPTANCE_LOCAL_RUN_ID" \
      COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" \
      node "$ROOT_DIR/dev/validate-element-acceptance-compose.mjs" \
        >/dev/null 2>&1; then
    echo 'Local prebuilt Compose ownership or loopback validation failed' >&2
    exit 2
  fi
fi

compose_run() {
  if [[ "$LOCAL_PREBUILT" == true ]]; then
    LOCAL_RUN_NUMBER=$((LOCAL_RUN_NUMBER + 1))
    "${COMPOSE[@]}" run "${LOCAL_PULL_ARGS[@]}" \
      --label "$LOCAL_RUN_LABEL=${ELEMENT_ACCEPTANCE_LOCAL_RUN_ID}" \
      --name "${COMPOSE_PROJECT_NAME}-local-${ELEMENT_ACCEPTANCE_LOCAL_RUN_ID}-${LOCAL_RUN_NUMBER}" \
      "$@"
  else
    "${COMPOSE[@]}" run "$@"
  fi
}

compose_up() {
  if [[ "$LOCAL_PREBUILT" == true ]]; then
    "${COMPOSE[@]}" up "${LOCAL_PULL_ARGS[@]}" --no-build "$@"
  else
    "${COMPOSE[@]}" up "$@"
  fi
}
MATRIX_USER="${MATRIX_CALENDAR_DEV_USER:-calendar}"
MATRIX_PASSWORD="${MATRIX_CALENDAR_DEV_PASSWORD:-calendar-dev-password}"
CONTRACT_APPSERVICE_REGISTRATION="${MATRIX_CALENDAR_DEV_APPSERVICE_REGISTRATION:-enabled}"

case "$CONTRACT_APPSERVICE_REGISTRATION" in
  enabled|disabled) ;;
  *)
    echo "MATRIX_CALENDAR_DEV_APPSERVICE_REGISTRATION must be enabled or disabled" >&2
    exit 2
    ;;
esac

startup_failure_stage=docker-preflight
command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }
startup_failure_stage=curl-preflight
command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }

echo "==> Preparing Synapse configuration"
startup_failure_stage=homeserver-probe
if ! compose_run --rm --entrypoint sh synapse -c 'test -f /data/homeserver.yaml' >/dev/null 2>&1; then
  startup_failure_stage=homeserver-generate
  compose_run --rm synapse generate >/dev/null 2>&1
fi

if [[ "$CONTRACT_APPSERVICE_REGISTRATION" == enabled ]]; then
  echo "==> Registering the synthetic local application service"
  startup_failure_stage=fixture-permission
  chmod 0644 "$ROOT_DIR/dev/appservice-calendar-contract.yaml" >/dev/null 2>&1
else
  echo "==> Removing the synthetic local application-service registration"
fi
startup_failure_stage=registration-update
compose_run --rm \
  -e "MATRIX_CALENDAR_DEV_APPSERVICE_REGISTRATION=$CONTRACT_APPSERVICE_REGISTRATION" \
  --entrypoint python synapse -c '
import os
import sys
import tempfile
import yaml

sys.path.insert(0, "/data")
from synapse_contract_config import (
    configure_contract_appservice_registration,
    configure_contract_login_limits,
)

config_path = "/data/homeserver.yaml"
registration = "/data/appservice-calendar-contract.yaml"
with open(config_path, encoding="utf-8") as config_file:
    config = yaml.safe_load(config_file)
registration_mode = os.environ.get("MATRIX_CALENDAR_DEV_APPSERVICE_REGISTRATION")
if registration_mode == "enabled" and not os.path.isfile(registration):
    raise SystemExit("synthetic application-service registration is missing")
configure_contract_appservice_registration(config, registration, registration_mode)
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
if [[ "$CONTRACT_APPSERVICE_REGISTRATION" == enabled ]]; then
  compose_run --rm --user 991:991 --entrypoint sh synapse -c \
    'test -r /data/homeserver.yaml && test -w /data/homeserver.yaml && test -w /data && test -r /data/appservice-calendar-contract.yaml' \
    >/dev/null 2>&1
else
  compose_run --rm --user 991:991 --entrypoint sh synapse -c \
    'test -r /data/homeserver.yaml && test -w /data/homeserver.yaml && test -w /data' \
    >/dev/null 2>&1
fi

echo "==> Starting Synapse"
startup_failure_stage=synapse-compose-start
compose_up -d --force-recreate synapse >/dev/null 2>&1

echo "==> Waiting for Synapse"
startup_failure_stage=readiness
for _ in $(seq 1 90); do
  if curl --silent --fail "http://${DEV_LOOPBACK_HOST}:8008/_matrix/client/versions" >/dev/null; then
    break
  fi
  sleep 1
done
if ! curl --silent --fail "http://${DEV_LOOPBACK_HOST}:8008/_matrix/client/versions" >/dev/null; then
  synapse_status="$(
    node -e '
        const { spawnSync } = require("node:child_process");
        const composeArgs = ["compose"];
        if (process.env.MATRIX_CALENDAR_LOCAL_PREBUILT_REHEARSAL === "true") {
          composeArgs.push("-p", process.env.COMPOSE_PROJECT_NAME ?? "");
        }
        composeArgs.push("-f", process.argv[1], "ps", "--all", "--format", "json", "synapse");
        const compose = spawnSync("docker", composeArgs, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
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
    "http://${DEV_LOOPBACK_HOST}:8008/_matrix/client/v3/login" >/dev/null; then
  echo "==> Registering dev Matrix user @$MATRIX_USER:localhost"
  printf '%s' "$MATRIX_PASSWORD" |
    "${COMPOSE[@]}" exec -T synapse register_new_matrix_user \
      -c /data/homeserver.yaml \
      -u "$MATRIX_USER" \
      --password-file /dev/stdin \
      -a \
      "http://${DEV_LOOPBACK_HOST}:8008"
else
  echo "==> Dev Matrix user already exists"
fi

echo "==> Building the project-owned OpenID-only Radicale image"
if [[ "$LOCAL_PREBUILT" == true ]]; then
  echo "Using preloaded Radicale image ${ELEMENT_ACCEPTANCE_RADICALE_IMAGE}"
else
  "${COMPOSE[@]}" build radicale
fi

echo "==> Starting OpenID-authenticated Radicale"
compose_up -d radicale

echo "==> Minting a short-lived OpenID proof for the local Synapse fixture"
OPENID_CREDENTIAL="$(node "$ROOT_DIR/dev/mint-openid-credential.mjs")"

echo "==> Waiting for Radicale"
for _ in $(seq 1 60); do
  if curl --silent --fail --max-time 3 -u "$MATRIX_USER:$OPENID_CREDENTIAL" "http://${DEV_LOOPBACK_HOST}:5232/" >/dev/null; then
    break
  fi
  sleep 1
done
curl --silent --fail --max-time 3 -u "$MATRIX_USER:$OPENID_CREDENTIAL" "http://${DEV_LOOPBACK_HOST}:5232/" >/dev/null

cat <<EOF
Development services are ready.

Matrix homeserver: http://${DEV_LOOPBACK_HOST}:8008
Matrix user:       @$MATRIX_USER:localhost

Radicale:          http://${DEV_LOOPBACK_HOST}:5232
CalDAV username:   $MATRIX_USER
CalDAV auth:       short-lived Matrix OpenID proof

The local fixture password is used only to create/sign in the development
Synapse account and mint that proof. It is never sent to Radicale or the
calendar gateway, and the script does not print it or the proof.
EOF
