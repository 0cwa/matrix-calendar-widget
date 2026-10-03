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
  canonicalizeCalendarExternalUrl,
  MAX_CALENDAR_EVENT_EXTERNAL_LINK_LABEL_LENGTH,
  MAX_CALENDAR_EVENT_EXTERNAL_LINK_URI_LENGTH,
} from './calendarEventExternalLinks';

describe('canonicalizeCalendarExternalUrl', () => {
  it.each([
    ['https://EXAMPLE.test:443/a path', 'https://example.test/a%20path'],
    ['http://example.test', 'http://example.test/'],
    [
      'https://matrix.to/#/!room:example.test',
      'https://matrix.to/#/!room:example.test',
    ],
  ])('canonicalizes %s', (value, expected) => {
    expect(canonicalizeCalendarExternalUrl(value)).toBe(expected);
  });

  it.each([
    '',
    '/relative/path',
    '//example.test/path',
    'http:relative/path',
    'https:/one-slash/path',
    'https:///ambiguous-authority/path',
    'https:////ambiguous-authority/path',
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'file:///etc/passwd',
    'https://user@example.test/path',
    'https://:secret@example.test/path',
    'https://@example.test/path',
    ' https://example.test/path',
    'https://example.test/path ',
    'https:\\\\example.test\\path',
    'https://example.test/path\nmore',
    'https://example.test/path\u007f',
    'https://example.test/path\u0085',
    'https://example.test/path\u202e',
    'https://example.test/' +
      'a'.repeat(MAX_CALENDAR_EVENT_EXTERNAL_LINK_URI_LENGTH),
    'https://example.test/' + ' '.repeat(1400),
    undefined,
    null,
    42,
  ])('rejects %p', (value) => {
    expect(canonicalizeCalendarExternalUrl(value)).toBeUndefined();
  });
});

describe('boundCalendarEventExternalLinkLabel', () => {
  it('returns trimmed plain text with control characters removed', () => {
    expect(boundCalendarEventExternalLinkLabel('  Main\n\u202eroom  ')).toBe(
      'Mainroom',
    );
  });

  it('limits labels by Unicode code point count', () => {
    const label = '🔗'.repeat(
      MAX_CALENDAR_EVENT_EXTERNAL_LINK_LABEL_LENGTH + 2,
    );

    expect(
      Array.from(boundCalendarEventExternalLinkLabel(label) ?? ''),
    ).toHaveLength(MAX_CALENDAR_EVENT_EXTERNAL_LINK_LABEL_LENGTH);
  });

  it.each([undefined, null, '', ' \t '])(
    'omits empty or non-text labels %p',
    (value) => {
      expect(boundCalendarEventExternalLinkLabel(value)).toBeUndefined();
    },
  );
});
