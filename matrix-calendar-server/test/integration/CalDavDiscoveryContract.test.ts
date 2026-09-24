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
  CalDavCredentialProvider,
  CalDavDiscoveryClient,
} from '../../src/caldav';
import fetchMock from 'jest-fetch-mock';

const describeContract =
  process.env.CALDAV_CONTRACT === '1' ? describe : describe.skip;

describeContract('CalDAV discovery contract', () => {
  beforeAll(() => {
    fetchMock.disableMocks();
  });

  afterAll(() => {
    fetchMock.enableMocks();
    fetchMock.dontMock();
  });

  const baseUrl = process.env.CALDAV_BASE_URL ?? 'http://localhost:5232/';
  const username = process.env.CALDAV_USERNAME ?? 'calendar';
  const password = process.env.CALDAV_PASSWORD ?? 'calendar-dev-password';

  it(
    'discovers a real VEVENT collection through Matrix-authenticated Radicale',
    async () => {
      const result = await new CalDavDiscoveryClient(
        baseUrl,
        basicCredentialProvider(username, password),
      ).discover();

      expect(result.calendars).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            displayName: 'Contract Calendar',
            components: expect.arrayContaining(['VEVENT']),
          }),
        ]),
      );
    },
  );

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
