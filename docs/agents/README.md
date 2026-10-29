# Coding-agent workflow

[Documentation](../README.md) · [Contribution guide](../../CONTRIBUTING.md) · [Current status](../STATUS.md)

This is the repository-wide instruction set for coding agents, loaded through the root `AGENTS.md`. Paths written as code below are relative to the repository root. Human onboarding and shared project policies live in `CONTRIBUTING.md` and `docs/DEVELOPMENT.md`.

## Mission

Build a fast, responsive Matrix team-calendar widget that uses Radicale/CalDAV as the canonical calendar store, integrates deeply with Matrix/Element, and retains a Matrix bot/command fallback for clients without widget support.

## Required reading before changing code

1. `README.md` and `CONTRIBUTING.md` for the product and shared contribution rules.
2. `docs/STATUS.md`, `docs/ROADMAP.md`, and `docs/PLAN.md` for current scope and dependencies.
3. `docs/ARCHITECTURE.md` and `docs/UPSTREAM.md` for boundaries and provenance.
4. The relevant fork ADRs indexed by `docs/adrs/README.md`.
5. `docs/RELEASE.md` when changing candidate qualification or operator procedures.

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

### Standing same-repository authorization

For routine pre-alpha work in this repository, the user has granted agents standing authorization to perform scoped implementation and documentation work without separate conversational confirmation. This includes normal commits, forward-only pushes, creating and updating pull requests, marking pull requests ready, and merging after the stated review and check gates pass. Preserve exact repository, branch, base, head, changed-path, check, and review preflight, then verify the remote state after each mutation. This authorization does not permit force-pushes or changes to other repositories without explicit approval, and it does not bypass branch protection, repository rules, or platform and sandbox controls.

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
yarn docs:test
yarn docs:check
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

## Documentation ownership

- Keep agent instructions, execution notes, and continuation handoffs under `docs/agents/`. The root `AGENTS.md` is the discovery entry point only.
- Write human instructions in `CONTRIBUTING.md`, the development guide, and the task-specific guides linked from `docs/README.md`. Do not require people to read this file to contribute.
- Keep `docs/STATUS.md` concise and current; separate merged behavior from open PRs. Put detailed historical milestones and source-bound observations in the archive or evidence record, not the project README.
- Preserve source SHAs, failures, limits, and attribution when moving historical records. Rebase relative links and run `yarn docs:check` after a move.
- Review open PRs for overlapping documentation before pushing, so a pending feature is not documented as already merged.

## Historical handoffs

Earlier continuation handoffs are available in git history.
