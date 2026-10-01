#!/usr/bin/env node

// Copyright 2026 Matrix Calendar Widget contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const homeserverUrl =
  process.env.MATRIX_CALENDAR_DEV_HOMESERVER_URL ?? 'http://localhost:8008';
const username = process.env.MATRIX_CALENDAR_DEV_USER ?? 'calendar';
const password =
  process.env.MATRIX_CALENDAR_DEV_PASSWORD ?? 'calendar-dev-password';
const matrixServerName =
  process.env.MATRIX_CALENDAR_DEV_SERVER_NAME ?? 'localhost';

function fail() {
  throw new Error('Unable to mint the local Matrix OpenID test credential.');
}

async function requestJson(path, options) {
  let response;
  try {
    response = await fetch(new URL(path, homeserverUrl), {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    fail();
  }

  if (!response.ok) fail();

  try {
    return await response.json();
  } catch {
    fail();
  }
}

async function main() {
  if (!username || !password || !matrixServerName) fail();

  const login = await requestJson('/_matrix/client/v3/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: username },
      password,
    }),
  });
  if (typeof login.access_token !== 'string' || !login.access_token) fail();

  const userId = `@${username}:${matrixServerName}`;
  const openId = await requestJson(
    `/_matrix/client/v3/user/${encodeURIComponent(userId)}/openid/request_token`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${login.access_token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    },
  );
  if (
    typeof openId.access_token !== 'string' ||
    !openId.access_token ||
    openId.matrix_server_name !== matrixServerName
  ) {
    fail();
  }

  const proof = Buffer.from(
    JSON.stringify({
      access_token: openId.access_token,
      matrix_server_name: openId.matrix_server_name,
    }),
  ).toString('base64url');
  process.stdout.write(`matrix-openid:${proof}\n`);
}

main().catch(() => {
  process.stderr.write(
    'Unable to mint the local Matrix OpenID test credential.\n',
  );
  process.exitCode = 1;
});
