# Docker deployment contract

## Target and maturity

The first deployment target is Docker containers managed with Ansible, including
etke deployments based on Matrix Docker Ansible Deploy (MDAD). Helm remains an
optional deployment path. This page records the current container interfaces
and generic operator requirements; it is not a ready deployment recipe.

This repository contains no MDAD Ansible role, service declaration, or
deployment recipe for Matrix Calendar. Public image availability is also not
established: the package scripts build local tags, and chart publishing is
disabled. The exact MDAD checkout/ref used by the operator, Docker networks,
proxy arrangement, hostnames, and database endpoint are unknown. Restart,
upgrade, and rollback remain the responsibility of the operator's Ansible and
container-management setup until a supported adapter is implemented.

## Images and ports

The repository scripts expect generated `matrix-calendar-server/lib`,
`packages/calendar/lib`, and `matrix-calendar-widget/dist` build outputs. Build
the workspace, then build the two local images:

```sh
yarn build
yarn workspace @matrix-calendar-widget/server docker:build
yarn workspace @matrix-calendar-widget/widget docker:build
```

These package scripts tag the images `0cwa/matrix-calendar-server` and
`0cwa/matrix-calendar-widget`. They do not publish versioned images to a
registry. A deployment needs images built and made available through an
operator-approved registry or host-local image workflow.

| Container | Internal port | Current behavior |
| --- | ---: | --- |
| Calendar server | `3000` by default; set `PORT` to override | Node/NestJS gateway and bot. Route the gateway URL to this listener. |
| Widget | `8080` | Static files served by the nginx-based widget image. The package's local run command maps host port `3000` to container port `8080`. |

## Runtime configuration and storage

The server reads these required environment variables:

| Variable | Purpose |
| --- | --- |
| `ACCESS_TOKEN` | Matrix bot credential; provide through the operator's secret mechanism. |
| `HOMESERVER_URL` | Matrix homeserver base URL. The server must be able to reach it. |
| `MEETINGWIDGET_URL` | Widget URL used by the bot. |
| `BREAKOUT_SESSION_WIDGET_URL` | Breakout widget URL used by the bot. |
| `MEETINGWIDGET_COCKPIT_URL` | Cockpit widget URL used by the bot. |

`RADICALE_URL` is optional in the configuration schema and is required for
configured CalDAV discovery and access. `ROOM_CALENDAR_BINDINGS` supplies the
operator-managed room-to-calendar map when room calendars are configured.
`PORT` defaults to `3000`.

`GET /v1/health` calls `${HOMESERVER_URL}/health` and returns success only when
the homeserver responds successfully. It therefore checks homeserver
reachability as well as this HTTP route; it is not a process-only liveness
signal and does not check Radicale or PostgreSQL. Choose container probes with
that behavior in mind.

The server defaults `STORAGE_FILE_DATA_PATH` to `storage`, which resolves to
`/app/storage` in the image. The bot writes its Matrix SDK session state there;
crypto state, when enabled, is stored below the same directory by default.
The image creates this directory for UID `101`. Mount durable writable storage
at `/app/storage` and preserve permissions for that user across container
restarts and image upgrades.

Widget `REACT_APP_*` values are Vite build-time inputs, not runtime environment
settings for the static nginx container. In particular, build the widget with
the intended `REACT_APP_API_BASE_URL` and other widget settings; changing
container environment variables after the image is built does not rebuild the
browser bundle. See [configuration.md](./configuration.md) for the existing
widget and server setting names.

The server supports the optional
`MATRIX_CALENDAR_REMINDER_DATABASE_URL` setting, and the Helm chart can project
it from an external Secret. This repository has no verified Docker/MDAD
provisioning, network path, or operational example for that database
connection. If configured, use an app-owned database and least-privilege role
separate from Synapse. A PostgreSQL cluster may be shared, but do not reuse
Synapse's database, schema, role, or credentials. The chart's `pg-credentials`
are for separate Synapse rate-limit tooling, not reminder storage.

## MDAD integration boundary

### etke-managed servers

etke distinguishes its managed Hosting service, which runs on a VPS rented by
etke, from On-Premises service on the customer's infrastructure. etke's
[Hosting details](https://etke.cc/services/hosting/) say a customer may request
root SSH access to a hosted server and run other services there, while manually
modifying Matrix configuration is not allowed. Its [FAQ](https://etke.cc/help/faq/)
also says customer-run services alongside its stack are allowed, but may disrupt
the managed Matrix stack, may be broken by upgrades without warning, and are
not supported by etke. These statements were checked on 2026-09-27.

Treat a separately managed Matrix Calendar container as an operator-owned,
unsupported adjacent service, not as an officially supported etke service. A
first-class MDAD component is a separate integration: MDAD's [contributor
guidance](https://github.com/spantaleev/matrix-docker-ansible-deploy/blob/master/AGENTS.md)
requires new components to be registered in the playbook, group variables,
documentation indexes, container-image documentation, and changelog. That
guidance describes the first-class component path; it does not establish a
generic custom-container interface. Whether the operator can add a separately
managed service remains deployment-specific. This repository contains no such
MDAD component or etke integration.

The public information does not establish this operator's Hosting or
On-Premises plan, access to the host or MDAD inventory, or approval to operate
this particular adjacent service. It also does not provide application-specific
image delivery, network, proxy, database, secret, persistent-storage, upgrade,
or maintenance arrangements. Confirm those points with the operator and etke
before writing an account-specific deployment. The MDAD references below
describe upstream patterns; they do not establish access to or control of this
operator's deployment.

At a generic level, an Ansible-managed Docker deployment must:

- connect the server container to networks where it can reach the configured
  homeserver and Radicale; also provide a route to the separate application
  database if reminder storage is enabled;
- publish the widget and gateway through the operator's chosen proxy with URLs
  that match the built widget configuration and server widget URLs;
- provide bot credentials through the operator's secret mechanism and keep
  `/app/storage` durable;
- own image selection, container restart, and rollback. Keep the server at one
  replica for the current deployment target; the reminder database alone does
  not establish safety for multiple server replicas.

The following upstream MDAD references point to commit
`c8087f4f2065052ac81f680cb72f7a9b3ea6e5f6` for
background on its network, proxy, configuration, and external-database
patterns. They do not describe or verify the operator's exact deployed MDAD
checkout or inventory, and they do not configure this application:

- [MDAD addon-network defaults](https://github.com/spantaleev/matrix-docker-ansible-deploy/blob/c8087f4f2065052ac81f680cb72f7a9b3ea6e5f6/roles/custom/matrix-base/defaults/main.yml#L62-L73)
- [MDAD reverse-proxy defaults](https://github.com/spantaleev/matrix-docker-ansible-deploy/blob/c8087f4f2065052ac81f680cb72f7a9b3ea6e5f6/roles/custom/matrix-base/defaults/main.yml#L261-L296)
- [MDAD configuration guide](https://github.com/spantaleev/matrix-docker-ansible-deploy/blob/c8087f4f2065052ac81f680cb72f7a9b3ea6e5f6/docs/configuring-playbook.md)
- [MDAD bridge external-database notes](https://github.com/spantaleev/matrix-docker-ansible-deploy/blob/c8087f4f2065052ac81f680cb72f7a9b3ea6e5f6/docs/configuring-playbook-bridge-mautrix-signal.md)

Implementing and validating the exact Ansible service, proxy routing, network
attachments, secret source, database route, image publication, and upgrade
behavior requires the operator's MDAD repository/ref and deployment choices.
The broad M8 container/deployment item and controlled-pilot gates remain open.
