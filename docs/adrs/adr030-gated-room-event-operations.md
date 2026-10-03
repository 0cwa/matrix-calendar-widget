# ADR030: Gate room-owned event operations

- Status: Proposed
- Date: 2026-10-03
- Preserves: ADR005, ADR006, ADR010, ADR014, ADR015, ADR024, and ADR026

## Context

Room calendars use one appservice-owned Radicale principal, whose `owner_only`
rights cover its whole home. ADR014 and ADR015 therefore require the gateway to
authorize the Matrix actor and resolve the exact server-managed room/calendar
binding before it requests an appservice OpenID proof or makes a CalDAV
request. The proof authenticates the service principal to Radicale; it does
not authorize the actor.

PR #164 completed the appservice proof and room-isolation read contract on the
pinned Synapse and Radicale stack. Event writes need their own gate and
contract because a mistake can replace or delete canonical CalDAV data. Room
collections remain operator-managed, and imported mixed iCalendar resources
must retain unsupported siblings during any supported VEVENT edit.

## Decision

1. Keep room calendar access behind `ROOM_CALENDAR_ACCESS_ENABLED`, which
   defaults to `false`. Add the independent
   `ROOM_CALENDAR_EVENT_WRITES_ENABLED` setting, which also defaults to
   `false`. The write setting cannot enable access when the general room
   access setting is disabled. Enable writes only after the real Synapse and
   Radicale write, authorization, and cross-room contracts pass.
2. For every room request, validate the current Matrix actor's joined
   membership, action-specific power, and exact server-managed binding before
   minting an appservice proof or making CalDAV I/O. Revalidate the binding,
   configured appservice user, service-principal calendar path, and event
   resource URL at the CalDAV operation boundary. Never use the actor's
   OpenID proof as the room calendar's CalDAV identity, and never accept a
   caller-selected principal, URL, or credential.
3. Expose only event-level room operations: list and get VEVENT resources,
   create an event, update an event conditionally, and delete an event
   conditionally. A room event URL must be one direct resource child of the
   exact bound collection. Collection creation, rename, metadata changes, and
   deletion remain operator-managed.
4. Create with `If-None-Match: *`. Update only after reading the current
   resource, preserving unsupported properties and mixed legacy components
   through the existing iCalendar codec, and send the caller's concrete
   `If-Match` validator unchanged. Reject a missing, wildcard, weak, or
   multi-value validator. A stale update remains a conflict; it must not be
   silently rebased onto the resource just read.
5. Before delete, GET the current resource and require its ETag to match the
   caller's concrete strong ETag. Delete only a single VEVENT series: allow
   one VEVENT master and detached VEVENTs with the same UID, plus VTIMEZONE
   definitions. Reject VTODO, VJOURNAL, VFREEBUSY, unknown components,
   multiple event masters, unrelated UIDs, malformed identity, or a mixed
   resource. Send DELETE with the same `If-Match` validator so a concurrent
   change fails closed.
6. Keep the authorization and operations services private to the server.
   Bot callers may enter through an authenticated homeserver-event context,
   but must apply the same actor membership, action-power, and binding checks
   before using the service-principal capability. Event sender data is actor
   context, never proof. Personal-principal routes retain their existing
   identity model; personal deletion applies the same ETag and single-series
   safety checks.
7. Apply the configured bounded CalDAV event-response limit to room event
   clients. Redirects fail closed. Errors and responses must not expose
   appservice tokens, OpenID proofs, authorization headers, or full iCalendar
   bodies.

## Consequences

- The default configuration enables neither room access nor room writes.
- Passing the room read contract does not enable writes; the write flag is an
  independent operator-controlled gate.
- Unsupported calendar objects remain readable where existing behavior allows
  and are preserved during supported event updates. Destructive operations
  refuse resources that cannot be proven to contain one VEVENT series.
- Room calendars cannot be created or managed through widget or bot event
  APIs. Operators provision their collections and static bindings separately.
- The M6 real-container contract validates the repository's pinned stack. It
  does not verify an etke-managed deployment, its image override, or its
  existing `/data` store.

## Acceptance gates

- Tests show membership, action power, and binding denials occur before
  appservice proof issuance and CalDAV I/O.
- The real Synapse/Radicale contract covers create, get, update, and delete
  against the appservice principal, plus cross-room and unauthorized
  no-I/O denials.
- Unit tests cover conditional validators, create collisions, stale updates,
  delete eligibility, mixed-resource preservation on update, disabled write
  defaults, URL containment, redirect handling, response bounds, and
  credential-safe failures.
- Operator deployment verification and the ADR024 image/data-path gates stay
  separate from the passing repository contract.
