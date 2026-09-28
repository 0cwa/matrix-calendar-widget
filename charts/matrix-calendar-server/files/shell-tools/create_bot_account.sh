#!/bin/sh
while [ "$(curl -k -sw '%{http_code}' "$HOMESERVER"/_matrix/client/versions -o /dev/null)" -ne 200 ]; do
  sleep 1;
done
response=$(curl -k --write-out '%{http_code}' --silent --output /dev/null -X GET --header 'Accept: application/json' "$HOMESERVER/_matrix/client/r0/register/available?username=$USERTOCREATE")
if [ "$response" = 400 ]; then
    echo "Bot user already exists"
else
  case "$BOT_PASSWORD" in
    *[![:space:]]*) ;;
    *)
      echo "Failed to create Matrix bot account" >&2
      exit 1
      ;;
  esac
  echo "Will create User $USERTOCREATE on $HOMESERVER"
  PASSWORD_INPUT=$BOT_PASSWORD
  unset BOT_PASSWORD
  if ! printf '%s' "$PASSWORD_INPUT" | register_new_matrix_user -a -u "$USERTOCREATE" --password-file /dev/stdin -c /data/homeserver.yaml "$HOMESERVER" >/dev/null 2>&1; then
    unset PASSWORD_INPUT
    echo "Failed to create Matrix bot account" >&2
    exit 1
  fi
  unset PASSWORD_INPUT
fi
exit 0
