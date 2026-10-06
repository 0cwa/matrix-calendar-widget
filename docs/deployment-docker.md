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

## etke and Matrix Docker Ansible deployment

The Docker images in this repository can be run as separate operator-managed
containers alongside Matrix. This documents a possible deployment boundary; it
does not verify a live etke host, its networks, proxy, or authentication setup.

There are two different operating models:

- **Hosted etke.cc:** etke's [FAQ](https://etke.cc/help/faq/) permits customer-run
  services alongside its stack, but says those services are unsupported, may
  break the stack, and may be broken by upgrades without warning. Do not hand-edit
  etke-managed Matrix configuration: etke says maintenance can replace it.
  Treat the calendar containers, their configuration, updates, and recovery as
  the operator's responsibility.
- **Self-managed `etkecc/ansible`:** this public Ansible repository is an etke
  wrapper around
  [`spantaleev/matrix-docker-ansible-deploy`](https://github.com/spantaleev/matrix-docker-ansible-deploy),
  with additional service roles and playbooks. The stable `main` snapshot reviewed
  here is commit
  [`72039fc`](https://github.com/etkecc/ansible/tree/72039fcea112f7a001dfcf005550c4f77c536cae)
  (2026-10-01); its [README](https://github.com/etkecc/ansible/blob/72039fcea112f7a001dfcf005550c4f77c536cae/README.md)
  describes `fresh` as its testing branch. Its
  [`play/all.yml` custom section](https://github.com/etkecc/ansible/blob/72039fcea112f7a001dfcf005550c4f77c536cae/play/all.yml)
  lists the roles selected for that play. **Inference from this wiring:**
  first-class Ansible lifecycle management for this app would require a role and
  playbook integration maintained by the operator. This does not prevent an
  operator from running a separate Docker Compose project alongside the playbook.

At the reviewed etke commit, `requirements.yml` pins the MASH Radicale role as
[`v3.8.1.1-0`](https://github.com/etkecc/ansible/blob/72039fcea112f7a001dfcf005550c4f77c536cae/requirements.yml).
That role defaults to the `tomsquest/docker-radicale:3.8.1.1` image. The public
role exposes variables for the host data/config paths, image name, Radicale auth
type, base Docker network, additional pre-existing networks, and its Traefik
labels; it also permits extra environment variables ([role defaults](https://github.com/mother-of-all-self-hosting/ansible-role-radicale/blob/f1a0253eb61c9fe8409cb12f9e4c526532c7e60e/defaults/main.yml),
[configuration template](https://github.com/mother-of-all-self-hosting/ansible-role-radicale/blob/f1a0253eb61c9fe8409cb12f9e4c526532c7e60e/templates/config/config.j2),
[environment template](https://github.com/mother-of-all-self-hosting/ansible-role-radicale/blob/f1a0253eb61c9fe8409cb12f9e4c526532c7e60e/templates/env.j2); the role tag resolves to commit [`f1a0253`](https://github.com/mother-of-all-self-hosting/ansible-role-radicale/commit/f1a0253eb61c9fe8409cb12f9e4c526532c7e60e)).
The service template runs Radicale under systemd with `docker create`, mounts
the generated config read-only at `/config`, and bind-mounts persistent data at
`/data` ([service template](https://github.com/mother-of-all-self-hosting/ansible-role-radicale/blob/f1a0253eb61c9fe8409cb12f9e4c526532c7e60e/templates/systemd/radicale.service.j2)).
The defaults place the host data under `/radicale/data` and the calendar
collections at `/data/collections`; the role can connect Radicale to additional
Docker networks that already exist. Those Radicale role settings do not set up
the calendar gateway or widget.

These are capabilities in the **public self-managed role**. They do not show
that an etke-managed host lets a customer override the image, configuration,
network, service lifecycle, or data mount. For a hosted etke server, use only an
operator-approved extension path and do not hand-edit managed configuration.

Before deploying, agree with the operator on the calendar hostname and who owns
DNS, TLS, and reverse-proxy routing; the private Docker network that will allow
the gateway to reach Radicale; how server-only secrets will be supplied; which
paths or databases need persistence and backup; and who owns image updates and
recovery. Keep CalDAV access on a private network where possible and expose only
the required application endpoint through an operator-approved ingress. Do not
assume the managed Traefik instance discovers or routes an arbitrary sidecar.
The current Dockerfiles do not supply production volumes, credentials, or a
deployment lifecycle. Persist and back up configured app storage and databases;
inject server-only secrets through an operator-approved secret mechanism.

### Radicale authentication

The [etke Radicale service documentation](https://etke.cc/help/extras/radicale/)
describes Matrix credentials for its managed service. That mode conflicts with
this repository's rule never to ask for, store, proxy, log, or derive a user's
Matrix password. [ADR024](./adrs/adr024-in-repo-radicale-openid-auth.md) selects
a clean-room in-repository Radicale 3.8 Auth module in a pinned, project-owned
image. The image will not include or invoke an external auth package; the owned
backend accepts only explicitly tagged short-lived OpenID credentials and
rejects untagged credentials. Conventional Matrix-password CalDAV login is
intentionally unsupported and deferred in this pre-alpha. A separate
Radicale-native credential mode would require a future ADR. The module and
image build are implemented in this repository and exercised by its container
contract, but no deployment on an etke-managed host has been verified. The
public role exposes an image override and an auth-type setting; its generated
config template has special cases for `htpasswd` and `radicale_auth_matrix`,
and its environment template supports additional variables. Those public
self-managed role features do not establish that etke enables the same
overrides on this managed host. The project's image currently targets Radicale
3.8.0, while the reviewed etke role defaults to 3.8.1.1; compatibility between
those versions and the existing store has not been verified. Any managed-image
replacement requires operator approval and a rehearsal of the image, config,
network, service lifecycle, data preservation, and rollback. Do not install a
floating auth module or attach the managed `/data` volume to the separate
sidecar example below.

The source snapshot above was checked on **2026-10-03**; the etke Ansible links
pin commit `72039fcea112f7a001dfcf005550c4f77c536cae` (committed 2026-10-01).
The [etke FAQ](https://etke.cc/help/faq/) and
[Radicale v3 documentation](https://radicale.org/v3.html) are live documents
that were checked on 2026-10-03. Host-specific support, configuration, routing,
and data preservation remain unverified.

The local `dev/compose.yaml` stack is for development and integration services;
it does not define a production deployment or an etke/MDAD deployment contract.
Helm and Kubernetes packaging are outside this slice.

### Operator-run Compose sidecar example

[`deploy/etke-sidecar.compose.yaml`](../deploy/etke-sidecar.compose.yaml) is a
reference for an operator who already manages a Matrix homeserver with etke's
Ansible playbook or `matrix-docker-ansible-deploy` and wants to run Matrix
Calendar as a separate Compose project. It does not install an Ansible role,
change the managed Matrix stack, or connect to an existing etke Radicale store.
The example starts the calendar gateway, widget, and this project's
OpenID-authenticated Radicale image with its own named data volumes. Do not
point it at a Matrix-password-authenticated Radicale service: the gateway
delegates a short-lived Matrix OpenID proof, and the project-owned image
accepts only that tagged credential.

The existing etke Radicale deployment and `/data` store are not a drop-in
backend for this sidecar: the authentication configuration and data reuse path
have not been validated together. The example creates an independent Radicale
service and empty store; it does not mount, read, convert, or migrate the etke
`/data` volume. Keep the existing service and its data untouched. Reusing or
moving existing calendars requires a separately planned, verified CalDAV
migration with a recoverable backup; this example does not provide that
migration.

The server service reads optional server-only settings from
[`deploy/.env.server`](../deploy/.env.server.example). The file is optional;
when it is absent, room access, room writes, reminder configuration, reminder
delivery, and action notices remain disabled by the server's existing
default-false gates. Do not add empty assignments for optional credentials,
database URLs, or bindings. The sample file contains only commented examples.
This uses Docker Compose's optional `env_file` support and requires Docker
Compose 2.24.0 or newer. See the Compose
[`env_file` reference](https://docs.docker.com/reference/compose-file/services/#env_file)
and [variable precedence guide](https://docs.docker.com/compose/how-tos/environment-variables/envvars-precedence/).

Keep `deploy/.env.local` for the Compose interpolation values used by the
widget, homeserver, bot, and proxy. Put room and reminder settings only in
`deploy/.env.server`; this file supplies the server container environment and
does not override the interpolation file. Exported shell values can override
interpolated Compose values, so run preflight and deployment with the same
shell, project name, and `--env-file` options. Quote values containing `$` with
single quotes in `.env.server` so Compose treats them literally.

### Application-service identity and room collection provisioning

Room calendars use one dedicated homeserver application-service identity. On
Synapse, install a registration through its supported
`app_service_config_files` setting. This example has a deliberately narrow
exclusive namespace and no event-delivery URL: the Matrix application-service
spec allows `url: null` when no traffic needs to be sent to the service, and
this gateway does not implement an application-service transaction endpoint.
See the [Matrix registration specification](https://spec.matrix.org/latest/application-service-api/#registration)
and [Synapse registration instructions](https://element-hq.github.io/synapse/latest/application_services.html).

```yaml
id: matrix-calendar-room
url: null
as_token: REPLACE_WITH_A_DISTINCT_RANDOM_AS_TOKEN
hs_token: REPLACE_WITH_A_DIFFERENT_RANDOM_HS_TOKEN
sender_localpart: _matrix_calendar_service
namespaces:
  users:
    - exclusive: true
      regex: '^@_matrix_calendar_service:example\.org$'
  aliases: []
  rooms: []
```

Replace both token placeholders with separately generated high-entropy values;
never use tokens from a test fixture. Set
`MATRIX_APPLICATION_SERVICE_TOKEN` to this registration's `as_token` and
`MATRIX_APPLICATION_SERVICE_USER_ID` to the sender ID formed with the actual
Matrix server name. The server's required `ACCESS_TOKEN` remains a separate
normal bot-user access token; do not substitute either application-service
token for it. Apply the registration through the homeserver operator's
supported process and restart or reload the isolated acceptance homeserver
before testing it. Do not hand-edit managed homeserver configuration.

Before setting `ROOM_CALENDAR_BINDINGS` or enabling the room UI, create the
calendar collection under the service user's Radicale home. The authorized
operator must obtain a short-lived OpenID proof for the exact service user by
calling `POST /_matrix/client/v3/user/{serviceUserId}/openid/request_token`
with the `as_token`, then use Radicale's tagged credential form from
[ADR024](./adrs/adr024-in-repo-radicale-openid-auth.md) to issue one `MKCALENDAR`
request to `{RADICALE_URL}/{serviceLocalpart}/{calendarId}/`. The tagged
credential uses the service localpart as the username and a
`matrix-openid:` password containing the short-lived proof and Matrix server
name. Keep the proof in memory, suppress request/response logging that could
expose it, and discard it immediately; never place it in command arguments,
shell history, files, or artifacts. The repository does not yet provide a
one-command provisioner, so perform this step only with an operator-approved
secret-safe tool during isolated acceptance.

Invite the service user to the single pilot room and give it only the room
membership/state and message permissions required by the selected features.
Then set exactly one matching room/calendar pair in `.env.server`, run the
preflight below, and keep each feature gate separate. Room writes require the
room access gate; either reminder gate also requires room access, the
application-service identity, the binding, and the external reminder database.
`ROOM_CALENDAR_ACTION_MESSAGES_ENABLED` remains independent. These settings
are opt-in configuration, not evidence of a tested team-host deployment.

This is an operator-configured sidecar pattern, not a verified etke deployment.
Before using it, the operator must provide:

- an existing Docker network that the chosen reverse proxy can reach; its
  actual name is supplied as `MATRIX_PROXY_NETWORK` and is deliberately not
  guessed here;
- an HTTPS URL routed to `widget:8080` and a separate HTTPS API URL routed to
  `server:3000`, with both services attached to that operator-selected network;
- a homeserver URL reachable from the server and Radicale containers, plus
  the exact Matrix server name used by Matrix user IDs;
- a dedicated Matrix bot access token supplied through the operator's secret
  store, or a local ignored mode-600 env file; never commit or print the
  resolved Compose configuration containing that token;
- stable storage and a backup/restore procedure for the `radicale-data` and
  `server-data` volumes.

The proxy should expose only the widget and gateway hostnames. Radicale has no
published host port and is reachable only from the Compose backend network.
The homeserver and any reverse proxy that handles Matrix OpenID userinfo
requests must follow the token-log redaction requirements in
[ADR024](./adrs/adr024-in-repo-radicale-openid-auth.md). This example does not
configure proxy labels, DNS, TLS, firewall rules, rate limits, Matrix widget
registration, or log redaction; those remain operator tasks.

Build the local images from a checkout of the pinned source, from the
repository root:

```bash
yarn workspace @matrix-calendar-widget/ical-timezones build
yarn workspace @matrix-calendar-widget/calendar build
yarn workspace @matrix-calendar-widget/server build
yarn workspace @matrix-calendar-widget/widget build
docker build -t matrix-calendar-widget/server:local -f matrix-calendar-server/Dockerfile .
docker build --target runtime -t matrix-calendar-widget/radicale-openid:local -f radicale-auth/Dockerfile radicale-auth
docker build --build-context root=. -t matrix-calendar-widget/widget:local -f matrix-calendar-widget/Dockerfile matrix-calendar-widget
```

Copy [`deploy/etke-sidecar.env.example`](../deploy/etke-sidecar.env.example)
to the ignored `deploy/.env.local` and replace the example URLs and
network name. The Matrix widget URL templates use single-quoted env values so
Compose passes Matrix's `$matrix_*` placeholders through literally. Set the
bot token in the secret-injection environment when available; Compose uses a
shell-provided value ahead of the example env file. Only when a room or
reminder feature is deliberately being configured, copy
[`deploy/.env.server.example`](../deploy/.env.server.example) to the ignored
`deploy/.env.server` and uncomment only the required settings. Leave optional
values absent when the corresponding gate is off.

After building the server workspace, validate the resolved Compose environment
without starting services. The preflight runs `docker compose config --quiet`,
captures the resolved model only in memory, and validates server settings with
the server's Joi, binding, and TLS helpers. It prints fixed success or failure
text; it does not print or save resolved configuration or secrets. Pass the
same options and shell environment that will be used for deployment:

```bash
node scripts/validate-sidecar-compose.mjs --project-name matrix-calendar-sidecar --env-file deploy/.env.local
```

Then start the stack with the same project name and interpolation file so
Compose reuses its named volumes:

```bash
docker compose --project-name matrix-calendar-sidecar --env-file deploy/.env.local -f deploy/etke-sidecar.compose.yaml up -d
```

Route the public API URL without stripping the `/v1` path used by the gateway.
The browser must be able to reach both HTTPS hostnames. Confirm widget loading,
Matrix OpenID authentication, and personal-calendar access with a test account
before inviting users. This example does not enable room-calendar access, move
existing calendars, or validate a live etke-managed host. Rehearse image
updates and volume recovery with disposable data before relying on it.

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
Node.js's system trust store. This Compose example exposes no custom CA setting.
A TLS or certificate error prevents startup and
does not fall back to plaintext. The only opt-out is
`MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE=trusted-private-network`, for an
operator-controlled isolated database network. It disables TLS explicitly and
must not be used across an untrusted network. The CI localhost PostgreSQL
contract sets this exception only for its disposable test database. No
production database TLS connection or etke host deployment has been validated.
