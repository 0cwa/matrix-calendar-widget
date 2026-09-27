# Docker build and deployment notes

This page records the container behavior currently present in the repository at the time of writing. It is not a production deployment recipe. The project is pre-alpha; operators must supply and verify their own configuration, networking, persistence, and upgrade procedures.

## Build contracts

Build the server from the repository root after installing the locked Yarn dependencies and building the workspaces:

```bash
yarn install --frozen-lockfile
yarn workspace @matrix-calendar-widget/calendar build
yarn workspace @matrix-calendar-widget/server build
docker build -t matrix-calendar-widget/server:local -f matrix-calendar-server/Dockerfile .
```

The root context is required because the server Dockerfile reads the root `package.json` and `yarn.lock`, and copies the built calendar package. The build also creates a license SBOM with Trivy.

Build the widget after the calendar package and widget workspace have been built:

```bash
yarn workspace @matrix-calendar-widget/calendar build
yarn workspace @matrix-calendar-widget/widget build
docker build --build-context root=. -t matrix-calendar-widget/widget:local -f matrix-calendar-widget/Dockerfile matrix-calendar-widget
```

The widget context is `matrix-calendar-widget` so its Dockerfile can copy `dist`; the named `root` context supplies the root lockfile for the SBOM scan. Both CI image tags are local to the runner. CI does not log in to a registry, push images, or publish releases.

## Runtime behavior in the current Dockerfiles

The server image uses Node 22 on Debian Bookworm slim, sets `NODE_ENV=production`, and runs `node ./lib/index.js` as UID 101. It copies the compiled server and calendar package, configuration files, and a Trivy-generated SBOM. It creates `/app/storage` and grants group write access to that directory. The Dockerfile does not declare a port, health check, or volume; deployments must determine the needed network access and persist any configured storage path themselves. The server reads its runtime configuration from environment variables in `matrix-calendar-server/src/configuration.ts`.

The widget image extends the pinned `ghcr.io/nordeck/matrix-widget-toolkit/widget-server:1.2.3` image by digest, adds the built `dist` files to `/usr/share/nginx/html/`, and includes the SBOM in that directory. It sets CSP image and connect source environment values from `REACT_APP_HOME_SERVER_URL` and `REACT_APP_API_BASE_URL`. The base image supplies the web server runtime behavior; this repository's Dockerfile does not define a separate port, health check, or entrypoint.

The inherited toolkit base image name is an implementation dependency, not a publishing target. Project-built images and CI tags use the `matrix-calendar-widget` name. The existing workspace Docker scripts retain their own defaults; this guide's `:local` tags are explicit examples for local builds.

## etke/MDAD deployment boundary

An operator may choose to run these Docker-compatible images alongside an etke/MDAD-managed Matrix deployment, provided the operator supplies the required configuration, networking, and persistent storage. This is generic operator-run container compatibility only. The repository contains no MDAD-native service definition, etke role/module, inventory integration, generated deployment variables, or automated rollout support, and no such deployment has been validated here. Helm and Kubernetes packaging are also outside this slice.

The local `dev/compose.yaml` stack is for development and integration services; it does not define a production deployment for the server and widget. Do not treat it as an MDAD deployment contract.

## Optional reminder PostgreSQL database

The server can persist Matrix reminder sidecar state in a separate
application-owned PostgreSQL database through the optional
`MATRIX_CALENDAR_REMINDER_DATABASE_URL` setting. Omit the setting to keep the
store disabled. When configured, the server applies its versioned migrations
at startup and will not start if the database or migrations are unavailable.
Provide the URL through the operator's secret mechanism; do not reuse Synapse's
database, schema, role, or credentials. The application does not create the
database or role.

Connections require verified TLS by default. Use a certificate whose DNS name
or IP subject alternative name matches the configured endpoint; the driver uses
Node.js's system trust store. A TLS or certificate error prevents startup and
does not fall back to plaintext. The only opt-out is
`MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE=trusted-private-network`, for an
operator-controlled isolated database network. It disables TLS explicitly and
must not be used across an untrusted network. The CI localhost PostgreSQL
contract sets this exception only for its disposable test database. No
production database TLS connection or etke host deployment has been validated.
