# ADR027: Restrict free/busy to an authorized, minimal projection

- Status: Accepted
- Date: 2026-10-03

## Context

Free/busy intervals can reveal a person's work and personal schedule even when
calendar titles and attendees are hidden. The repository treats free/busy as
sensitive data, but has no free/busy API or widget surface. A future availability
feature must use the existing calendar read boundary and the project's bounded
VEVENT/timezone semantics without exposing source event details or implying
availability when an event cannot be interpreted.

Existing room-context access checks current membership and action power, while
the app-principal room-calendar path remains disabled pending M6 authorization,
appservice, cross-room-isolation, and deployment contracts. The static
room/calendar binding is an authorization input, not a grant that may be
inferred from an event attendee or from membership in a different room.

## Decision

1. **Treat intervals as sensitive derived calendar data.** Compute a projection
   from canonical CalDAV VEVENT resources on demand. Do not persist it, copy it
   into the reminder store, or place it in a shared cache. A future HTTP route
   must return `Cache-Control: no-store` unless an equivalent requester-scoped
   cache is separately reviewed and reauthorizes every read.
2. **Require the same explicit read authorization as the source calendar.**
   Personal requests must be authenticated as the calendar owner's validated
   Matrix user. A room-target request must repeat the current membership and
   applicable read authorization checks, resolve the exact server-managed
   room/calendar binding, and reject target mismatches before CalDAV I/O. These
   checks run for every request. The room-owned path stays disabled until the
   separate M6 appservice and deployment gates pass. Do not grant cross-room
   access, infer consent from room membership, attendees, contacts, or
   presence, or allow free/busy to select an otherwise inaccessible calendar.
3. **Return the minimum result.** A successful response contains only the
   explicit viewer IANA timezone and a list of coalesced busy intervals. Clip
   intervals to the requested half-open range and encode endpoints as UTC
   instants. Do not return calendar IDs/names/hrefs, event UIDs/ETags, event
   content, people or email addresses, meeting URLs, alarm or recurrence
   details, or source privacy/transparency values. Never include raw source
   resources in errors, metrics, or routine logs. `CLASS:PRIVATE` and
   `CLASS:CONFIDENTIAL` events follow the same busy-time rules as other events
   but reveal no additional source data and do not widen the read boundary.
4. **Require a bounded, explicit time request.** A future query must include
   supported IANA viewer timezone data and finite instants with `start < end`.
   Interpret the interval as `[start, end)`, require a range no longer than
   744 consecutive hours (31 × 24 hours), and do not silently truncate. Use
   that viewer timezone to interpret `DATE` day boundaries and floating DATE-TIME values according to
   [ADR023](./adr023-floating-recurrence-semantics.md). Return only intervals
   that intersect the requested range, clipped to its endpoints.
5. **Apply deterministic VEVENT inclusion rules.** Project through the
   existing bounded recurrence semantics in ADR023, including its 512
   projected-occurrence-per-resource limit. `STATUS:CANCELLED` contributes no
   busy interval; `STATUS:TENTATIVE`, `STATUS:CONFIRMED`, and an absent STATUS
   are busy unless `TRANSP:TRANSPARENT` makes the event transparent. Missing
   transparency defaults to opaque and is busy. An unsupported status,
   transparency value, timezone, recurrence, malformed timing, or expansion
   beyond the supported projection limit makes the
   entire query unavailable. Never omit an opaque candidate and return a
   success-shaped result that implies it is free. A successful empty interval
   list means every candidate VEVENT was safely examined and none was busy.
6. **Do not make MSC4496 a dependency.** The result is a gateway projection
   policy, not a requirement for MSC4496 availability endpoints or a
   homeserver-specific event type.
7. **Keep this ADR policy-only until implementation gates pass.** There is no
   availability endpoint or UI in the current source. Before one is added,
   prove authorization-before-CalDAV behavior, output minimization, redaction,
   interval semantics, and failure cases described in
   [the free/busy privacy model](../free-busy-privacy.md). The 31-day cap does
   not replace M8 request rate and response-size limits.

## Consequences

- Free/busy remains unavailable to users until a future implementation passes
  the stated authorization, correctness, and privacy checks.
- Callers that already have explicit read access may receive a limited timing
  projection only within that same calendar context. Being authorized in one
  room does not authorize access to a different room's calendar.
- Private and confidential event classes do not suppress intervals from an
  already-authorized reader, but no source event metadata is returned. Busy
  intervals themselves remain sensitive.
- Unsupported source data causes a generic unavailable result rather than a
  false assertion of free time or a partial projection.
- An eventual UI or API that broadens sharing, changes event inclusion rules,
  adds cross-calendar aggregation, persists availability, or changes the
  authorization boundary requires a new review and ADR.
