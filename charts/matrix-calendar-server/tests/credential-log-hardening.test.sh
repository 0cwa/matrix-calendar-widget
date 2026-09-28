#!/bin/sh
set -eu

chart_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
temp_dir=$(mktemp -d)
real_chmod=$(command -v chmod)
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
      malformed-with-token) printf '%s\n200' 'not-json {"access_token":"access-token-canary"}' ;;
      missing) printf '%s\n200' '{"user_id":"@bot:example.org"}' ;;
      null-token) printf '%s\n200' '{"access_token":"null"}' ;;
      success) printf '%s\n200' '{"access_token":"access-token-canary","device_id":"device-canary"}' ;;
      *) exit 2 ;;
    esac
    ;;
  *) printf 'unexpected fake curl request\n' >&2; exit 1 ;;
esac
EOF
cat > "$temp_dir/bin/chmod" <<'EOF'
#!/bin/sh
if [ "${CHMOD_FAILURE:-0}" = 1 ]; then
  exit 1
fi
exec "$REAL_CHMOD" "$@"
EOF
cat > "$temp_dir/bin/register_new_matrix_user" <<'EOF'
#!/bin/sh
printf '%s\n' 'registration access-token-canary password-canary' >&1
printf '%s\n' 'registration stderr canary access-token-canary password-canary' >&2
[ "${REGISTRATION_FAILURE:-0}" = 0 ]
EOF
chmod +x "$temp_dir/bin/curl" "$temp_dir/bin/register_new_matrix_user" "$temp_dir/bin/chmod"

assert_no_credentials() {
  output=$1
  for canary in access-token-canary device-canary credential\ response\ canary malformed\ response\ canary password-canary; do
    if printf '%s' "$output" | grep -F "$canary" >/dev/null; then
      printf 'credential material leaked to output: %s\n' "$canary" >&2
      return 1
    fi
  done
}

assert_no_temp_files() {
  for temp_file in "$temp_dir/work"/.env.tmp.*; do
    if [ -e "$temp_file" ]; then
      printf 'temporary credential file remains: %s\n' "$temp_file" >&2
      return 1
    fi
  done
}

success_output=$(PATH="$temp_dir/bin:$PATH" REAL_CHMOD="$real_chmod" WORK_DIR="$temp_dir/work" \
  USERTOCREATE=bot HOMESERVER=https://matrix.example BOT_PASSWORD=password-canary \
  sh "$chart_dir/files/shell-tools/get_meetings_bot_token.sh" 2>&1)
assert_no_credentials "$success_output"
if [ "$success_output" != 'Login successful.' ]; then
  printf 'successful login produced unexpected output\n' >&2
  exit 1
fi
if ! printf 'ACCESS_TOKEN=%s\n' 'access-token-canary' | cmp - "$temp_dir/work/.env"; then
  printf 'successful login wrote an unexpected env file\n' >&2
  exit 1
fi
if [ "$(stat -c '%a' "$temp_dir/work/.env")" != 600 ]; then
  printf 'credential env file does not have mode 0600\n' >&2
  exit 1
fi
assert_no_temp_files

run_login_failure() {
  login_case=$1
  printf '%s\n' 'ACCESS_TOKEN=stale-token-canary' > "$temp_dir/work/.env"
  if failure_output=$(PATH="$temp_dir/bin:$PATH" REAL_CHMOD="$real_chmod" WORK_DIR="$temp_dir/work" LOGIN_CASE="$login_case" \
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
  assert_no_temp_files
}

run_login_failure network
run_login_failure http
run_login_failure malformed
run_login_failure malformed-with-token
run_login_failure missing
run_login_failure null-token

printf '%s\n' 'ACCESS_TOKEN=stale-token-canary' > "$temp_dir/work/.env"
if write_failure=$(PATH="$temp_dir/bin:$PATH" REAL_CHMOD="$real_chmod" CHMOD_FAILURE=1 \
  WORK_DIR="$temp_dir/work" USERTOCREATE=bot HOMESERVER=https://matrix.example BOT_PASSWORD=password-canary \
  sh "$chart_dir/files/shell-tools/get_meetings_bot_token.sh" 2>&1); then
  printf 'credential file write failure unexpectedly succeeded\n' >&2
  exit 1
fi
assert_no_credentials "$write_failure"
grep -Fx 'Login failed. Check your credentials and try again.' <<EOF >/dev/null
$write_failure
EOF
if [ -e "$temp_dir/work/.env" ]; then
  printf 'credential env file remains after write failure\n' >&2
  exit 1
fi
assert_no_temp_files

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
