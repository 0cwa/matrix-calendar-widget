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

## Consequences

- Master and recurrence readers preserve floating wall time without binding
  it to the server's timezone or replacing it with a UTC value.
- The typed master-event widget shows timed values in the viewer's local
  timezone, resolves floating values there, and filters by their interpreted
  instants while preserving source zones and floating values on writes.
- Duration-based recurrence timing retains enough information for a later
  expander to distinguish nominal calendar weeks/days from exact time units
  and account for timezone transitions.
- This decision does not implement recurrence expansion or recurrence edits.
