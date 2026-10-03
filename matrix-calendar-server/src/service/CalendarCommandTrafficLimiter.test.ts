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

import { CalendarCommandTrafficLimiter } from './CalendarCommandTrafficLimiter';

describe('CalendarCommandTrafficLimiter', () => {
  test('allows six commands per actor in a rolling minute and expires at the window boundary', () => {
    let now = 100_000;
    const limiter = new CalendarCommandTrafficLimiter(() => now);
    const roomId = '!team:matrix.org';
    const actorId = '@alice:matrix.org';

    for (let index = 0; index < 6; index += 1) {
      const release = limiter.tryAcquire(roomId, actorId);
      expect(release).toBeDefined();
      release?.();
    }
    expect(limiter.tryAcquire(roomId, actorId)).toBeUndefined();

    now += 59_999;
    expect(limiter.tryAcquire(roomId, actorId)).toBeUndefined();

    now += 1;
    const afterWindow = limiter.tryAcquire(roomId, actorId);
    expect(afterWindow).toBeDefined();
    afterWindow?.();
  });

  test('limits concurrent work globally, per room, and per actor-room while isolating rooms', () => {
    const now = 100_000;
    const limiter = new CalendarCommandTrafficLimiter(() => now);
    const roomId = '!team:matrix.org';

    const alice = limiter.tryAcquire(roomId, '@alice:matrix.org');
    expect(alice).toBeDefined();
    expect(limiter.tryAcquire(roomId, '@alice:matrix.org')).toBeUndefined();

    const bob = limiter.tryAcquire(roomId, '@bob:matrix.org');
    expect(bob).toBeDefined();
    expect(limiter.tryAcquire(roomId, '@carol:matrix.org')).toBeUndefined();

    const aliceInAnotherRoom = limiter.tryAcquire(
      '!other:matrix.org',
      '@alice:matrix.org',
    );
    expect(aliceInAnotherRoom).toBeDefined();

    alice?.();
    bob?.();
    aliceInAnotherRoom?.();

    const globalLeases: Array<() => void> = [];
    for (let index = 0; index < 8; index += 1) {
      const release = limiter.tryAcquire(
        `!room-${index}:matrix.org`,
        `@user-${index}:matrix.org`,
      );
      expect(release).toBeDefined();
      if (release) globalLeases.push(release);
    }
    expect(
      limiter.tryAcquire('!room-overflow:matrix.org', '@new:matrix.org'),
    ).toBeUndefined();

    globalLeases[0]();
    const afterGlobalRelease = limiter.tryAcquire(
      '!room-overflow:matrix.org',
      '@new:matrix.org',
    );
    expect(afterGlobalRelease).toBeDefined();
    afterGlobalRelease?.();
    globalLeases.slice(1).forEach((release) => release());
  });

  test('keeps an active reservation after its burst token expires until release', () => {
    let now = 100_000;
    const limiter = new CalendarCommandTrafficLimiter(() => now);
    const release = limiter.tryAcquire('!team:matrix.org', '@alice:matrix.org');
    expect(release).toBeDefined();

    now += 60_000;
    expect(
      limiter.tryAcquire('!team:matrix.org', '@alice:matrix.org'),
    ).toBeUndefined();

    release?.();
    release?.();
    const afterRelease = limiter.tryAcquire(
      '!team:matrix.org',
      '@alice:matrix.org',
    );
    expect(afterRelease).toBeDefined();
    afterRelease?.();
  });

  test('caps distinct state and evicts only after inactive window entries expire', () => {
    let now = 100_000;
    const limiter = new CalendarCommandTrafficLimiter(() => now);

    for (let index = 0; index < 1_000; index += 1) {
      const release = limiter.tryAcquire(
        `!room-${index}:matrix.org`,
        `@user-${index}:matrix.org`,
      );
      expect(release).toBeDefined();
      release?.();
    }
    expect(
      limiter.tryAcquire('!room-overflow:matrix.org', '@new:matrix.org'),
    ).toBeUndefined();

    now += 60_000;
    const afterExpiry = limiter.tryAcquire(
      '!room-overflow:matrix.org',
      '@new:matrix.org',
    );
    expect(afterExpiry).toBeDefined();
    afterExpiry?.();
  });

  test('rejects malformed, noncanonical, and unbounded Matrix identifiers', () => {
    const limiter = new CalendarCommandTrafficLimiter(() => 100_000);
    const nonCanonicalDomainlessId = `!${'A'.repeat(42)}B`;

    expect(
      limiter.tryAcquire('room text', '@alice:matrix.org'),
    ).toBeUndefined();
    expect(
      limiter.tryAcquire('!team:matrix.org', 'alice:matrix.org'),
    ).toBeUndefined();
    expect(
      limiter.tryAcquire('!team:matrix.org', `@${'a'.repeat(512)}:matrix.org`),
    ).toBeUndefined();
    expect(
      limiter.tryAcquire('!team:bad domain', '@alice:matrix.org'),
    ).toBeUndefined();
    expect(
      limiter.tryAcquire('!team:matrix.org:123456', '@alice:matrix.org'),
    ).toBeUndefined();
    expect(
      limiter.tryAcquire('!opaque-id', '@alice:matrix.org'),
    ).toBeUndefined();
    expect(
      limiter.tryAcquire(nonCanonicalDomainlessId, '@alice:matrix.org'),
    ).toBeUndefined();
  });

  test('accepts canonical version-12 and legacy opaque room IDs with historical printable sender localparts', () => {
    const limiter = new CalendarCommandTrafficLimiter(() => 100_000);
    const version12RoomId = '!Nhcu5BS-UMnFX7hBVfVSoXiD7OgH6iRT-xyIuqDnpYQ';

    const version12 = limiter.tryAcquire(version12RoomId, '@alice:matrix.org');
    expect(version12).toBeDefined();
    version12?.();

    const legacyOpaque = limiter.tryAcquire(
      '!🗓~archive:example.org',
      '@legacy~ actor:example.org',
    );
    expect(legacyOpaque).toBeDefined();
    legacyOpaque?.();
  });

  test('preserves case-sensitive version-12 room ID keys', () => {
    const limiter = new CalendarCommandTrafficLimiter(() => 100_000);
    const uppercaseRoomId = '!Nhcu5BS-UMnFX7hBVfVSoXiD7OgH6iRT-xyIuqDnpYQ';
    const lowercaseRoomId = '!nhcu5BS-UMnFX7hBVfVSoXiD7OgH6iRT-xyIuqDnpYQ';

    for (let index = 0; index < 6; index += 1) {
      const uppercase = limiter.tryAcquire(
        uppercaseRoomId,
        '@alice:matrix.org',
      );
      const lowercase = limiter.tryAcquire(
        lowercaseRoomId,
        '@alice:matrix.org',
      );
      expect(uppercase).toBeDefined();
      expect(lowercase).toBeDefined();
      uppercase?.();
      lowercase?.();
    }

    expect(
      limiter.tryAcquire(uppercaseRoomId, '@alice:matrix.org'),
    ).toBeUndefined();
    expect(
      limiter.tryAcquire(lowercaseRoomId, '@alice:matrix.org'),
    ).toBeUndefined();
  });

  test('normalizes case-insensitive server names in tuple keys', () => {
    const limiter = new CalendarCommandTrafficLimiter(() => 100_000);

    for (let index = 0; index < 6; index += 1) {
      const serverName = index % 2 === 0 ? 'MATRIX.ORG' : 'matrix.org';
      const release = limiter.tryAcquire(
        `!team:${serverName}`,
        `@alice:${serverName}`,
      );
      expect(release).toBeDefined();
      release?.();
    }

    expect(
      limiter.tryAcquire('!team:matrix.org', '@alice:matrix.org'),
    ).toBeUndefined();
  });
});
