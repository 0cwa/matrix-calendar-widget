# ADR018: Edit only existing DISPLAY alarm triggers and descriptions

- Status: Accepted
- Date: 2026-09-26

## Context

CalDAV resources can contain multiple `VALARM` components, including actions
such as `DISPLAY`, `EMAIL`, `AUDIO`, and extension actions. The calendar widget
must preserve the full iCalendar resource when editing an event. Treating all
alarms as editable or actionable could change data owned by another client or
cause notifications to be sent unexpectedly. Matrix reminder recipients and
delivery remain separate sidecar work under ADR007.

## Decision

- Expose only existing `ACTION:DISPLAY` alarms on the master VEVENT in the event
  response, with a resource-order index, description, and relative trigger only
  when the trigger is representable as a whole number of minutes. The index is
  scoped to the resource version and is protected by the existing conditional
  event update.
- Accept edits only for the trigger and description of an existing DISPLAY
  alarm. The codec validates that the indexed component still has exactly one
  DISPLAY action and edits only those property values in a cloned resource.
  Existing property parameters and every other property/component remain
  untouched. Missing or ambiguous target components fail before PUT.
- Keep DISPLAY triggers in unsupported forms visible but read-only. Do not
  normalize them to minutes or rewrite them during unrelated edits.
- Do not expose or execute EMAIL, AUDIO, or other alarm actions. Do not add or
  remove alarms, schedule or send notifications, add Matrix recipients, or
  change reminder sidecar behavior.
- Keep new event creation alarm-free unless a separate decision defines alarm
  creation semantics.

## Consequences

The editor supports a small, reviewable DISPLAY subset while retaining the
complete VALARM components in CalDAV. Other alarm actions and source properties
remain inert and unchanged; scheduling and Matrix-specific delivery stay
outside this editor.
