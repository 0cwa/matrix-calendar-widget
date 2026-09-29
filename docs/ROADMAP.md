# Roadmap

The roadmap describes sequencing and intent. Detailed acceptance criteria live in [PLAN.md](./PLAN.md).

| Phase | Goal                        | User-visible result                                         |
| ----- | --------------------------- | ----------------------------------------------------------- |
| M0    | safe hard fork              | repo can be developed without upstream ambiguity            |
| M1    | domain seam                 | inherited UI runs on calendar-domain abstractions           |
| M2    | identity + CalDAV discovery | widget can securely list Radicale calendars                 |
| M3    | VEVENT CRUD                 | real events can be created, edited, and deleted             |
| M4    | collection management       | Radicale event calendars can be managed from the widget     |
| M5    | serious calendaring         | recurrence, alarms, attendees, and round-trip fidelity      |
| M6    | Matrix team features        | room policy, member targeting, reminders, MatrixRTC linkage |
| M7    | fallback commands           | essential access from non-widget clients                    |
| M8    | hardening                   | beta deployment, security, scale, compatibility             |

## Product direction

The intended experience is closer to a team calendar inside Element than a generic Radicale administration panel. Protocol complexity should appear only where it helps interoperability or diagnosis.

Collection management is part of the product, but DAV vocabulary should stay mostly behind an “advanced” boundary. Users manage **Calendars**.

## Near-term priorities

1. Keep M4 collection-timezone editing deferred until a compatible CalDAV behavior is established. Calendar creation, visibility, rename, deletion, description/color editing, mixed-collection safeguards, and manager-only diagnostics are already on `main`.
2. Continue bounded M5 recurrence and iCalendar slices with focused round-trip and timezone regressions. The pinned Radicale server ignores `CALDAV:timezone`; do not send that unsupported query element.
3. Resolve #48's external ADR009 OpenID-capable `radicale-auth-matrix` gap, then use it in #45's real gateway/OpenID/non-member contract for the user-scoped path.
4. Separately define and test non-password Radicale authentication for the ADR010 application principal, then implement explicit room-to-calendar binding and per-operation membership/power checks. Keep room-owned reads and writes disabled until the principal-authentication prerequisite passes.
5. M7 has localized `!calendar help` and widget guidance. Add event queries and data-changing commands only after the M6 room-owned calendar authorization path is ready.
6. Treat Docker build smoke and deployment documentation as groundwork, not deployment verification. Verify the operator's host-specific service and database contract before claiming an etke-managed deployment.

See [STATUS.md](./STATUS.md) for transient PR/CI details.

## Explicit non-goals for the first beta

- CardDAV/address books.
- First-class VJOURNAL support.
- A generic WebDAV file manager.
- Reimplementing CalDAV in Matrix.
- Depending on homeserver support for an unstable calendar MSC.
- Feature parity with every historical NeoDateFix meeting-room capability.
