# ADR017: Support representable “this and following” timing edits

- Status: Accepted
- Date: 2026-09-26

## Context

RFC 5545 defines `RECURRENCE-ID;RANGE=THISANDFUTURE` as an exception whose
original recurrence identity remains fixed while its start-time difference and
duration apply to the boundary instance and later instances. The existing
single-instance operation edits only one detached component. A series-wide
write would be unsafe for a following edit because arbitrary properties,
recurrence-set changes, and unknown range payloads cannot be inferred safely.

## Decision

- Support a distinct following-scope operation that carries the backing
  resource identity, the exact typed original `RECURRENCE-ID`, and new timing
  only. Authorize as `update-event`, fetch the current resource, and write one
  conditional PUT with the resource ETag. Do not retry a conflict.
- Encode the boundary as a same-resource VEVENT with the master UID and
  `RECURRENCE-ID;RANGE=THISANDFUTURE`. Keep the original recurrence identity;
  never replace it with the moved DTSTART.
- Apply the start-time difference between the original recurrence identity and
  boundary DTSTART to that boundary and later instances. Apply the boundary
  duration to those instances. Leave earlier instances unchanged. An ordinary
  detached exception at a later recurrence identity remains independently
  defined and takes precedence over the range transformation.
- Expose the range in the domain model only when the component is a timing-only
  override in the master’s DATE/DATE-TIME mode and timezone. Preserve unknown
  properties in the cloned VCALENDAR resource.
- Fail before PUT when range fields are ambiguous, the target is not a member of
  the recurrence set, duplicate components exist, the time mode is incompatible,
  or timezone/recurrence data cannot be verified. Return a stable visible error
  and leave the fetched source unchanged. Preserve unsupported range payloads
  and report them through ADR011’s response-only diagnostic.
- In the widget, make “this and following” an explicit action. That editor
  changes start time and duration only; it cannot change title, descriptive
  fields, recurrence rules, timing type, or timezone.
- Do not split the series, change UID, rewrite RRULE/RDATE/EXDATE, or infer the
  meaning of unknown range component properties.

## Consequences

The implementation supports the interoperable timing subset of RFC 5545
following-instance semantics without rewriting the master recurrence set.
Unsupported or ambiguous range components remain intact but do not expand or
accept following-scope edits. Whole-series editing and broader range payloads
remain separate work.
