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

import ICAL from 'ical.js';

/** Return true only when deleting the resource removes one complete VEVENT series. */
export function isSafeSingleVeventSeries(icalendar: string): boolean {
  try {
    const calendar = new ICAL.Component(ICAL.parse(icalendar));
    if (calendar.name !== 'vcalendar') {
      return false;
    }

    const components = calendar.getAllSubcomponents();
    const events = components.filter(
      (component) => component.name === 'vevent',
    );
    if (
      events.length === 0 ||
      components.some(
        (component) =>
          component.name !== 'vevent' && component.name !== 'vtimezone',
      )
    ) {
      return false;
    }

    for (const component of components) {
      const allowedChildren =
        component.name === 'vevent' ? ['valarm'] : ['standard', 'daylight'];
      if (
        component
          .getAllSubcomponents()
          .some(
            (child) =>
              !allowedChildren.includes(child.name) ||
              child.getAllSubcomponents().length > 0,
          )
      ) {
        return false;
      }
    }

    const seriesUids = new Set<string>();
    let masterCount = 0;
    for (const event of events) {
      const uidProperties = event.getAllProperties('uid');
      const recurrenceProperties = event.getAllProperties('recurrence-id');
      if (
        uidProperties.length !== 1 ||
        recurrenceProperties.length > 1 ||
        typeof uidProperties[0].getFirstValue() !== 'string'
      ) {
        return false;
      }

      const uid = uidProperties[0].getFirstValue() as string;
      if (uid.length === 0) {
        return false;
      }
      seriesUids.add(uid);
      if (recurrenceProperties.length === 0) {
        masterCount += 1;
      }
    }

    return seriesUids.size === 1 && masterCount === 1;
  } catch {
    return false;
  }
}
