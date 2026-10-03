/*
 * Copyright 2026 Matrix Calendar Widget contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  boundCalendarEventExternalLinkLabel,
  CalendarEventExternalLink,
  canonicalizeCalendarExternalUrl,
  MAX_CALENDAR_EVENT_EXTERNAL_LINKS,
} from '@matrix-calendar-widget/calendar';
import ICAL from 'ical.js';

/** Read a bounded, sanitized navigation projection from one VEVENT. */
export function readCalendarLinks(
  vevent: ICAL.Component,
): CalendarEventExternalLink[] | undefined {
  const links: CalendarEventExternalLink[] = [];

  for (const property of vevent.getAllProperties()) {
    if (links.length >= MAX_CALENDAR_EVENT_EXTERNAL_LINKS) {
      break;
    }

    try {
      const kind = linkKind(property);
      if (!kind) {
        continue;
      }

      const href = canonicalizeCalendarExternalUrl(property.getFirstValue());
      if (!href) {
        continue;
      }

      const label =
        kind === 'conference'
          ? boundCalendarEventExternalLinkLabel(
              readSingleTextParameter(property, 'label'),
            )
          : undefined;

      links.push({ kind, href, ...(label ? { label } : {}) });
    } catch {
      // Malformed source properties remain in the VCALENDAR but are not links.
    }
  }

  return links.length > 0 ? links : undefined;
}

function linkKind(
  property: ICAL.Property,
): CalendarEventExternalLink['kind'] | undefined {
  if (property.type !== 'uri' || !hasOnlyUriValueType(property)) {
    return undefined;
  }

  switch (property.name) {
    case 'url':
      return 'event';
    case 'attach':
      return 'attachment';
    case 'conference':
      return 'conference';
    default:
      return undefined;
  }
}

function hasOnlyUriValueType(property: ICAL.Property): boolean {
  const valueType = property.getParameter('value');
  if (valueType === undefined) {
    return true;
  }

  if (Array.isArray(valueType)) {
    return (
      valueType.length === 1 &&
      typeof valueType[0] === 'string' &&
      valueType[0].toUpperCase() === 'URI'
    );
  }

  return typeof valueType === 'string' && valueType.toUpperCase() === 'URI';
}

function readSingleTextParameter(
  property: ICAL.Property,
  name: string,
): string | undefined {
  const value = property.getParameter(name);
  if (Array.isArray(value)) {
    return value.length === 1 && typeof value[0] === 'string'
      ? value[0]
      : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}
