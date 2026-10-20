#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
rendered=$(helm template health-probe-test "$repo_root/charts/matrix-calendar-server" \
  --show-only templates/deployment.yaml)
connection_test=$(helm template health-probe-test "$repo_root/charts/matrix-calendar-server" \
  --show-only templates/tests/test-connection.yaml)

printf '%s\n__HEALTH_TEST_CONNECTION__\n%s\n' "$rendered" "$connection_test" | python3 -c '
import re
import sys

deployment, connection_test = sys.stdin.read().split("__HEALTH_TEST_CONNECTION__", 1)
expectations = {
    "readinessProbe": "/v1/health",
    "livenessProbe": "/v1/health/live",
}

for probe, expected_path in expectations.items():
    match = re.search(
        rf"(?ms)^ {{10}}{probe}:\n(.*?)(?=^ {{10}}[A-Za-z][A-Za-z0-9]*:|\Z)",
        deployment,
    )
    if not match:
        raise SystemExit(f"rendered deployment is missing {probe}")
    path = re.search(r"(?m)^\s+path:\s*(\S+)\s*$", match.group(1))
    if not path or path.group(1) != expected_path:
        actual = path.group(1) if path else "missing"
        raise SystemExit(
            f"{probe} rendered path {actual!r}; expected {expected_path!r}"
        )

if not re.search(
    r"(?m)^\s*args:\s*\[\x27[^\x27]*/v1/health\x27\]\s*$",
    connection_test,
):
    raise SystemExit("rendered chart connection test must use /v1/health")

print("Helm rendered liveness, readiness, and connection-test paths are correct.")
'
