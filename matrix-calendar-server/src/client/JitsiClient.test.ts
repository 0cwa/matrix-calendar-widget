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

import type { IAppConfiguration } from '../IAppConfiguration';
import { JitsiClient } from './JitsiClient';

describe('JitsiClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns no dial-in number when the configured list is empty', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);

    const client = new JitsiClient({
      jitsi_dial_in_json_url: 'https://example.test/dial-in.json',
    } as IAppConfiguration);

    await expect(
      client.getSharingInformationAsync('!room:example.test'),
    ).resolves.toEqual({
      jitsi_dial_in_number: undefined,
      jitsi_pin: undefined,
    });
  });
});
