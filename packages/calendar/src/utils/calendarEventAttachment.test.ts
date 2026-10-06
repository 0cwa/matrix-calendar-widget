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
  CalendarEventAttachmentValidationError,
  normalizeCalendarEventAttachmentInput,
  normalizeCalendarEventAttachmentPatch,
  validateCalendarEventInputAttachment,
  validateCalendarEventPatchAttachment,
} from './calendarEventAttachment';

describe('calendar event attachment authoring payloads', () => {
  it('accepts one safe HTTP(S) attachment and canonicalizes its URL', () => {
    expect(
      normalizeCalendarEventAttachmentInput({
        url: 'https://files.example.test:443/agenda',
      }),
    ).toEqual({ url: 'https://files.example.test/agenda' });
  });

  it('accepts only add, set, or remove operations with safe URLs', () => {
    expect(
      normalizeCalendarEventAttachmentPatch({
        action: 'add',
        url: 'https://files.example.test/new',
      }),
    ).toEqual({
      action: 'add',
      url: 'https://files.example.test/new',
    });
    expect(
      normalizeCalendarEventAttachmentPatch({
        action: 'set',
        sourceUrl: 'https://files.example.test/old',
        url: 'https://files.example.test/new',
      }),
    ).toEqual({
      action: 'set',
      sourceUrl: 'https://files.example.test/old',
      url: 'https://files.example.test/new',
    });
    expect(
      normalizeCalendarEventAttachmentPatch({
        action: 'remove',
        sourceUrl: 'https://files.example.test/old',
      }),
    ).toEqual({
      action: 'remove',
      sourceUrl: 'https://files.example.test/old',
    });
  });

  it('rejects unsafe URLs, extra operation fields, and projected event data', () => {
    expect(() =>
      normalizeCalendarEventAttachmentInput({
        url: 'javascript:alert(1)',
      }),
    ).toThrow(CalendarEventAttachmentValidationError);
    expect(() =>
      normalizeCalendarEventAttachmentPatch({
        action: 'set',
        sourceUrl: 'https://files.example.test/old',
        url: 'https://files.example.test/new',
        extra: true,
      }),
    ).toThrow(CalendarEventAttachmentValidationError);
    expect(() =>
      validateCalendarEventPatchAttachment({
        attachment: {
          action: 'remove',
          sourceUrl: 'https://files.example.test/old',
        },
        attachments: [],
      }),
    ).toThrow(CalendarEventAttachmentValidationError);
    expect(() =>
      validateCalendarEventInputAttachment({
        uid: 'event@example.test',
        unsupportedAttachment: true,
      }),
    ).toThrow(CalendarEventAttachmentValidationError);
  });
});
