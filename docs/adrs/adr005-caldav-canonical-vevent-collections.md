# ADR005: CalDAV is canonical and new calendars are VEVENT-only

- Status: Accepted
- Date: 2026-09-22

## Context

Radicale exposes CalDAV collections that may advertise multiple component types such as VEVENT, VTODO, and VJOURNAL. Exposing that generic protocol model directly creates a confusing user experience, while VJOURNAL has little relevance to the intended team-calendar product.

The widget must also interoperate with ordinary CalDAV clients.

## Decision

Radicale/CalDAV is the canonical source of truth for calendar collections and iCalendar objects.

The user-facing abstraction is a **Calendar**.

Calendars created by this product advertise/support VEVENT only.

For existing collections:

- VEVENT-only collections behave normally.
- mixed collections expose their VEVENT subset but unsupported members are preserved.
- VTODO-only collections are hidden from the initial calendar UI.
- VJOURNAL-only collections are hidden by default.
- CardDAV collections are out of scope.

The application must avoid destructive rewrites of unknown iCalendar properties and unsupported components.

## Consequences

The widget can replace Radicale's basic collection-management UI for normal team calendars without pretending to be a generic DAV administration console.

A future tasks feature can deliberately introduce VTODO without changing the calendar mental model.
