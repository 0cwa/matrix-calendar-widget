# Example values for dev and PR deployments. Replace the non-routable Matrix and
# Element placeholders with endpoints owned by the deployment operator.

matrix-calendar-widget:
  settings:
    hostname: matrix.example.invalid

  env:
    - name: REACT_APP_BOT_USER_ID
      value: '@calendar:matrix.example.invalid'
    - name: REACT_APP_DISPLAY_ALL_MEETINGS
      value: 'true'

matrix-calendar-server:
  settings:
    widgetUrl: https://matrix-calendar-widget.example.invalid

    additionalEnv:
      - name: HOMESERVER_URL
        value: 'https://matrix.example.invalid'
      - name: MATRIX_LINK_SHARE
        value: 'https://element.example.invalid/#/'
      - name: BOT_DISPLAYNAME
        value: 'Matrix Calendar Bot${PR_SUFFIX}'
      - name: CALENDAR_ROOM_NAME
        value: 'Matrix Calendar${PR_SUFFIX}'
      - name: LOG_LEVEL
        value: 'info'
      - name: AUTO_DELETION_OFFSET
        value: '60'
      - name: ENABLE_CRYPTO
        value: 'true'
