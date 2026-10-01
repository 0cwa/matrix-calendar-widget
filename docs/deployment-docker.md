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
  [`cd28f0b`](https://github.com/etkecc/ansible/tree/cd28f0bd94c0d15dbb3db7ad4718c7df62f49622)
  (2026-09-24); the [README](https://github.com/etkecc/ansible/blob/cd28f0bd94c0d15dbb3db7ad4718c7df62f49622/README.md)
  describes `fresh` as its testing branch. Its
  [`play/all.yml` custom section](https://github.com/etkecc/ansible/blob/cd28f0bd94c0d15dbb3db7ad4718c7df62f49622/play/all.yml#L83-L99)
  is a curated list of named roles. **Inference from this wiring:** the reviewed
  tree provides no generic Compose override or arbitrary-service variable hook;
  first-class Ansible lifecycle management for this app would require an explicit
  custom role and playbook integration that the operator maintains.

The stable etke tree includes the MASH Radicale role, pinned there as
[`v3.8.0.0-1`](https://github.com/etkecc/ansible/blob/cd28f0bd94c0d15dbb3db7ad4718c7df62f49622/requirements.yml#L31-L33).
That **Radicale role only** provides variables for host data/config paths, its
base Docker network, pre-existing additional networks, and Radicale's own Traefik
labels ([role defaults](https://github.com/etkecc/ansible/blob/cd28f0bd94c0d15dbb3db7ad4718c7df62f49622/roles/galaxy/radicale/defaults/main.yml#L11-L18),
[networks](https://github.com/etkecc/ansible/blob/cd28f0bd94c0d15dbb3db7ad4718c7df62f49622/roles/galaxy/radicale/defaults/main.yml#L54-L73),
[Traefik labels](https://github.com/etkecc/ansible/blob/cd28f0bd94c0d15dbb3db7ad4718c7df62f49622/roles/galaxy/radicale/defaults/main.yml#L75-L124)).
The role creates Radicale under systemd with `docker create`, bind-mounting its
config read-only and its data directory for persistence; additional networks
must already exist ([service template](https://github.com/etkecc/ansible/blob/cd28f0bd94c0d15dbb3db7ad4718c7df62f49622/roles/galaxy/radicale/templates/systemd/radicale.service.j2#L23-L50)).
These role settings do not configure routing for the calendar gateway or widget.

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
image have not been implemented or deployed. The checked etke role exposes
`radicale_auth_type` and `radicale_auth_matrix_server` variables
([role defaults](https://github.com/etkecc/ansible/blob/cd28f0bd94c0d15dbb3db7ad4718c7df62f49622/roles/galaxy/radicale/defaults/main.yml#L238-L242)),
but public role documentation does not establish that the actual managed host
accepts a custom image override. This repository now contains the adapter and
image build, but neither is deployed here. Confirm that override, preserve the
existing `/data` volume, and rehearse config, network, service lifecycle, and rollback
before rollout. Do not install a floating auth module or create a second
Radicale store.

Sources above were checked on **2026-09-28**. The etke source links pin the
stable `main` snapshot at `cd28f0bd94c0d15dbb3db7ad4718c7df62f49622`. The
etke FAQ is live documentation reviewed on that date.

The local `dev/compose.yaml` stack is for development and integration services;
it does not define a production deployment or an etke/MDAD deployment contract.
Helm and Kubernetes packaging are outside this slice.

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
