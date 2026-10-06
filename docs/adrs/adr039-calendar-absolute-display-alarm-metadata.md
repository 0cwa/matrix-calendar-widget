# ADR-039: Calendar-only absolute DISPLAY alarm metadata

**Status:** Accepted
**Date:** 2026-10-06

## Context

The calendar editor currently supports a non-repeating DISPLAY alarm whose
TRIGGER is a negative DURATION relative to the event start. Matrix room
reminder delivery deliberately accepts only relative DURATION triggers and
binds a stored choice to that trigger's current identity. An absolute UTC
TRIGGER has different timing semantics and is not an occurrence-relative
Matrix reminder.

## Decision

The calendar editor may read, create, update, and remove one non-repeating
`ACTION:DISPLAY` VALARM with
`TRIGGER;VALUE=DATE-TIME:YYYYMMDDTHHMMSSZ`. The application model represents
this as an absolute trigger with an ISO UTC value ending in `Z`. The editor
asks for an explicit UTC timestamp.

This support is calendar metadata only. It does not add absolute triggers to
Matrix reminder options, configuration, scheduling, due scans, or delivery.
A stored relative reminder choice is not usable when the current calendar
source has changed to an absolute trigger; configuration and the scheduler
continue to fail closed.

Only one DISPLAY alarm without REPEAT or VALARM DURATION is editable. The
codec retains the VALARM UID, DESCRIPTION, and unknown alarm properties when
editing a supported alarm. Malformed, duplicate, floating, TZID-based, or
otherwise unsupported alarm data remains opaque and is preserved through
unrelated event edits. EMAIL, AUDIO, repeats, and attachments remain outside
this decision.

## Consequences

Users can store an absolute alarm for calendar clients that support it. The
editor explains that this alarm is saved in the calendar and is unavailable
for Matrix room reminder delivery. Client notification behavior remains
dependent on the calendar client.

RFC 5545 defines an absolute TRIGGER as a DATE-TIME in UTC and restricts the
RELATED parameter to DURATION-valued triggers:
[RFC 5545, section 3.8.6.3](https://www.rfc-editor.org/rfc/rfc5545#section-3.8.6.3).
