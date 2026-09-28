#!/bin/sh

ENV_FILE="${WORK_DIR:-/work-dir}/.env"
umask 077
TEMP_ENV_FILE=
cleanup_temp_file() {
    if [ -n "$TEMP_ENV_FILE" ]; then
        rm -f "$TEMP_ENV_FILE" 2>/dev/null
    fi
}
trap cleanup_temp_file EXIT
trap 'exit 1' HUP INT TERM

if ! rm -f "$ENV_FILE" 2>/dev/null; then
    echo "Login failed. Check your credentials and try again." >&2
    exit 1
fi

# Get the login token
if ! LOGIN_RESPONSE=$(curl -s -w '\n%{http_code}' -X POST -H "Content-Type: application/json" -d "{\"type\":\"m.login.password\",\"user\":\"${USERTOCREATE}\",\"password\":\"${BOT_PASSWORD}\"}" "${HOMESERVER}/_matrix/client/r0/login"); then
    echo "Login failed. Check your credentials and try again." >&2
    exit 1
fi

HTTP_STATUS=$(printf '%s\n' "$LOGIN_RESPONSE" | tail -n 1)
TOKEN_RESPONSE=$(printf '%s\n' "$LOGIN_RESPONSE" | sed '$d')

# Extract the access token from the response
if ! ACCESS_TOKEN=$(printf '%s' "$TOKEN_RESPONSE" | python3 -c 'import json, sys; payload = json.load(sys.stdin); token = payload.get("access_token"); sys.stdout.write(token if isinstance(token, str) and token and "\n" not in token and "\r" not in token else "")' 2>/dev/null); then
    echo "Login failed. Check your credentials and try again." >&2
    exit 1
fi

if [ "$HTTP_STATUS" != "200" ] || [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "null" ]; then
    echo "Login failed. Check your credentials and try again." >&2
    exit 1
fi

TEMP_ENV_FILE=$(mktemp "${ENV_FILE}.tmp.XXXXXX" 2>/dev/null) || {
    echo "Login failed. Check your credentials and try again." >&2
    exit 1
}

# Add it to a private temporary env file, then atomically replace the target.
if ! printf 'ACCESS_TOKEN=%s\n' "$ACCESS_TOKEN" > "$TEMP_ENV_FILE" 2>/dev/null ||
    ! chmod 600 "$TEMP_ENV_FILE" 2>/dev/null ||
    ! mv -f "$TEMP_ENV_FILE" "$ENV_FILE" 2>/dev/null; then
    rm -f "$ENV_FILE" 2>/dev/null
    echo "Login failed. Check your credentials and try again." >&2
    exit 1
fi
TEMP_ENV_FILE=

echo "Login successful."
