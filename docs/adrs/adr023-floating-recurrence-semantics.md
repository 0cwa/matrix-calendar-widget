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
   typed event model for display. Occurrences keep a distinct view identity and
   map actions back to the source CalDAV resource. Malformed or unsupported
   recurrence remains opaque with a diagnostic; `RANGE=THISANDFUTURE` series
   stay hidden and diagnosed. CalDAV candidate REPORT bounds may be widened by
   32 hours on each side for supported IANA zones in the 2026d data set, then
   clipped to the exact viewer-local half-open interval in the widget. Do not
   rely on Radicale honoring `CALDAV:timezone` or claim arbitrary custom
   VTIMEZONE offsets. Projection never writes resources or collection timezone
   metadata.
5. Recurrence editing and mainstream-client recurrence interoperability remain
   out of scope.

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
rules remain hidden with a diagnostic. View IDs are synthetic and selection
maps back to the source resource ID. `RANGE=THISANDFUTURE` remains hidden and
diagnosed; recurrence editing is not implemented.

The pinned Radicale 3.8.0.0 server ignores `CALDAV:timezone`. CalDAV candidate
REPORT bounds are widened by 32 hours on each side without adding that
unsupported query child; exact clipping remains in the widget. The window is
sized for supported IANA 2026d zones and does not establish support for
arbitrary custom VTIMEZONE offsets. The hosted Radicale contract includes
floating and DATE boundary candidates and checks that the read-only query
leaves resource ETags and bodies unchanged.

PR #121 adds the `@matrix-calendar-widget/ical-timezones` package generated
from IANA Time Zone Database 2026d. Its source and output provenance is recorded
in `docs/timezones-ical-data.md` and
`packages/ical-timezones/src/data/provenance.json`; package tests verify the
data hash and selected historical/current timezone offsets. This data evidence
does not complete the broader application DST and named-timezone regression
suite or make CalDAV queries viewer-local.

Collection `Calendar.timezone` editing remains deferred under M4. Viewer-local
event interpretation does not read or write that collection property.

## Consequences

- Master and recurrence readers preserve floating wall time without binding
  it to the server's timezone or replacing it with a UTC value.
- The typed master-event widget shows timed values in the viewer's local
  timezone, resolves floating values there, and filters already-loaded events
  by their interpreted instants in memory while preserving source zones and
  floating values on writes.
- Duration-based recurrence timing distinguishes nominal calendar weeks/days
  from exact time units and accounts for timezone transitions in the bounded
  display projection.
- The projection is read-only and bounded; it does not implement recurrence
  edits, `RANGE=THISANDFUTURE`, or arbitrary custom VTIMEZONE offsets.
