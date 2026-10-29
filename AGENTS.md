# Agent instructions

This file is the authoritative agent policy. If any other doc disagrees with it, this file wins. Humans: see [CONTRIBUTING.md](./CONTRIBUTING.md), [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md), and [docs/README.md](./docs/README.md).

## Current goal

**The pilot is live. Work only on (a) bugs reported from pilot use, (b) operability of the live pilot, (c) items explicitly prioritized by the maintainer. Decline or park everything else.** Do not start new features, new integrations, framework migrations, or scope expansion on your own initiative. If unsure, ask instead of building.

## Mission

A fast Matrix team-calendar widget with Radicale/CalDAV as the canonical calendar store, deep Element integration, and a bot/command fallback for clients without widget support.

## Authority and PR limits

- Agents may merge their own pull request when it is safe: all required checks pass on the final head, the PR is scoped to one issue or task, and it does not change authorization, credential handling, iCalendar serialization, database migrations, or deployment configuration. PRs touching those areas need human approval before merge.
- At most 2 agent PRs open at a time. Finish or close one before opening another.
- No force-pushes, no changes to other repositories, no bypassing branch protection.
- Keep PRs small and reviewable; do not mix renames, architecture changes, and features.
- Private operator details (hosts, credentials, team names) never go in the repo.

## Not allowed

- PRs whose only purpose is recording or reconciling evidence, ledgers, or status.
- Adding diagnostic, evidence, or sanitizer tooling to make a flaky test pass. Fix the flake or delete the flaky step.
- Exact-SHA evidence re-binding or re-running suites solely because another change merged.
- Updating `docs/STATUS.md` or `docs/PLAN.md` as part of a change. The maintainer updates STATUS when something material changes.

## Required reading

`README.md`, `docs/ARCHITECTURE.md`, and the relevant ADR in `docs/adrs/`. Inherited ADR001-ADR003 are historical unless a fork ADR adopts them.

## Product and security boundaries (non-negotiable)

- Radicale/CalDAV is canonical. Project-created calendars are VEVENT-only. Never destructively normalize existing mixed collections; preserve unsupported members and unknown iCalendar properties (add round-trip tests before touching the adapter).
- No VJOURNAL UI; VTODO is out of scope.
- The Matrix widget is the primary UI; bot commands are fallback/automation.
- Never ask for, store, proxy, log, or derive a Matrix password.
- Widget-to-server auth uses Matrix OpenID assertions with server-side authorization scoped to room membership and calendar policy. Never rely on UI hiding.
- No Matrix access tokens or CalDAV credentials in browser persistence.
- Do not log authorization headers, OpenID assertions, tokens, credentials, or full ICS bodies. Errors must not expose secrets.
- Treat titles, attendees, locations, and free/busy as sensitive. Use least-privilege widget capabilities; sanitize URLs and rendered text.
- Reminder recipients are sidecar metadata; do not overload core iCalendar semantics. Use standard `m.mentions`.
- Never publish containers, packages, or charts under inherited Nordeck names.

## Definition of done

`yarn ci` passes (docs, prettier, lint, tsc, all tests, build). Also: user-visible behavior has tests, serialization changes have round-trip fixtures, every recurrence/timezone bug gets a regression test.

## Testing strategy

Unit, contract, and widget tests in `yarn ci` are the merge gate. Element E2E acceptance is a manual or weekly smoke test, not a merge gate.

## ADRs

Write an ADR only for a genuinely new persistence, auth, public-API, or deployment decision. No ADR for bounded extensions of existing features. An accepted ADR overrides this file for what it covers.

## Fork hygiene

Active names are `matrix-calendar-widget`, `matrix-calendar-server`, and the `@matrix-calendar-widget/*` scope; `scripts/check-fork-identity.sh` enforces this in CI. Preserve upstream license headers and NOTICE; do not rewrite inherited history.

## Architecture direction

```text
Widget UI -> application/domain interfaces -> Matrix adapter, Calendar API client
Gateway / bot -> Matrix identity + room authorization -> CalDAV repository,
                 reminder scheduler -> Matrix notification delivery
Radicale -> canonical CalDAV collections and iCalendar objects
```

FullCalendar, Redux, Radicale wire formats, and Matrix event shapes must not become the domain model.
