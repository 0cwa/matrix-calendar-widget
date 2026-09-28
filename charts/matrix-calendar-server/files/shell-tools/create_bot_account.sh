#!/bin/sh
while [ "$(curl -k -sw '%{http_code}' "$HOMESERVER"/_matrix/client/versions -o /dev/null)" -ne 200 ]; do
  sleep 1;
done
response=$(curl -k --write-out '%{http_code}' --silent --output /dev/null -X GET --header 'Accept: application/json' "$HOMESERVER/_matrix/client/r0/register/available?username=$USERTOCREATE")
if [ "$response" = 400 ]; then
    echo "Bot user already exists"
else
  echo "Will create User $USERTOCREATE on $HOMESERVER"
  if ! register_new_matrix_user -a -u "$USERTOCREATE" -p "$BOT_PASSWORD" -c /data/homeserver.yaml "$HOMESERVER" >/dev/null 2>&1; then
    echo "Failed to create Matrix bot account" >&2
    exit 1
  fi
fi
exit 0
