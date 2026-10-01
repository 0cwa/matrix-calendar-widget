# ADR024: Own a clean-room OpenID authentication module for Radicale

- Status: Accepted
- Date: 2026-10-01
- Supersedes: ADR009's external-only implementation-location requirement
- Preserves: ADR006, ADR010, ADR014, and ADR015 identity, principal, and
  authorization decisions

## Context

ADR006 requires server-side Matrix OpenID validation and forbids the widget
gateway from asking for, storing, or proxying Matrix passwords. ADR009 defines
the tagged OpenID delegation contract for personal calendars, but requires its
Radicale authentication code to live in a separate plugin repository. ADR010,
ADR014, and ADR015 separately select per-user personal calendars and one
appservice-owned principal for explicitly bound room calendars, with actor,
membership, power, and binding checks before CalDAV access.

The pinned development service uses Radicale 3.8.0.0 with
`radicale-auth-matrix` and `owner_only`. Its current password mode sends the
supplied username and password to Matrix `m.login.password`; it has no OpenID
credential mode. The project needs an OpenID path for personal widget access
and for the dedicated application principal while keeping conventional
Matrix-password CalDAV clients working.

The primary-source audit found a supported Radicale Auth extension interface,
but no existing native mode that provides the required split. Radicale's
OAuth2 backend uses a password grant. Its `http_x_remote_user` backend trusts a
proxy-supplied identity and disables internal authentication. Neither option,
by itself, preserves the current password clients while safely validating both
OpenID principals. Radicale collection sharing is per-collection, disabled by
default, and requires an authenticated collection owner to provision tokens;
it does not provide the selected service-principal path. The external
`radicale-auth-matrix` source is LGPL-3.0, so copying it into this Apache-2.0
repository would create a separate licensing obligation.
ADR014's boundary against changing that external package remains in force:
this decision adds a separately authored module and does not fork or copy the
external implementation. If the pinned custom image keeps that package for its
password-login mode, its LGPL-3.0 source, license, and notices remain separate
and must accompany image distribution as required.

The operator's managed host is etke-based. A fork-owned custom image is the
selected packaging target for an etke Radicale image override, but support for
that override on the actual host has not been confirmed. The current data path
is `/data`, with collections under `/data/collections`; Radicale remains the
canonical calendar store.

## Decision

1. **Implement a clean-room Radicale Auth module in this repository.** Target
   the Radicale 3.8.0.0 interface used by the pinned development and hosted
   contract stacks. Write the module from the Radicale interface and protocol
   requirements; do not copy, vendor, or modify `radicale-auth-matrix` source.
   License the clean-room module with this repository. If the custom image
   includes the external package for conventional password login, preserve its
   LGPL-3.0 source, license, notices, and distribution obligations separately.
2. **Build and pin a project-owned custom image.** The image must pin its
   Radicale base version and module dependencies; never install a floating
   plugin branch at startup. The intended deployment replaces the etke
   Radicale image without introducing a second calendar service or a
   Helm/Kubernetes dependency. Whether the actual etke role exposes a supported
   image override is unverified; confirm the host's supported extension path
   with its operator before treating this image as deployable. Keep the
   existing Radicale data mount at `/data` and the collection store at
   `/data/collections`; image replacement must leave the existing persistent
   CalDAV store canonical and intact. Do not claim etke-host compatibility
   until the image replacement path is confirmed and a deployment rehearsal
   verifies the actual volume, network, config, and service lifecycle.
3. **Keep the two Basic Auth modes explicit.** An untagged password retains
   the existing conventional-client Matrix-password login behavior. The
   gateway must never use that mode. A value with the ADR009
   `matrix-openid:` tag is parsed strictly as a short-lived OpenID delegation;
   the adapter verifies it against only the configured Matrix homeserver's
   `/_matrix/federation/v1/openid/userinfo` endpoint and rejects malformed,
   expired, unknown, or mismatched proofs. Require the returned Matrix user
   ID's localpart to match the Basic Auth username and its server name to
   match both the payload and configured Matrix homeserver. Do not accept a
   caller-selected homeserver URL or use the proof as an authorization
   decision.
4. **Use the actor's validated proof for personal calendars.** For personal
   widget access, the gateway passes the same request-scoped OpenID proof it
   has validated for the actor, using ADR009's tagged payload and the actor's
   Matrix localpart. The adapter verifies the proof subject independently.
   Do not mint a different user's proof or infer a user from a room event.
5. **Use a dedicated appservice-owned principal for room calendars.** For a
   room-target operation, the gateway authenticates the widget actor with its
   validated OpenID proof or accepts the bot actor only from an authenticated
   homeserver event. It then checks current joined membership,
   action-specific power, and the exact server-managed room/calendar binding
   under ADR014 and ADR015. An event sender is authorization context only; it
   does not prove a CalDAV identity. Only after those checks pass may it call
   `POST /_matrix/client/v3/user/{appserviceUserId}/openid/request_token`
   as the application service. Use the exact configured dedicated appservice
   user ID in both the path and Matrix's `user_id` impersonation parameter,
   and send the server-held `as_token` in the `Authorization: Bearer` header.
   The user ID must be within the appservice's registered user namespace. Do
   not put `as_token` in the query string. The gateway sends the returned
   short-lived OpenID proof to Radicale under that user's localpart. The
   adapter requires the returned subject to equal the exact configured
   appservice Matrix ID. The room actor's proof is never presented as the
   CalDAV principal, and the appservice proof never substitutes for actor
   authorization.
6. **Keep proofs transient.** The gateway and adapter hold issued OpenID
   proofs only for the authorized operation. Do not cache, persist, return to
   the widget, place in the reminder database, or log them. Do not log Basic
   Auth values, authorization headers, appservice tokens, complete URLs with
   query strings, or full iCalendar bodies. The appservice token is a
   deployment secret: keep it out of the repository, database, browser,
   Matrix events, and logs. Never ask for, store, derive, or proxy a user's
   Matrix password in gateway or room-target flows.
7. **Treat `owner_only` as whole-home access.** Radicale grants the appservice
   principal access to its entire home. Only app-owned room calendars may live
   there. The gateway must resolve and authorize the exact ADR015 binding
   before any CalDAV request; it must not enumerate the appservice home to
   select a room calendar. Gateway checks provide application-level
   per-room isolation only. Do not serve mutually untrusted rooms from this
   single principal unless the deployment also enforces equivalent
   per-room isolation; otherwise constrain the home to one trusted
   organizational boundary.
8. **Redact OpenID query credentials at every logging boundary.** Matrix's
   OpenID userinfo API carries its `access_token` in a query parameter. The
   adapter, gateway, Synapse access-log configuration, and any reverse proxy
   must not record that value. Keep Synapse's `SYNAPSE_LOG_SENSITIVE` unset
   and sensitive debug logging disabled; configure its deployed access logs
   to redact or omit `access_token` query values. Configure etke Traefik
   access logging to drop query parameters
   (for example, `accessLog.fields.queryParameters.defaultMode: drop`) for
   the homeserver ingress. Before room access is enabled, a contract check
   must use a sentinel proof and confirm that it appears in none of the
   gateway, Radicale, Synapse, or Traefik logs.
9. **Keep access disabled until the contracts pass.** Issue #48 is now
   in-repository work to implement the module, image, and dual-mode tests.
   Issue #45 remains the real-Radicale gateway contract for both the personal
   actor proof and the authorized appservice proof, including denial before
   downstream I/O. Room-target access remains disabled until #48 and #45 pass,
   the ADR014/ADR015 checks and cross-room isolation are validated, and the
   operator's custom-image `/data` replacement path is verified.

## Alternatives considered

### Wait for or extend `radicale-auth-matrix`

This leaves the work dependent on an external release and does not resolve the
repository's code-location requirement. The project will not open changes in
that repository without separate authorization. The owned clean-room module
keeps the same Radicale extension boundary without taking external source.

### Use Radicale's built-in OAuth2 or remote-user backends alone

The audited OAuth2 implementation relays a username/password grant. The
remote-user backend trusts a proxy-provided user and turns off Radicale's own
authentication. Neither alone supplies both explicit credential modes while
preserving conventional Matrix-password clients.

### Use Radicale collection-sharing tokens

Sharing tokens are per-collection and require an authenticated owner to create
them; the feature and token creation are disabled by default. This requires a
separate provisioning and rotation flow for each collection and is not the
selected application-principal credential model.

### Put the service principal behind a trusted-user proxy

A proxy header would change the authentication boundary and must not be
accepted from untrusted clients. It would also need a separately designed
dual-mode proxy contract. This ADR keeps identity verification in Radicale's
supported Auth interface and does not add a new proxy identity protocol.

## Consequences

- The project owns the OpenID adapter and image release lifecycle and must
  maintain the Radicale 3.8 compatibility contract as Radicale versions
  change.
- If the image includes `radicale-auth-matrix` for password compatibility, the
  project must preserve that package's LGPL-3.0 notices and source obligations
  when distributing the image.
- Existing conventional CalDAV clients retain their Matrix-password login;
  the widget gateway and room-target code use OpenID proofs only.
- The etke-managed production path is not verified by this decision. If the
  actual host cannot replace the Radicale image while preserving its
  configuration, network, service lifecycle, and `/data` volume, room access
  remains disabled until an operator-supported image path is established.
- ADR006's gateway boundary and ADR010/ADR014/ADR015 principal selection,
  actor authorization, room binding, and whole-home isolation requirements
  remain unchanged. This ADR defines an authentication mechanism; it does not
  enable room-target CalDAV operations by itself.
- The homeserver access token used to mint the appservice OpenID proof is a
  high-value deployment secret. The proof is short-lived and request-scoped,
  but its query parameter makes end-to-end log redaction a deployment gate.

## Primary-source basis

- [Radicale v3 authentication and plugin interfaces](https://radicale.org/v3.html#auth)
  and [collection sharing](https://radicale.org/v3.html#sharing).
- The pinned [`radicale-auth-matrix` source](https://github.com/etkecc/radicale-auth-matrix/tree/0f07e8ba32cf595e744403f70dd4ff81db3886b6)
  and its LGPL-3.0 license govern that separate package if it remains in the
  image.
- Matrix Client-Server API for
  [requesting an OpenID token](https://spec.matrix.org/v1.16/client-server-api/#post_matrixclientv3useruseridopenidrequest_token)
  and the Application Service API's
  [identity assertion](https://spec.matrix.org/v1.16/application-service-api/#identity-assertion)
  for the `as_token` and `user_id` request identity. The Server-Server API
  defines
  [validating it](https://spec.matrix.org/v1.16/server-server-api/#get_matrixfederationv1openiduserinfo).
- Synapse's [container environment variables](https://github.com/element-hq/synapse/blob/develop/docker/README.md)
  document `SYNAPSE_LOG_SENSITIVE`; its
  [logging configuration](https://element-hq.github.io/synapse/latest/usage/configuration/logging_sample_config.html)
  warns that sensitive debug logging can include access tokens. See also
  [Traefik access-log query-parameter controls](https://doc.traefik.io/traefik/observability/access-logs/).
- [etke's Radicale service description](https://etke.cc/help/extras/radicale/)
  documents its Matrix-authenticated service but does not confirm an image
  override on the user's managed host. Confirm that capability with the
  operator before rollout.

## Implementation acceptance gates

- The custom image pins Radicale 3.8.0.0 and has a reproducible build; the
  adapter is clean-room code and no upstream plugin source is copied.
- Tests prove legacy Matrix-password CalDAV clients still authenticate and
  that personal OpenID proofs are accepted only for their exact Matrix
  subject.
- Tests prove appservice OpenID proofs identify only the configured
  appservice MXID; malformed, expired, unknown, wrong-user, and wrong-server
  proofs fail closed.
- Gateway tests prove room membership, power, and exact binding are checked
  before the appservice OpenID request and before every CalDAV operation.
- Real Radicale tests prove the same `/data` collection store remains visible
  after replacing the image and that room-bound operations cannot select a
  different room's collection.
- A sentinel-token log test covers gateway, Radicale, Synapse, and Traefik.
- The actual etke host's image override, `/data` persistence, network, config,
  Traefik routing/logging, and upgrade/rollback procedure are documented and
  rehearsed before production room-calendar access is enabled.
