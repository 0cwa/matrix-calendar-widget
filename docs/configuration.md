# Configuration

[Documentation](./README.md) · [Deployment](./deployment-docker.md) · [Room setup](./bot-calendar.md)

Use this reference to configure the widget, calendar gateway/bot, and optional
features. For a local development stack, start with the
[development guide](./DEVELOPMENT.md); for an operator deployment, follow the
[Docker guide](./deployment-docker.md) and its configuration preflight.

The authoritative server settings and validation rules are in
[`configuration.ts`](../matrix-calendar-server/src/configuration.ts). Supply
server secrets through deployment secret management. Widget settings are
public: never put access tokens, OpenID assertions, database URLs, or CalDAV
credentials in a `REACT_APP_*` variable or widget URL.

**On this page**

- [Choose the settings for your deployment](#choose-the-settings-for-your-deployment)
- [Widget container](#widget-container)
- [Server connections and widget URL](#server-connections-and-widget-url)
- [Room calendars and capability gates](#room-calendars-and-capability-gates)
- [Public calendar subscriptions](#public-calendar-subscriptions)
- [Private external CalDAV clients](#private-external-caldav-clients)
- [Application PostgreSQL stores](#application-postgresql-stores)
- [Request and response limits](#request-and-response-limits)
- [Matrix runtime and storage](#matrix-runtime-and-storage)
- [Inherited meeting configuration](#inherited-meeting-configuration)

## Choose the settings for your deployment

1. Configure the widget's public gateway URL and the server's Matrix/Radicale
   connections.
2. Select one room principal and configure room bindings if you need shared
   room calendars. Enable each capability separately.
3. Add application PostgreSQL only for the binding/reminder features you use.
4. Enable public subscriptions only after reviewing their public-data,
   ingress, logging, and recovery requirements.
5. Keep inherited meeting settings at their calendar-only defaults. A few
   legacy URL names are still required by startup validation; they are listed
   explicitly below.

## Widget container

The widget uses Vite with the historical `REACT_APP_` prefix retained for
compatibility. Local `.env` files belong in `matrix-calendar-widget/` and are
read when Vite starts. The container's widget-server base supplies runtime
configuration. Restart the relevant process after changing settings; see
[`vite.config.ts`](../matrix-calendar-widget/vite.config.ts) and the
[widget Dockerfile](../matrix-calendar-widget/Dockerfile).

| Setting                     | Purpose                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REACT_APP_API_BASE_URL`    | Public HTTPS origin of the calendar gateway, for example `https://calendar-api.example.org`. An explicit `meetings_bot_base_url` widget parameter takes precedence. |
| `REACT_APP_BOT_USER_ID`     | Matrix ID of the calendar bot, for example `@calendar:example.org`.                                                                                                 |
| `REACT_APP_HOME_SERVER_URL` | Public Matrix homeserver URL; also used in the container's content-security policy.                                                                                 |
| `REACT_APP_ELEMENT_URL`     | Element client URL used by the inherited toolkit integration.                                                                                                       |
| `REACT_APP_PRIMARY_COLOR`   | Optional theme color, for example `#b0131d`. Quote the value in a shell or `.env` file.                                                                             |

Additional theme options are documented by
[@matrix-widget-toolkit/mui](https://www.npmjs.com/package/@matrix-widget-toolkit/mui#customization).
Meeting-duration, breakout, and old meeting-list settings are listed in
[Inherited meeting configuration](#inherited-meeting-configuration).

## Server connections and widget URL

| Setting                                                    | Requirement and behavior                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOMESERVER_URL`                                           | Required Matrix Client-Server API URL, reachable by the server.                                                                                                                                                                                                           |
| `ACCESS_TOKEN`                                             | Required token for the normal calendar bot account. Keep it server-side; an application-service token is not a substitute.                                                                                                                                                |
| `MATRIX_OPENID_USERINFO_URL`                               | Optional fixed origin for widget OpenID userinfo verification only. Omission uses `HOMESERVER_URL`. No path, query, fragment, or credentials; HTTPS is required except for loopback HTTP in isolated tests. It does not change Client-Server requests or identity checks. |
| `RADICALE_URL`                                             | CalDAV service URL, required for calendar operations. It must point directly to the canonical endpoint; redirects are refused. Public feeds additionally require a private root origin.                                                                                   |
| `MEETINGWIDGET_URL`                                        | Required calendar widget URL. The inherited setting name is retained. Moderator setup requires an explicit safe `meetings_bot_base_url` and raw `matrix_room_id=$matrix_room_id` parameter.                                                                               |
| `MEETINGWIDGET_NAME`                                       | Widget display name; defaults to `Matrix Calendar`.                                                                                                                                                                                                                       |
| `MEETINGWIDGET_COCKPIT_URL`, `BREAKOUT_SESSION_WIDGET_URL` | **Still required by server startup validation**, despite the retired widget routes. Set these compatible URL placeholders as shown in the deployment examples; they do not enable meeting or breakout features.                                                           |

A calendar widget URL template looks like this. Preserve the literal `$`
placeholders with single quotes when using a shell or Compose environment file:

```sh
MEETINGWIDGET_URL='https://calendar.example.org/#/?meetings_bot_base_url=https://calendar-api.example.org&theme=$org.matrix.msc2873.client_theme&matrix_user_id=$matrix_user_id&matrix_display_name=$matrix_display_name&matrix_avatar_url=$matrix_avatar_url&matrix_room_id=$matrix_room_id&matrix_client_id=$org.matrix.msc2873.client_id&matrix_client_language=$org.matrix.msc2873.client_language&matrix_device_id=$org.matrix.msc3819.matrix_device_id&matrix_base_url=$org.matrix.msc4039.matrix_base_url'
```

The image's fallback gateway setting is not visible to server-side room setup.
Provide the gateway URL in `MEETINGWIDGET_URL` even if the image also sets it.
See the [deployment environment examples](../deploy/etke-sidecar.env.example)
for the remaining required URL values.

## Room calendars and capability gates

`ROOM_CALENDAR_PRINCIPAL_MODE` selects the server-side CalDAV and scheduled
reminder identity for the whole process:

| Mode                   | Identity and required configuration                                                                                                                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `appservice` (default) | Dedicated application-service identity from `MATRIX_APPLICATION_SERVICE_USER_ID` and `MATRIX_APPLICATION_SERVICE_TOKEN`. Its localpart must be one literal CalDAV home segment: 1–255 ASCII letters, digits, dots, underscores, equals signs, or hyphens; dot segments are refused. |
| `bot-account`          | Normal bot identity verified by the SDK client using `ACCESS_TOKEN`. Do not configure a separate claimed user ID.                                                                                                                                                                   |

Changing mode selects another Radicale home; it does not migrate calendars.
Neither mode enables capabilities by itself. See
[ADR041](./adrs/adr041-optional-normal-bot-account-for-room-operations.md) and
[principal provisioning](./deployment-docker.md#room-principal-and-collection-provisioning).

Each gate below defaults to `false`. Matrix membership, action-specific power,
and exact binding checks apply server-side on every relevant operation.

| Gate                                             | Enables                                                          | Additional requirements                                                                                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ROOM_CALENDAR_ACCESS_ENABLED`                   | Room calendar reads                                              | Valid selected principal, room/calendar binding, homeserver, and Radicale configuration.                                                                                         |
| `ROOM_CALENDAR_EVENT_WRITES_ENABLED`             | Room event create/update/delete                                  | Room access enabled and current event-write authorization.                                                                                                                       |
| `ROOM_CALENDAR_SETUP_ENABLED`                    | Exact `!calendar setup` command                                  | Current calendar-manage permission, setup actor allowlist, bot membership/widget power, verified unencrypted room, safe widget URL, and binding store for a new dynamic binding. |
| `MATRIX_CALENDAR_REMINDER_CONFIGURATION_ENABLED` | Supported room reminder settings                                 | Room access and app-owned reminder database. Does not start delivery.                                                                                                            |
| `ROOM_CALENDAR_REMINDER_DELIVERY_ENABLED`        | Scheduled whole-room mentions                                    | Room access, selected principal, binding, canonical supported alarm, reminder database, unencrypted room, and current mention permission.                                        |
| `ROOM_CALENDAR_ACTION_MESSAGES_ENABLED`          | Best-effort notices after successful room widget event mutations | An authorized successful mutation and safe Matrix sending. Failure does not roll back the CalDAV change.                                                                         |

### Bindings and setup actors

`ROOM_CALENDAR_BINDINGS` is an optional server-only JSON array. Each canonical
room ID and app-owned calendar ID must be unique:

```sh
ROOM_CALENDAR_BINDINGS='[{"roomId":"!room-hash:example.org","calendarId":"team-calendar"}]'
```

Static bindings require an existing matching collection. With
`MATRIX_CALENDAR_BINDING_DATABASE_URL` configured, moderator setup can reserve
and create a new binding. Static entries remain authoritative for their rooms;
only verified ready dynamic rows grant access. There is no runtime unlink or
rebind operation.

`ROOM_CALENDAR_SETUP_ALLOWED_ACTOR_SERVER_NAMES` optionally sets a comma-separated
allowlist such as `team.example.org,example.net:8448`. The default is the normal
bot account's Matrix server name. Wildcards are refused; validated ports and
bracketed IPv6 names are allowed. This list applies only to setup and does not
change ordinary read/write authorization. See [room setup](./bot-calendar.md)
and [ADR043](./adrs/adr043-moderator-room-calendar-setup.md).

### Reminder and action-message limits

Scheduled Matrix delivery currently targets the whole room with
`m.mentions.room`; selected-user targets and all-day local-time scheduling are
not part of the merged implementation. Encrypted or unknown room state is
refused. Claims and stable Matrix transaction IDs support retries but do not
guarantee exactly-once delivery. Scheduling assumes one server replica.

Action notices are separate from scheduled reminders. They suppress automatic
mentions and use the SDK encryption-aware path where available. The SDK's
60-second default request timeout is not overridden for notices. Review
[ADR028](./adrs/adr028-room-reminder-configuration-and-delivery.md) and
[ADR032](./adrs/adr032-room-calendar-action-messages.md) before enabling either
capability.

## Public calendar subscriptions

Public ICS subscriptions are opt-in per calendar. Anyone with the link can
read all canonical VEVENT data in that calendar, including details preserved
but not displayed by the widget. They provide read-only subscription access;
private external CalDAV editing is not implemented by this feature.

| Setting                                        | Requirement                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `MATRIX_CALENDAR_PUBLIC_FEED_ORIGIN`           | Externally reachable gateway origin routing `GET`/`HEAD /v1/public-calendar-feeds/<envelope>` to this server. No path, query, or fragment. |
| `MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY`      | Dedicated persistent random 32-byte key, encoded as 43 unpadded base64url characters. Never reuse Matrix/OpenID/CalDAV secrets.            |
| `MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY_FILE` | Alternative one-line key file mounted into the server. Set this **or** the inline key, never both.                                         |

Publication requires the origin and one key source; leave all three absent to
keep it disabled. Configure and verify the exact external route and access-log
redaction before enabling it. Keep `RADICALE_URL`, `/.token/`, and `/.sharing/`
network-private: a signed envelope can be decoded to its native bearer token,
so every public read must pass through the gateway's validation and limits.

A user must confirm publication in the widget; personal calendars require the
owner, and room calendars require current calendar-manage authorization. The
gateway serves Radicale's canonical bytes and rejects mixed
VEVENT/VTODO/VJOURNAL/VFREEBUSY responses on each read. Public reads do not
recheck Matrix membership; unpublish or revoke the native token to stop future
reads. Previously downloaded copies may remain. Unpublish before changing a
static room binding.

Back up the dedicated signing key with the matching complete Radicale `/data`
store. See [ADR045](./adrs/adr045-public-calendar-feeds.md),
[backup and recovery](./backup-recovery.md), and the
[public-feed deployment notes](./deployment-docker.md#public-calendar-feed-ingress-and-recovery).

## Private external CalDAV clients

This default-off capability is still in development and is not ready to enable
on a deployment. The server contracts and staged widget work do not yet qualify
an actual desktop calendar application or a live Matrix installation. Follow
[ADR046](./adrs/adr046-private-caldav-clients.md) for the current lifecycle,
security boundary, and validation gates.

Private clients use the existing public API origin for the scoped root DAV
route. Configure that origin to route `/<appID>/calendar/` to the calendar
gateway; keep Radicale and its native `/.sharing/` and `/.token/` endpoints
private. The capability stays disabled unless explicitly enabled with all
required settings:

| Setting                                            | Requirement                                                                                                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MATRIX_CALENDAR_PRIVATE_CLIENTS_ENABLED`          | Default `false`. Keep disabled until actual desktop-client, widget UI, combined public-feed, and deployment acceptance gates pass.                             |
| `MATRIX_CALENDAR_PRIVATE_CLIENT_ORIGIN`            | Existing externally reachable HTTPS API origin routing the private root DAV path. Origin only: no path, query, or fragment.                                    |
| `MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_URL`      | App-owned PostgreSQL URL for credential metadata and tombstones; separate schema from the reminder and binding stores. Never use Synapse's database.           |
| `MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_TLS_MODE` | `verify-full` by default; `trusted-private-network` is only for an explicitly controlled isolated database network.                                            |
| `MATRIX_CALENDAR_PRIVATE_CLIENT_EPOCH_KEY`         | Dedicated random 32-byte key encoded as 43 unpadded base64url characters. Keep it outside database backups and rotate it before opening ingress after restore. |
| `MATRIX_CALENDAR_PRIVATE_CLIENT_CALLBACK_KEY`      | Separate random 32-byte callback HMAC key in the same encoding. Its bytes must differ from the private epoch key and configured public-feed signing key.       |

Inject keys through deployment secret management. There are no key-file
settings for private clients. Never place these keys, Matrix credentials, or
the one-time CalDAV app password in widget configuration or browser persistence.
The private epoch key is independent from the public-feed signing key: restoring
private-client database state requires credential invalidation, while public
feed links use their own recovery policy.

## Application PostgreSQL stores

The stores are independently optional and use separate schemas. Omitting
one URL disables that store only; there is no fallback to the other URL. They
may share an application-owned database, but must never use Synapse's database.

| Purpose                               | Connection                                    | TLS mode                                           |
| ------------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| Dynamic room bindings                 | `MATRIX_CALENDAR_BINDING_DATABASE_URL`        | `MATRIX_CALENDAR_BINDING_DATABASE_TLS_MODE`        |
| Reminder settings and delivery claims | `MATRIX_CALENDAR_REMINDER_DATABASE_URL`       | `MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE`       |
| Private CalDAV client credentials     | `MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_URL` | `MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_TLS_MODE` |

Supply PostgreSQL URLs through secret management. All three stores default to
`verify-full`, which verifies the certificate chain and hostname. Use
`trusted-private-network` only for an explicitly controlled isolated database
network. Startup migrations require a least-privilege application role with
schema/table permissions, not a superuser. Store and migration failures stop
the configured capability; do not substitute Synapse credentials.

Capture and restore every configured database alongside the matching CalDAV
recovery point. If the URLs point to different databases, both need coverage.
See [database deployment](./deployment-docker.md#optional-application-postgresql-stores)
and [upgrade behavior](./upgrade-migration.md#data-stores-and-migration-behavior).

## Request and response limits

| Setting                                           | Default             | Allowed range / behavior                                                           |
| ------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| `MATRIX_CALENDAR_CALDAV_MAX_EVENT_RESPONSE_BYTES` | `16777216` (16 MiB) | Integer bytes from 1 through `67108864` (64 MiB); streamed event REPORT/GET limit. |
| `MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_REQUESTS`     | `120`               | 1–100,000 requests per source per fixed window.                                    |
| `MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_WINDOW_MS`    | `60000`             | 1–86,400,000 milliseconds.                                                         |
| `MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_MAX_KEYS`     | `10000`             | 1–10,000 distinct in-memory source keys.                                           |

The HTTP limiter uses the TCP peer address and ignores forwarded-address
headers. Behind a reverse proxy, callers seen from that proxy share a quota.
An unseen source is rejected with generic `429` and `Retry-After` when the key
table is full. Counters are process-local and reset on restart; they are not
a distributed abuse control.

JSON and URL-encoded request bodies have a fixed `100kb` parser limit before
Matrix authentication. Public feed transport has its own fixed size and time
bounds under ADR045. See the [threat model](./threat-model.md).

## Matrix runtime and storage

| Setting                               | Behavior                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `PORT`                                | HTTP listener port; deployment examples use `3000`.                                                             |
| `LOG_LEVEL`                           | One of `silent`, `fatal`, `error`, `warn`, `info`, `debug`, `trace`. Never enable secret-bearing request dumps. |
| `BOT_DISPLAYNAME`                     | Optional bot display name applied on startup.                                                                   |
| `STORAGE_FILE_DATA_PATH`              | Matrix SDK storage directory; default `storage`. Persist it in a deployment.                                    |
| `STORAGE_FILE_FILENAME`               | SDK session-store filename; default `bot.json`.                                                                 |
| `ENABLE_CRYPTO`                       | Default `false`. Enables retained SDK crypto support; it does not add encrypted scheduled reminders.            |
| `CRYPTO_DATA_PATH`                    | Crypto directory relative to the storage path; default `crypto`.                                                |
| `MATRIX_SERVER_EVENT_MAX_AGE_MINUTES` | Maximum age of incoming events handled after startup; default `5`.                                              |
| `MATRIX_FILTER_APPLY`                 | Apply the bot sync filter; default `true`.                                                                      |
| `MATRIX_FILTER_TIMELINE_LIMIT`        | Sync timeline limit; default `50`.                                                                              |
| `MATRIX_LINK_SHARE`                   | Base for room links; default `https://matrix.to/#/`.                                                            |
| `WELCOME_WORKFLOW_DEFAULT_LOCALE`     | Fallback locale for bot communication; default `en`.                                                            |

## Inherited meeting configuration

These names remain for compatibility with code inherited from NeoDateFix. They
are not calendar feature switches. Legacy meeting-management routes are
blocked by the calendar-only server guard, and retired widget deep links
redirect to calendar home. See [legacy entry points](./legacy-entry-points.md)
and the [server inventory](./legacy-server-inventory.md) before changing them.

| Setting                                       | Inherited behavior / default                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| `REACT_APP_DEFAULT_MEETING_MINUTES`           | Initial meeting duration, `60`.                                               |
| `REACT_APP_DEFAULT_BREAKOUT_SESSION_MINUTES`  | Initial breakout duration, `15`.                                              |
| `REACT_APP_DEFAULT_MINUTES_TO_ROUND`          | Start-time rounding interval, `15` minutes.                                   |
| `REACT_APP_MESSAGING_NOT_ALLOWED_POWER_LEVEL` | Meeting messaging restriction level, `100`.                                   |
| `REACT_APP_DISPLAY_ALL_MEETINGS`              | Old multi-room meeting-list switch.                                           |
| `MEETINGWIDGET_COCKPIT_NAME`                  | Legacy detail-widget name, `Calendar Details`.                                |
| `BREAKOUT_SESSION_WIDGET_NAME`                | Legacy breakout-widget name, `Breakout Sessions`.                             |
| `CALENDAR_ROOM_NAME`                          | Legacy bot direct-room name, `Matrix Calendar`.                               |
| `AUTO_DELETION_OFFSET`                        | Optional minutes after a meeting before legacy deletion.                      |
| `DEFAULT_EVENTS_CONFIG`                       | Meeting initial-state template file, `conf/default_events.json`.              |
| `DEFAULT_WIDGET_LAYOUTS_CONFIG`               | Meeting widget-layout template file, `conf/default_widget_layouts.json`.      |
| `ENABLE_WELCOME_WORKFLOW`                     | Legacy private help-room creation; default `false`.                           |
| `ENABLE_CONTROL_ROOM_MIGRATION`               | Legacy Matrix control-room migration; default `false`.                        |
| `ENABLE_PRIVATE_ROOM_ERROR_SENDING`           | Legacy private error-room creation; default `false`.                          |
| `JITSI_DIAL_IN_JSON_URL`                      | Optional inherited Jitsi dial-in endpoint.                                    |
| `JITSI_PIN_URL`                               | Optional Jitsi PIN endpoint with `{base32_room_name}` placeholder.            |
| `OPEN_XCHANGE_MEETING_URL_TEMPLATE`           | Optional inherited calendar link with `{{id}}` and `{{folder}}` placeholders. |
| `ENABLE_GUEST_USER_POWER_LEVEL_CHANGE`        | Legacy guest power adjustment; default `false`.                               |
| `GUEST_USER_PREFIX`                           | Guest user-ID prefix, `@guest-`.                                              |
| `GUEST_USER_DEFAULT_POWER_LEVEL`              | Guest power level, `0`.                                                       |
| `GUEST_USER_DELETE_POWER_LEVEL_ON_LEAVE`      | Remove the guest's explicit power on departure, `true`.                       |

Keep private-room creation and control-room migration disabled for ordinary
calendar operation. The following templates are retained as compatibility
reference, not instructions to enable meeting functionality.

### `DEFAULT_EVENTS_CONFIG`

The `DEFAULT_EVENTS_CONFIG` JSON file contains room and state events that the bot sends into a meeting room when it is created.
This can be used to e.g. automatically enable certain widgets to the room.
These are inherited meeting-room templates. The calendar-only server rejects the legacy meeting-management API; see the [legacy data-model reference](./archive/neodate-data-model.md).

The content of the events can be templated using [mustache templates](https://www.npmjs.com/package/mustache).
The following content is available:

- `room_id`: the ID of the current room.
- `base32_room_id`: the base32 encoded room id as needed for Jitsi.
- `base32_room_id50`: the base32 encoded room id with max character limit of 50 as needed for Etherpad.
- `title`: the title of the meeting (=the room name).
- `uuid`: a random UUID.
- `encodeURIComponent()`: a function to encode any value to make it URL-safe  
  Usage: `{{#encodeURIComponent}}my-text{{/encodeURIComponent}}`

#### Content

| Field                      | Type      | Description                                   |
| -------------------------- | --------- | --------------------------------------------- |
| `state_events[]`           | —         | A list of state events.                       |
| `state_events[].type`      | `string`  | The type of event.                            |
| `state_events[].state_key` | `string`  | The state key of the event.                   |
| `state_events[].optional`  | `boolean` | If true, this widget is not added by default. |
| `state_events[].content`   | `object`  | The content of the event.                     |
| `room_events[]`            | —         | The list of room events.                      |
| `room_events[].type`       | `string`  | The type of event.                            |
| `room_events[].content`    | `object`  | The content of the event.                     |

#### Example

```json
{
  "state_events": [
    {
      "type": "m.room.power_levels",
      "content": { "events": { "net.nordeck.meetings.metadata": 100 } }
    },
    {
      "type": "m.room.history_visibility",
      "content": { "history_visibility": "shared" }
    },
    {
      "type": "m.room.guest_access",
      "content": { "guest_access": "forbidden" }
    },
    { "type": "m.room.join_rules", "content": { "join_rule": "public" } },
    {
      "type": "im.vector.modular.widgets",
      "state_key": "jitsi",
      "optional": true,
      "content": {
        "type": "jitsi",
        "url": "https://app.element.io/jitsi.html?confId={{#encodeURIComponent}}{{base32_room_id}}{{/encodeURIComponent}}#conferenceId=$conferenceId&domain=$domain&isAudioOnly=$isAudioOnly&displayName=$matrix_display_name&avatarUrl=$matrix_avatar_url&userId=$matrix_user_id&roomId=$matrix_room_id&roomName=$roomName&theme=$theme{{#data.auth}}&auth={{data.auth}}{{/data.auth}}",
        "name": "Video Conference",
        "data": {
          "domain": "meet.jit.si",
          "conferenceId": "{{base32_room_id}}",
          "roomName": "{{title}}",
          "isAudioOnly": true
        }
      }
    }
  ],
  "room_events": []
}
```

### `DEFAULT_WIDGET_LAYOUTS_CONFIG`

The `DEFAULT_WIDGET_LAYOUTS_CONFIG` JSON file contains different widget layout configurations for different widget combinations that are installed into a meeting room.
It will update the `io.element.widgets.layout` when creating or updating the meeting room.

#### Content

| Field                        | Type       | Description                                                                                                   |
| ---------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `[]`                         | —          | A list of configurations.                                                                                     |
| `[].widgetIds`               | `string[]` | The ids of the active widgets when this configuration should be applied.                                      |
| `[].layouts`                 | –          | The layout of each widget by `state_key`.                                                                     |
| `[].layouts.[key].container` | `string`   | The location of the widget (`top` or `center`).                                                               |
| `[].layouts.[key].index`     | `number`   | The index of the widget in the container.                                                                     |
| `[].layouts.[key].width`     | `number`   | Percentage (integer) for relative width of the container to consume. The total width should not exceed `100`. |
| `[].layouts.[key].height`    | `number`   | Percentage (integer) for relative height of the container.                                                    |

#### Example

```json
[
  {
    "widgetIds": ["jitsi"],
    "layouts": {
      "jitsi": {
        "container": "center",
        "index": 0,
        "width": 100,
        "height": 100
      }
    }
  },
  {
    "widgetIds": ["jitsi", "poll"],
    "layouts": {
      "jitsi": {
        "container": "top",
        "index": 0,
        "width": 25,
        "height": 100
      },
      "poll": {
        "container": "top",
        "index": 1,
        "width": 75,
        "height": 100
      }
    }
  }
]
```

### Legacy Synapse invitation configuration

The inherited meeting/invitation workflow used the settings below for user
directory search and invitation state. They are **not requirements for the
calendar widget**. Do not broaden a homeserver's user directory or prejoin
state merely to run the calendar; review them only when maintaining an
explicitly retained legacy workflow.

```yaml
user_directory:
  # Users that are not known to each other can be found.
  search_all_users: true

# Controls for the state that is shared with users who receive an invite
# to a room
room_prejoin_state:
  # Additional state event types to share with users when they are invited
  # to a room.
  #
  # By default, this list is empty (so only the default event types are shared).
  #
  additional_event_types:
    - m.space.parent
    - net.nordeck.meetings.metadata
    - m.room.power_levels
```
