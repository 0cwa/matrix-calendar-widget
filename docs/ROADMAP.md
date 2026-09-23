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

1. Land PR #40 to finish the repository-backed M1 create/edit/delete path.
2. Refresh and land PR #52 (request-scoped OpenID credential) and PR #53 (CalDAV discovery client).
3. Implement #55 and #56 to connect validated Matrix identity, authorization, delegated credentials, and configured Radicale discovery.
4. Complete #48's OpenID-capable `radicale-auth-matrix` path and #45's real-container discovery contract tests.
5. Start M3's real VEVENT CRUD vertical slice only after the authenticated discovery spine is proven.

See [STATUS.md](./STATUS.md) for transient PR/CI details.

## Explicit non-goals for the first beta

- CardDAV/address books.
- First-class VJOURNAL support.
- A generic WebDAV file manager.
- Reimplementing CalDAV in Matrix.
- Depending on homeserver support for an unstable calendar MSC.
- Feature parity with every historical NeoDateFix meeting-room capability.
