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
observances. The manifest also omits a generation timestamp; it records the
pinned source and actual tool versions instead. Those choices make runtime data
and provenance hashes repeatable for the same inputs and toolchain. RFC 5545
§3.6.5 defines VTIMEZONE `LAST-MODIFIED` as optional:
[RFC 5545](https://www.rfc-editor.org/rfc/rfc5545#section-3.6.5).

## Regression evidence

The hosted generator run was `36413953822`; artifact ID `10966906625` had ZIP
SHA-256
`a5edaed6b9dde10e96eb29831c58680fac9c11ad17c2bbcfedb400d934769961`. The
downloaded ZIP matched GitHub's digest. Its inner file hashes are:

- `vtimezones.json`: `0e436433d2064275ffd13f303ed6d5b3aeb7ce4f8df016f5f75a50c10d2f2d2e`
- `provenance.json`: `3bb1fab27dc90ff5641ccf8e9eb9fad25c1d871572e409f7ad5c7f52d854d9ba`
- `licenses/timezones-ical-library-LICENSE`: `5899dbe0bfc6533ff55fa14869b01c4d8f36de258e6db722c8e284eaa546cce4`
- `licenses/IANA-theory.html`: `3f821678362a806a8547a3de08c5ba1d4832ffa70e0c0328572504bcfc9cf334`

The manifest has no wall-clock generation field, and none of the 597
VTIMEZONE blocks has a generated `LAST-MODIFIED` property. Repeated runs from
the same pinned inputs and toolchain produce the same inner file hashes.

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
