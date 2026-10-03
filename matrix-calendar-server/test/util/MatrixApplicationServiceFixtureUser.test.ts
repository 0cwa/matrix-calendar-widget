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
  MatrixApplicationServiceFixtureError,
  obtainMatrixApplicationServiceFixtureUserToken,
} from './MatrixApplicationServiceFixtureUser';

const homeserverUrl = 'http://localhost:8008';
const applicationServiceToken = 'fixture-application-service-token';
const userId = '@_matrix_calendar_service:localhost';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function queuedFetch(responses: Response[]): {
  fetchImpl: typeof fetch;
  requests: Array<{ url: URL; init?: RequestInit }>;
} {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input));
    requests.push({ url, init });
    const response = responses.shift();
    if (!response) throw new Error('No fixture response queued');
    return response;
  };
  return { fetchImpl, requests };
}

function requestBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe('Matrix application-service fixture user', () => {
  it('verifies the user returned by a new registration before returning its token', async () => {
    const { fetchImpl, requests } = queuedFetch([
      jsonResponse({ user_id: userId, access_token: 'scoped-access-token' }),
      jsonResponse({ user_id: userId }),
    ]);

    await expect(
      obtainMatrixApplicationServiceFixtureUserToken({
        fetchImpl,
        homeserverUrl,
        applicationServiceToken,
        userId,
      }),
    ).resolves.toBe('scoped-access-token');

    expect(requests.map(({ url }) => url.pathname)).toEqual([
      '/_matrix/client/v3/register',
      '/_matrix/client/v3/account/whoami',
    ]);
    expect(requests[0].init?.headers).toMatchObject({
      Authorization: `Bearer ${applicationServiceToken}`,
    });
    expect(requestBody(requests[0].init)).toEqual({
      type: 'm.login.application_service',
      username: '_matrix_calendar_service',
    });
    expect(requests[1].init?.headers).toMatchObject({
      Authorization: 'Bearer scoped-access-token',
    });
  });

  it('logs in only the exact registered service user after exact M_USER_IN_USE', async () => {
    const { fetchImpl, requests } = queuedFetch([
      jsonResponse({ errcode: 'M_USER_IN_USE' }, 400),
      jsonResponse({ user_id: userId, access_token: 'scoped-access-token' }),
      jsonResponse({ user_id: userId }),
    ]);

    await expect(
      obtainMatrixApplicationServiceFixtureUserToken({
        fetchImpl,
        homeserverUrl,
        applicationServiceToken,
        userId,
      }),
    ).resolves.toBe('scoped-access-token');

    expect(requests.map(({ url }) => url.pathname)).toEqual([
      '/_matrix/client/v3/register',
      '/_matrix/client/v3/login',
      '/_matrix/client/v3/account/whoami',
    ]);
    expect(requestBody(requests[1].init)).toEqual({
      type: 'm.login.application_service',
      identifier: { type: 'm.id.user', user: userId },
    });
    expect(JSON.stringify(requestBody(requests[1].init))).not.toMatch(
      /password|other-user/,
    );
    expect(requests[1].init?.headers).toMatchObject({
      Authorization: `Bearer ${applicationServiceToken}`,
    });
    expect(requests[2].init?.headers).toMatchObject({
      Authorization: 'Bearer scoped-access-token',
    });
  });

  it('fails closed on every other registration error without attempting login', async () => {
    const { fetchImpl, requests } = queuedFetch([
      jsonResponse({ errcode: 'M_FORBIDDEN', error: 'private detail' }, 400),
    ]);

    await expect(
      obtainMatrixApplicationServiceFixtureUserToken({
        fetchImpl,
        homeserverUrl,
        applicationServiceToken,
        userId,
      }),
    ).rejects.toMatchObject<Partial<MatrixApplicationServiceFixtureError>>({
      stage: 'registration',
      category: 'http-status',
      status: 400,
      matrixErrcode: 'M_FORBIDDEN',
    });
    expect(requests).toHaveLength(1);
  });

  it('does not treat M_USER_IN_USE outside HTTP 400 as an idempotent registration', async () => {
    const { fetchImpl, requests } = queuedFetch([
      jsonResponse({ errcode: 'M_USER_IN_USE' }, 409),
    ]);

    await expect(
      obtainMatrixApplicationServiceFixtureUserToken({
        fetchImpl,
        homeserverUrl,
        applicationServiceToken,
        userId,
      }),
    ).rejects.toMatchObject({
      stage: 'registration',
      category: 'http-status',
      status: 409,
      matrixErrcode: 'M_USER_IN_USE',
    });
    expect(requests).toHaveLength(1);
  });

  it('rejects an existing-user login token that does not identify the exact service user', async () => {
    const { fetchImpl, requests } = queuedFetch([
      jsonResponse({ errcode: 'M_USER_IN_USE' }, 400),
      jsonResponse({
        user_id: '@different:localhost',
        access_token: 'wrong-user-access-token',
      }),
    ]);

    await expect(
      obtainMatrixApplicationServiceFixtureUserToken({
        fetchImpl,
        homeserverUrl,
        applicationServiceToken,
        userId,
      }),
    ).rejects.toMatchObject({
      stage: 'application-service-login',
      category: 'invalid-response',
    });
    expect(requests).toHaveLength(2);
    expect(requests.map(({ url }) => url.pathname)).not.toContain(
      '/_matrix/client/v3/account/whoami',
    );
  });

  it('rejects a scoped token unless whoami confirms the configured service user', async () => {
    const { fetchImpl } = queuedFetch([
      jsonResponse({ user_id: userId, access_token: 'scoped-access-token' }),
      jsonResponse({ user_id: '@different:localhost' }),
    ]);

    await expect(
      obtainMatrixApplicationServiceFixtureUserToken({
        fetchImpl,
        homeserverUrl,
        applicationServiceToken,
        userId,
      }),
    ).rejects.toMatchObject({
      stage: 'identity-verification',
      category: 'invalid-response',
    });
  });
});
