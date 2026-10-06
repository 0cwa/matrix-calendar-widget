# ADR037: Use an independent Radicale store for the controlled beta

- Status: Accepted
- Date: 2026-10-06
- Supersedes: ADR024's existing-store deployment preference and dependent
  existing-store gates for the controlled beta only
- Preserves: ADR024's pinned project-owned image, OpenID authentication,
  service-principal, actor-authorization, and cross-room isolation decisions

## Context

ADR024 selects a project-owned Radicale image and describes replacing the
operator-managed Radicale image while preserving its existing `/data` store.
The bounded beta instead uses a separate project-owned Radicale service with a
new, independent store. The beta can then exercise the implemented room
calendar workflow and recovery behavior without attaching to, copying from, or
changing an existing calendar store. This topology does not establish
compatibility with an operator-managed host or provide access to calendars in
another store.

## Decision

1. For controlled-beta acceptance, run the pinned project-owned Radicale image
   as a separate service with its own newly initialized data store. Pilot
   calendars are provisioned there; operator-configured bindings reference the
   intended collection. Do not mount, import, copy, migrate, or modify an
   operator-managed Radicale data directory or any other existing store.
2. Test backup, restart, and restore for the new Radicale store and the
   application-owned PostgreSQL reminder store separately. Keep the required
   client, actor authorization, stale-write, keyboard/focus, reminder, and
   measured-pilot-envelope acceptance evidence in
   [the beta contract](../beta-scope.md). Passing those checks establishes
   evidence only for the tested candidate and selected new-store deployment.
3. Preserve ADR024's OpenID-only credential boundary and authorization model.
   The server validates the actor's current membership, action-specific power,
   and exact room/calendar binding before appservice proof minting or CalDAV
   access. The appservice Radicale principal remains an `owner_only` identity
   whose trust domain is its whole home; application bindings do not become
   backend per-room ACLs. Preserve cross-room isolation, secret redaction, and
   all default-off capability gates.
4. If an operator selects an existing Radicale service or store, ADR024's
   image-override, data-path preservation, network/configuration/service
   lifecycle, same-store visibility, backup/restore, and rollback gates remain
   required before enabling that path. New-store beta evidence does not satisfy
   them.
5. Completing local or controlled-beta acceptance does not prove compatibility
   with a team-managed host or authorize production contact, publication, or
   rollout. Those actions require their own explicit review after the
   candidate gates pass.

## Consequences

- The controlled beta has a clean, project-owned calendar store and does not
  migrate or expose an operator's existing calendars.
- A passing beta validates only the selected project-owned deployment on the
  tested stack. It does not verify an existing-store image replacement or
  managed-host configuration.
- Reusing an existing service or store remains a separate, unverified path
  until every applicable ADR024 gate is rehearsed and accepted.
- The one-replica gateway, separate reminder database, supported calendar
  behavior, and default-off access gates remain as documented in the beta
  contract.
