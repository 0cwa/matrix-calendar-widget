# IANA VTIMEZONE data

`@matrix-calendar-widget/ical-timezones` provides exact, generated VTIMEZONE
components for supported IANA identifiers. `getVTimezoneBlock(id)` returns the
serialized component for a bundled ID and `undefined` for malformed or
unsupported IDs. The lookup uses an own-property check and never treats an ID
as a path.

## Data provenance

The committed bundle was generated from IANA Time Zone Database release
`2026d` on 2026-09-28. The source archive SHA-512 is
`1a27de5af50bbc28a2f64c506ab3678b09d9e5ab6c118f39eb38bb823aa8f57069bf5e465848e71df8274c6b8bcd0fc736a88107e5792d816a1db5d867cbc219`.
Generation used `add2cal/timezones-ical-library` commit
`07ada5679043d60c58d7f5c8ea5825154e0282e2` (package version 2.3.2) and its
VZIC `--pure` mode. The default VZIC mode truncates historical observances and
is unsuitable for this bundle.

The repo-owned
[`iana-timezones.yml`](../.github/workflows/iana-timezones.yml) workflow runs
on relevant pull requests and supports manual refresh. It checks out the
pinned generator source, verifies the published IANA archive checksum, builds
on Ubuntu 24.04 with Node 22, runs `--pure`, then validates emitted serialized
VTIMEZONE blocks with the locked `ical.js` dependency. It uploads only generated
runtime data, provenance, and license notices. The workflow has `contents:read`
permissions and does not contain generator source or write to another
repository.

The IANA list contains 597 identifiers. Link aliases missing as standalone
raw VZIC files are expanded from the same `--pure` build's generated library
database and re-tagged with the requested identifier. The manifest records
these IDs. The upstream convenience aliases `CT`, `ET`, `MT`, and `PT` are
excluded because they are not IANA identifiers.

VZIC writes the current build time to each component's optional `LAST-MODIFIED`
property. The generator removes that property while retaining all timezone
observances, so repeated builds from the same pinned inputs produce identical
runtime VTIMEZONE data. RFC 5545 §3.6.5 defines this VTIMEZONE property as
optional: [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545#section-3.6.5).

## Regression evidence

The hosted generator run was `36410576491`; artifact ID `10963623739` had ZIP
SHA-256
`5e2f9a6ca13899367c8e811fb4c92899dfe554ed36fb53cb08b9cd138831009d`. The
downloaded artifact matched that digest and its internal hashes. The
manifest's `vtimezones.json` SHA-256 is
`3bb759866d313a28006273a133d732bb0c7b6a9b203a24bf1d6abe9d125595c3`.

The serialized `America/Inuvik` component includes historical STANDARD and
DAYLIGHT observances, a 2026-03 transition to UTC−06, and a final
`STANDARD` observance at `2026-11-01T02:00` with both offsets at UTC−06. Tests
parse the component itself and check 1970/1972 history, 2026 winter time, the
cancelled November fallback, and December UTC−06. The `CET` alias is also
parsed and checked for UTC+01 in winter and UTC+02 in summer.

## Licenses and refreshes

The upstream Apache-2.0 license and IANA source notice are preserved under
[`packages/ical-timezones/src/data/licenses`](../packages/ical-timezones/src/data/licenses).
The full provenance manifest is
[`provenance.json`](../packages/ical-timezones/src/data/provenance.json). The
VZIC build source is used only by the hosted generation job and is not copied
into the package.

To refresh, update the IANA version and published archive SHA-512 in the
workflow, then run it on a pull-request branch. Review the artifact's manifest
and serialized components before copying its `vtimezones.json`, provenance,
and notices into this package. Keep the generated data hash in the manifest
and run the package tests before opening the PR.
