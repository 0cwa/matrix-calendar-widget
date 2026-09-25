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

1. Close #48's external ADR009 OpenID-capable `radicale-auth-matrix` gap.
2. Use that plugin in #45's real gateway/OpenID/non-member contract and close M2.
3. While #48 is externally blocked, finish #98 / PR #99: rename writable calendars through the existing repository/gateway seams. Calendar creation (#92 / PR #94) is merged.
4. Reassess after rename before description/color/timezone or delete work. Avoid broad generic WebDAV administration.
5. Keep M3 regression coverage green; M3 is complete on `main` through PRs #70, #89, and #90.

See [STATUS.md](./STATUS.md) for transient PR/CI details.

## Explicit non-goals for the first beta

- CardDAV/address books.
- First-class VJOURNAL support.
- A generic WebDAV file manager.
- Reimplementing CalDAV in Matrix.
- Depending on homeserver support for an unstable calendar MSC.
- Feature parity with every historical NeoDateFix meeting-room capability.
