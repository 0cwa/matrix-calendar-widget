# Free/busy privacy model

Free/busy data reveals when a person or group is unavailable even when it omits
event titles. Treat it as sensitive calendar data under [AGENTS.md](../AGENTS.md)
and the [security policy](../SECURITY.md). This document sets the privacy and
projection rules for any future availability feature. **There is no free/busy
API, widget surface, or cross-calendar sharing feature in the current source.**
This policy does not mean the behavior is implemented or available to users.

The decisions are recorded in [ADR027](./adrs/adr027-free-busy-privacy-boundary.md).
A future implementation must complete the acceptance checks there before
exposing an endpoint or UI.

## Who may request availability

Free/busy may be computed only for a calendar the requester can already read
through the product's explicit server-side calendar authorization. Availability
is a reduced view of that same protected calendar data, not a way to bypass
its read boundary.

- A personal calendar request must be authenticated as that calendar's
  validated Matrix user. A client-supplied user ID alone is not proof.
- For a room-target request, the server must recheck the requester's current
  room membership and applicable read authorization, resolve the exact
  server-managed room-to-calendar binding, and reject mismatches before any
  CalDAV discovery or read. Recheck on every request; do not rely on cached
  membership or a prior binding result.
- Room-owned CalDAV access remains disabled until the separate M6 appservice,
  authorization, cross-room-isolation, and deployment contracts pass. This
  privacy model does not relax that gate.
- A room membership, shared attendee, Matrix contact, or presence in another
  room does not grant access to another room's calendar. Do not infer consent
  to cross-room or personal-calendar sharing. Any future cross-calendar
  disclosure needs a separate explicit authorization and consent decision.

Denied, missing, ambiguous, or cross-room targets must fail before CalDAV
access and must not be converted into an empty availability response that
could be mistaken for “free.”

## Response data

A successful response contains only the explicit viewer timezone and coalesced
busy intervals clipped to the requested range. Its future contract is limited
to this information (shown illustratively, not as a current endpoint):

```json
{
  "timeZone": "Europe/Paris",
  "busy": [{ "start": "2026-10-03T08:00:00Z", "end": "2026-10-03T09:00:00Z" }]
}
```

Do not return or expose in headers, diagnostics, or routine logs a calendar
name or ID, CalDAV href/URL, event UID, ETag, title, description, location,
organizer, attendee or email address, conference link, alarm, recurrence rule,
source transparency/classification, or raw iCalendar data. Do not persist a
free/busy projection in the reminder database or copy event details into an
availability cache. Future HTTP responses must not enter a shared cache; use
`Cache-Control: no-store` unless a separately reviewed design establishes an
equivalent requester-scoped cache that reauthorizes every read.

`CLASS:PRIVATE` and `CLASS:CONFIDENTIAL` events may contribute a busy interval
only when the caller already passes the same calendar read authorization as
for other events. Those classes never reveal source details or widen access.
The result does not distinguish private from public events. This is a
minimization rule, not a claim that busy intervals are non-sensitive.

## Interval and event semantics

A future request must provide an explicit, supported IANA viewer timezone and
a finite start/end interval with `start < end`. Interpret the requested range
as half-open `[start, end)` and normalize interval endpoints to UTC instants
for the response. Reject ranges longer than 744 consecutive hours (31 × 24
hours); do not silently truncate them. The timezone is required to interpret
DATE and floating values even though returned endpoints are UTC.

Use the existing supported read-only event projection described in
[ADR023](./adrs/adr023-floating-recurrence-semantics.md), bounded by its
recurrence limits. Project only VEVENT data under [ADR005](./adrs/adr005-caldav-canonical-vevent-collections.md).
For events the projector can safely interpret:

- `STATUS:CANCELLED` does not contribute busy time, including a supported
  cancelled recurrence override.
- `TRANSP:TRANSPARENT` does not contribute busy time. Missing or `OPAQUE`
  transparency is busy by default.
- `STATUS:TENTATIVE`, `STATUS:CONFIRMED`, and an absent STATUS are busy.
  Tentative time is not evidence that the person is free. An unsupported
  status value fails closed.
- A `DATE` event maps its exclusive start/end dates to viewer-zone local-day
  boundaries. A floating DATE-TIME is interpreted in the explicit viewer
  timezone, following ADR023. Named timezone and UTC events retain their
  represented instants and are clipped to the viewer's half-open range.
- Supported RRULE, RDATE, EXDATE, and detached-override behavior follows the
  bounded recurrence projector, its 512 projected-occurrence-per-resource
  limit, and its current supported timezone data. Merge overlapping or
  adjacent busy intervals before returning them.

If any candidate event cannot be interpreted safely, including an unsupported
recurrence or timezone, malformed timing, or recurrence expansion beyond the
supported limit, the server must not report a successful partial result that
implies the unknown time is free. Fail the entire request with a generic
unavailable error and no partial interval list or resource-specific diagnostic.
An empty `busy` list is valid only when the full bounded query completed and
all candidate VEVENTs were safely accounted for.

## Implementation gates

Before any API route or UI is added, its implementation must:

1. Reuse server-side identity validation and the existing read authorization
   rules; recheck membership, binding, and target equality before CalDAV I/O.
2. Prove that denial, missing authorization state, unsupported targets, and
   cross-room identifiers make no CalDAV request and do not return a
   success-shaped empty result.
3. Enforce the explicit timezone, maximum range, recurrence/resource limits,
   half-open clipping, and interval coalescing. The 31-day range cap alone is
   not rate limiting or a response-size limit; those M8 controls also need to
   be in place.
4. Test transparent, opaque/default, tentative, cancelled, private, and
   confidential events; DATE and floating values across timezone transitions;
   supported recurrence exceptions; and fail-closed handling of opaque
   resources.
5. Verify an output allowlist and log redaction so no source event, person,
   collection, or CalDAV identifier leaks through response bodies, headers,
   errors, metrics, or routine logs. Do not send real notifications from
   privacy tests.

Until those gates pass, free/busy remains a documented policy only, not an
implemented feature or a new authorization grant.
