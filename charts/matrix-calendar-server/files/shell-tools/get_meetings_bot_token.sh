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

# Serialize the body before the curl pipeline so POSIX sh can check Python's
# status independently of curl's status.
if ! LOGIN_PAYLOAD=$(python3 -c 'import json, os, sys; sys.stdout.write(json.dumps({"type": "m.login.password", "user": os.environ["USERTOCREATE"], "password": os.environ["BOT_PASSWORD"]}))' 2>/dev/null); then
    echo "Login failed. Check your credentials and try again." >&2
    exit 1
fi
unset BOT_PASSWORD

# Get the login token. The JSON body travels on stdin, not in curl's argv.
if ! LOGIN_RESPONSE=$(printf '%s' "$LOGIN_PAYLOAD" | curl -s -w '\n%{http_code}' -X POST -H "Content-Type: application/json" --data-binary @- "${HOMESERVER}/_matrix/client/r0/login"); then
    unset LOGIN_PAYLOAD
    echo "Login failed. Check your credentials and try again." >&2
    exit 1
fi
unset LOGIN_PAYLOAD

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
