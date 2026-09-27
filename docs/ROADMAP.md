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

1. Add ADR009's Matrix OpenID credential mode to `radicale-auth-matrix`, preserving its existing password mode. First establish a writable upstream/fork/plugin source target; keep this LGPL-family plugin work outside the Apache application repository.
2. Prove both auth modes in a minimal plugin-owned Synapse + locally built Radicale container stack. This focused contract requires no MAS, widget, or gateway.
3. Pin the tested plugin artifact in this repository's `dev/compose.yaml`, then close #45 with the real gateway/OpenID/non-member contract and complete M2.
4. In parallel, synchronize and finish #100 / PR #101: safe VEVENT-only calendar deletion through the existing repository/gateway seams. Calendar creation (#94), visibility controls (#96), and rename (#99) are merged.
5. Reassess after safe delete before the next metadata/compatibility slice. Avoid broad generic WebDAV administration, and keep M3 regression coverage green (complete on `main` through PRs #70, #89, and #90).

See [STATUS.md](./STATUS.md) for transient PR/CI details.

## Explicit non-goals for the first beta

- CardDAV/address books.
- First-class VJOURNAL support.
- A generic WebDAV file manager.
- Reimplementing CalDAV in Matrix.
- Depending on homeserver support for an unstable calendar MSC.
- Feature parity with every historical NeoDateFix meeting-room capability.
