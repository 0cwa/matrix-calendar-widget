# Matrix Calendar Server

The Matrix Calendar widget is the primary calendar interface. This server provides the Matrix bot fallback, authenticated calendar gateway, and reminder services. Radicale/CalDAV remains the canonical calendar store.

## Calendar-only pilot behavior

- Use `!calendar help` for the supported bot command fallback. Room-calendar commands remain subject to the configured room binding, access, and write gates.
- When the operator enables `ROOM_CALENDAR_SETUP_ENABLED`, an eligible room member can use the exact no-argument `!calendar setup` command. Setup also requires the configured binding store for new rooms, a confirmed unencrypted room, bot membership and widget-state power, and a usable widget URL. See [the setup guide](../docs/bot-calendar.md).
- The inherited `/v1/meeting/*` HTTP routes and Matrix meeting RPC handlers are disabled for the pilot.
- `!meeting setup` is disabled because the legacy welcome-room marker cannot authorize widget writes to another room. The legacy `!meeting` workflow is off by default (`ENABLE_WELCOME_WORKFLOW=false`).
- Legacy private help-room creation and RPC error-room notifications are off by default. The existing `ENABLE_WELCOME_WORKFLOW` and `ENABLE_PRIVATE_ROOM_ERROR_SENDING` variables are explicit compatibility opt-ins; `!calendar` remains available when the welcome workflow is off.
- See [the legacy entry-point inventory](../docs/legacy-entry-points.md) for source-backed route and background-task dispositions, and [configuration](../docs/configuration.md) for environment settings.

### Available Scripts

In the project directory, you can run:

- `yarn start`: Start the bot for development.
- `yarn build`: Build the production version of the bot.
- `yarn test`: Watch all files for changes and run tests.
- `yarn tsc`: Check TypeScript types for errors in the widget.
- `yarn lint`: Run eslint on the bot.
- `yarn depcheck`: Check for missing or unused dependencies.
- `yarn translate`: Update translation files from code.
- `yarn generate-disclaimer`: Generates license disclaimer and include it in the build output.
- `yarn docker:build`: Builds a container from the output of `yarn build` and `yarn generate-disclaimer`.
