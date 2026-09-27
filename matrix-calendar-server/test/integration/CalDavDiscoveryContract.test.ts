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

import fetchMock from 'jest-fetch-mock';
import {
  CalDavCredentialProvider,
  CalDavDiscoveryClient,
} from '../../src/caldav';

const describeContract =
  process.env.CALDAV_CONTRACT === '1' ? describe : describe.skip;

describeContract('CalDAV discovery contract', () => {
  let discoveryClient: CalDavDiscoveryClient;

  beforeAll(() => {
    fetchMock.disableMocks();
    discoveryClient = new CalDavDiscoveryClient(baseUrl, credentials);
  });

  afterAll(() => {
    fetchMock.enableMocks();
    fetchMock.dontMock();
  });

  const baseUrl = process.env.CALDAV_BASE_URL ?? 'http://localhost:5232/';
  const username = process.env.CALDAV_USERNAME ?? 'calendar';
  const password = process.env.CALDAV_PASSWORD ?? 'calendar-dev-password';
  const credentials = basicCredentialProvider(username, password);

  it('discovers a real VEVENT collection', async () => {
    const result = await discoveryClient.discover();

    expect(result.calendars).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: 'Contract Calendar',
          components: expect.arrayContaining(['VEVENT']),
        }),
      ]),
    );
  });

  it('sets, reads, and clears calendar-description on a real collection', async () => {
    const calendarUrl = new URL(
      `${encodeURIComponent(username)}/contract-calendar/`,
      baseUrl,
    ).toString();
    const description = '  Planning <Q&A> & follow-up  ';
    let cleared = false;

    try {
      await discoveryClient.updateCalendarDescription(calendarUrl, description);

      const afterSet = await discoveryClient.discover();
      expect(
        afterSet.calendars.find((calendar) => calendar.href === calendarUrl)
          ?.description,
      ).toBe(description);

      await discoveryClient.updateCalendarDescription(calendarUrl, '');

      const afterClear = await discoveryClient.discover();
      expect(
        afterClear.calendars.find((calendar) => calendar.href === calendarUrl)
          ?.description,
      ).toBeUndefined();
      cleared = true;
    } finally {
      if (!cleared) {
        await discoveryClient.updateCalendarDescription(calendarUrl, '');
      }
    }
  });

  it('sets, reads, and clears Apple calendar-color on a real collection', async () => {
    const calendarUrl = new URL(
      `${encodeURIComponent(username)}/contract-calendar/`,
      baseUrl,
    ).toString();
    const color = '#A1b2C3';
    let cleared = false;

    try {
      await discoveryClient.updateCalendarColor(calendarUrl, color);

      const afterSet = await discoveryClient.discover();
      expect(
        afterSet.calendars.find((calendar) => calendar.href === calendarUrl)
          ?.color,
      ).toBe(color);

      await discoveryClient.updateCalendarColor(calendarUrl, '');

      const afterClear = await discoveryClient.discover();
      expect(
        afterClear.calendars.find((calendar) => calendar.href === calendarUrl)
          ?.color,
      ).toBeUndefined();
      cleared = true;
    } finally {
      if (!cleared) {
        await discoveryClient.updateCalendarColor(calendarUrl, '');
      }
    }
  });

  it('fails closed for invalid Radicale credentials', async () => {
    await expect(
      new CalDavDiscoveryClient(
        baseUrl,
        basicCredentialProvider(username, 'not-the-password'),
      ).discover(),
    ).rejects.toMatchObject({
      name: 'CalDavDiscoveryError',
      status: 401,
    });
  });
});

function basicCredentialProvider(
  username: string,
  password: string,
): CalDavCredentialProvider {
  return {
    async getRequestHeaders() {
      const authorization = Buffer.from(
        `${username}:${password}`,
        'utf8',
      ).toString('base64');

      return {
        Authorization: `Basic ${authorization}`,
      };
    },
  };
}
