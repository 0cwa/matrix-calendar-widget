# Pilot checklist

[Documentation](./README.md) · [Project status](./STATUS.md)

The pilot is live for one team. This page is the scope and the per-deploy checklist. Private operator details (hosts, accounts, credentials, team names) live outside this repository.

## Scope

- One trusted organization with explicitly configured room calendars.
- Clients: Element Web and Element Desktop, in the standard side-panel widget layout.
- One gateway replica (rate limits and reminder scheduling are process-local).
- Project-owned Radicale with its own calendar store, plus an application-owned PostgreSQL database for reminder state (not Synapse's database). Existing Radicale data is not reused. See [ADR037](./adrs/adr037-independent-radicale-store-for-controlled-beta.md).
- Room calendar bindings are configured at deployment; inviting the bot or adding the widget does not create one.
- Room reads, event writes, reminder configuration, reminder delivery, and room action notices are separate feature flags, default off. The operator enables the ones the pilot uses.
- The widget and bot never ask for or store Matrix passwords. Radicale is OpenID-only; there is no conventional CalDAV login.

## Known limits

- CalDAV is canonical. The widget may omit source events whose recurrence or timezone data the bounded projector cannot handle. Diagnosed forms show an affected-event warning, but not every unsupported form is diagnosed. The original resource stays in CalDAV, and a clean view is not proof that every resource is understood.
- Scheduled reminders use whole-room `m.mentions.room` and work only in unencrypted rooms. Encrypted or unknown rooms are unsupported and fail closed. Delivery is not exactly once.
- Not supported: arbitrary RRULE editing, attendee or email authoring, individual reminder recipients, mobile or other Matrix clients.

## Release checklist (a human runs this per deploy)

1. `yarn ci` is green on the commit to release.
2. The image is built from a tagged commit.
3. A backup of the Radicale store and the app Postgres database is taken before deploying.
4. Deploy the tag.
5. Smoke test:
   - open the widget in a room;
   - two users create, edit, and delete an event;
   - a stale edit is rejected;
   - a reminder fires in an unencrypted room.
6. Rollback: redeploy the previous tag (restore the backup only if data was affected).
