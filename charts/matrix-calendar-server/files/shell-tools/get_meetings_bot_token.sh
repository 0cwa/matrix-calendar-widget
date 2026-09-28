#!/bin/sh

# Get the login token
if ! LOGIN_RESPONSE=$(curl -s -w '\n%{http_code}' -X POST -H "Content-Type: application/json" -d "{\"type\":\"m.login.password\",\"user\":\"${USERTOCREATE}\",\"password\":\"${BOT_PASSWORD}\"}" "${HOMESERVER}/_matrix/client/r0/login"); then
    echo "Login failed. Check your credentials and try again." >&2
    exit 1
fi

HTTP_STATUS=$(printf '%s\n' "$LOGIN_RESPONSE" | tail -n 1)
TOKEN_RESPONSE=$(printf '%s\n' "$LOGIN_RESPONSE" | sed '$d')

# Extract the access token from the response
ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

if [ "$HTTP_STATUS" != "200" ] || [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "null" ]; then
    echo "Login failed. Check your credentials and try again." >&2
    exit 1
fi

echo "Login successful."

# Add it to the env file so it can be used by the bot
echo "ACCESS_TOKEN=$ACCESS_TOKEN" > "${WORK_DIR:-/work-dir}/.env"
