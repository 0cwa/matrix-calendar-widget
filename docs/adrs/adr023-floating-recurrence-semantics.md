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
   kinds. Recurrence expansion also interprets floating values in the viewer's
   local timezone, with RFC duration and timezone-transition handling owned by
   downstream expansion.
4. Recurrence editing, `RANGE` handling, and recurrence expansion remain out
   of scope.

## Implementation status and boundaries

PR #120 implements master floating parsing, exact local wall-time round trips,
title-only and timing edits, viewer-local presentation, and the in-memory
visible-range filter. The in-memory filter applies only to events already
returned by the repository; it does not establish viewer-local filtering by a
CalDAV server.

The current CalDAV `calendar-query` sends UTC range bounds without a viewer-zone
context. The pinned Radicale 3.8.0.0 server ignores `CALDAV:timezone`, so
viewer-local floating-event selection at the server query boundary remains
unimplemented. Do not add that unsupported query child for this server. A
supported, tested server-query strategy remains separate work. Viewer-local
recurrence occurrence projection and duration expansion also remain
unimplemented.

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
- Duration-based recurrence timing retains enough information for a later
  expander to distinguish nominal calendar weeks/days from exact time units
  and account for timezone transitions.
- This decision does not implement recurrence expansion or recurrence edits.
