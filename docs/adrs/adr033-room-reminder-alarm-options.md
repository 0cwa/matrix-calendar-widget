# ADR033: Bounded room reminder alarm options

- Status: Accepted
- Date: 2026-10-03

## Context

ADR028 stores only the canonical room, bound calendar, event, recurrence, and
alarm identity. A manager-facing editor still needs to discover which existing
alarms in a selected room event satisfy the delivery policy, including
END-relative and repeating DISPLAY alarms, without exposing event content or
accepting client-authored timing as proof of a valid source alarm.

## Decision

1. Add a read-only
   `GET /v1/calendar/rooms/:roomId/reminders/options?eventId=...` endpoint.
   It accepts exactly one direct `.ics` resource URL, resolves it through the
   exact operator-configured room/calendar binding, and reads the current
   resource using the authorized application-service principal. It does not
   accept a recipient, event UID, alarm UID, principal, credential, or URL
   base from the caller.
2. Require the same default-off reminder-configuration and room-calendar
   access gates, an enabled reminder store, current authenticated Matrix
   actor, current room membership, manage action power, and exact room/calendar
   binding as the configuration API. Require a successful current encryption
   state lookup that confirms the room is unencrypted before reminder store
   access, application-service proof, or CalDAV reads. Encrypted rooms and
   unknown encryption state receive generic errors. Complete actor and binding
   checks before requesting application-service proof or reading CalDAV.
   Responses use `Cache-Control: no-store`.
3. Prepare the raw resource once and reuse the canonical identity resolver and
   trigger validator. Return only an array of eligible options containing the
   canonical `eventUid`, typed `recurrenceId` (null for a master), stable
   `alarmUid`, `relatedTo`, signed relative trigger duration, and optional
   repeat count and interval. The UI matches these identities to its currently
   selected event; the UID comes from the validated source and is never
   caller-authored. Never return event titles, descriptions, arbitrary
   iCalendar properties, raw source, DAV URLs, ETags, credentials, or
   actor/principal data.
4. Offer only uniquely resolvable stable-UID DISPLAY alarms whose event timing,
   recurrence identity, raw trigger syntax, timezone, repeat shape, and full
   schedule meet ADR028's current source policy. Unsupported or ambiguous alarm
   candidates are omitted. A later configuration PUT re-reads and revalidates
   the source; an options response is not an authorization token or a promise
   that the alarm remains current.
5. Bound one source inspection to at most 64 total VALARMs, 1,024 components,
   4,096 properties, and 8,192 physical lines, in addition to the existing
   CalDAV response-byte limit. Reject the whole request with one fixed
   unavailable response when a resource exceeds these bounds or cannot be
   parsed safely; never return a truncated option list or include source
   failure details.

## Consequences

- The editor can select supported existing START-relative, END-relative, and
  repeating DISPLAY alarms while the server remains authoritative about the
  current source and delivery limits.
- The endpoint is a bounded metadata projection. It adds no persistent state,
  alarm writer, scheduler, sender, or user-selected CalDAV access path.
- A source change between listing and saving is handled by revalidation during
  PUT, which may reject an option that was previously displayed.
