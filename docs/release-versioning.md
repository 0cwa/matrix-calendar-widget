# Release and versioning policy

This page proposes the versioning and release rules for a future controlled
beta. It describes policy; it does not configure a release, publish artifacts,
or establish that any deployment is ready. The project remains pre-alpha until
the applicable M8 and operator gates are met.

## What the repository does today

The named workspaces currently use version `0.0.0`. The root, widget, calendar,
timezone-data, and E2E manifests are marked private. The server workspace
manifest does not set `private`, so it lacks the package-level publish guard
present on the other workspaces. The root manifest includes Changesets, and
`.changeset/config.json` is present, but the repository has no release workflow
or package-publishing workflow. The Changesets configuration uses restricted
access and enables version/tag handling for private packages; that configuration
alone does not publish releases.

Before enabling any package-publishing workflow, either add an explicit private
guard to the server workspace or separately decide and document its package
release, API, and compatibility policy. The absence of a publish workflow does
not replace that package-level release gate.

The standalone Helm chart versions currently are `0.1.1` for the server,
`0.2.0` for the widget, and `0.3.0` for the umbrella chart. Each chart's
`appVersion` is `0.0.0`. The umbrella chart currently declares local child-chart
dependencies with a wildcard version. These values are repository state, not a
published compatibility promise.

CI builds the server, widget, and Radicale images with local `:ci` tags. It does
not log in to a registry, push images, or publish a release. The Docker notes
also show local build tags. The server and widget charts name their default
repositories as `ghcr.io/0cwa/matrix-calendar-server` and
`ghcr.io/0cwa/matrix-calendar-widget`. CI names its locally built Radicale
image `matrix-calendar-widget/radicale-openid`; no registry destination for
that image is configured here.

## Proposed version source and artifact map

Use one immutable Git tag as the version source for each coordinated project
release. The tag identifies the exact source commit from which release notes,
container images, and charts are built. Do not treat workspace placeholder
versions, chart metadata, or a mutable image tag as a substitute for that source
tag.

| Artifact                 | Version source and release mapping                                                                                                                                                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source release           | Git tag `vX.Y.Z` on the reviewed release commit, with notes describing included components and known limits.                                                                                                                                                                                                                                   |
| Server image             | The server image built from that commit, tagged `X.Y.Z`; record the registry digest in the release notes. The current chart default repository is `ghcr.io/0cwa/matrix-calendar-server`.                                                                                                                                                       |
| Widget image             | The widget image built from that commit, tagged `X.Y.Z`; record the registry digest in the release notes. The current chart default repository is `ghcr.io/0cwa/matrix-calendar-widget`.                                                                                                                                                       |
| Radicale image           | The project-owned Radicale image built from that commit, tagged `X.Y.Z`; choose and document its registry destination before enabling publication. CI currently builds it locally as `matrix-calendar-widget/radicale-openid:ci`.                                                                                                              |
| Server and widget charts | Keep each chart's `version` as the SemVer version of that chart package. Set its `appVersion` to the corresponding application image version. Record the exact image digest in the deployment values or release record where the deployment system supports it.                                                                                |
| Umbrella chart           | Keep its `version` as the SemVer version of the chart package. Set child-chart dependencies to exact chart versions when packaging a release; wildcard local dependencies are not a release lock.                                                                                                                                              |
| Workspace packages       | Keep calendar and timezone libraries bundled as implementation dependencies of the application images. Do not publish them as standalone npm packages unless a separate package-support decision defines their public API and compatibility policy. Resolve the server workspace's missing `private` flag before enabling package publication. |

The source release tag is coordinated across the images in a release, but each
chart package has its own chart `version`: a chart may change without changing
the application image. `appVersion` names the matching image release, not the
chart package release. Before a first published release, align manifest and
chart metadata in a dedicated change and choose the Radicale image registry
destination. This policy does not make those changes or enable publishing.

## Tag channels and SemVer rules

Before the first supported beta, release candidates use
`v0.MINOR.PATCH-beta.N`, for example `v0.4.0-beta.1`. Final controlled-beta
releases use `v0.MINOR.PATCH`, for example `v0.4.0`. Candidate numbers increase
for successive candidates of the same target version. A corrected build gets a
new candidate number; never replace an existing tag or image tag. Do not use a
mutable `latest` tag as a deployment version.

While the project is in `0.y.z`, increment `y` for a release that may break
compatibility and increment `z` for a backward-compatible fix. Candidate tags
are ordered before the corresponding final version under SemVer. After a
separately approved stable `1.0.0` release, use normal SemVer: major for
incompatible changes, minor for backward-compatible features, and patch for
backward-compatible fixes. A stable release must not be inferred from a GitHub
release or tag alone; the release notes must state the support status.

Tags and image versions identify source and build inputs; they do not promise
that different server, widget, Radicale, or chart versions can be mixed. The
release record must state the compatible set and the tested Matrix clients,
CalDAV/Radicale contract, and deployment configuration. Until publication is
explicitly enabled, candidate validation may build artifacts locally or in a
non-production CI context, but must not push them to a production registry.

## Compatibility and rollback expectations

Every release record should identify the Git commit, source tag, server and
widget image versions and digests, Radicale image version and digest, and chart
versions. It should list supported or tested client versions separately from
untested clients and call out API, configuration, and database migration
changes. Do not claim compatibility based only on matching version strings.

Deployments should pin image digests where supported and retain the previous
known-good image set and chart package. A rollback means returning to that
tested application/chart set; it does not reverse calendar changes already
written to Radicale. Database migrations must have a documented compatibility
or recovery path before a release that applies them. If a prior server cannot
read the migrated database, do not roll back by running it against that
database: use the documented database recovery procedure or a forward fix.
Never restore or replace canonical Radicale data as an implicit part of an
application rollback. Backup and restore procedures remain a separate M8 gate.

## Maintainer release checklist

Before creating a candidate or final release:

- Confirm the release commit is based on reviewed `main`, the required checks
  passed for that exact commit, and required security and interoperability
  reviews are recorded.
- Confirm M8 gates relevant to the release have evidence. A container build
  smoke is not deployment validation; operator-specific deployment gates must
  be reported separately.
- Review the changes for configuration, API, CalDAV serialization, and database
  migration compatibility. Verify preservation and recovery behavior where
  applicable.
- Choose the next SemVer version and candidate number. Confirm the Git tag does
  not already exist; tags and published image versions are immutable.
- Build all release images from the tagged source commit. Record their digests
  and SBOMs. Confirm each image's repository and chart defaults match the
  intended deployment, including an explicitly selected Radicale registry
  destination.
- Set server/widget chart `appVersion` values to their application image
  versions. Set chart `version` values for changed chart packages and lock the
  umbrella chart to exact child-chart versions.
- Write release notes listing the source commit, complete compatible artifact
  set, tested Matrix clients and CalDAV contract, migration behavior, known
  limitations, and rollback instructions.
- Publish only after the release gate is approved. Verify the published tags,
  digests, and chart packages against the release record; do not overwrite an
  artifact to correct a mistake.

No publishing automation, registry credentials, registry destination for the
Radicale image, or operator deployment behavior is established by this policy.
