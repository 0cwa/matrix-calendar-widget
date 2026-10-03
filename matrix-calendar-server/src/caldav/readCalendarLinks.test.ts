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
  CalendarEventExternalLink,
  MAX_CALENDAR_EVENT_EXTERNAL_LINKS,
} from '@matrix-calendar-widget/calendar';
import fs from 'fs';
import ICAL from 'ical.js';
import path from 'path';
import { ICalendarEventCodec } from './ICalendarEventCodec';
import { readCalendarLinks } from './readCalendarLinks';

const fixturePath = path.resolve(
  __dirname,
  '../../../fixtures/ical/external-links.ics',
);

function readFixture(): string {
  return fs.readFileSync(fixturePath, 'utf8');
}

function parseVevent(source: string): ICAL.Component {
  const calendar = new ICAL.Component(ICAL.parse(source));
  const vevent = calendar.getFirstSubcomponent('vevent');
  if (!vevent) {
    throw new Error('Fixture does not contain a VEVENT');
  }
  return vevent;
}

function propertyLines(vevent: ICAL.Component, name: string): string[] {
  return vevent
    .getAllProperties(name)
    .map((property) => property.toICALString());
}

describe('readCalendarLinks', () => {
  it('projects safe event, URI attachment, and conference links only', () => {
    expect(readCalendarLinks(parseVevent(readFixture()))).toEqual([
      {
        kind: 'event',
        href: 'https://events.example.test/agenda',
      },
      {
        kind: 'attachment',
        href: 'https://files.example.test/agenda.pdf',
      },
      {
        kind: 'attachment',
        href: 'https://files.example.test/notes.txt',
      },
      {
        kind: 'conference',
        href: 'https://meet.example.test/room/42',
        label: 'Main room',
      },
    ] satisfies CalendarEventExternalLink[]);
  });

  it('bounds the number of projected links', () => {
    const vevent = new ICAL.Component('vevent');
    for (
      let index = 0;
      index < MAX_CALENDAR_EVENT_EXTERNAL_LINKS + 2;
      index += 1
    ) {
      const attachment = new ICAL.Property('attach');
      attachment.setValue(`https://files.example.test/${index}.pdf`);
      vevent.addProperty(attachment);
    }

    expect(readCalendarLinks(vevent)).toHaveLength(
      MAX_CALENDAR_EVENT_EXTERNAL_LINKS,
    );
  });

  it('preserves links and uninterpreted participant data on an ordinary edit', () => {
    const source = readFixture();
    const parsed = new ICalendarEventCodec().parse(
      'team',
      'external-links.ics',
      source,
    );
    const edited = parsed.applyPatch({ title: 'Edited external link fixture' });
    const sourceVevent = parseVevent(source);
    const editedVevent = parseVevent(edited.icalendar);

    for (const propertyName of [
      'url',
      'attach',
      'conference',
      'organizer',
      'attendee',
      'x-unknown-property',
    ]) {
      expect(propertyLines(editedVevent, propertyName)).toEqual(
        propertyLines(sourceVevent, propertyName),
      );
    }
    expect(propertyLines(editedVevent, 'attach')).toHaveLength(4);
    expect(
      editedVevent.getAllProperties('attach').map((property) => property.type),
    ).toEqual(['uri', 'uri', 'binary', 'uri']);
  });

  it('includes the safe projection in codec reads and ordinary edit results', () => {
    const source = readFixture();
    const parsed = new ICalendarEventCodec().parse(
      'team',
      'external-links.ics',
      source,
    );
    const expectedLinks = [
      {
        kind: 'event',
        href: 'https://events.example.test/agenda',
      },
      {
        kind: 'attachment',
        href: 'https://files.example.test/agenda.pdf',
      },
      {
        kind: 'attachment',
        href: 'https://files.example.test/notes.txt',
      },
      {
        kind: 'conference',
        href: 'https://meet.example.test/room/42',
        label: 'Main room',
      },
    ] satisfies CalendarEventExternalLink[];

    expect(parsed.event.externalLinks).toEqual(expectedLinks);
    expect(
      parsed.applyPatch({ title: 'Edited external link fixture' }).event
        .externalLinks,
    ).toEqual(expectedLinks);
    expect(
      parsed.applyPatch({ url: 'javascript:alert(1)' }).event.externalLinks,
    ).toEqual(expectedLinks.slice(1));
  });

  it('projects a canonical event link from a newly created VEVENT', () => {
    const created = new ICalendarEventCodec().create('team', 'created.ics', {
      uid: 'created@example.test',
      title: 'New event',
      timing: {
        type: 'timed',
        start: { type: 'floating', local: '2026-10-04T09:00:00' },
        end: { type: 'floating', local: '2026-10-04T10:00:00' },
      },
      url: 'https://EVENTS.EXAMPLE.TEST:443/agenda',
    });

    expect(created.event.externalLinks).toEqual([
      {
        kind: 'event',
        href: 'https://events.example.test/agenda',
      },
    ]);
  });
});
