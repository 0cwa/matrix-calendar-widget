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

export type MatrixApplicationServiceFixtureStage =
  | 'registration'
  | 'application-service-login'
  | 'identity-verification';

export type MatrixApplicationServiceFixtureFailureCategory =
  | 'transport'
  | 'http-status'
  | 'invalid-response';

const ALLOWED_MATRIX_ERROR_CODES = new Set([
  'M_BAD_JSON',
  'M_FORBIDDEN',
  'M_EXCLUSIVE',
  'M_INVALID_PARAM',
  'M_INVALID_PASSWORD',
  'M_INVALID_USERNAME',
  'M_LIMIT_EXCEEDED',
  'M_MISSING_PARAM',
  'M_NOT_FOUND',
  'M_THREEPID_AUTH_FAILED',
  'M_UNAUTHORIZED',
  'M_UNKNOWN',
  'M_UNKNOWN_TOKEN',
  'M_USER_DEACTIVATED',
  'M_USER_IN_USE',
]);

export class MatrixApplicationServiceFixtureError extends Error {
  constructor(
    readonly stage: MatrixApplicationServiceFixtureStage,
    readonly category: MatrixApplicationServiceFixtureFailureCategory,
    readonly status?: number,
    readonly matrixErrcode?: string,
  ) {
    super(
      category === 'http-status' && status
        ? `Matrix contract fixture request failed (${status})`
        : 'Matrix application-service fixture is unavailable',
    );
    this.name = 'MatrixApplicationServiceFixtureError';
  }
}

type MatrixJson = Record<string, unknown>;

type MatrixResponse = {
  response: Response;
  body: MatrixJson | undefined;
};

export async function obtainMatrixApplicationServiceFixtureUserToken(options: {
  fetchImpl: typeof fetch;
  homeserverUrl: string;
  applicationServiceToken: string;
  userId: string;
}): Promise<string> {
  const { fetchImpl, homeserverUrl, applicationServiceToken, userId } = options;
  const registration = await matrixJsonRequest(fetchImpl, homeserverUrl, {
    path: '/_matrix/client/v3/register',
    stage: 'registration',
    method: 'POST',
    token: applicationServiceToken,
    body: {
      type: 'm.login.application_service',
      username: userId.slice(1).split(':')[0],
    },
  });

  let accessToken: string | undefined;
  if (registration.response.ok) {
    accessToken = readAccessToken(registration.body, userId, 'registration');
  } else if (
    registration.response.status === 400 &&
    registration.body?.errcode === 'M_USER_IN_USE'
  ) {
    const login = await matrixJsonRequest(fetchImpl, homeserverUrl, {
      path: '/_matrix/client/v3/login',
      stage: 'application-service-login',
      method: 'POST',
      token: applicationServiceToken,
      body: {
        type: 'm.login.application_service',
        identifier: { type: 'm.id.user', user: userId },
      },
    });
    if (!login.response.ok) {
      throw responseError(login, 'application-service-login');
    }
    accessToken = readAccessToken(
      login.body,
      userId,
      'application-service-login',
    );
  } else {
    throw responseError(registration, 'registration');
  }

  const whoami = await matrixJsonRequest(fetchImpl, homeserverUrl, {
    path: '/_matrix/client/v3/account/whoami',
    stage: 'identity-verification',
    method: 'GET',
    token: accessToken,
  });
  if (!whoami.response.ok) {
    throw responseError(whoami, 'identity-verification');
  }
  if (whoami.body?.user_id !== userId) {
    throw new MatrixApplicationServiceFixtureError(
      'identity-verification',
      'invalid-response',
    );
  }

  return accessToken;
}

async function matrixJsonRequest(
  fetchImpl: typeof fetch,
  homeserverUrl: string,
  request: {
    path: string;
    stage: MatrixApplicationServiceFixtureStage;
    method: string;
    token: string;
    body?: unknown;
  },
): Promise<MatrixResponse> {
  let response: Response;
  try {
    response = await fetchImpl(new URL(request.path, homeserverUrl), {
      method: request.method,
      headers: {
        Authorization: `Bearer ${request.token}`,
        ...(request.body === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
      },
      ...(request.body === undefined
        ? {}
        : { body: JSON.stringify(request.body) }),
    });
  } catch {
    throw new MatrixApplicationServiceFixtureError(request.stage, 'transport');
  }

  let body: MatrixJson | undefined;
  try {
    const parsed: unknown = await response.clone().json();
    if (isPlainRecord(parsed)) body = parsed;
  } catch {
    body = undefined;
  }
  return { response, body };
}

function readAccessToken(
  body: MatrixJson | undefined,
  userId: string,
  stage: MatrixApplicationServiceFixtureStage,
): string {
  if (
    body?.user_id !== userId ||
    typeof body.access_token !== 'string' ||
    body.access_token.length === 0
  ) {
    throw new MatrixApplicationServiceFixtureError(stage, 'invalid-response');
  }
  return body.access_token;
}

function responseError(
  result: MatrixResponse,
  stage: MatrixApplicationServiceFixtureStage,
): MatrixApplicationServiceFixtureError {
  const rawErrcode = result.body?.errcode;
  const matrixErrcode =
    typeof rawErrcode === 'string' && ALLOWED_MATRIX_ERROR_CODES.has(rawErrcode)
      ? rawErrcode
      : undefined;
  return new MatrixApplicationServiceFixtureError(
    stage,
    'http-status',
    result.response.status,
    matrixErrcode,
  );
}

function isPlainRecord(value: unknown): value is MatrixJson {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
