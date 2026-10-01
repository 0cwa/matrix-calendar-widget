# ADR015: Manage room/calendar bindings in server configuration

- Status: Accepted
- Date: 2026-09-26

## Context

ADR014 selects the CalDAV principal from the explicit, server-authoritative
target: personal widget calendars use the validated user's principal, while
room-bound widget and bot targets use the app-owned room principal. ADR014 also
requires identity, room membership, action power, and the room/calendar binding
to be resolved before any CalDAV discovery or access.

M6 needs a source for that binding. The initial release can use a deployment-
managed configuration map without adding a runtime binding database, Matrix
room-state protocol, or browser-managed association. The gateway must not let a
room member choose an arbitrary CalDAV collection merely by supplying its URL.

The current Radicale `owner_only` policy gives the app principal access to its
whole calendar home. A gateway mapping narrows ordinary application behavior,
but does not isolate rooms from a compromised gateway or service principal.

## Decision

1. **Use server-managed configuration as the initial source of truth.** The
   configuration maps a canonical Matrix room ID to exactly one stable,
   app-owned calendar identifier. A room without an entry has no room calendar.
   Do not infer a binding from a calendar name, room alias, sender, or existing
   collection contents.
2. **Require one-to-one bindings.** A room may have only one binding, and an
   app-owned calendar identifier may be assigned to only one room. Reject
   duplicate room entries, duplicate collection assignments, and any input
   that makes the mapping ambiguous. Detect duplicate entries before converting
   configuration into a map; do not let a parser silently keep the last value.
   Bindings to user-owned or unrelated collections are invalid.
3. **Validate before CalDAV.** Validate the entire configuration at load time.
   Reject malformed or non-canonical room IDs, malformed collection
   identifiers, missing bindings, and ambiguous configuration before making
   any CalDAV discovery, read, or write request. Invalid configuration must
   fail closed rather than silently select one of several values; if the
   mapping cannot be validated, room-target operations remain unavailable.
4. **Resolve collection identifiers on the server.** The configured calendar
   identifier is an application-owned identifier resolved by the server under
   the configured Radicale service and room principal. It is not a browser-
   supplied href or URL. If an API request includes a calendar identifier, it
   must match the resolved binding; a mismatch, arbitrary URL, or identifier
   bound to another room is denied before CalDAV access. Do not discover the
   room principal's whole home to choose a target.
5. **Keep binding writes out of the widget and room membership.** Only an
   operator-managed server configuration change creates, replaces, or removes
   a binding. Browser requests, room members, and Matrix room events cannot
   write or override the mapping. Under this initial static-binding contract,
   the widget may read and manage events in the already-bound room calendar
   after ADR014's caller identity, current membership, and action-specific
   power checks pass. Calendar collection creation, deletion, and rename remain
   operator/configuration-managed so collection lifecycle cannot leave a
   dangling or unbound room target. Widget-managed collection lifecycle needs a
   later ADR.
6. **Select the ADR014 principal only after resolving the target.** A personal
   widget target continues to use the validated user's principal. A room-bound
   widget or bot target resolves its room through this map and uses the
   server-side app-owned room principal. Credentials and short-lived OpenID
   assertions remain server-side. A Matrix sender ID is never a CalDAV
   principal or collection selector.
7. **Retain the M2, M6, and deployment gates.** This decision does not make
   room CalDAV access available. The M2 personal actor OpenID implementation
   and real-Radicale contract (#48 and #45) are prerequisites for authenticated
   widget requests. M6 issue #7 owns appservice proof issuance, room-target
   authorization, and cross-room isolation acceptance. With `owner_only`, the
   app principal can access its whole home;
   only app-owned room calendars may be placed there, and deployments must
   constrain that home to one trusted organizational boundary or validate
   equivalent per-room isolation before serving mutually untrusted rooms.
8. **Defer dynamic binding mechanisms.** A binding database, Matrix room-state
   event, or widget binding-management flow changes persistence and
   authorization boundaries. Any such mechanism requires a separate ADR that
   defines who may change bindings, its audit/lifecycle behavior, and how it
   preserves fail-closed resolution.

## Consequences

- Server configuration is the initial authority for which app-owned calendar
  belongs to a room; Radicale remains canonical for the collection and its
  calendar objects.
- The widget can access only the configured room calendar after server-side
  authorization and can read and manage events in that collection. It cannot
  bind a room, select an arbitrary collection, or create, delete, or rename the
  collection under this initial contract. Operators coordinate collection
  provisioning/removal with configuration changes.
- M7 commands derive the room target from the same mapping and authenticated
  room context, not from a sender ID or user-supplied calendar URL.
- Missing, malformed, duplicate, ambiguous, or cross-room mapping data fails
  closed before CalDAV. Operators must correct configuration before access can
  resume.
- Personal calendar access and the deferred per-user bot-target policy remain
  unchanged.
- ADR014's whole-home service-principal isolation requirement remains in
  force. M2 #48/#45 cover personal actor authentication; M6 issue #7 owns the
  appservice proof and room-isolation gates.

## Acceptance gates for a future implementation

- Configuration parsing rejects non-canonical room IDs, malformed calendar
  identifiers, duplicate room entries, duplicate calendar assignments, and
  ambiguous mappings.
- A missing room binding or request/binding mismatch is rejected before any
  CalDAV discovery, read, or write call.
- A browser-supplied href or URL cannot create or override a room binding.
- The resolved room calendar belongs to the configured Radicale service and
  app-owned room principal; the server principal's home is not enumerated to
  choose a target.
- Widget and bot room operations retain ADR014 actor identity, current
  membership, action-power, credential-redaction, and owner-only isolation
  requirements.
- End-to-end room CalDAV operations remain disabled until M2 #48/#45, M6
  issue #7, and the deployment trust-domain gate pass.
