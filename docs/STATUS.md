# Project status

_Last updated: 2026-10-29._

**The pilot is live.** One organization runs the widget, server, and project-owned Radicale with a separate app PostgreSQL store on a private host. Room calendars, event writes, reminder configuration and delivery, private CalDAV clients, and the public feed are enabled there. Private operator details are kept outside this repository.

## Now

- Fix bugs reported from pilot use (see open issues labelled `pilot`).
- Keep deploys simple: tagged image, backup, deploy, smoke check, rollback to previous tag. See [Pilot checklist](./beta-scope.md).

## Parked until the pilot settles

Calendar subscriptions, app-credential redesign, Android host interop, framework major upgrades (NestJS 12, Redux Toolkit 2), architecture refactors, legacy NeoDate server retirement, and broader recurrence/interoperability (M4/M5 deferred items). See issues labelled `post-pilot`.

## Known limits

- The bounded recurrence/timezone projector may omit unsupported source events from the view; it warns for forms it detects. Source data remains intact in CalDAV.
- Scheduled reminders are whole-room mentions in unencrypted rooms only.
- One server replica; rate limits and reminder scheduling are process-local.

History before this date is in git log and closed issues.
