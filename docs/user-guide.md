# Using the calendar

[Documentation](./README.md) · [Room setup and commands](./bot-calendar.md) · [Current feature status](./STATUS.md)

This guide describes the features merged into `main`. Your installation may enable only some of them. The controlled pilot targets the standard Element Web/Desktop side panel; broader client support is still being validated.

## Open a room calendar

Open the calendar widget in your Matrix room and approve the requested identity access if you want to use it. The widget uses Matrix OpenID to authenticate to its gateway; it does not ask for your Matrix password.

A room needs an enabled calendar service and a room-to-calendar binding. If the widget shows that no calendar is configured, ask a room moderator or the server administrator. Where the operator has enabled moderator setup, an authorized moderator can use `!calendar setup`. Inviting the bot alone does not configure the calendar. See [room setup](./bot-calendar.md) for the prerequisites and exact command syntax.

## Browse calendars and events

Use the date controls to move through the calendar. Narrow room panels offer list and day views; work-week, week, and month become available when the widget viewport is at least 800 CSS pixels wide. List view is useful in the standard narrow side panel. Calendar visibility controls choose which available calendars are shown; hiding a calendar does not delete it.

Open an event to see its time, title, description, location, and other supported fields. Timed events and all-day events have different calendar semantics. All-day event end dates are exclusive in iCalendar; the UI handles the date range for display.

The view is a bounded projection, not a complete export of the CalDAV store. Some unsupported recurrence or timezone forms may not appear. Diagnostic warnings describe forms the projector recognizes; a warning-free view does not guarantee that every source resource is visible. Ask the operator to inspect or export unsupported source data using authorized tooling, and retain backups before making changes. Conventional private calendar-client credentials are not yet available.

## Create and edit events

Use the calendar's create action when it is available. Choose the destination calendar and enter the title and timing, then add optional details. Room event writes depend on both server configuration and your current room permissions; being able to view a calendar does not guarantee that you can edit it.

The editor exposes title, description, location, timing, bounded recurrence, one safe conference link, supported URI attachment operations, and supported display-alarm metadata. Other iCalendar properties can be read or preserved without having an authoring control. Supported edits retain source properties the widget does not understand instead of silently replacing the complete event.

If another client changes the event before your save, the server rejects the stale version. Reload the current event, review the other change, and apply your edit again. Do not treat a conflict as evidence that the event was lost.

Deletion requires confirmation and is limited to source resources the application can safely delete. A mixed or ambiguous source can be refused to protect data outside the selected event.

## Edit a recurring event

The editor makes the choice between a selected occurrence and the series explicit where the operation is supported. The current subset includes common daily, weekly, monthly, and yearly rules, selected-occurrence timing and text changes, and skip/restore operations. Some following-occurrence timing edits are supported only for finite series of at most 128 members and have further restrictions.

Arbitrary recurrence rules, general series splitting, and every possible occurrence property are not supported. If a particular edit is unavailable, keep the original data and ask the operator to inspect it with authorized tooling rather than simplifying the rule just to make the widget accept it. The [implementation plan](./PLAN.md#m5--recurrence-and-icalendar-completeness) links to the precise supported boundaries.

## Manage calendars

Where the server and your permissions allow it, create an event-only calendar, change its name, description, or color, or delete it with the required safeguards. Collection timezone editing remains deferred.

Existing calendars containing both events and tasks or journal entries can expose their event subset, but the application must retain the other components. Task-only and journal-only collections are hidden from the main calendar UI.

Room-calendar setup is separately controlled. The setup command creates or reconciles one binding; it is not a general room-calendar deletion or rebinding tool.

## Calendar alarms and Matrix reminders

A calendar alarm records when an event should remind a calendar client. Matrix delivery is a separate setting stored by the gateway. A saved alarm does not automatically send a Matrix message.

On the documented `main` baseline, authorized managers can configure whole-room Matrix reminders for supported relative DISPLAY alarms on timed events with a resolvable timezone, in unencrypted rooms. Imported supported alarms may be relative to the start or end and may include bounded repeats; the alarm editor itself authors a narrower non-repeating subset. The operator must enable reminder configuration and delivery independently. Absolute UTC display alarms remain calendar metadata and are not eligible for Matrix delivery. Selected-member targeting and explicit all-day Matrix schedules are being developed in [PR #384](https://github.com/0cwa/matrix-calendar-widget/pull/384); check [current status](./STATUS.md) before relying on them.

Post-success notices about room-calendar event edits are also independent of scheduled reminders. An event save can succeed even if a best-effort notice cannot be delivered.

## Publish a public subscription

Public feeds are optional and disabled by default on the server. Publishing a personal calendar requires its owner; publishing a room calendar requires current calendar-management permission. When enabled, choose **Public feed** to open the **Public calendar feed** dialog, choose an eligible event-only calendar, read the disclosure, and confirm before selecting **Publish feed**. The dialog offers **Copy URL**, **Subscribe in a calendar app**, and **Unpublish**.

Anyone who has the link can read every event in that calendar, including sensitive details present in the canonical calendar. The feed is not restricted to Matrix room members, and it is not limited to the widget's visible date range. It is read-only; it does not give an external calendar application permission to edit events.

Unpublishing blocks future requests but cannot retract calendar data already downloaded or cached. Public links remain valid after Matrix membership or manager-power changes until explicitly revoked. Calendar applications choose their own refresh interval, so updates may not appear immediately. Publishing a mixed collection is refused instead of quietly omitting its non-event data.

Private external calendar editing with independently revocable credentials is still planned separately. Do not enter your Matrix password into a CalDAV application for this service.

## When something is unavailable

| Symptom                                   | Next step                                                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| No configured room calendar               | Ask a moderator about `!calendar setup`, or ask the operator to configure a binding.                                  |
| Calendar visible, editing unavailable     | Check your room permissions and whether event writes are enabled.                                                     |
| Event or recurrence missing from the view | Review the diagnostic warning and ask the operator to inspect the canonical source with authorized tooling.           |
| Save rejected after another client edited | Reload, review the current event, then retry the intended change.                                                     |
| Alarm saved, no Matrix message arrives    | Check supported alarm type, room encryption, manager permissions, and the separate reminder delivery setting.         |
| Public feed settings unavailable          | Ask whether public feeds and their public ingress have been configured by the operator.                               |
| Widget or gateway connection fails        | Record the client/version and steps to reproduce; ask the operator to check the configured gateway and identity flow. |

For a bug report, include client and server versions, reproduction steps, and a minimized synthetic event when useful. Remove names, private calendar content, public-feed URLs, and credentials from shared logs. Use the [security policy](../SECURITY.md) for a suspected vulnerability.
