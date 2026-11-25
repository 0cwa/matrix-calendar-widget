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
  CalendarEventAlarmPatch,
  CalendarEventDisplayAlarm,
  CalendarEventDisplayAlarmInput,
  isCalendarEventAlarmRemoval,
} from '@matrix-calendar-widget/calendar';
import { randomUUID } from 'crypto';
import ICAL from 'ical.js';
import { unsupportedAlarmPatch } from './ICalendarCodecError';
import {
  contentLineParameters,
  parseContentLine,
  type ICalendarContentLine,
} from './ICalendarContentLine';
import { textValue } from './ICalendarEventFields';
import {
  compactUtcTimestampToIso,
  isValidCompactUtcDateTime,
} from './ICalendarUtcTimestamp';

export function readResourceAlarm(
  calendar: ICAL.Component,
  master: ICAL.Component,
  rawVeventAlarmProperties: () => ICalendarContentLine[][][],
): { alarm?: CalendarEventDisplayAlarm; unsupported?: true } {
  const events = calendar.getAllSubcomponents('vevent');
  const alarms = events.flatMap((vevent) =>
    vevent
      .getAllSubcomponents('valarm')
      .map((alarm) => ({ owner: vevent, alarm })),
  );
  if (alarms.length === 0) {
    return {};
  }
  if (alarms.length !== 1 || alarms[0].owner !== master) {
    return { unsupported: true };
  }

  const rawAlarmsByEvent = rawVeventAlarmProperties();
  const masterIndex = events.indexOf(master);
  const rawMasterAlarms = rawAlarmsByEvent[masterIndex] ?? [];
  if (
    rawAlarmsByEvent.length !== events.length ||
    rawMasterAlarms.length !== 1
  ) {
    return { unsupported: true };
  }

  const alarm = readDisplayAlarm(alarms[0].alarm, rawMasterAlarms[0]);
  if (
    alarm?.uid &&
    resourceHasComponentUid(calendar, alarm.uid, alarms[0].alarm)
  ) {
    return { unsupported: true };
  }
  return alarm ? { alarm } : { unsupported: true };
}

function readDisplayAlarm(
  component: ICAL.Component,
  rawProperties: ICalendarContentLine[],
): CalendarEventDisplayAlarm | undefined {
  const uidProperties = component.getAllProperties('uid');
  const uid =
    uidProperties.length === 1
      ? textValue(uidProperties[0].getFirstValue())
      : undefined;
  const actionProperties = component.getAllProperties('action');
  const triggerProperties = component.getAllProperties('trigger');
  const descriptions = component.getAllProperties('description');
  const rawTriggerProperties = rawProperties
    .map((line) => parseContentLine(line.value))
    .filter((property) => property?.name === 'trigger');
  if (
    uidProperties.length > 1 ||
    (uidProperties.length === 1 &&
      (uid === undefined || !isValidAlarmUid(uid))) ||
    actionProperties.length !== 1 ||
    triggerProperties.length !== 1 ||
    rawTriggerProperties.length !== 1 ||
    descriptions.length !== 1 ||
    component.hasProperty('repeat') ||
    component.hasProperty('duration') ||
    component.getAllSubcomponents().length > 0 ||
    textValue(actionProperties[0].getFirstValue())?.toUpperCase() !== 'DISPLAY'
  ) {
    return undefined;
  }

  const rawTrigger = rawTriggerProperties[0]!;
  const rawParameters = contentLineParameters(rawTrigger.header);
  const parameterNames = rawParameters.map(({ name }) => name);
  if (new Set(parameterNames).size !== parameterNames.length) {
    return undefined;
  }

  const triggerProperty = triggerProperties[0];
  const trigger = triggerProperty.getFirstValue();
  const valueType = rawParameters.find(({ name }) => name === 'value')?.value;
  if (valueType?.toUpperCase() === 'DATE-TIME') {
    if (
      rawParameters.length !== 1 ||
      !isValidCompactUtcDateTime(rawTrigger.value) ||
      !(trigger instanceof ICAL.Time) ||
      trigger.isDate ||
      trigger.zone !== ICAL.Timezone.utcTimezone ||
      trigger.toICALString() !== rawTrigger.value
    ) {
      return undefined;
    }

    return {
      action: 'display',
      ...(uid !== undefined ? { uid } : {}),
      trigger: {
        type: 'absolute',
        value: compactUtcTimestampToIso(rawTrigger.value),
      },
    };
  }

  const related = rawParameters.find(({ name }) => name === 'related')?.value;
  if (
    !(trigger instanceof ICAL.Duration) ||
    !trigger.isNegative ||
    rawParameters.some(({ name }) => !['related', 'value'].includes(name)) ||
    (related !== undefined && related.toUpperCase() !== 'START') ||
    (valueType !== undefined && valueType.toUpperCase() !== 'DURATION') ||
    !isValidNegativeAlarmDuration(rawTrigger.value)
  ) {
    return undefined;
  }

  const leadTime = {
    weeks: trigger.weeks,
    days: trigger.days,
    hours: trigger.hours,
    minutes: trigger.minutes,
    seconds: trigger.seconds,
  };
  if (!isValidAlarmLeadTime(leadTime)) {
    return undefined;
  }

  return {
    action: 'display',
    ...(uid !== undefined ? { uid } : {}),
    trigger: leadTime,
  };
}

export function validateDisplayAlarm(
  value: unknown,
): asserts value is CalendarEventDisplayAlarmInput {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2
  ) {
    throw unsupportedAlarmPatch();
  }
  const alarm = value as Record<string, unknown>;
  if (
    alarm.action !== 'display' ||
    !alarm.trigger ||
    typeof alarm.trigger !== 'object' ||
    Array.isArray(alarm.trigger)
  ) {
    throw unsupportedAlarmPatch();
  }

  const trigger = alarm.trigger as Record<string, unknown>;
  const supportedTrigger =
    trigger.type === 'absolute'
      ? Object.keys(trigger).length === 2 &&
        typeof trigger.value === 'string' &&
        isValidAlarmUtcDateTime(trigger.value)
      : isValidAlarmLeadTime(trigger);
  if (!supportedTrigger) {
    throw unsupportedAlarmPatch();
  }
}

function isValidAlarmUtcDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
    return false;
  }
  const compact = `${value.slice(0, 4)}${value.slice(5, 7)}${value.slice(
    8,
    10,
  )}T${value.slice(11, 13)}${value.slice(14, 16)}${value.slice(17, 19)}Z`;
  return isValidCompactUtcDateTime(compact);
}

function isValidNegativeAlarmDuration(value: string): boolean {
  if (!value.toUpperCase().startsWith('-P')) {
    return false;
  }

  const durationValue = value.slice(2);
  if (/^\d+W$/i.test(durationValue)) {
    return true;
  }

  const dateDuration = /^(\d+)D(?:T(.+))?$/i.exec(durationValue);
  if (dateDuration) {
    return (
      dateDuration[2] === undefined ||
      isValidAlarmTimeDuration(`T${dateDuration[2]}`)
    );
  }

  return isValidAlarmTimeDuration(durationValue);
}

function isValidAlarmTimeDuration(value: string): boolean {
  const match = /^T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(value);
  return Boolean(match && (match[1] || match[2] || match[3]));
}

function isValidAlarmLeadTime(
  value: Record<string, unknown>,
): value is Record<'weeks' | 'days' | 'hours' | 'minutes' | 'seconds', number> {
  const units = ['weeks', 'days', 'hours', 'minutes', 'seconds'] as const;
  if (
    Object.keys(value).length !== units.length ||
    units.some(
      (unit) =>
        !Number.isSafeInteger(value[unit]) || (value[unit] as number) < 0,
    )
  ) {
    return false;
  }

  const hasWeeks = (value.weeks as number) > 0;
  const hasOtherUnits = units
    .slice(1)
    .some((unit) => (value[unit] as number) > 0);
  const hasLeadTime = units.some((unit) => (value[unit] as number) > 0);
  return hasLeadTime && !(hasWeeks && hasOtherUnits);
}

export function setDisplayAlarm(
  calendar: ICAL.Component,
  vevent: ICAL.Component,
  alarm: CalendarEventAlarmPatch | undefined,
  description: string,
  currentAlarm?: CalendarEventDisplayAlarm,
): string | undefined {
  const existing = vevent.getAllSubcomponents('valarm');
  if (alarm === undefined || isCalendarEventAlarmRemoval(alarm)) {
    existing.forEach((component) => vevent.removeSubcomponent(component));
    return undefined;
  }

  validateDisplayAlarm(alarm);
  if (existing.length === 1) {
    const component = existing[0];
    const triggerProperty = component.getFirstProperty('trigger');
    if (!triggerProperty || !currentAlarm) {
      throw unsupportedAlarmPatch();
    }
    const alarmChanged = !displayAlarmTriggersEqual(
      currentAlarm.trigger,
      alarm.trigger,
    );
    if (alarmChanged) {
      setDisplayAlarmTrigger(triggerProperty, alarm.trigger);
    }
    let uid = currentAlarm.uid;
    if (alarmChanged && uid === undefined) {
      uid = createAlarmUid(calendar);
      component.addPropertyWithValue('uid', uid);
    }
    return uid;
  }
  if (existing.length > 1) {
    throw unsupportedAlarmPatch();
  }

  const component = new ICAL.Component('valarm');
  const uid = createAlarmUid(calendar);
  component.addPropertyWithValue('uid', uid);
  component.addPropertyWithValue('action', 'DISPLAY');
  component.addPropertyWithValue('description', description);
  const triggerProperty = new ICAL.Property('trigger');
  setDisplayAlarmTrigger(triggerProperty, alarm.trigger);
  component.addProperty(triggerProperty);
  vevent.addSubcomponent(component);
  return uid;
}

function setDisplayAlarmTrigger(
  property: ICAL.Property,
  trigger: CalendarEventDisplayAlarm['trigger'],
): void {
  if ('type' in trigger) {
    // ical.js emits VALUE=DATE-TIME for a date-time value when serializing.
    property.removeParameter('value');
    property.removeParameter('related');
    property.setValue(ICAL.Time.fromDateTimeString(trigger.value));
    return;
  }

  property.removeParameter('value');
  property.setValue(
    ICAL.Duration.fromData({
      ...trigger,
      isNegative: true,
    }),
  );
}

export function displayAlarmTriggersEqual(
  left: CalendarEventDisplayAlarm['trigger'],
  right: CalendarEventDisplayAlarm['trigger'],
): boolean {
  if ('type' in left || 'type' in right) {
    return 'type' in left && 'type' in right && left.value === right.value;
  }

  return (
    left.weeks === right.weeks &&
    left.days === right.days &&
    left.hours === right.hours &&
    left.minutes === right.minutes &&
    left.seconds === right.seconds
  );
}

function isValidAlarmUid(value: string): boolean {
  return (
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 255 &&
    !containsControlCharacters(value)
  );
}

function containsControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}

function createAlarmUid(calendar: ICAL.Component): string {
  const uid = randomUUID();
  if (resourceHasComponentUid(calendar, uid)) {
    throw unsupportedAlarmPatch();
  }
  return uid;
}

function resourceHasComponentUid(
  calendar: ICAL.Component,
  uid: string,
  exceptAlarm?: ICAL.Component,
): boolean {
  return ['vevent', 'vtodo', 'vjournal', 'vfreebusy'].some((componentName) =>
    calendar
      .getAllSubcomponents(componentName)
      .some(
        (component) =>
          component
            .getAllProperties('uid')
            .some((property) => textValue(property.getFirstValue()) === uid) ||
          component
            .getAllSubcomponents('valarm')
            .some(
              (alarm) =>
                alarm !== exceptAlarm &&
                alarm
                  .getAllProperties('uid')
                  .some(
                    (property) => textValue(property.getFirstValue()) === uid,
                  ),
            ),
      ),
  );
}
