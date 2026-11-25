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
  CalendarEventAttachmentPatch,
  MAX_CALENDAR_EVENT_AUTHORABLE_ATTACHMENTS,
  canonicalizeCalendarExternalUrl,
} from '@matrix-calendar-widget/calendar';
import ICAL from 'ical.js';
import { unsupportedAttachmentPatch } from './ICalendarCodecError';
import {
  contentLineParameters,
  foldContentLine,
  parseContentLine,
  type ICalendarContentLine,
} from './ICalendarContentLine';
import { textValue } from './ICalendarEventFields';

type SupportedAttachmentValue = {
  url: string;
  propertyIndex: number;
};

type AttachmentSourceState = {
  editable: SupportedAttachmentValue[];
  opaqueUriUrls: string[];
  projectable: boolean;
  unsupported: boolean;
};

type AttachmentPatchPlan = {
  noOp: boolean;
  nextProperties: ICalendarContentLine[];
  sourcePropertyIndex?: number;
};

export function readAttachmentSourceState(
  vevent: ICAL.Component,
  rawProperties: ICalendarContentLine[],
): AttachmentSourceState {
  const parsedProperties = vevent.getAllProperties('attach');
  let unsupported = rawProperties.length !== parsedProperties.length;
  const editable: SupportedAttachmentValue[] = [];
  const opaqueUriUrls: string[] = [];

  for (
    let propertyIndex = 0;
    propertyIndex < Math.min(rawProperties.length, parsedProperties.length);
    propertyIndex += 1
  ) {
    const raw = parseContentLine(rawProperties[propertyIndex].value);
    const property = parsedProperties[propertyIndex];
    const valueTypes = raw
      ? contentLineParameters(raw.header).filter(
          (parameter) => parameter.name === 'value',
        )
      : [];
    const hasUriValueType =
      valueTypes.length === 0 ||
      valueTypes.some((parameter) => parameter.value?.toUpperCase() === 'URI');
    const rawUrl = raw ? canonicalizeCalendarExternalUrl(raw.value) : undefined;
    const parsedUrl = canonicalizeCalendarExternalUrl(property.getFirstValue());
    if (
      !raw ||
      valueTypes.length > 1 ||
      (valueTypes.length === 1 &&
        valueTypes[0].value?.toUpperCase() !== 'URI') ||
      property.type !== 'uri' ||
      !rawUrl ||
      rawUrl !== parsedUrl
    ) {
      if (hasUriValueType && rawUrl) {
        opaqueUriUrls.push(rawUrl);
      }
      continue;
    }
    if (editable.length <= MAX_CALENDAR_EVENT_AUTHORABLE_ATTACHMENTS) {
      editable.push({ url: rawUrl, propertyIndex });
    } else {
      unsupported = true;
    }
  }

  const seenUrls = new Set<string>();
  for (const attachment of editable) {
    if (seenUrls.has(attachment.url)) {
      unsupported = true;
    }
    seenUrls.add(attachment.url);
  }
  if (editable.length > MAX_CALENDAR_EVENT_AUTHORABLE_ATTACHMENTS) {
    unsupported = true;
  }

  return {
    editable,
    opaqueUriUrls,
    projectable:
      rawProperties.length === parsedProperties.length &&
      editable.length <= MAX_CALENDAR_EVENT_AUTHORABLE_ATTACHMENTS,
    unsupported,
  };
}

export function hasAmbiguousAttachmentSource(
  calendar: ICAL.Component,
  uid: string,
  master: ICAL.Component,
  attachmentPropertiesByEvent: ICalendarContentLine[][],
): boolean {
  const matchingEvents = calendar
    .getAllSubcomponents('vevent')
    .map((component, index) => ({ component, index }))
    .filter(({ component }) =>
      component
        .getAllProperties('uid')
        .some((property) => textValue(property.getFirstValue()) === uid),
    );
  const masters = matchingEvents.filter(
    ({ component }) => !component.hasProperty('recurrence-id'),
  );
  return (
    masters.length !== 1 ||
    matchingEvents.some(({ component, index }) => {
      if (component.getAllProperties('uid').length !== 1) {
        return true;
      }
      if (component === master) {
        return false;
      }
      return (
        component.getAllProperties('attach').length > 0 ||
        (attachmentPropertiesByEvent[index]?.length ?? 0) > 0
      );
    })
  );
}

export function planAttachmentPatch(
  sourceProperties: ICalendarContentLine[],
  sourceState: AttachmentSourceState,
  patch: CalendarEventAttachmentPatch,
): AttachmentPatchPlan {
  if (sourceState.unsupported) {
    throw unsupportedAttachmentPatch();
  }

  const targetUrl = 'sourceUrl' in patch ? patch.sourceUrl : patch.url;
  if (sourceState.opaqueUriUrls.includes(targetUrl)) {
    throw unsupportedAttachmentPatch();
  }
  if (patch.action === 'set' && sourceState.opaqueUriUrls.includes(patch.url)) {
    throw unsupportedAttachmentPatch();
  }
  const matches = sourceState.editable.filter(
    (attachment) => attachment.url === targetUrl,
  );
  if (patch.action === 'add') {
    if (matches.length > 1) {
      throw unsupportedAttachmentPatch();
    }
    if (matches.length === 1) {
      return { noOp: true, nextProperties: sourceProperties };
    }
    if (
      sourceState.editable.length >= MAX_CALENDAR_EVENT_AUTHORABLE_ATTACHMENTS
    ) {
      throw unsupportedAttachmentPatch();
    }
    return {
      noOp: false,
      nextProperties: [
        ...sourceProperties,
        foldContentLine(`ATTACH;VALUE=URI:${patch.url}`),
      ],
    };
  }

  if (matches.length !== 1) {
    throw unsupportedAttachmentPatch();
  }
  const sourcePropertyIndex = matches[0].propertyIndex;
  if (patch.action === 'remove') {
    return {
      noOp: false,
      sourcePropertyIndex,
      nextProperties: sourceProperties.filter(
        (_property, index) => index !== sourcePropertyIndex,
      ),
    };
  }
  if (patch.sourceUrl === patch.url) {
    return {
      noOp: true,
      sourcePropertyIndex,
      nextProperties: sourceProperties,
    };
  }
  if (
    sourceState.editable.some(
      (attachment) =>
        attachment.propertyIndex !== sourcePropertyIndex &&
        attachment.url === patch.url,
    )
  ) {
    throw unsupportedAttachmentPatch();
  }
  const source = parseContentLine(sourceProperties[sourcePropertyIndex].value);
  if (!source) {
    throw unsupportedAttachmentPatch();
  }
  return {
    noOp: false,
    sourcePropertyIndex,
    nextProperties: sourceProperties.map((property, index) =>
      index === sourcePropertyIndex
        ? foldContentLine(`${source.header}:${patch.url}`)
        : property,
    ),
  };
}

export function setAttachmentProperty(
  vevent: ICAL.Component,
  patch: CalendarEventAttachmentPatch,
  sourcePropertyIndex?: number,
): void {
  if (patch.action === 'add') {
    vevent.addProperty(
      ICAL.Property.fromString(`ATTACH;VALUE=URI:${patch.url}`),
    );
    return;
  }
  const properties = vevent.getAllProperties('attach');
  const property =
    sourcePropertyIndex === undefined
      ? undefined
      : properties[sourcePropertyIndex];
  if (!property) {
    throw unsupportedAttachmentPatch();
  }
  if (patch.action === 'remove') {
    vevent.removeProperty(property);
  } else {
    property.setValue(patch.url);
  }
}
