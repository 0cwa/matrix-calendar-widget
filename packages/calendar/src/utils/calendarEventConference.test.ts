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
  CalendarEventConferenceValidationError,
  normalizeCalendarEventConferenceInput,
  normalizeCalendarEventConferencePatch,
  validateCalendarEventInputConference,
  validateCalendarEventPatchConference,
} from './calendarEventConference';

describe('calendar conference write validation', () => {
  it('canonicalizes one safe URL and treats omitted LABEL as a replacement clear', () => {
    expect(
      normalizeCalendarEventConferenceInput({
        url: 'HTTPS://EXAMPLE.TEST/meet',
        label: 'Room A',
      }),
    ).toEqual({ url: 'https://example.test/meet', label: 'Room A' });
    expect(
      normalizeCalendarEventConferencePatch({
        action: 'set',
        url: 'https://example.test/meet',
      }),
    ).toEqual({ action: 'set', url: 'https://example.test/meet' });
    expect(normalizeCalendarEventConferencePatch({ action: 'remove' })).toEqual(
      { action: 'remove' },
    );
  });

  it.each([
    { url: 'javascript:alert(1)' },
    { url: 'https://user@example.test/' },
    { url: 'https://example.test/\nmeet' },
    { url: 'https://example.test/', extra: true },
    { url: 'https://example.test/', label: 12 },
    { url: 'https://example.test/', label: 'x\u202ey' },
    { url: 'https://example.test/', label: 'x'.repeat(121) },
  ])('rejects malformed or unsafe conference input %#', (value) => {
    expect(() => normalizeCalendarEventConferenceInput(value)).toThrow(
      CalendarEventConferenceValidationError,
    );
  });

  it.each([
    { action: 'set', url: 'https://example.test/', ignored: true },
    { action: 'remove', url: 'https://example.test/' },
    { action: 'set', url: 'https://example.test', label: null },
    { action: 'replace', url: 'https://example.test' },
  ])('rejects malformed patch operation %#', (value) => {
    expect(() => normalizeCalendarEventConferencePatch(value)).toThrow(
      CalendarEventConferenceValidationError,
    );
  });

  it('rejects attempts to spoof read-only link projection fields', () => {
    expect(() =>
      validateCalendarEventInputConference({
        uid: 'event',
        externalLinks: [],
      }),
    ).toThrow(CalendarEventConferenceValidationError);
    expect(() =>
      validateCalendarEventPatchConference({
        unsupportedConference: true,
      }),
    ).toThrow(CalendarEventConferenceValidationError);
  });
});
