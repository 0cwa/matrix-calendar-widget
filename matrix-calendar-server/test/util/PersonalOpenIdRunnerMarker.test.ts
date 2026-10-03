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

import { resolve } from 'node:path';
import {
  isPersonalOpenIdTestPath,
  markPersonalOpenIdRunnerReady,
} from './PersonalOpenIdRunnerMarker';

describe('Personal OpenID runner marker', () => {
  const personalTestPath = getPersonalOpenIdTestPath();

  it('matches only the exact Personal OpenID test path', () => {
    expect(isPersonalOpenIdTestPath(undefined)).toBe(false);
    expect(isPersonalOpenIdTestPath(personalTestPath)).toBe(true);
    expect(isPersonalOpenIdTestPath(`${personalTestPath}.other`)).toBe(false);
  });

  it('writes only the fixed marker for the exact path and contract controls', () => {
    const append = jest.fn();

    markPersonalOpenIdRunnerReady(
      getPersonalOpenIdTestPath(),
      '1',
      '/private/stage-file-path',
      append,
    );

    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(
      '/private/stage-file-path',
      'personal-openid-runner-ready\n',
      'utf8',
    );
  });

  it('does not write for another path or when contract controls are absent', () => {
    const append = jest.fn();
    const personalPath = getPersonalOpenIdTestPath();

    markPersonalOpenIdRunnerReady(
      `${personalPath}.other`,
      '1',
      '/private/stage-file-path',
      append,
    );
    markPersonalOpenIdRunnerReady(
      personalPath,
      '0',
      '/private/stage-file-path',
      append,
    );
    markPersonalOpenIdRunnerReady(personalPath, '1', undefined, append);

    expect(append).not.toHaveBeenCalled();
  });
});

function getPersonalOpenIdTestPath(): string {
  return resolve(
    __dirname,
    '../integration/PersonalOpenIdRadicaleContract.test.ts',
  );
}
