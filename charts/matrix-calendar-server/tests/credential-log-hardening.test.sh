#!/bin/sh
set -eu

chart_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT HUP INT TERM

mkdir -p "$temp_dir/bin" "$temp_dir/work"
cat > "$temp_dir/bin/curl" <<'EOF'
#!/bin/sh
case "$*" in
  *"/_matrix/client/versions"*) printf 200 ;;
  *"/_matrix/client/r0/register/available"*) printf 200 ;;
  *"/_matrix/client/r0/login"*)
    case "${LOGIN_CASE:-success}" in
      network) exit 7 ;;
      http) printf '%s\n403' '{"errcode":"M_FORBIDDEN","error":"credential response canary","access_token":"access-token-canary"}' ;;
      malformed) printf '%s\n200' 'malformed response canary' ;;
      missing) printf '%s\n200' '{"user_id":"@bot:example.org"}' ;;
      success) printf '%s\n200' '{"access_token":"access-token-canary","device_id":"device-canary"}' ;;
      *) exit 2 ;;
    esac
    ;;
  *) printf 'unexpected fake curl request\n' >&2; exit 1 ;;
esac
EOF
cat > "$temp_dir/bin/register_new_matrix_user" <<'EOF'
#!/bin/sh
printf '%s\n' 'registration access-token-canary password-canary' >&1
printf '%s\n' 'registration stderr canary access-token-canary password-canary' >&2
[ "${REGISTRATION_FAILURE:-0}" = 0 ]
EOF
chmod +x "$temp_dir/bin/curl" "$temp_dir/bin/register_new_matrix_user"

assert_no_credentials() {
  output=$1
  for canary in access-token-canary device-canary credential\ response\ canary malformed\ response\ canary password-canary; do
    if printf '%s' "$output" | grep -F "$canary" >/dev/null; then
      printf 'credential material leaked to output: %s\n' "$canary" >&2
      return 1
    fi
  done
}

success_output=$(PATH="$temp_dir/bin:$PATH" WORK_DIR="$temp_dir/work" \
  USERTOCREATE=bot HOMESERVER=https://matrix.example BOT_PASSWORD=password-canary \
  sh "$chart_dir/files/shell-tools/get_meetings_bot_token.sh" 2>&1)
assert_no_credentials "$success_output"
grep -Fx 'Login successful.' <<EOF >/dev/null
$success_output
EOF
grep -Fx 'ACCESS_TOKEN=access-token-canary' "$temp_dir/work/.env" >/dev/null

run_login_failure() {
  login_case=$1
  rm -f "$temp_dir/work/.env"
  if failure_output=$(PATH="$temp_dir/bin:$PATH" WORK_DIR="$temp_dir/work" LOGIN_CASE="$login_case" \
    USERTOCREATE=bot HOMESERVER=https://matrix.example BOT_PASSWORD=password-canary \
    sh "$chart_dir/files/shell-tools/get_meetings_bot_token.sh" 2>&1); then
    printf 'login case unexpectedly succeeded: %s\n' "$login_case" >&2
    return 1
  fi
  assert_no_credentials "$failure_output"
  grep -Fx 'Login failed. Check your credentials and try again.' <<EOF >/dev/null
$failure_output
EOF
  if [ -e "$temp_dir/work/.env" ]; then
    printf 'login case wrote credentials after failure: %s\n' "$login_case" >&2
    return 1
  fi
}

run_login_failure network
run_login_failure http
run_login_failure malformed
run_login_failure missing

account_output=$(PATH="$temp_dir/bin:$PATH" USERTOCREATE=bot HOMESERVER=https://matrix.example \
  BOT_PASSWORD=password-canary sh "$chart_dir/files/shell-tools/create_bot_account.sh" 2>&1)
assert_no_credentials "$account_output"

if account_failure=$(PATH="$temp_dir/bin:$PATH" REGISTRATION_FAILURE=1 USERTOCREATE=bot HOMESERVER=https://matrix.example \
  BOT_PASSWORD=password-canary sh "$chart_dir/files/shell-tools/create_bot_account.sh" 2>&1); then
  printf 'registration failure unexpectedly succeeded\n' >&2
  exit 1
fi
assert_no_credentials "$account_failure"
grep -Fx 'Failed to create Matrix bot account' <<EOF >/dev/null
$account_failure
EOF

if awk '/name: getbottoken/{in_token=1} in_token && /- name:/{if ($0 !~ /name: getbottoken/) exit} in_token && /-x/{found=1} END{exit !found}' "$chart_dir/templates/deployment.yaml"; then
  printf 'deployment template still enables shell xtrace\n' >&2
  exit 1
fi

printf 'credential log hardening success and failure paths passed\n'
