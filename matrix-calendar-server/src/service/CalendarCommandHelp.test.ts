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

import i18next from 'i18next';
import {
  formatCalendarCommandHelp,
  type CalendarCommandHelp,
} from './CalendarCommandHelp';
import { parseCalendarCommand } from './CalendarCommandParser';

describe('formatCalendarCommandHelp', () => {
  test('renders localized command groups as Matrix HTML and readable plain text', () => {
    const help = i18next.t('calendarCommandHelp', {
      lng: 'en',
      returnObjects: true,
    }) as unknown as CalendarCommandHelp;

    const result = formatCalendarCommandHelp(help);

    expect(result.body).toContain('Find and read events\n!calendar upcoming');
    expect(result.body).toContain(
      'Example: !calendar create 2026-10-22T10:00 2026-10-22T11:00 "Planning"',
    );
    expect(result.formattedBody).toContain('<h3>Find and read events</h3>');
    expect(result.formattedBody).toContain('<ul><li><code>!calendar upcoming');
    expect(result.formattedBody).toContain('<strong>Example:</strong> <code>');
    expect(result.formattedBody).toContain('&lt;resource-id&gt;');
    expect(result.formattedBody).not.toContain('<resource-id>');

    const examples = help.sections
      .flatMap((section) => section.commands)
      .flatMap((command) => (command.example ? [command.example] : []));
    expect(examples).toHaveLength(4);
    for (const example of examples) {
      expect(() =>
        parseCalendarCommand(example.slice('!calendar '.length)),
      ).not.toThrow();
    }

    const germanHelp = i18next.t('calendarCommandHelp', {
      lng: 'de',
      returnObjects: true,
    }) as unknown as CalendarCommandHelp;
    expect(germanHelp.title).toBe('Befehle für den Raumkalender');
    expect(formatCalendarCommandHelp(germanHelp).formattedBody).toContain(
      '<h3>Termine finden und anzeigen</h3>',
    );
  });

  test('escapes translated text and command examples before formatting HTML', () => {
    const result = formatCalendarCommandHelp({
      title: '<script>alert("x")</script>',
      intro: 'Use <calendar> & stay safe.',
      exampleLabel: '<Example>',
      sections: [
        {
          title: 'Find <events>',
          commands: [
            {
              syntax: '!calendar event <id> & "quoted"',
              description: 'Show <one> event.',
              example: '!calendar event <event>.ics',
            },
          ],
        },
      ],
      requirementsHeading: '<Access>',
      requirements: ['Use <allowed> & authorized rooms.'],
    });

    expect(result.formattedBody).toContain(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
    expect(result.formattedBody).toContain(
      '<code>!calendar event &lt;id&gt; &amp; &quot;quoted&quot;</code>',
    );
    expect(result.formattedBody).toContain(
      'Use &lt;allowed&gt; &amp; authorized rooms.',
    );
    expect(result.formattedBody).toContain('<h3>&lt;Access&gt;</h3>');
    expect(result.formattedBody).toContain('&lt;Example&gt;:</strong>');
    expect(result.formattedBody).not.toContain('<script>');
  });
});
