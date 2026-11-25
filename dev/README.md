# Local integration services and acceptance helpers

[Documentation](../docs/README.md) · [Development guide](../docs/DEVELOPMENT.md) · [Browser tests](../e2e/README.md)

The base development stack supplies isolated Synapse and Radicale services for gateway contracts. The rest of this directory contains the setup, validation, cleanup, and sanitized-evidence helpers used by real Element acceptance. Choose the fixture for the behavior you are testing; ordinary unit tests do not need these services.

## Base stack

| Service  | Pinned fixture                                    | Default local endpoint  |
| -------- | ------------------------------------------------- | ----------------------- |
| Synapse  | v1.161.0                                          | `http://localhost:8008` |
| Radicale | 3.8.0.0 with the project-owned OpenID auth module | `http://localhost:5232` |

[`compose.yaml`](./compose.yaml) is the version source. Radicale builds from [`radicale-auth/Dockerfile`](../radicale-auth/Dockerfile), using a digest-pinned upstream image. The base stack does **not** include the gateway, widget, Element, or PostgreSQL.

### Start

Prerequisites: the repository's Node toolchain, Docker with Compose v2, Bash, curl, and available ports 8008 and 5232. From the repository root:

```bash
yarn dev:services:up
```

This runs [`up.sh`](./up.sh). On first use it generates Synapse configuration and a signing key in a named volume, registers the fixture account if needed, starts the services, and checks authenticated Radicale access. The default Compose project is `matrix-calendar-dev`.

The default port mappings follow Docker's host binding behavior. To bind the fixture services to loopback explicitly:

```bash
MATRIX_CALENDAR_DEV_SYNAPSE_PORT_MAPPING=127.0.0.1:8008:8008 \
MATRIX_CALENDAR_DEV_RADICALE_PORT_MAPPING=127.0.0.1:5232:5232 \
yarn dev:services:up
```

### Fixture identity

| Setting                  | Development-only value  |
| ------------------------ | ----------------------- |
| Matrix ID                | `@calendar:localhost`   |
| Synapse fixture password | `calendar-dev-password` |
| Radicale username        | `calendar`              |

To use a different local fixture account:

```bash
MATRIX_CALENDAR_DEV_USER=alice \
MATRIX_CALENDAR_DEV_PASSWORD=another-dev-password \
yarn dev:services:up
```

[`mint-openid-credential.mjs`](./mint-openid-credential.mjs) uses that fixture password only to sign in to the isolated Synapse and request a short-lived OpenID proof. The password is never sent to Radicale or the calendar gateway. `up.sh` does not print the password or proof. Radicale Basic Auth uses the Matrix **localpart** and the tagged OpenID proof in its password field.

The stack registers the synthetic `_matrix_calendar_service` user from [`appservice-calendar-contract.yaml`](./appservice-calendar-contract.yaml). Its static tokens are test fixtures. Room-principal contracts obtain OpenID proof for the selected principal and use explicit test bindings; the fixture does not make room access enabled by default in gateway configuration.

The Synapse fixture increases login address/account burst counts to 20 for sequential test sign-ins. It leaves refill rates and the failed-attempt limiter unchanged. See [`synapse_contract_config.py`](./synapse_contract_config.py).

### Stop or reset

Stop containers while retaining local data:

```bash
yarn dev:services:down
```

To discard this base fixture and **delete its Matrix/Radicale volumes and data**:

```bash
yarn dev:services:reset
```

These root commands target the base Compose file. Acceptance rehearsals can use additional files and explicitly owned resources; follow their cleanup procedure rather than applying the base reset command to them.

## Use the fixture

Run the [gateway](../matrix-calendar-server/README.md) and [widget](../matrix-calendar-widget/README.md) separately with the [documented configuration](../docs/configuration.md), or use the dedicated acceptance workflow below. The [CalDAV contract workflow](../.github/workflows/caldav-contract.yml) shows the environment and setup used for personal and room-principal contracts. Starting the stack alone does not enable environment-gated test suites.

The Radicale image separates its homeserver endpoint (`http://synapse:8008`) from the Matrix server name (`localhost`). It stores collections under `/data/collections` with `owner_only` rights. It does not implement etke's `RADICALE_CONFIG_*` environment translation. Existing managed service/data reuse requires its own operator validation; the [bounded beta](../docs/beta-scope.md) uses an independent project-owned store.

## Acceptance helper map

| Files                                                              | Purpose                                                           | Start with                                                                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `compose.yaml`, `up.sh`, OpenID and Synapse helpers                | Base Matrix/Radicale service fixture and bootstrap                | This guide and the [CalDAV workflow](../.github/workflows/caldav-contract.yml)               |
| `element-acceptance*.compose.yaml`, setup/configuration/API probes | Widget, server, Element, and optional PostgreSQL acceptance stack | [Element acceptance workflow](../.github/workflows/element-acceptance.yml)                   |
| `element-desktop-*`, room-context and keyboard/focus helpers       | Packaged Desktop startup, journey, and scoped evidence            | [E2E guide](../e2e/README.md) and [client validation](../docs/calendar-client-validation.md) |
| Reminder restore, resource ownership, and Compose validators       | Bounded restore and exact owned-resource cleanup                  | [Backup/recovery](../docs/backup-recovery.md) and [release ledger](../docs/RELEASE.md)       |
| `sanitize-*`, action summaries, diagnostics                        | Allowlisted summaries without raw credentials or calendar data    | The workflow that invokes each helper and its adjacent tests                                 |
| `lint-staged.mjs`                                                  | Route staged source files to the correct workspace linter         | [Development guide](../docs/DEVELOPMENT.md)                                                  |

The real-client harness has explicit source, egress, evidence, and cleanup requirements. Use the documented workflow and configuration rather than launching isolated helper scripts with guessed inputs. Synthetic fixture success establishes only the tested fixture behavior; it does not certify a production host, mobile client, or operator rollout.

## Deployment examples

Helm development values contain non-routable `.invalid` Matrix, Element, and widget hostnames. They are placeholders rather than a working deployment profile. Set operator-owned endpoints and ensure the configured widget URL matches its public ingress or intentional alias. See [charts](../charts/README.md) and [deployment](../docs/deployment-docker.md).
