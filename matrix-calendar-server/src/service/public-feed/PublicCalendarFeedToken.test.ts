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
  hashPublicCalendarFeedScope,
  publicCalendarFeedUrl,
  signPublicCalendarFeedEnvelope,
  verifyPublicCalendarFeedEnvelope,
} from './PublicCalendarFeedToken';

describe('public calendar feed capability', () => {
  const key = Buffer.alloc(32, 0x53);
  const tokenPath = `/.token/v1/${'A'.repeat(44)}/`;

  it('signs one canonical read-only native token path and hides the target scope', () => {
    const scopeHash = hashPublicCalendarFeedScope(
      key,
      'room\0!synthetic:example.test\0team-calendar',
    );
    const envelope = signPublicCalendarFeedEnvelope(tokenPath, scopeHash, key);

    expect(verifyPublicCalendarFeedEnvelope(envelope, key)).toEqual({
      tokenPath,
      scopeHash,
    });
    expect(envelope).not.toContain('synthetic');
    expect(envelope).not.toContain('example.test');
    expect(
      publicCalendarFeedUrl('https://calendar.example.test/', envelope),
    ).toBe(
      `https://calendar.example.test/v1/public-calendar-feeds/${envelope}`,
    );
  });

  it('rejects unsigned, tampered, noncanonical, and unconfigured envelopes', () => {
    const scopeHash = hashPublicCalendarFeedScope(key, 'personal\0alice');
    const envelope = signPublicCalendarFeedEnvelope(tokenPath, scopeHash, key);

    expect(
      verifyPublicCalendarFeedEnvelope(envelope, undefined),
    ).toBeUndefined();
    expect(
      verifyPublicCalendarFeedEnvelope(`${envelope.slice(0, -1)}x`, key),
    ).toBeUndefined();
    expect(
      verifyPublicCalendarFeedEnvelope(`${envelope}.extra`, key),
    ).toBeUndefined();
    expect(() =>
      signPublicCalendarFeedEnvelope(
        'https://radicale.example.test/.token/v1/secret/',
        scopeHash,
        key,
      ),
    ).toThrow();
    expect(() =>
      signPublicCalendarFeedEnvelope(
        '/xtoken/v1/' + 'A'.repeat(44) + '/',
        scopeHash,
        key,
      ),
    ).toThrow();
    expect(() =>
      signPublicCalendarFeedEnvelope('/.token/v1/a%2Fb/', scopeHash, key),
    ).toThrow();
  });
});
