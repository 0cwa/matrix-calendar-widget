# Matrix Calendar Widget

A Matrix calendar widget backed by an authenticated calendar gateway and CalDAV.

## Runtime configuration

The default widget requires a Matrix room ID (`matrix_room_id`) and a
calendar gateway URL (the `meetings_bot_base_url` widget parameter or
`REACT_APP_API_BASE_URL`). Missing or blank values display an initialization
error instead of showing an in-memory calendar that cannot persist changes.

Tests and standalone demos that need an in-memory calendar must explicitly
inject `InMemoryCalendarRepository` through `AppContainer`. No fallback is
enabled in a deployed widget.

### Available Scripts

In the project directory, you can run:

- `yarn dev`: Start the widget for development.
- `yarn dev:https`: Start the widget for development with a self-signed HTTPS certificate.
- `yarn build`: Build the production version of the widget.
- `yarn test`: Watch all files for changes and run tests.
- `yarn tsc`: Check TypeScript types for errors in the widget.
- `yarn lint`: Run eslint on the widget.
- `yarn depcheck`: Check for missing or unused dependencies.
- `yarn translate`: Update translation files from code.
- `yarn generate-disclaimer`: Generates license disclaimer and include it in the build output.
- `yarn docker:build`: Builds a container from the output of `yarn build` and `yarn generate-disclaimer`.
