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
  CalendarEventConferencePatch,
  boundCalendarEventExternalLinkLabel,
  canonicalizeCalendarExternalUrl,
} from '@matrix-calendar-widget/calendar';
import ICAL from 'ical.js';
import { unsupportedConferencePatch } from './ICalendarCodecError';
import {
  contentLineParameters,
  foldContentLine,
  parseContentLine,
  splitContentLineHeader,
  type ICalendarContentLine,
} from './ICalendarContentLine';
import { textValue } from './ICalendarEventFields';

type SupportedConferenceValue = {
  url: string;
  label?: string;
};

type ConferenceSourceState = {
  present: boolean;
  editable?: SupportedConferenceValue;
};

export function readConferenceSourceState(
  vevent: ICAL.Component,
  rawProperties: ICalendarContentLine[],
): ConferenceSourceState {
  const parsedProperties = vevent.getAllProperties('conference');
  if (rawProperties.length === 0 && parsedProperties.length === 0) {
    return { present: false };
  }
  if (rawProperties.length !== 1 || parsedProperties.length !== 1) {
    return { present: true };
  }

  const raw = parseContentLine(rawProperties[0].value);
  const valueTypes = raw
    ? contentLineParameters(raw.header).filter((p) => p.name === 'value')
    : [];
  const labels = raw
    ? contentLineParameters(raw.header).filter((p) => p.name === 'label')
    : [];
  const property = parsedProperties[0];
  if (
    !raw ||
    valueTypes.length !== 1 ||
    valueTypes[0].value?.toUpperCase() !== 'URI' ||
    labels.length > 1 ||
    property.type !== 'uri'
  ) {
    return { present: true };
  }

  const url = canonicalizeCalendarExternalUrl(property.getFirstValue());
  if (!url) {
    return { present: true };
  }

  let label: string | undefined;
  if (labels.length === 1) {
    const rawLabel = property.getParameter('label');
    if (typeof rawLabel !== 'string') {
      return { present: true };
    }
    label = boundCalendarEventExternalLinkLabel(rawLabel);
    if (!label || label !== rawLabel.trim()) {
      return { present: true };
    }
  }

  return {
    present: true,
    editable: { url, ...(label ? { label } : {}) },
  };
}

export function hasAmbiguousConferenceSource(
  calendar: ICAL.Component,
  uid: string,
  master: ICAL.Component,
  conferencePropertiesByEvent: ICalendarContentLine[][],
): boolean {
  const matchingEvents = calendar
    .getAllSubcomponents('vevent')
    .map((component, index) => ({ component, index }))
    .filter(
      ({ component }) =>
        textValue(component.getFirstPropertyValue('uid')) === uid,
    );
  const masters = matchingEvents.filter(
    ({ component }) => !component.hasProperty('recurrence-id'),
  );
  return (
    masters.length !== 1 ||
    matchingEvents.some(
      ({ component, index }) =>
        component !== master &&
        (component.hasProperty('conference') ||
          (conferencePropertiesByEvent[index]?.length ?? 0) > 0),
    )
  );
}

export function conferencePatchIsNoOp(
  patch: CalendarEventConferencePatch,
  state: ConferenceSourceState,
): boolean {
  if (patch.action === 'remove') {
    return !state.present;
  }
  return (
    state.editable?.url === patch.url && state.editable.label === patch.label
  );
}

export function setConferenceProperty(
  vevent: ICAL.Component,
  patch: CalendarEventConferencePatch,
): void {
  const properties = vevent.getAllProperties('conference');
  if (patch.action === 'remove') {
    for (const property of properties) {
      vevent.removeProperty(property);
    }
    return;
  }

  const property =
    properties.length === 1
      ? properties[0]
      : ICAL.Property.fromString(`CONFERENCE;VALUE=URI:${patch.url}`);
  property.setValue(patch.url);
  if (patch.label) {
    property.setParameter('label', patch.label);
  } else {
    property.removeParameter('label');
  }
  if (properties.length === 0) {
    vevent.addProperty(property);
  }
}

export function rawConferencePropertiesAfterPatch(
  sourceProperties: ICalendarContentLine[],
  patch: CalendarEventConferencePatch,
): ICalendarContentLine[] {
  if (patch.action === 'remove' || sourceProperties.length === 0) {
    return [];
  }
  if (sourceProperties.length !== 1) {
    throw unsupportedConferencePatch();
  }

  const parsed = parseContentLine(sourceProperties[0].value);
  if (!parsed) {
    throw unsupportedConferencePatch();
  }
  const segments = splitContentLineHeader(parsed.header);
  const output = [segments[0]];
  let labelWritten = false;
  for (const segment of segments.slice(1)) {
    const separator = segment.indexOf('=');
    const name = (separator < 0 ? segment : segment.slice(0, separator))
      .trim()
      .toLowerCase();
    if (name !== 'label') {
      output.push(segment);
      continue;
    }
    if (patch.label) {
      output.push(`LABEL=${quoteConferenceLabel(patch.label)}`);
      labelWritten = true;
    }
  }
  if (patch.label && !labelWritten) {
    output.push(`LABEL=${quoteConferenceLabel(patch.label)}`);
  }
  return [foldContentLine(`${output.join(';')}:${patch.url}`)];
}

function quoteConferenceLabel(label: string): string {
  return `"${label.replace(/\^/g, '^^').replace(/"/g, "^'")}"`;
}
