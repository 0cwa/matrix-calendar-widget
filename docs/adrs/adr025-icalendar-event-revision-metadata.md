# ADR025: Manage iCalendar event revision metadata

Status: accepted
Date: 2026-10-03

## Context

The CalDAV codec preserves source VEVENT properties while patching the fields
the calendar domain supports. It previously left `DTSTAMP`, `CREATED`,
`LAST-MODIFIED`, and `SEQUENCE` unchanged during edits and wrote none when it
created a VEVENT. Those properties describe an event's creation and revision;
clients need stable creation time and current revision information. The codec
does not implement iTIP delivery or organizer/attendee scheduling workflows.

Issue #6 also calls for organizer/attendee round-trip and safe attachment and
conference handling. This decision covers revision metadata only. It must not
infer participant addresses or registration state, or rewrite properties the
domain does not edit.

## Decision

1. When the codec creates a VEVENT, it writes `DTSTAMP`, `CREATED`, and
   `LAST-MODIFIED` from one clock reading and writes `SEQUENCE:0`. The clock is
   injectable for deterministic tests. Values are UTC and have whole-second
   RFC 5545 precision.
2. When a patch changes the serialized master VEVENT, the codec updates
   `DTSTAMP` and `LAST-MODIFIED` from one clock reading and increments
   `SEQUENCE` exactly once. A missing `SEQUENCE` has RFC's default value of
   zero and becomes one on the first effective edit. A semantic no-op leaves
   all revision metadata unchanged. An existing `CREATED` is never changed;
   edits do not add `CREATED` when it is absent.
3. The codec increments only a single `SEQUENCE` in the RFC 5545 `INTEGER`
   non-negative range `0..2147483647` ([Section 3.3.8](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.3.8)
   and [Section 3.8.7.4](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.8.7.4)). If
   `SEQUENCE` is malformed, duplicated, negative, or above that range, an
   effective edit may still change its supported event fields, but the
   complete revision metadata set is left as received. A sequence already at
   `2147483647` remains valid read-only data, but an edit does not advance any
   revision metadata because the next value is out of range. If `DTSTAMP` or
   `LAST-MODIFIED` is duplicated or is not one valid
   UTC DATE-TIME value, including a calendar date or time that ical.js would
   normalize while parsing, the codec likewise leaves the revision metadata
   set unchanged. The codec checks the unfolded source content lines
   before relying on the parsed component because the parser can normalize
   malformed integer or date-time values. It does not guess which value to
   retain or normalize.
4. The domain exposes validated revision metadata as read-only event data.
   Timestamp values use `YYYY-MM-DDTHH:mm:ssZ`. Event creation inputs and
   patches cannot write these fields. Invalid or duplicate values stay in the
   source iCalendar resource and are omitted from the domain projection.
   Timestamp values that cannot be represented at whole-second UTC precision,
   including leap-second values, remain opaque.
5. Organizer, attendee, attachment, conference, and other uninterpreted
   properties remain outside this editable metadata model. Ordinary edits
   preserve their complete source properties and parameters; the codec does
   not infer email addresses, RSVP state, or registration.

## Consequences

New VEVENTs have a stable creation timestamp and initial sequence, while an
effective local edit gives clients a fresh UTC revision timestamp and a single
sequence increment. Existing `CREATED` is never changed, and repeated no-op
operations do not create artificial revisions. Malformed or ambiguous
metadata remains preserved even when that prevents revision fields from
advancing. The sequence increment reports a local resource edit; it does not
imply that this application sent an iTIP scheduling message or requested
attendee re-acceptance.

The regression fixture covers a normal title edit alongside organizer,
attendee, attachment, conference, alarm, and creation metadata. Broader
participant editing and attachment/conference semantics remain outside this
decision.
