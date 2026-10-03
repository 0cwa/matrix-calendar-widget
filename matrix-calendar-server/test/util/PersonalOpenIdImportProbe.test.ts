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

import { appendFileSync } from 'node:fs';

const runtimeImports: Array<[string, () => unknown]> = [
  ['01', () => jest.requireActual('@nestjs/common')],
  ['02', () => jest.requireActual('@nestjs/core')],
  ['03', () => jest.requireActual('jest-fetch-mock')],
  ['04', () => jest.requireActual('matrix-bot-sdk')],
  ['05', () => jest.requireActual('node:child_process')],
  ['06', () => jest.requireActual('node:fs')],
  ['07', () => jest.requireActual('node:http')],
  ['08', () => jest.requireActual('node:path')],
  ['09', () => jest.requireActual('../../src/ModuleProviderToken')],
  [
    '10',
    () =>
      jest.requireActual(
        '../../src/caldav/MatrixOpenIdCalDavCredentialProviderFactory',
      ),
  ],
  [
    '11',
    () => jest.requireActual('../../src/controller/CalendarGatewayController'),
  ],
  ['12', () => jest.requireActual('../../src/guard/MatrixAuthGuard')],
  ['13', () => jest.requireActual('../../src/guard/MatrixRoomMembershipGuard')],
  ['14', () => jest.requireActual('../../src/middleware/MatrixAuthMiddleware')],
  [
    '15',
    () => jest.requireActual('../../src/service/MatrixCalendarAuthorization'),
  ],
  [
    '16',
    () => jest.requireActual('../../src/service/RoomCalendarCalDavAccess'),
  ],
];

test('diagnose Personal OpenID runtime imports without fixture setup', () => {
  const stageFile = process.env.CALDAV_IMPORT_PROBE_FILE;
  if (!stageFile) {
    return;
  }

  let failed = false;
  for (const [id, load] of runtimeImports) {
    try {
      load();
      appendFileSync(stageFile, `personal-openid-import-${id} passed\n`);
    } catch {
      appendFileSync(stageFile, `personal-openid-import-${id} failed\n`);
      failed = true;
      break;
    }
  }

  expect(failed).toBe(false);
});
