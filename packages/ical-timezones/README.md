# IANA VTIMEZONE data package

This workspace package contains generated IANA VTIMEZONE components and a
small safe lookup API. See [the data maintenance guide](../../docs/timezones-ical-data.md)
for the pinned source, hosted generation workflow, provenance, and license
notices.

```ts
import { getVTimezoneBlock } from '@matrix-calendar-widget/ical-timezones';

const component = getVTimezoneBlock('Europe/Stockholm');
if (!component) {
  throw new Error('The requested IANA time zone is unavailable');
}
```

The function returns `undefined` for malformed identifiers and IDs that are
not present in the bundled release. It performs an exact own-property lookup;
it does not access the filesystem or interpret identifiers as paths.
