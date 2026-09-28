#!/bin/sh

ENV_FILE="${WORK_DIR:-/work-dir}/.env"
if ! rm -f "$ENV_FILE"; then
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

if [ "$HTTP_STATUS" != "200" ] || [ -z "$ACCESS_TOKEN" ]; then
    echo "Login failed. Check your credentials and try again." >&2
    exit 1
fi

echo "Login successful."

# Add it to the env file so it can be used by the bot
if ! printf 'ACCESS_TOKEN=%s\n' "$ACCESS_TOKEN" > "$ENV_FILE" 2>/dev/null; then
    rm -f "$ENV_FILE"
    echo "Login failed. Check your credentials and try again." >&2
    exit 1
fi
