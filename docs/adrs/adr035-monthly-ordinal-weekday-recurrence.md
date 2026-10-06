# ADR035: Bounded monthly ordinal weekday recurrence authoring

- Status: Accepted
- Date: 2026-10-06

## Context

The calendar editor can author simple monthly recurrence patterns but cannot
express rules such as the second Monday or last Friday of each month. The
recurrence model and projector already preserve unsupported rule data, so the
editor can add a small, explicit authoring subset without making arbitrary
RRULEs writable or changing the behavior of existing broader projections.

## Decision

1. Add one MONTHLY `BYDAY` selector: exactly one weekday with ordinal `1` through
   `5`, or `-1` for the last weekday of the month. The rule may also contain a
   positive `INTERVAL` and either `COUNT`, a compatible inclusive `UNTIL`, or
   neither. Other `BY*` parts, multiple selectors, `WKST`, yearly ordinal
   selectors, and other ordinal values remain outside this authoring subset.
2. The authored DTSTART must itself match the selected weekday and ordinal.
   The editor and codec reject a timing-only DTSTART change that no longer
   matches the stored rule. This keeps the initial DTSTART in the recurrence
   set and prevents it from consuming an unexpected COUNT occurrence. To
   change the selector to a different ordinal weekday, the user also changes
   DTSTART to a matching date.
3. Project matching rules by calendar month, skipping months without a fifth
   matching weekday. COUNT counts emitted matching dates; inclusive UNTIL
   retains the existing DATE, floating, UTC, and TZID handling. Timed events
   retain their local wall time and named timezone through offset changes.
4. Expose a “repeat by weekday” toggle with ordinal and weekday controls for
   MONTHLY rules. When enabling it, default both controls from DTSTART. The
   controls do not infer or rewrite unsupported source patterns.
5. Keep the stricter authoring parser separate from the existing general
   recurrence projection rules. Previously supported projections such as
   monthly multi-selector and yearly ordinal rules remain readable. Patterns
   outside this authoring subset remain read-only in the editor and are
   preserved on ordinary non-recurrence edits; attempts to replace their
   recurrence fail closed. This decision supersedes ADR023's no-ordinal
   authoring boundary only for this single MONTHLY selector; the existing
   weekly plain-BYDAY boundary is unchanged.
6. This addition does not expand ADR034's bounded this-and-following timing
   operation. Monthly ordinal rules remain ineligible for that operation until
   separately specified and validated.

## Consequences

The editor supports second Monday, last Friday, and equivalent single ordinal
weekday patterns while preserving unknown source recurrence data. The codec
validates the selector against DTSTART on recurrence writes and timing-only
edits. Arbitrary monthly RRULE authoring, multiple monthly selectors, and
yearly ordinal BYDAY authoring remain unsupported.

## Validation

Tests cover first, second, fifth, and last weekday selectors; COUNT and
inclusive UNTIL; short months; a TZID series crossing DST; opaque preservation
of unsupported rules and unknown iCalendar properties; and rejection of a
timing-only anchor change that no longer matches its selector. Widget tests
cover creating and editing the monthly ordinal controls.
