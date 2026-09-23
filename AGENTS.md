# AGENTS.md

This file is the repository-level instruction set for coding agents and human contributors.

## Mission

Build a fast, responsive Matrix team-calendar widget that uses Radicale/CalDAV as the canonical calendar store, integrates deeply with Matrix/Element, and retains a Matrix bot/command fallback for clients without widget support.

## Required reading before changing code

1. `README.md`
2. `docs/STATUS.md`
3. `docs/PLAN.md`
4. `docs/ARCHITECTURE.md`
5. `docs/UPSTREAM.md`
6. Fork ADRs beginning with `docs/adrs/adr004-...`

The inherited ADR001-ADR003 documents describe NeoDateFix's original meeting architecture. Treat them as historical context unless a fork ADR explicitly adopts them.

## Non-negotiable product boundaries

- Radicale/CalDAV is canonical for calendar collections and calendar objects.
- Calendars created by this project are VEVENT-only.
- Existing mixed CalDAV collections must not be destructively normalized. Read/use their VEVENT members and preserve unsupported members.
- VJOURNAL is not a first-class product feature. Do not add a journal UI without a new accepted ADR.
- VTODO is out of the initial calendar scope. It may become a separate task-list surface later.
- The Matrix widget is the primary UI. Bot commands exist for fallback/automation only.
- Never ask for, store, proxy, log, or derive a user's Matrix password.
- Widget-to-server auth must use Matrix-provided identity assertions/OpenID and server-side authorization.
- Do not put Matrix access tokens or CalDAV credentials in browser persistence.
- Calendar editing must preserve unknown iCalendar properties whenever technically possible. Add round-trip tests before modifying the iCalendar adapter.
- Matrix-specific reminder recipients are sidecar metadata; do not overload core iCalendar semantics in a way that breaks other CalDAV clients.
- Use standard `m.mentions` for Matrix notification targeting.
- MSC4496 is a compatibility target, not a required runtime dependency while it remains unstable.
- Never publish containers, packages, or Helm charts under inherited Nordeck names.

## How to work

- Work from a GitHub issue or a clearly scoped item in `docs/PLAN.md`.
- Prefer vertical slices over broad rewrites.
- Keep PRs reviewable. Do not combine package renames, architecture changes, and product features unless the task requires it.
- Add or update tests with behavior changes.
- Update `docs/PLAN.md` when completing or materially changing a planned task.
- Update `docs/STATUS.md` when the active phase, dependency order, or important PR blocker materially changes.
- Add an ADR for decisions that change a persistence boundary, authentication model, public API, calendar semantics, permission model, or deployment topology.
- Preserve upstream license and NOTICE requirements.
- Do not rewrite inherited history or delete upstream ADRs merely because they are no longer current.

## Definition of done

A change is done when all applicable items pass:

```bash
yarn prettier:check
yarn lint
yarn tsc
yarn test:all
yarn build
```

Or simply:

```bash
yarn ci
```

Also verify:

- user-visible behavior has tests,
- calendar serialization changes have round-trip fixtures,
- authorization is enforced server-side rather than only hidden in the UI,
- errors do not expose secrets,
- docs/ADR changes are included when architecture changed,
- no inherited Nordeck publishing target was used.

## Fork hygiene

Active fork identity now uses `matrix-calendar-widget`, `matrix-calendar-server`, and the `@matrix-calendar-widget/*` workspace scope. Historical upstream names are allowed only in provenance, NOTICE, and changelog material. CI enforces this with `scripts/check-fork-identity.sh`.

When code is substantially modified from upstream, preserve required copyright headers and follow Apache-2.0 notice requirements.

## Architecture direction

Target dependency direction:

```text
Widget UI
   -> application/domain interfaces
      -> Matrix adapter
      -> Calendar API client

Calendar gateway / bot
   -> Matrix identity + room authorization
   -> CalDAV repository
   -> reminder scheduler
   -> Matrix notification delivery

Radicale
   -> canonical CalDAV collections and iCalendar objects
```

Do not let FullCalendar, Redux, Radicale wire formats, or Matrix room-event shapes become the domain model.

## Testing strategy

- Unit tests: calendar domain rules, permissions, recurrence helpers, serializers.
- Contract tests: iCalendar and CalDAV request/response behavior.
- Widget tests: interaction, responsive layouts, accessibility.
- Integration tests: widget/gateway with Synapse + Radicale.
- E2E tests: Element-compatible widget flow for critical paths.

Every recurrence or timezone bug should gain a regression test.

## Security defaults

- Validate Matrix identity server-side.
- Scope calendar access to Matrix room membership and explicit calendar policy.
- Treat event titles, attendee lists, locations, and free/busy data as sensitive.
- Use least-privilege widget capabilities.
- Sanitize user-provided URLs and rendered calendar text.
- Do not log authorization headers, OpenID assertions, Matrix tokens, CalDAV credentials, or complete ICS bodies at normal log levels.

## If instructions conflict

An accepted fork ADR overrides this file for the specific decision it covers. If implementation reality requires violating an accepted ADR, update or supersede the ADR in the same PR.
