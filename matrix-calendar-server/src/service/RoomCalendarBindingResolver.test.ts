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
  parseRoomCalendarBindings,
  resolveRoomCalendarBinding,
  RoomCalendarBindingError,
  RoomCalendarBindingErrorCode,
  validateRoomCalendarBindings,
} from './RoomCalendarBindingResolver';

describe('RoomCalendarBindingResolver', () => {
  const binding = {
    roomId: '!room-id:example.org',
    calendarId: 'team-calendar',
  };

  it('parses server configuration as an array and preserves it as readonly data', () => {
    expect(parseRoomCalendarBindings(JSON.stringify([binding]))).toEqual([
      binding,
    ]);
    expect(parseRoomCalendarBindings(undefined)).toEqual([]);
  });

  it.each([
    ['malformed JSON', '{'],
    ['object map instead of an array', '{"!room-id:example.org":"team"}'],
    ['non-object entry', '["!room-id:example.org"]'],
    ['missing field', '[{"roomId":"!room-id:example.org"}]'],
    [
      'extra caller-selectable field',
      '[{"roomId":"!room-id:example.org","calendarId":"team","href":"https://dav.example/team/"}]',
    ],
    ['room alias', '[{"roomId":"#team:example.org","calendarId":"team"}]'],
    ['empty room id', '[{"roomId":"!","calendarId":"team"}]'],
    [
      'domainless room id with non-hash content',
      '[{"roomId":"!not a room id","calendarId":"team"}]',
    ],
    [
      'domainless room id with a noncanonical hash length',
      '[{"roomId":"!opaque-id","calendarId":"team"}]',
    ],
    [
      'domainless room id with noncanonical Base64 pad bits',
      `[{"roomId":"!${'A'.repeat(42)}B","calendarId":"team"}]`,
    ],
    ['empty server name', '[{"roomId":"!opaque:","calendarId":"team"}]'],
    [
      'malformed server name',
      '[{"roomId":"!opaque:example.org/path","calendarId":"team"}]',
    ],
    [
      'unsafe calendar URL',
      '[{"roomId":"!opaque:example.org","calendarId":"https://dav.example/team"}]',
    ],
    [
      'calendar path traversal',
      '[{"roomId":"!opaque:example.org","calendarId":"../other"}]',
    ],
  ])(
    'rejects %s without exposing configuration contents',
    (_description, input) => {
      expect(() => parseRoomCalendarBindings(input)).toThrow(
        RoomCalendarBindingError,
      );
    },
  );

  it('accepts legacy, server-name-free, and IPv6-server room IDs', () => {
    expect(
      validateRoomCalendarBindings([
        {
          roomId: '!Nhcu5BS-UMnFX7hBVfVSoXiD7OgH6iRT-xyIuqDnpYQ',
          calendarId: 'calendar-one',
        },
        { roomId: '!opaque-id:example.org:8448', calendarId: 'calendar-two' },
        {
          roomId: '!opaque-id:[2001:db8::1]:8448',
          calendarId: 'calendar-three',
        },
      ]),
    ).toHaveLength(3);
  });

  it('accepts valid non-surrogate Unicode in a legacy room localpart', () => {
    expect(
      validateRoomCalendarBindings([
        { roomId: '!🗓:example.org', calendarId: 'team-calendar' },
      ]),
    ).toHaveLength(1);
  });

  it('rejects NUL, unpaired surrogates, and room IDs over the Matrix byte limit', () => {
    expectBindingError(
      () =>
        validateRoomCalendarBindings([
          { roomId: '!bad\u0000id:example.org', calendarId: 'team-calendar' },
        ]),
      'invalid_room_id',
    );
    expectBindingError(
      () =>
        validateRoomCalendarBindings([
          { roomId: `!bad\ud800:example.org`, calendarId: 'team-calendar' },
        ]),
      'invalid_room_id',
    );
    expectBindingError(
      () =>
        validateRoomCalendarBindings([
          {
            roomId: `!${'x'.repeat(250)}:example.org`,
            calendarId: 'team-calendar',
          },
        ]),
      'invalid_room_id',
    );
  });

  it('rejects duplicate rooms before resolving a map', () => {
    expectBindingError(
      () => validateRoomCalendarBindings([binding, binding]),
      'duplicate_room_id',
    );
  });

  it('rejects assigning one calendar to multiple rooms', () => {
    expectBindingError(
      () =>
        validateRoomCalendarBindings([
          binding,
          {
            roomId: '!another-room:example.org',
            calendarId: binding.calendarId,
          },
        ]),
      'duplicate_calendar_id',
    );
  });

  it('resolves only an exact configured room and optional matching calendar', () => {
    expect(resolveRoomCalendarBinding([binding], binding.roomId)).toEqual(
      binding,
    );
    expect(
      resolveRoomCalendarBinding([binding], binding.roomId, binding.calendarId),
    ).toEqual(binding);
  });

  it('fails closed for missing, malformed, or caller-mismatched targets', () => {
    expectBindingError(
      () => resolveRoomCalendarBinding([], binding.roomId),
      'missing_binding',
    );
    expectBindingError(
      () => resolveRoomCalendarBinding([binding], '#team:example.org'),
      'invalid_room_id',
    );
    expectBindingError(
      () =>
        resolveRoomCalendarBinding([binding], binding.roomId, 'other-calendar'),
      'request_calendar_mismatch',
    );
    expectBindingError(
      () =>
        resolveRoomCalendarBinding(
          [binding],
          binding.roomId,
          'https://dav.example/',
        ),
      'request_calendar_mismatch',
    );
  });

  it('does not include raw binding input in parse errors', () => {
    const secretLikeValue = 'private-calendar-token';
    let error: unknown;
    try {
      parseRoomCalendarBindings(secretLikeValue);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RoomCalendarBindingError);
    expect(String(error)).not.toContain(secretLikeValue);
  });
});

function expectBindingError(
  operation: () => unknown,
  code: RoomCalendarBindingErrorCode,
): void {
  let error: unknown;
  try {
    operation();
  } catch (caught) {
    error = caught;
  }

  expect(error).toBeInstanceOf(RoomCalendarBindingError);
  expect(error).toMatchObject({ code });
}
