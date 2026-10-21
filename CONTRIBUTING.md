# Contributing

[Project overview](./README.md) · [Documentation](./docs/README.md) · [Development guide](./docs/DEVELOPMENT.md)

Matrix Calendar Widget welcomes fixes, documentation improvements, accessibility work, and focused calendar features. You do not need to understand the inherited meeting application to make your first contribution.

## Your first change

1. Follow the [development guide](./docs/DEVELOPMENT.md) to install dependencies and run a focused test.
2. Read the [architecture overview](./docs/ARCHITECTURE.md) and the source map for the area you want to change.
3. Pick an [open issue](https://github.com/0cwa/matrix-calendar-widget/issues), or describe a small, concrete problem in a new issue. The [roadmap](./docs/ROADMAP.md) explains current priorities.
4. Make a focused change, run the relevant checks, and open a pull request describing the result.

Documentation corrections, clearer error messages, and regressions for a reproducible bug are useful starting points. For a larger feature or cleanup, agree on its scope in an issue before changing architecture or deleting inherited code.

## Product and engineering boundaries

These requirements apply to every contribution:

- **CalDAV/Radicale owns calendar data.** Preserve stable event identity, ETags, unknown iCalendar properties, mixed collections, and recurrence/timezone semantics. Add a minimized fixture and round-trip regression when changing serialization.
- **The widget is the primary interface.** Bot commands provide a bounded fallback. New calendars are VEVENT-only; journal and task interfaces are outside the current scope.
- **Matrix establishes identity and room permissions.** Use the widget/OpenID flow and enforce membership, power, and calendar binding on the server. Hiding a control in the widget is insufficient authorization.
- **Keep credentials out of the browser and diagnostics.** Never handle a user's Matrix password or persist Matrix access tokens or CalDAV credentials in browser storage. Logs and examples must not expose live tokens, authorization headers, or private calendar contents.
- **Keep Matrix reminder state separate from iCalendar.** Notification targeting belongs in the sidecar store and uses standard `m.mentions`.
- **Keep changes reviewable.** Separate feature work from unrelated dependency upgrades, broad renames, and legacy-code removal.

See the [data model](./docs/data-model.md), [threat model](./docs/threat-model.md), and [architecture decisions](./docs/adrs/README.md) for the reasons and detailed contracts. Changes to persistence, authentication, public APIs, permissions, calendar semantics, or deployment topology need an ADR. Use the [ADR template](./docs/adrs/adr000-template.md); update or supersede an existing decision when its contract changes. ADR001–ADR003 describe inherited NeoDateFix behavior and are historical unless a fork decision explicitly adopts them.

## Check your work

Run commands from the repository root after the initial dependency install:

```bash
yarn prettier:check
yarn ci
```

`yarn ci` includes documentation link checks and their regressions, formatting, dependency checks, lint, the configured workspace type checks, unit tests, and builds. Use the [focused commands](./docs/DEVELOPMENT.md#run-focused-checks) while editing, then satisfy all applicable pull-request checks. Browser, PostgreSQL, and real CalDAV/Matrix contracts have separate setup and are not all exercised by `yarn ci`; the [testing map](./docs/DEVELOPMENT.md#choose-the-right-test-layer) explains when to use them.

For a documentation-only change, check links and formatting, then verify any commands or behavior claims you edited:

```bash
yarn docs:check
yarn prettier:check
```

`yarn docs:check` runs offline and checks local Markdown file/image links, heading anchors, and reference links. It does not verify remote URLs. Run `yarn docs:test` when changing the checker itself. Put new guides in the [documentation index](./docs/README.md), and keep relative links working when moving pages. A passing historical run does not validate a changed source tree. Required checks and review rules are documented in [branch protection](./docs/BRANCH_PROTECTION.md).

## Pull requests

A useful PR description explains:

- The problem and resulting user or developer behavior.
- The scope of the change and the checks actually run, including any skipped or blocked checks.
- Authorization, privacy, and iCalendar preservation effects where relevant.
- Screenshots for visible widget changes and keyboard/focus coverage for interaction changes.
- Relevant issues, ADRs, and any deliberately deferred follow-up.

Update the guide that owns the behavior you changed. Update [project status](./docs/STATUS.md), the [roadmap](./docs/ROADMAP.md), or [implementation plan](./docs/PLAN.md) when the change materially affects them. Keep detailed run evidence in the appropriate validation document or [release ledger](./docs/RELEASE.md), with the tested commit and scope; avoid copying the same status narrative into several guides.

## Documentation conventions

The [documentation index](./docs/README.md) is the entry point. Write guides around a reader's task, link to the canonical reference for detail, and use relative links within the repository. Distinguish implemented behavior, planned work, historical evidence, and deployment acceptance. Check commands against the relevant `package.json` or script before documenting them.

Agent-specific workflows and handoffs belong in [the agent area](./docs/agents/README.md). Human setup and contribution instructions belong here and in the development guide; contributors should not need to read an agent runbook.

## Attribution and security reports

The project is derived from an Apache-2.0 codebase. Preserve the [license](./LICENSE), applicable NOTICE files, copyright headers, and upstream attribution. Follow the [upstream policy](./docs/UPSTREAM.md) when porting a fix. Container, package, and chart publishing must use fork-owned names.

Report suspected vulnerabilities using [SECURITY.md](./SECURITY.md). Keep private operator details and credentials out of public issues and pull requests.
