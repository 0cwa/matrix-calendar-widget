# ADR045: Publish opt-in, VEVENT-only public calendar feeds

- Status: Accepted
- Date: 2026-10-21
- Tracking: [issue #382](https://github.com/0cwa/matrix-calendar-widget/issues/382)

## Context

Users need a standards-based ICS subscription link for calendars they choose to
make public. Anyone who obtains such a link can read its calendar without
Matrix membership or a CalDAV credential, so sharing must be explicit,
calendar-scoped, and easy to revoke. Radicale remains the canonical store;
reconstructing event objects in a second ICS serializer could lose unknown
iCalendar properties, timezones, or recurrence data.

Radicale's native sharing behavior is version-specific. The project pins
Radicale 3.8.0.0 and its Auth module uses Matrix OpenID to authenticate the
owner, so the sharing API must be verified with that exact runtime and must
not weaken the existing `owner_only` rights backend.

## Decision

1. **Keep every calendar private by default.** A user publishes one selected
   calendar from the widget and must confirm that anyone with the link can read
   it. Personal publication requires the current authenticated owner. Room
   publication requires current room membership, calendar-manage power, and
   the exact server-side room/calendar binding. The server repeats the room
   authorization and target resolution after creating a share; if the target
   changed, it revokes the newly created token before failing the request.
2. **Use Radicale's native file-backed token sharing.** On the project's pinned
   Radicale 3.8.0.0 runtime, `[sharing] type = files` enables native sharing;
   configure `collection_by_token = True`, `collection_by_map = False`,
   `permit_create_token = True`, `permit_create_map = False`,
   `permit_properties_overlay = False`, and
   `default_permissions_create_token = r`. Keep `[rights] type = owner_only`
   unchanged. The gateway authenticates native create/list/delete requests as
   the exact personal owner or selected room principal. Every created share
   explicitly sets `Permissions = r`, `Conversion = none`, and `Enabled = true`.
   It never converts or rewrites the canonical calendar.
3. **Keep Radicale's share database authoritative.** Mark only shares created
   for this feature with a deterministic opaque scope marker in
   `D:displayname`. Reconcile one valid share per target under a process-local
   per-target lock, and delete only shares carrying the exact marker for that
   target. The pinned runtime stores token metadata under
   `collections/collection-db/files/token`, below the persistent Radicale
   `/data` directory. No second application publication database is added.
   Management serialization is process-local; deployments must use one
   publication-management writer. This implementation does not claim safe
   concurrent management across multiple gateway replicas.
4. **Wrap native token paths in a signed public URL.** Configure a dedicated
   persistent 32-byte HMAC-SHA256 key and the externally reachable gateway
   origin. Both are required; when either is absent, publication is disabled
   and calendars remain private. The envelope contains only version `1`, the
   canonical native token path `/.token/v1/<44-character-base64url-token>/`,
   and an opaque keyed scope hash. It contains no Matrix or CalDAV credential,
   raw room/user identifier, or private collection URL. The gateway verifies
   the bounded, canonical envelope with a timing-safe signature comparison
   before making any upstream request. Unsigned, malformed, or modified links
   receive the same generic not-found response; raw Radicale token paths are
   never accepted by the gateway. The envelope is integrity-protected, not
   encrypted: anyone holding a link can decode its native token path. Radicale
   and its token route must remain unreachable from untrusted networks so the
   gateway remains the public validation, method, rate-limit, and revocation
   boundary.
5. **Expose only public reads through the gateway.** The public route accepts
   only `GET` and `HEAD` at `/v1/public-calendar-feeds/<envelope>`. It fetches
   the native token route from the server-only Radicale origin; it does not
   proxy arbitrary URLs, the Radicale sharing API, or CalDAV credentials. The
   internal `RADICALE_URL` must be a root HTTP(S) origin reachable only by the
   server and trusted operators in this initial implementation. Redirects fail
   closed. Requests time out after five
   seconds, native calendar bodies are capped at 16 MiB, and sharing API JSON
   responses are capped at 1 MiB. Public requests use the existing bounded,
   process-local calendar gateway limiter.
6. **Validate every canonical response before returning it.** Fetch the
   complete native calendar on each `GET` and `HEAD`; do not short-circuit on
   ETags or conditional requests. Return Radicale's bytes unchanged only when
   the entire bounded VCALENDAR contains VEVENT components and no unsupported
   component. Reject VTODO, VJOURNAL, VFREEBUSY, malformed boundaries, and
   malformed UTF-8 without returning a body. This also rejects a calendar that
   becomes mixed after publication. Unknown VEVENT properties, timezone
   definitions, recurrence data, and alarms stay in Radicale's canonical
   representation. Radicale currently adds `X-WR-CALNAME` to the feed; the
   product does not promise an exact metadata shape. Responses use
   `Cache-Control: no-store`, `Pragma: no-cache`, and
   `X-Content-Type-Options: nosniff`; upstream validators are not forwarded.
7. **Redact bearer paths at each logging boundary.** The gateway does not write
   request access records for publication queries (which contain private
   collection hrefs) or public feed paths (which contain signed bearer links).
   The Radicale Auth module installs a narrow logger filter that redacts native
   token paths in messages, encoded storage names, and formatted exception
   tracebacks at every Radicale log level. External reverse proxies must omit
   or redact the path for `/v1/public-calendar-feeds/` and the query for
   `/v1/calendar-feeds/publication`; do not expose Radicale's `/.sharing/`
   endpoints through the public ingress. Keep ordinary diagnostics enabled.
8. **Make publication lifetime explicit.** Public reads intentionally do not
   recheck Matrix membership or manager power. Losing room-manager power does
   not revoke an existing link; a currently authorized owner/manager must
   unpublish it, or the owner must revoke the native share. The current room
   binding registry has no unlink or rebind operation; dynamic bindings are
   append-only. Operators must unpublish before changing or removing a static
   binding. Any future unlink/rebind path must revoke its marked native share
   before changing the binding. A source that becomes unavailable returns an
   unavailable response; an absent or revoked token returns not found. Key
   rotation or loss invalidates all previously signed URLs; native shares must
   then be explicitly revoked or reconciled after a new key is installed.
9. **Back up the capability key with Radicale `/data`.** Include the complete
   persistent Radicale `/data` store and the configured public-feed signing
   key in the same protected backup/recovery point. When the key comes from a
   file, add that file to the operator's explicit encrypted restore-input
   allowlist. Restoring only one of the share database or signing key will not
   preserve existing URLs.

## Evidence and consequences

The tracked
[`public_feed_contract.py`](../../radicale-auth/tests/public_feed_contract.py)
asserts Radicale 3.8.0 and runs against an isolated process with synthetic
OpenID owners and temporary storage. It verifies unchanged `owner_only`
rights, owner-authenticated sharing administration, read-only token
permissions, anonymous GET/HEAD, denied writes, canonical VEVENT/timezone/
recurrence/opaque-property preservation, rejection requirements for mixed
components, restart persistence, revocation, the share database path, and
token redaction at Radicale trace level. It also verifies the same native
sharing contract for the configured room service principal. The script does
not write to a live Matrix or CalDAV service and does not validate a deployment
proxy or operator backup.

Anyone with a copied link can read the selected VEVENT calendar until it is
unpublished, its native token is revoked, or its signing key changes. Existing
client copies may remain after revocation. Public ingress, gateway rate
limits, reverse-proxy access logs, secret storage, and paired backup/recovery
remain deployment responsibilities. This decision does not enable private
CalDAV editing through ICS; future private editing must use CalDAV.
