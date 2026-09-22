# ADR008: Align with MSC4496 without requiring it

- Status: Accepted
- Date: 2026-09-22

## Context

MSC4496 proposes Matrix-native calendar rooms, events, invites, RSVPs, availability, recurrence, and CalDAV bridging. It is highly relevant but remains an unstable proposal and cannot be assumed available on production homeservers or clients.

## Decision

Treat MSC4496 as a semantic compatibility target, not a runtime dependency.

Domain concepts should map cleanly where practical: stable UID, named timezones, status/transparency, recurrence, organizer, attendees, invite/RSVP semantics, conference linkage, and free/busy.

Do not require MSC4496 endpoints or stable event types for the initial product. If experimental support is added, isolate it behind an adapter and unstable feature flag.

## Consequences

The product can ship against today's Matrix/Widget APIs and Radicale while remaining well-positioned for future Matrix-native calendar interoperability.
