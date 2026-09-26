# ADR016: Preserve detached exceptions during series edits

- Status: Accepted
- Date: 2026-09-26

## Context

A recurring VEVENT resource can contain a master plus detached exceptions. Each
exception is tied to its original, typed `RECURRENCE-ID`, even if the exception
has moved to a different `DTSTART`. Editing the master's `DTSTART`, `RRULE`,
`RDATE`, or `EXDATE` can otherwise leave an exception detached from the
resulting recurrence set. A resource-wide conditional PUT would then persist a
series that no longer contains the exception's original occurrence.

## Decision

- Before a series-set edit is written, compute the proposed membership from
  `DTSTART`, `RRULE`, `RDATE` (including PERIOD starts), and `EXDATE` using the
  resource's timezone data.
- Require every existing same-UID detached VEVENT's exact typed
  `RECURRENCE-ID` to remain in that set. Identity uses DATE versus DATE-TIME
  and the original floating, UTC, or TZID form; a moved `DTSTART` never
  replaces the original identity.
- Preserve all existing exception components and unknown resource data when
  membership remains. Never remap or silently delete an exception.
- Refuse the edit before PUT if an identity is absent or membership cannot be
  proven because of malformed, unsupported, or over-limit recurrence data.
  Return stable `recurrence-exception-orphaned` or
  `recurrence-exception-unverifiable` gateway error codes and keep the
  explanation visible in the editor.
- Do not recompute membership for unrelated event-field edits. Keep
  `RANGE=THISANDFUTURE` opaque; check its original anchor like any other
  recurrence identity without applying range semantics.

## Consequences

Series edits cannot persist a master that silently strands existing detached
exceptions. Some edits to unsupported or very large recurrence sets may be
refused until the recurrence can be checked safely. The CalDAV resource and
its exception components remain unchanged after a refusal.
