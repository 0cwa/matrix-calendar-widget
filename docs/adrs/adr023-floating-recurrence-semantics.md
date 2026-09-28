# ADR023: Preserve floating recurrence values and RFC durations

- Status: Accepted
- Date: 2026-09-28

## Context

The recurrence read view must preserve the iCalendar value kind and timing
semantics so later recurrence expansion can interpret each occurrence
correctly. RFC 5545 Sections 3.3.5 and 3.3.6 define a DATE-TIME without `TZID`
and without a UTC marker as floating: it retains its local wall-clock fields
and has no timezone until an application interprets it.

## Decision

1. The recurrence domain view tags floating DATE-TIME values explicitly and
   stores their exact local wall-clock text. DATE values, named-TZID/UTC
   DATE-TIME values, and floating DATE-TIME values remain distinct. Reading a
   floating recurrence value does not convert it to the server timezone or to
   UTC.
2. The previously approved application behavior interprets floating
   recurrence values in the viewer's local timezone for display and occurrence
   expansion. That interpretation belongs to downstream recurrence
   consumers; the codec only preserves the value and its tag.
3. RDATE PERIODs and detached recurrence overrides preserve either an explicit
   end or the original RFC DURATION components alongside DTSTART. Week, day,
   hour, minute, and second components remain distinct. The codec does not
   calculate an end from a duration. Downstream expansion is responsible for
   applying RFC 5545 duration and timezone-transition rules.
4. This decision covers recurrence metadata only. Existing master-event
   floating DATE-TIME consumers are unchanged by this slice. Recurrence
   editing and `RANGE` handling remain out of scope.

## Consequences

- Recurrence readers preserve floating wall time without binding it to the
  server's timezone or replacing it with a UTC value.
- Duration-based recurrence timing retains enough information for a later
  expander to distinguish nominal calendar weeks/days from exact time units
  and account for timezone transitions.
- This read-view decision does not implement recurrence expansion or change
  how existing master-event timing is interpreted.
