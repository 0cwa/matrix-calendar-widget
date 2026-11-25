## Summary

<!-- What user/developer capability does this change add or fix? -->

New contributors: see [CONTRIBUTING.md](https://github.com/0cwa/matrix-calendar-widget/blob/main/CONTRIBUTING.md) for setup, review expectations, and documentation guidance.

## Tracking

<!-- Link the issue or describe the scoped request. Use Closes #123 only when this PR completes it. -->

## Architecture and data boundaries

- [ ] No persistence/auth/public-API boundary changed.
- [ ] Boundary changed and an ADR is included or updated.

Source(s) of truth touched:

<!-- CalDAV/iCalendar, Matrix room state, gateway sidecar DB, widget-local state, none -->

## Calendar interoperability

- [ ] Not applicable.
- [ ] Unknown iCalendar properties/components are preserved.
- [ ] Round-trip fixture/tests were added or updated.
- [ ] Recurrence/timezone behavior has regression coverage where relevant.

## Security / authorization

<!-- Where is authorization enforced? Does this touch tokens, OpenID, room permissions, reminder recipients, URLs, or sensitive calendar data? -->

## Testing

<!-- Record commands and results relevant to this change; explain any unavailable check. Hosted required checks still apply. -->

- [ ] `yarn docs:check`
- [ ] `yarn prettier:check`
- [ ] `yarn lint`
- [ ] `yarn tsc`
- [ ] `yarn test:all`
- [ ] `yarn build`

## Documentation

- [ ] Changed behavior and setup instructions are documented, or no update is needed.
- [ ] New guides are linked from the documentation index; agent-only instructions stay in `docs/agents/`.

## Screenshots / recordings

<!-- Add for widget UI changes, especially narrow Element panel behavior. -->

## Follow-ups

<!-- Explicitly list intentionally deferred work. -->
