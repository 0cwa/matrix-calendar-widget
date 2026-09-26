# ADR013: Use viewer-local time for recurrence presentation

- Status: Accepted
- Date: 2026-09-26

## Context

The widget expands recurring events into a requested visible instant range.
DATE and floating DATE-TIME values do not contain a timezone, while each
calendar may have a configured timezone. Using that calendar setting can put
the same floating event on a different viewer-local day and can make range
inclusion disagree with the calendar grid and event labels.

## Decision

- Interpret DATE and floating recurrence values in the browser viewer's local
  timezone when expanding them into the visible range.
- Render floating timed occurrences in that same viewer-local timezone across
  the calendar grid, day grouping, list/month labels, and details.
- Keep DATE events date-only. Keep explicit UTC and TZID values anchored to
  their encoded timezone.
- Do not read, rewrite, or otherwise change the stored `Calendar.timezone`
  property or iCalendar objects as a result of this presentation policy.
- Keep unsupported recurrence constructs, including `RANGE=THISANDFUTURE`,
  preserved and visibly unsupported; this decision does not add recurrence
  interpretation or editing behavior.

## Consequences

DATE/floating recurrence visibility and labels follow the viewer's local day
boundaries even when a calendar advertises another timezone. Different viewers
may therefore see a floating event at their own local wall time, as required
by floating DATE-TIME semantics. A future product change to calendar-zone
presentation would require a new explicit decision and matching range, grid,
and label behavior.
