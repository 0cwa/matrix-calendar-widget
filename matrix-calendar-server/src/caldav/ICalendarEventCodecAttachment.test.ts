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

import { CalendarEventInput } from '@matrix-calendar-widget/calendar';
import {
  ICalendarEventCodec,
  ICalendarEventCodecError,
} from './ICalendarEventCodec';

const oldAttachment =
  'ATTACH;FMTTYPE=application/pdf;X-OPAQUE=one;X-OPAQUE=\r\n two:https://files.example.test/agenda';
const binaryAttachment = 'ATTACH;VALUE=BINARY;ENCODING=BASE64:YQ==';
const codec = () =>
  new ICalendarEventCodec(() => new Date('2026-10-06T12:00:00Z'));

function calendarWithAttachments(...attachments: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    'BEGIN:VEVENT',
    'UID:event@example.test',
    'DTSTAMP:20261001T120000Z',
    'CREATED:20261001T120000Z',
    'LAST-MODIFIED:20261001T120000Z',
    'SEQUENCE:3',
    'DTSTART:20261005T090000Z',
    'DTEND:20261005T100000Z',
    'SUMMARY:Original',
    ...attachments,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function recurringCalendarWithAttachment(attachment: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    'BEGIN:VEVENT',
    'UID:event@example.test',
    'DTSTAMP:20261001T120000Z',
    'CREATED:20261001T120000Z',
    'LAST-MODIFIED:20261001T120000Z',
    'SEQUENCE:3',
    'DTSTART:20261005T090000Z',
    'DTEND:20261005T100000Z',
    'SUMMARY:Original',
    'RRULE:FREQ=DAILY;COUNT=3',
    attachment,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function rawVeventBlocks(source: string): string[][] {
  const blocks: string[][] = [];
  let current: string[] | undefined;
  for (const line of source.split(/\r\n|\n|\r/)) {
    if (/^BEGIN:VEVENT$/i.test(line)) {
      current = [line];
    } else if (current) {
      current.push(line);
      if (/^END:VEVENT$/i.test(line)) {
        blocks.push(current);
        current = undefined;
      }
    }
  }
  return blocks;
}

describe('ICalendarEventCodec URI attachment authoring', () => {
  it('creates one URI attachment and projects it separately', () => {
    const input: CalendarEventInput = {
      uid: 'new@example.test',
      title: 'Planning',
      timing: {
        type: 'timed',
        start: { type: 'zoned', local: '2026-10-06T09:00:00', timezone: 'UTC' },
        end: { type: 'zoned', local: '2026-10-06T10:00:00', timezone: 'UTC' },
      },
      attachment: { url: 'https://files.example.test/agenda' },
    };

    const created = codec().create('team', 'new.ics', input);

    expect(created.icalendar).toMatch(
      /ATTACH(?:;VALUE=URI)?:https:\/\/files\.example\.test\/agenda/,
    );
    expect(created.event.attachments).toEqual([
      { url: 'https://files.example.test/agenda' },
    ]);
    expect(created.event.externalLinks).toEqual([
      {
        kind: 'attachment',
        href: 'https://files.example.test/agenda',
      },
    ]);
    expect(created.event).not.toHaveProperty('attachment');
  });

  it('projects default and explicit URI values as authorable links', () => {
    const parsed = codec().parse(
      'team',
      'event.ics',
      calendarWithAttachments(
        'ATTACH:https://files.example.test/default',
        'ATTACH;VALUE=URI:https://files.example.test/explicit',
        binaryAttachment,
      ),
    );

    expect(parsed.event.attachments).toEqual([
      { url: 'https://files.example.test/default' },
      { url: 'https://files.example.test/explicit' },
    ]);
    expect(parsed.event.unsupportedAttachment).toBeUndefined();
  });

  it('treats adding one existing canonical URL as a byte no-op', () => {
    const source = calendarWithAttachments(
      'ATTACH;VALUE=URI:https://files.example.test:443/agenda',
    );
    const parsed = codec().parse('team', 'event.ics', source);

    expect(
      parsed.applyPatch({
        attachment: {
          action: 'add',
          url: 'https://files.example.test/agenda',
        },
      }),
    ).toEqual({ event: parsed.event, icalendar: source });
  });

  it('preserves links when an existing add accompanies an event edit', () => {
    const source = calendarWithAttachments(
      'ATTACH;VALUE=URI:https://files.example.test:443/agenda',
    );
    const parsed = codec().parse('team', 'event.ics', source);

    const changed = parsed.applyPatch({
      title: 'Updated planning',
      attachment: {
        action: 'add',
        url: 'https://files.example.test/agenda',
      },
    });

    expect(changed.event.title).toBe('Updated planning');
    expect(changed.event.attachments).toEqual([
      { url: 'https://files.example.test/agenda' },
    ]);
  });

  it('adds a link without changing folded parameters or opaque siblings', () => {
    const source = calendarWithAttachments(oldAttachment, binaryAttachment);
    const parsed = codec().parse('team', 'event.ics', source);

    const added = parsed.applyPatch({
      attachment: {
        action: 'add',
        url: 'https://files.example.test/new',
      },
    });

    expect(added.icalendar).toContain(oldAttachment);
    expect(added.icalendar).toContain(binaryAttachment);
    expect(added.icalendar).toContain(
      'ATTACH;VALUE=URI:https://files.example.test/new',
    );
    expect(added.event.attachments).toEqual([
      { url: 'https://files.example.test/agenda' },
      { url: 'https://files.example.test/new' },
    ]);
  });

  it('changes only the selected URI and retains repeated opaque parameters', () => {
    const source = calendarWithAttachments(
      oldAttachment,
      binaryAttachment,
      'ATTACH;VALUE=URI:https://files.example.test/sibling',
    );
    const parsed = codec().parse('team', 'event.ics', source);

    const changed = parsed.applyPatch({
      attachment: {
        action: 'set',
        sourceUrl: 'https://files.example.test/agenda',
        url: 'https://files.example.test/next',
      },
    });
    const unfolded = changed.icalendar.replace(/\r\n[ \t]/g, '');

    expect(unfolded).toContain(
      'ATTACH;FMTTYPE=application/pdf;X-OPAQUE=one;X-OPAQUE=two:https://files.example.test/next',
    );
    expect(changed.icalendar).toContain(binaryAttachment);
    expect(changed.icalendar).toContain(
      'ATTACH;VALUE=URI:https://files.example.test/sibling',
    );
    expect(changed.event.attachments).toEqual([
      { url: 'https://files.example.test/next' },
      { url: 'https://files.example.test/sibling' },
    ]);
  });

  it('removes one link and refuses binary, unsafe, and repeated-VALUE targets', () => {
    const unsafe = 'ATTACH;VALUE=URI:javascript:alert(1)';
    const repeatedValue =
      'ATTACH;VALUE=URI;VALUE=URI:https://files.example.test/opaque';
    const source = calendarWithAttachments(
      'ATTACH;VALUE=URI:https://files.example.test/remove',
      binaryAttachment,
      unsafe,
      repeatedValue,
    );
    const parsed = codec().parse('team', 'event.ics', source);

    expect(parsed.event.attachments).toEqual([
      { url: 'https://files.example.test/remove' },
    ]);
    expect(() =>
      parsed.applyPatch({
        attachment: {
          action: 'remove',
          sourceUrl: 'https://files.example.test/not-authorable',
        },
      }),
    ).toThrow(ICalendarEventCodecError);

    const removed = parsed.applyPatch({
      attachment: {
        action: 'remove',
        sourceUrl: 'https://files.example.test/remove',
      },
    });
    expect(removed.icalendar).not.toContain(
      'ATTACH;VALUE=URI:https://files.example.test/remove',
    );
    expect(removed.icalendar).toContain(binaryAttachment);
    expect(removed.icalendar).toContain(unsafe);
    expect(removed.icalendar).toContain(repeatedValue);
    expect(removed.event.attachments).toBeUndefined();
  });

  it('refuses duplicate canonical identities and retains the source lines', () => {
    const duplicate = 'ATTACH;VALUE=URI:https://files.example.test/shared';
    const source = calendarWithAttachments(
      duplicate,
      'ATTACH:https://FILES.example.test:443/shared',
    );
    const parsed = codec().parse('team', 'event.ics', source);

    expect(parsed.event.attachments).toEqual([
      { url: 'https://files.example.test/shared' },
      { url: 'https://files.example.test/shared' },
    ]);
    expect(parsed.event.unsupportedAttachment).toBe(true);
    expect(() =>
      parsed.applyPatch({
        attachment: {
          action: 'add',
          url: 'https://files.example.test/shared',
        },
      }),
    ).toThrow(ICalendarEventCodecError);
    expect(() =>
      parsed.applyPatch({
        attachment: {
          action: 'remove',
          sourceUrl: 'https://files.example.test/shared',
        },
      }),
    ).toThrow(ICalendarEventCodecError);
    expect(() =>
      parsed.applyPatch({
        attachment: {
          action: 'set',
          sourceUrl: 'https://files.example.test/shared',
          url: 'https://files.example.test/next',
        },
      }),
    ).toThrow(ICalendarEventCodecError);
    expect(parsed.applyPatch({ title: 'Ordinary edit' }).icalendar).toContain(
      duplicate,
    );
  });

  it('does not edit a URL colliding with an opaque URI-intent sibling', () => {
    const sourceUrl = 'https://files.example.test/shared';
    const repeatedValue =
      'ATTACH;VALUE=URI;VALUE=URI:https://FILES.example.test:443/shared';
    const otherUrl = 'https://files.example.test/other';
    const source = calendarWithAttachments(
      `ATTACH;VALUE=URI:${sourceUrl}`,
      repeatedValue,
      `ATTACH;VALUE=URI:${otherUrl}`,
    );
    const parsed = codec().parse('team', 'event.ics', source);

    expect(parsed.event.unsupportedAttachment).toBeUndefined();
    expect(parsed.event.attachments).toEqual([{ url: otherUrl }]);
    expect(() =>
      parsed.applyPatch({
        attachment: { action: 'remove', sourceUrl },
      }),
    ).toThrow(ICalendarEventCodecError);
    expect(() =>
      parsed.applyPatch({
        attachment: { action: 'add', url: sourceUrl },
      }),
    ).toThrow(ICalendarEventCodecError);
    expect(() =>
      parsed.applyPatch({
        attachment: {
          action: 'set',
          sourceUrl: otherUrl,
          url: sourceUrl,
        },
      }),
    ).toThrow(ICalendarEventCodecError);

    const unrelated = parsed.applyPatch({
      attachment: {
        action: 'set',
        sourceUrl: otherUrl,
        url: 'https://files.example.test/changed',
      },
    });
    expect(unrelated.icalendar).toContain(repeatedValue);
    expect(unrelated.icalendar).toContain(`ATTACH;VALUE=URI:${sourceUrl}`);
    expect(unrelated.event.attachments).toEqual([
      { url: 'https://files.example.test/changed' },
    ]);
  });

  it('preserves default, binary, and unsafe raw lines on ordinary edits', () => {
    const unsafe = 'ATTACH;VALUE=URI:https://user:secret@files.example.test/a';
    const source = calendarWithAttachments(
      'ATTACH:https://files.example.test/default',
      binaryAttachment,
      unsafe,
    );
    const edited = codec()
      .parse('team', 'event.ics', source)
      .applyPatch({ title: 'Updated' });

    expect(edited.icalendar).toContain(
      'ATTACH:https://files.example.test/default',
    );
    expect(edited.icalendar).toContain(binaryAttachment);
    expect(edited.icalendar).toContain(unsafe);
    expect(edited.event.attachments).toEqual([
      { url: 'https://files.example.test/default' },
    ]);
  });

  it('returns the original bytes for a same-value operation with exhausted revision metadata', () => {
    const source = calendarWithAttachments(
      'ATTACH;VALUE=URI:https://files.example.test/agenda',
    ).replace('SEQUENCE:3', 'SEQUENCE:2147483647');
    const parsed = codec().parse('team', 'event.ics', source);

    const unchanged = parsed.applyPatch({
      title: 'Original',
      attachment: {
        action: 'set',
        sourceUrl: 'https://files.example.test/agenda',
        url: 'https://files.example.test/agenda',
      },
    });

    expect(unchanged.icalendar).toBe(source);
    expect(unchanged.event.revision?.sequence).toBe(2_147_483_647);
  });

  it('applies an effective write without changing exhausted sequence metadata', () => {
    const source = calendarWithAttachments(
      'ATTACH;VALUE=URI:https://files.example.test/agenda',
    ).replace('SEQUENCE:3', 'SEQUENCE:2147483647');
    const parsed = codec().parse('team', 'event.ics', source);

    const changed = parsed.applyPatch({
      attachment: {
        action: 'set',
        sourceUrl: 'https://files.example.test/agenda',
        url: 'https://files.example.test/revised',
      },
    });

    expect(changed.icalendar).toContain(
      'ATTACH;VALUE=URI:https://files.example.test/revised',
    );
    expect(changed.icalendar).toContain('SEQUENCE:2147483647');
    expect(changed.event.revision?.sequence).toBe(2_147_483_647);
  });

  it('blocks a malformed VEVENT that hides a duplicate same-UID component', () => {
    const hiddenAttachment =
      'ATTACH;VALUE=URI:https://files.example.test/hidden';
    const malformedComponent = [
      'BEGIN:VEVENT',
      'UID:other@example.test',
      'UID:event@example.test',
      'DTSTART:20261006T110000Z',
      'DTEND:20261006T120000Z',
      hiddenAttachment,
      'END:VEVENT',
    ].join('\r\n');
    const source = calendarWithAttachments(
      'ATTACH;VALUE=URI:https://files.example.test/master',
    ).replace(
      'END:VCALENDAR',
      [malformedComponent, 'END:VCALENDAR'].join('\r\n'),
    );
    const parsed = codec().parse('team', 'event.ics', source);

    expect(parsed.event.unsupportedAttachment).toBe(true);
    expect(parsed.event.attachments).toEqual([
      { url: 'https://files.example.test/master' },
    ]);
    expect(() =>
      parsed.applyPatch({
        attachment: {
          action: 'remove',
          sourceUrl: 'https://files.example.test/master',
        },
      }),
    ).toThrow(ICalendarEventCodecError);

    const ordinaryEdit = parsed.applyPatch({ title: 'Updated' });
    expect(ordinaryEdit.icalendar).toContain(hiddenAttachment);
    expect(ordinaryEdit.icalendar).toContain(
      'ATTACH;VALUE=URI:https://files.example.test/master',
    );
  });

  it('blocks detached attachments but permits detached components without ATTACH', () => {
    const masterAttachment =
      'ATTACH;VALUE=URI:' + 'https://files.example.test/agenda';
    const detachedWithAttachment = recurringCalendarWithAttachment(
      masterAttachment,
    ).replace(
      'END:VCALENDAR',
      [
        'BEGIN:VEVENT',
        'UID:event@example.test',
        'RECURRENCE-ID:20261006T090000Z',
        'DTSTART:20261006T090000Z',
        'DTEND:20261006T100000Z',
        'ATTACH;VALUE=URI:https://files.example.test/instance',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    );
    const blocked = codec().parse('team', 'series.ics', detachedWithAttachment);
    expect(blocked.event.unsupportedAttachment).toBe(true);
    expect(() =>
      blocked.applyPatch({
        attachment: {
          action: 'set',
          sourceUrl: 'https://files.example.test/agenda',
          url: 'https://files.example.test/updated',
        },
      }),
    ).toThrow(ICalendarEventCodecError);

    const detachedWithoutAttachment = recurringCalendarWithAttachment(
      masterAttachment,
    ).replace(
      'END:VCALENDAR',
      [
        'BEGIN:VEVENT',
        'UID:event@example.test',
        'RECURRENCE-ID:20261006T090000Z',
        'DTSTART:20261006T090000Z',
        'DTEND:20261006T100000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    );
    const allowed = codec().parse(
      'team',
      'series.ics',
      detachedWithoutAttachment,
    );
    expect(allowed.event.unsupportedAttachment).toBeUndefined();
    const updated = allowed.applyPatch({
      attachment: {
        action: 'set',
        sourceUrl: 'https://files.example.test/agenda',
        url: 'https://files.example.test/updated',
      },
    });
    expect(updated.icalendar).toContain(
      'ATTACH;VALUE=URI:https://files.example.test/updated',
    );
    expect(rawVeventBlocks(updated.icalendar)[1]).not.toContain(
      'ATTACH;VALUE=URI:https://files.example.test/instance',
    );
  });

  it('marks duplicate masters and over-cap link projections read-only', () => {
    const oneAttachment = 'ATTACH;VALUE=URI:https://files.example.test/agenda';
    const duplicateMaster = calendarWithAttachments(oneAttachment).replace(
      'END:VCALENDAR',
      [
        'BEGIN:VEVENT',
        'UID:event@example.test',
        'DTSTART:20261007T090000Z',
        'DTEND:20261007T100000Z',
        'SUMMARY:Ambiguous master',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    );
    const ambiguous = codec().parse('team', 'ambiguous.ics', duplicateMaster);
    expect(ambiguous.event.unsupportedAttachment).toBe(true);
    expect(() =>
      ambiguous.applyPatch({
        attachment: {
          action: 'remove',
          sourceUrl: 'https://files.example.test/agenda',
        },
      }),
    ).toThrow(ICalendarEventCodecError);

    const tooMany = codec().parse(
      'team',
      'many.ics',
      calendarWithAttachments(
        ...Array.from(
          { length: 17 },
          (_value, index) =>
            `ATTACH;VALUE=URI:https://files.example.test/${index}`,
        ),
      ),
    );
    expect(tooMany.event.attachments).toBeUndefined();
    expect(tooMany.event.unsupportedAttachment).toBe(true);
  });

  it('retains master ATTACH lines on occurrence and following clones', () => {
    const attachment =
      'ATTACH;VALUE=URI;X-OPAQUE=one:\r\n' +
      ' https://files.example.test/agenda';
    const source = recurringCalendarWithAttachment(attachment);
    const parsed = codec().parse('team', 'series.ics', source);
    const recurrenceId = {
      type: 'date-time' as const,
      value: { local: '2026-10-06T09:00:00', timezone: 'UTC' },
    };
    const timing = {
      type: 'end' as const,
      start: {
        type: 'date-time' as const,
        value: { local: '2026-10-06T11:00:00', timezone: 'UTC' },
      },
      end: {
        type: 'date-time' as const,
        value: { local: '2026-10-06T12:00:00', timezone: 'UTC' },
      },
    };

    expect(() =>
      parsed.applyPatch({
        recurrence: {
          occurrence: {
            action: 'set-timing',
            recurrenceId,
            timing,
            viewerTimezone: 'UTC',
          },
        },
        attachment: {
          action: 'add',
          url: 'https://files.example.test/instance',
        },
      }),
    ).toThrow(ICalendarEventCodecError);
    expect(() =>
      parsed.applyPatch({
        recurrence: {
          following: {
            action: 'set-timing',
            recurrenceId,
            timing,
            viewerTimezone: 'UTC',
          },
        },
        attachment: {
          action: 'add',
          url: 'https://files.example.test/following',
        },
      }),
    ).toThrow(ICalendarEventCodecError);

    const occurrence = parsed.applyPatch({
      recurrence: {
        occurrence: {
          action: 'set-timing',
          recurrenceId,
          timing,
          viewerTimezone: 'UTC',
        },
      },
    });
    expect(rawVeventBlocks(occurrence.icalendar)).toHaveLength(2);
    for (const block of rawVeventBlocks(occurrence.icalendar)) {
      expect(block.join('\r\n')).toContain(attachment);
    }

    const following = parsed.applyPatch({
      recurrence: {
        following: {
          action: 'set-timing',
          recurrenceId,
          timing,
          viewerTimezone: 'UTC',
        },
      },
    });
    expect(rawVeventBlocks(following.icalendar)).toHaveLength(3);
    for (const block of rawVeventBlocks(following.icalendar)) {
      expect(block.join('\r\n')).toContain(attachment);
    }
  });
});
