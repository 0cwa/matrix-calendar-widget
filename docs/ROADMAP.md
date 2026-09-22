# Roadmap

The roadmap describes sequencing and intent. Detailed acceptance criteria live in [PLAN.md](./PLAN.md).

| Phase | Goal | User-visible result |
| --- | --- | --- |
| M0 | safe hard fork | repo can be developed without upstream ambiguity |
| M1 | domain seam | inherited UI runs on calendar-domain abstractions |
| M2 | identity + CalDAV discovery | widget can securely list Radicale calendars |
| M3 | VEVENT CRUD | real events can be created, edited, and deleted |
| M4 | collection management | Radicale event calendars can be managed from the widget |
| M5 | serious calendaring | recurrence, alarms, attendees, and round-trip fidelity |
| M6 | Matrix team features | room policy, member targeting, reminders, MatrixRTC linkage |
| M7 | fallback commands | essential access from non-widget clients |
| M8 | hardening | beta deployment, security, scale, compatibility |

## Product direction

The intended experience is closer to a team calendar inside Element than a generic Radicale administration panel. Protocol complexity should appear only where it helps interoperability or diagnosis.

Collection management is part of the product, but DAV vocabulary should stay mostly behind an “advanced” boundary. Users manage **Calendars**.

## Near-term priorities

1. Fork hygiene without destabilizing inherited tests.
2. Introduce the calendar repository/domain seam.
3. Prove Matrix OpenID → gateway → Radicale discovery.
4. Ship the smallest end-to-end VEVENT CRUD slice.
5. Expand fidelity and Matrix-specific team features from that working spine.

## Explicit non-goals for the first beta

- CardDAV/address books.
- First-class VJOURNAL support.
- A generic WebDAV file manager.
- Reimplementing CalDAV in Matrix.
- Depending on homeserver support for an unstable calendar MSC.
- Feature parity with every historical NeoDateFix meeting-room capability.
