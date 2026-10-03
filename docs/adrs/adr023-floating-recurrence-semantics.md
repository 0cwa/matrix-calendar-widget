# ADR023: Preserve floating date-times and RFC durations

- Status: Accepted
- Date: 2026-09-28

## Context

The calendar domain must preserve the iCalendar value kind and timing
semantics so widget consumers and later recurrence expansion can interpret
values correctly. RFC 5545 Sections 3.3.5 and 3.3.6 define a DATE-TIME without
`TZID` and without a UTC marker as floating: it retains its local wall-clock
fields and has no timezone until an application interprets it.

## Decision

1. Master `DTSTART` and `DTEND` are tagged independently as either floating
   local date-times or zoned local date-times. Floating values keep their exact
   local wall-clock text and have no timezone field. Named-TZID values and UTC
   values remain zoned. Reading a floating value never converts it to the
   server timezone or UTC. A missing master `DTEND` remains rejected by the
   current codec boundary; the codec does not infer a duration.
2. Recurrence DATE-TIME values keep their existing explicit floating, DATE,
   named-TZID, or UTC tags. RDATE PERIODs and detached recurrence overrides
   preserve either an explicit end or the original RFC DURATION components
   alongside DTSTART. Week, day, hour, minute, and second components remain
   distinct. The codec does not calculate an end from a duration.
3. The approved application behavior interprets floating master values in the
   viewer's local timezone. All timed-event displays use the viewer's local
   timezone: floating wall times are interpreted there, and named-TZID/UTC
   values are converted from their saved timezone to the same instant in the
   viewer's timezone. Details, lists, visible calendar-cell times, accessible
   event labels, grid sorting, and in-memory range filtering use that behavior.
   Editor fields keep each endpoint's stored local wall-clock text: floating
   endpoints are interpreted in the viewer's local timezone for validation,
   while zoned endpoints are validated in their own timezone. When endpoints
   have different kinds or zones, the editor hides its single shared timezone
   field and retains each endpoint's original kind and zone when timing changes.
   Editing a title or other non-timing field preserves the original iCalendar
   resource; a timing update serializes floating endpoints without `TZID` or a
   UTC marker. Mixed floating and zoned endpoints retain their individual
   kinds. Recurrence projection interprets floating values in the viewer's local
   timezone and keeps RFC duration week/day units distinct from exact
   hour/minute/second units across timezone transitions.
4. The widget may expand a bounded, read-only occurrence projection from the
   typed event model for display. Occurrences keep a distinct view identity;
   details show the selected occurrence while reads and mutations retain the
   source CalDAV resource identity. Occurrence edits and deletes operate on the
   source series until explicit instance-edit semantics are implemented.
   Malformed or unsupported
   recurrence remains opaque with a diagnostic; `RANGE=THISANDFUTURE` series
   stay hidden and diagnosed. CalDAV candidate REPORT bounds may be widened by
   32 hours on each side for supported IANA zones in the 2026d data set. The
   authenticated gateway receives the explicit viewer IANA timezone, projects
   the candidates, and returns event details only for source resources with a
   supported occurrence intersecting the requested half-open interval. It
   returns count-and-reason diagnostics for opaque resources without their
   event details or ETags. The widget may keep defensive clipping for display.
   Do not rely on Radicale honoring `CALDAV:timezone` or claim arbitrary custom
   VTIMEZONE offsets. A recognized TZID is not sufficient when the resource
   embeds a different VTIMEZONE: definitions used by the master or a same-UID
   override must match the bundled transition rules by ordered
   STANDARD/DAYLIGHT observances, DTSTART, exact-second offsets, RRULE, and
   RDATE. Ignore only known non-transition metadata. Missing embedded
   definitions keep the exact bundled-IANA-ID behavior used by this project's
   writer. Unknown, duplicate, malformed, divergent, or unprovable definitions
   remain opaque before projection and contribute only count-and-reason
   diagnostics; their event details and ETags are suppressed. Preserve their
   original components on non-timing edits and reject timing edits while their
   timezone rules are unsupported. Projection never writes resources or
   collection timezone metadata.
5. Full recurrence editing, instance-edit semantics, and mainstream-client
   recurrence interoperability remain out of scope. The bounded editor may
   support the existing simple frequency rules and this additional weekly
   BYDAY subset: plain, unique weekday tokens including DTSTART's weekday, a
   positive safe-integer `INTERVAL` (defaulting to 1), no ordinal BYDAY values,
   and either no end, a positive `COUNT` across the whole series, or an
   inclusive `UNTIL` compatible with DTSTART's value kind. `WKST` must be
   omitted or `MO`, and no other rule parts are supported. Other weekly BYDAY
   combinations remain opaque and preserved. For an existing PERIOD-valued
   RDATE, the editor may remove one
   selected value by matching its complete start and either explicit end or
   original RFC DURATION components. It may also edit one supported PERIOD
   through an atomic replace operation containing the complete source value
   and its replacement. The source must match exactly one current PERIOD; a
   stale or ambiguous source, unsupported sibling, or replacement start that
   collides with another typed RDATE fails without changing the resource. A
   semantic no-op leaves the serialized resource untouched. A replacement
   preserves the source's explicit-end or duration representation, each
   endpoint's floating, UTC, or named-TZID identity, sibling order, property
   parameters, and all other resource data. Supported explicit-end values keep
   compatible endpoint kinds and zones and require the end to remain later
   than the start. The calendar write model and codec may add one explicit-end
   or duration-form PERIOD-valued RDATE to a supported timed recurring master
   without changing DTSTART. A PERIOD start retains its exact local value, and
   a TZID start requires its VTIMEZONE in the source VCALENDAR. Duration-form
   writes and edits require a positive RFC duration using supported integer
   components; zero, negative, fractional, malformed, unknown, and mixed
   week-and-time components are rejected. An exact repeated addition of the
   same PERIOD is a no-op. Malformed or unsupported source values remain opaque
   and cannot be changed.

## Implementation status and boundaries

PR #120 implements master floating parsing, exact local wall-time round trips,
title-only and timing edits, viewer-local presentation, and the in-memory
visible-range filter. The in-memory filter applies only to events already
returned by the repository; it does not establish viewer-local filtering by a
CalDAV server.

The widget now expands RRULE/RDATE candidates, applies EXDATE and same-resource
detached timing/status overrides, and clips occurrences to the exact
viewer-local half-open interval before either list or grid rendering. Expansion
is bounded to 512 displayed occurrences per resource; malformed or unsupported
rules remain hidden with a diagnostic. View IDs are synthetic; details show
the selected occurrence, while series-level reads and mutations keep the
source resource ID. Occurrence edit and delete actions apply to the full source
series; instance editing is not implemented. `RANGE=THISANDFUTURE` remains
hidden and diagnosed.

The pinned Radicale 3.8.0.0 server ignores `CALDAV:timezone`. CalDAV candidate
REPORT bounds are widened by 32 hours on each side without adding that
unsupported query child. The authenticated gateway then clips decoded source
resources against the requested interval using the explicit viewer timezone,
and returns ETags only for resources with supported intersecting occurrences.
Opaque resources contribute count-and-reason diagnostics without event
details or ETags. The widget retains defensive clipping before rendering. The
window is sized for supported IANA 2026d zones and does not establish support
for arbitrary custom VTIMEZONE offsets. The hosted Radicale contract includes
floating and DATE boundary candidates and checks that the read-only query
leaves resource ETags and bodies unchanged.

PR #121 adds the `@matrix-calendar-widget/ical-timezones` package generated
from IANA Time Zone Database 2026d. Its source and output provenance is recorded
in `docs/timezones-ical-data.md` and
`packages/ical-timezones/src/data/provenance.json`; package tests verify the
data hash and selected historical/current timezone offsets. The bounded
projector resolves named source and viewer zones only when their exact IDs
exist in that bundle, using pinned `ical.js` recurrence expansion reconciled to
the exact source observance offsets. Historical offset seconds are preserved
through the full encoded history, including Asia/Kolkata's `+05:53:20` offset
in 1855. An embedded VTIMEZONE used by the resource must also match the bundle's
ordered observance transition rules; a recognized TZID cannot override
conflicting rules. Missing definitions retain the bundled-ID fallback used by
the project writer. Unknown, duplicate, malformed, divergent, or unprovable
definitions remain opaque with a count-and-reason diagnostic and no event
details or ETag; the source component remains available for round-trip
preservation. This does not make CalDAV queries viewer-local.

Collection `Calendar.timezone` editing remains deferred under M4. Viewer-local
event interpretation does not read or write that collection property.

The bounded recurrence editor and codec support weekly BYDAY only for unique
plain weekday tokens that include DTSTART's weekday, a positive safe-integer
`INTERVAL`, and no ordinal tokens. The end may be open, a positive `COUNT`
across the whole series, or an inclusive `UNTIL` compatible with DTSTART's
value kind. `WKST` must be omitted or `MO`, with no additional RRULE parts.
The projector leaves other weekly BYDAY combinations opaque. An unrelated
event edit preserves the source RRULE and resource data.

PR #175 adds explicit-end and positive-duration PERIOD RDATE writes to the
calendar domain, codec, and in-memory adapter for supported timed recurring
masters, without changing DTSTART. Duration-form writes preserve the PERIOD
start's floating, UTC, or named-TZID identity and exact local value; a TZID
start requires its VTIMEZONE in the source VCALENDAR. Writes accept positive
RFC durations with supported integer components and reject zero, negative,
fractional, malformed, unknown, or mixed week-and-time components. An exact
repeated addition of the same PERIOD is a no-op; sibling recurrence values and
other resource data remain preserved. The widget supports duration-form entry
for timed recurring masters. The editor now changes one existing PERIOD using
an exact-match atomic replacement while preserving its explicit-end or
duration form, endpoint identity, and sibling RDATEs. Stale, ambiguous, or
colliding replacements fail closed; malformed and unsupported source values
remain opaque.

## Consequences

- Master and recurrence readers preserve floating wall time without binding
  it to the server's timezone or replacing it with a UTC value.
- The gateway returns only source resources with supported occurrences in the
  explicitly requested viewer-local interval. The widget shows selected
  occurrence details in the viewer's local timezone, resolves floating values
  there, and defensively filters returned events by their interpreted instants
  while preserving source zones and floating values on writes.
- Duration-based recurrence timing distinguishes nominal calendar weeks/days
  from exact time units and accounts for timezone transitions in the bounded
  display projection.
- PERIOD timing edits preserve whether a value uses an explicit end or an RFC
  duration, and leave sibling recurrence data in place. Exact source matching
  and collision checks prevent a stale edit from aliasing another recurrence
  value.
- The projection is read-only and bounded. The editor supports only the
  documented simple whole-series RRULE subset and weekly BYDAY subset; it does
  not implement instance edits, `RANGE=THISANDFUTURE`, or arbitrary custom
  VTIMEZONE offsets.
