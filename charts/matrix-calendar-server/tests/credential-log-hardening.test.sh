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
    if [ "${LOGIN_FAILURE:-0}" = 1 ]; then
      printf '%s' '{"errcode":"M_FORBIDDEN","error":"credential response canary","access_token":"null"}'
    else
      printf '%s' '{"access_token":"access-token-canary","device_id":"device-canary"}'
    fi
    ;;
  *) printf 'unexpected fake curl request\n' >&2; exit 1 ;;
esac
EOF
cat > "$temp_dir/bin/register_new_matrix_user" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$temp_dir/bin/curl" "$temp_dir/bin/register_new_matrix_user"

assert_no_credentials() {
  output=$1
  for canary in access-token-canary device-canary credential\ response\ canary password-canary; do
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

failure_output=$(PATH="$temp_dir/bin:$PATH" WORK_DIR="$temp_dir/work" LOGIN_FAILURE=1 \
  USERTOCREATE=bot HOMESERVER=https://matrix.example BOT_PASSWORD=password-canary \
  sh "$chart_dir/files/shell-tools/get_meetings_bot_token.sh" 2>&1)
assert_no_credentials "$failure_output"
grep -Fx 'Login failed. Check your credentials and try again.' <<EOF >/dev/null
$failure_output
EOF
grep -Fx 'ACCESS_TOKEN=null' "$temp_dir/work/.env" >/dev/null

account_output=$(PATH="$temp_dir/bin:$PATH" USERTOCREATE=bot HOMESERVER=https://matrix.example \
  BOT_PASSWORD=password-canary sh "$chart_dir/files/shell-tools/create_bot_account.sh" 2>&1)
assert_no_credentials "$account_output"

if awk '/name: getbottoken/{in_token=1} in_token && /- name:/{if ($0 !~ /name: getbottoken/) exit} in_token && /-x/{found=1} END{exit !found}' "$chart_dir/templates/deployment.yaml"; then
  printf 'deployment template still enables shell xtrace\n' >&2
  exit 1
fi

printf 'credential log hardening success and failure paths passed\n'
