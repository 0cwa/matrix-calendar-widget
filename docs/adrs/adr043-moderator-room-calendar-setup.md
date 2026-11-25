# ADR043: Set up a room calendar through a moderator command

[Decision index](./README.md) · [Documentation](../README.md)

- Status: Accepted
- Date: 2026-10-20
- Supersedes: only ADR015 Decision 5's operator-only binding-write and
  collection-creation clause, for the bounded `!calendar setup` flow
- Preserves: ADR005, ADR006, ADR010, ADR014, ADR015's remaining decisions,
  ADR019, ADR024, ADR028, ADR030, ADR037, ADR041, and ADR042

## Context

ADR015 makes server configuration the only source of room/calendar bindings
and keeps room collection creation operator-managed. A moderator has asked to
invite the normal calendar bot to a room and use `!calendar setup` to make the
room calendar available. That requires a durable binding source shared by the
widget, command, and reminder paths; a command-only mapping would leave the
widget unable to use the new calendar.

Room calendars still belong to Radicale/CalDAV. Dynamic bindings must not let a
room member choose a collection, change an existing operator binding, or
access a collection before current Matrix authorization. Setup is a
provisioning operation spanning Matrix state, PostgreSQL, and CalDAV, none of
which share a transaction. The initial workflow therefore needs a persistent
reservation and retry rules that never guess at a collection or delete data
after an ambiguous result.

The repository's current widget entry uses `im.vector.modular.widgets` state
with the configured calendar widget URL, type, name, and ID. The calendar app
reads `meetings_bot_base_url` and `matrix_room_id` from URL query and fragment
parameters; Element supplies the Widget API's `widgetId` and `parentUrl` when it
opens the widget. A pilot entry may use the generic `custom` kind, a fixed
state-key widget ID, and a literal current-room URL parameter. The inherited
welcome workflow also writes the shared `io.element.widgets.layout` state.
Replacing that layout could disturb unrelated widgets, so room setup must add
the calendar widget entry without replacing layout state.

## Decision

1. Add the exact, no-argument Matrix room command `!calendar setup`. Derive
   `roomId` and `actorUserId` only from the authenticated room event. Do not
   accept a room ID, calendar ID, href, URL, principal, or credential in the
   command. Do not add a widget binding editor or self-service teardown.
2. Reuse the existing `canManageCalendars(actorUserId, roomId)` policy. Require
   the actor's current joined membership and calendar-manage power before any
   persistence, widget-state write, OpenID proof, or CalDAV request. Also
   restrict setup actors to an explicit Matrix server-name allowlist. When
   `ROOM_CALENDAR_SETUP_ALLOWED_ACTOR_SERVER_NAMES` is unset or empty, allow
   only actors from the normal bot account's Matrix server. A nonempty,
   validated comma-separated list overrides that default; wildcards are not
   allowed. This setup-only gate does not replace room membership or
   calendar-manage authorization and does not affect ordinary calendar access.
   Require the selected normal bot account to be joined and currently able to
   send `m.room.message` and the `im.vector.modular.widgets` state event.
   Determine the bot principal only through the process-wide mode selected by
   ADR041.
3. For this initial setup path, proceed only when the current
   `m.room.encryption` lookup returns a trusted Matrix error with both HTTP
   status 404 and Matrix errcode `M_NOT_FOUND`, confirming state absence. Both
   values are required; either alone is unknown. An encryption event means the
   room is encrypted; malformed state and every other lookup failure mean
   unknown state and are unsupported. Check this before persistence or CalDAV.
   Preserve the existing encryption-aware Matrix send path and repeat the
   safe-room check before the command reply.
4. Gate only setup mutations behind `ROOM_CALENDAR_SETUP_ENABLED`, which
   defaults to `false`. Store room bindings through the optional,
   app-owned PostgreSQL connection `MATRIX_CALENDAR_BINDING_DATABASE_URL`,
   independent of `MATRIX_CALENDAR_REMINDER_DATABASE_URL` and the reminder
   adapter. The two settings and adapters remain independently optional and
   may point to the same app-owned PostgreSQL database. They retain separate
   schemas (`matrix_calendar_bindings` and `matrix_calendar`) and migration
   ownership; configuring one store never enables or falls back to the other.
   Either URL must use an application-owned database and least-privilege role,
   never Synapse's database or credentials. Verify PostgreSQL TLS fully by default; allow
   plaintext only when the operator explicitly sets
   `MATRIX_CALENDAR_BINDING_DATABASE_TLS_MODE=trusted-private-network`, with
   the same narrow meaning as ADR021. The default is `verify-full`.
   The store owns its `matrix_calendar_bindings` schema and schema-version
   table. If the URL is absent, only static bindings are available and the
   existing static-only resolver behavior remains unchanged. When the store
   is configured but its schema cannot be read or migrated, fail closed; do
   not silently fall back to static-only access.
5. Keep `ROOM_CALENDAR_BINDINGS` as the immutable static source. It remains
   authoritative for every configured room and collection: setup never
   overwrites, deletes, or migrates a static entry. A room with a static
   binding may use setup to verify that exact collection and idempotently
   install the widget, but setup never creates or renames that collection.
   Dynamic reservations that collide with either side of a static binding are
   rejected. With the binding store configured, the runtime registry combines
   validated static bindings with ready dynamic records only, verifies
   one-to-one room and collection identity across the complete set, and fails
   closed on ambiguity. Pending rows never authorize widget, command, event,
   or reminder access. Without a configured store, static-only reads retain
   their existing validation and cardinality behavior.
6. Store one immutable dynamic binding per room with state `pending` or
   `ready`, its canonical Matrix room ID, opaque app-owned calendar ID,
   requesting actor ID, creation time, and ready time. Enforce unique room and
   collection IDs in PostgreSQL. When the binding store is configured, limit
   the complete set to 32 bindings: all static bindings plus every dynamic
   row, including pending and ready rows. Reservations count validated static
   bindings and all existing dynamic rows before inserting. The registry
   applies the same cap to that complete set, then exposes static and ready
   dynamic bindings; it never truncates an over-limit or malformed result.
   Static-only mode without a configured store does not add a new cap to the
   existing static resolver. Persist no event titles, bodies, ETags, CalDAV
   hrefs, Matrix tokens, OpenID proofs, or raw errors. Status changes are
   limited to `pending` to `ready`; there is no update, rebind, or delete
   operation.
7. After all preconditions pass, reserve a server-generated
   `calendar-${randomUUID()}` identifier in PostgreSQL before CalDAV access.
   Reservation is atomic and idempotent by room: a concurrent or retried
   setup returns the existing row and exact collection ID instead of
   allocating another. A reservation checks static conflicts and the total
   configured-binding cap in the same transaction as its unique-ID checks.
   Use the selected
   ADR041 room principal, create only a VEVENT collection, and never enumerate
   the principal's home to choose a collection.
8. Reconcile a pending row only against its exact stored collection ID. Verify
   the collection's VEVENT-only, writable properties before changing the row
   to `ready`. If a request times out or a database transition fails, retain
   the pending row and collection. A retry inspects that same ID and may
   complete it; it never allocates a second ID, guesses from a display name,
   or deletes a collection on an ambiguous result. Existing ready rows and
   static bindings are verified as needed but never recreated or normalized by
   setup. Their collections may be read-only or advertise additional
   components as long as VEVENT is supported; an unknown component set is
   allowed, but an explicitly unsupported VEVENT set is not.
9. Before binding-store or CalDAV work, preflight the existing
   `im.vector.modular.widgets` entries and the URL for any new widget. The
   current widget bootstrap reads `meetings_bot_base_url` and
   `matrix_room_id` from both the URL query and the query in its fragment; a
   new entry therefore requires exactly one concrete HTTP(S)
   `meetings_bot_base_url` without credentials, query, or fragment, and the
   gateway must not downgrade an HTTPS widget to HTTP. It also requires one raw canonical
   `matrix_room_id=$matrix_room_id` parameter. Do not install a URL that relies
   only on the widget image's build-time API fallback. `widgetId` and
   `parentUrl` are supplied by Element when it launches the widget; do not
   hard-code those client values into the configured URL. A new entry uses the
   current `WidgetType.MEETINGS` payload generated by `WidgetClient`, with a
   deterministic state key and content `id` derived from the calendar ID.
   Reject URL user information and credential-named query or fragment
   parameters, including those in the nested gateway URL, before binding-store,
   OpenID, CalDAV, or widget-state work; never place those values in Matrix
   widget state.
10. Reuse an existing current-kind calendar widget only when its state key is
    the widget identity, its configured origin and path match, its gateway URL
    is safe, and its room context is either the actual room ID or the raw
    `$matrix_room_id` template. Reuse a trusted legacy `custom` or `m.custom`
    widget only when both event sender and `content.creator` are the
    SDK-derived bot ID, its existing state key identifies the widget, its
    configured origin and path match, and it has the same safe gateway and
    room-context checks. For either kind, `content.id` may be absent; when
    present it must equal the state key. An optional `matrix_widget_id` URL
    parameter must be the existing state key or the raw `$matrix_widget_id`
    macro, with no duplicates or conflicting values. Reuse the existing full
    payload and URL without rewriting them; never identify a widget by its name
    alone. A current or legacy widget URL with credential-bearing parameters or
    URL user information is not eligible for reuse. If the deterministic state
    key is occupied by different content or a same-endpoint lookalike fails
    identity or room checks, return a conflict and preserve all state. Recheck
    the stable key after payload generation and
    immediately before the write, then read back the exact payload before
    reporting success. Matrix state writes do not support conditional
    compare-and-set, so a concurrent write between the final read and write can
    still be replaced; the post-write check detects a changed payload and
    reports a conflict without rolling back. Do not replace or edit
    `io.element.widgets.layout` or any other widget state event.
11. If no trusted existing entry can be reused and required new-widget URL
    parameters are missing or invalid, stop before binding reservation or
    CalDAV access.
12. Keep setup failures phase-aware. A pending binding remains unavailable to
    consumers. A ready binding whose widget state write failed remains
    available to authorized widget, command, and reminder consumers; setup
    reports `widget-pending`, and retry repeats the widget check without
    creating another CalDAV collection. Do not roll back a ready binding or
    CalDAV collection after a Matrix write or reply failure. Replies use a
    bounded localized status only, with an empty `m.mentions` object.
13. Make ready dynamic bindings visible through the same registry used by
    widget room targets, bot commands, room event operations, reminder
    configuration, and scheduler delivery authorization. Resolve bindings
    asynchronously at request boundaries; the scheduler obtains a current
    bounded binding snapshot for each scan. This does not change the existing
    room-access, event-write, reminder configuration, delivery, action-message,
    principal-mode, encryption, or CalDAV authorization gates. Setup creates
    no reminder sidecar rows.
14. For rollback, disable `ROOM_CALENDAR_SETUP_ENABLED` and preserve the
    binding database, all binding rows, widget state, and CalDAV collections.
    Keep the database URL configured while existing dynamic bindings must
    remain usable. Removing a binding or collection requires a later lifecycle
    decision; setup does not add a cleanup or delete path.

## Consequences

- A moderator can set up a room without choosing a CalDAV collection. Setup
  succeeds only when the current bot can safely reply and write the calendar
  widget state event. An operator must keep the setup gate off until the
  binding store and integration contracts are ready.
- Static room/calendar mappings remain valid and unchanged. Static-only mode
  retains existing cardinality behavior; the 32-entry combined cap applies
  when the binding store is configured. Dynamic bindings become a second
  durable source only for rooms absent from static configuration, and every
  ready binding remains exact and one-to-one.
- The widget, bot commands, and existing reminder paths can resolve the same
  dynamic binding. Existing reminder gates, PostgreSQL state, and delivery
  behavior remain independent.
- A pending CalDAV operation can require moderator retry or operator review.
  Retaining its exact reservation avoids duplicate collections and avoids
  destructive guesses.
- A Matrix widget state failure can leave a ready calendar without its room
  widget entry. The result reports that phase and a retry installs the widget
  without another collection. No unrelated widget layout is changed.
- The selected Radicale principal still has whole-home `owner_only` access.
  The registry remains an application boundary, not a per-room Radicale ACL.
  ADR014's trust-domain and ADR037's independent-store requirements remain.
- Disabling setup does not delete or hide persisted ready bindings when the
  binding database remains configured. Removing the database URL would make
  those dynamic bindings unavailable, so that is not the rollback procedure.

## Acceptance gates

- Tests prove setup denies disabled, non-manager, non-member, encrypted, and
  encryption-unknown cases before database, widget-state, OpenID, or CalDAV
  work. They also prove bot membership and `m.room.message` plus widget-state
  power preconditions.
- PostgreSQL tests prove versioned initialization, one-to-one uniqueness,
  static conflicts, the total cap including static and pending rows,
  concurrent same-room reservation,
  stable pending retry after restart, exact pending-to-ready transition, and
  fail-closed persistence errors.
- CalDAV tests prove opaque IDs are server-selected, pending/new collections
  are writable and VEVENT-only, pending retry inspects only the exact reserved
  ID, ready/static collections are verified without rewriting mixed or
  read-only state, ready rows are not recreated, and ambiguous failures never
  delete or allocate another collection.
- Widget tests prove the current URL includes the safe gateway URL and the
  canonical room macro in a location read by the app, Widget API parameters
  remain Element-provided, stable-key retries do not duplicate the widget,
  credential-bearing URL parameters and URL user information fail before
  persistence or are rejected for current and legacy reuse,
  trusted `custom` and `m.custom` pilot entries are reused without rewriting their full
  payload, wrong identity/room/kind lookalikes conflict, unrelated state keys
  remain untouched, occupied keys are not overwritten, and Element layout
  state is not replaced.
- Registry tests prove static-only compatibility without a store, static
  precedence, ready-only dynamic resolution, complete one-to-one validation,
  and visibility through widget, command, event-operation, reminder
  configuration, and delivery paths after restart.
- Existing actor authorization, selected-principal, OpenID, encryption,
  credential-redaction, Radicale trust-domain, event serialization, reminder,
  and independent feature-gate contracts remain in force.
