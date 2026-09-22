# ADR004: Hard-fork NeoDateFix as the implementation baseline

- Status: Accepted
- Date: 2026-09-22

## Context

Building a Matrix widget from scratch would require reproducing solved work around Element integration, responsive calendar UI, recurrence controls, member selection, testing, accessibility, localization, and bot/widget plumbing. NeoDateFix already contains these capabilities under Apache-2.0.

Its persistence model, however, is meeting-room-centric and is not the target model for this product.

## Decision

Hard-fork `nordeck/matrix-meetings` from the pinned commit documented in `docs/UPSTREAM.md`.

Reuse UI and infrastructure aggressively, but migrate behavior through explicit calendar-domain and repository seams rather than preserving the original meeting-room persistence architecture.

Keep upstream ADR001-ADR003 as historical records. Fork-specific decisions start with ADR004.

## Consequences

### Positive

- Faster first usable widget.
- Proven Matrix Widget Toolkit patterns.
- Existing recurrence/calendar interaction code and tests.
- Existing bot/server and E2E infrastructure.

### Negative

- Temporary inherited names and dead meeting-room code.
- Significant conceptual migration is still required.
- Upstream syncs become selective ports rather than simple merges.

## Guardrail

Do not perform a broad rewrite merely to make the fork “look clean.” Replace upstream behavior with tested vertical slices, then remove unreachable legacy code.
