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
import type { RoomCalendarPrincipalIdentityProvider } from './RoomCalendarPrincipalIdentity';
import {
  MatrixRoomCalendarPrincipalOpenIdProofProvider,
  RoomCalendarPrincipalOpenIdProofUnavailableError,
} from './RoomCalendarPrincipalOpenIdProofProvider';

const PRINCIPAL_ID = '@calendar:matrix.org';
const OPENID_TOKEN = 'short-lived-openid-token';

function makeProvider(options?: {
  mode?: 'appservice' | 'bot-account';
  configuredMode?: 'appservice' | 'bot-account';
  principalId?: string;
  response?: Response;
  fetchFailure?: Error;
}) {
  const mode = options?.mode ?? 'appservice';
  const config = {
    room_calendar_principal_mode: options?.configuredMode ?? mode,
    application_service_user_id: PRINCIPAL_ID,
    application_service_token: 'appservice-secret',
    access_token: 'bot-secret',
    homeserver_url: 'https://matrix.example/',
  } as Pick<
    IAppConfiguration,
    | 'room_calendar_principal_mode'
    | 'application_service_user_id'
    | 'application_service_token'
    | 'access_token'
    | 'homeserver_url'
  >;
  const identityProvider: RoomCalendarPrincipalIdentityProvider = {
    resolve: jest.fn().mockResolvedValue({
      mode,
      userId: options?.principalId ?? PRINCIPAL_ID,
    }),
  };
  const fetchMock = jest.fn();
  if (options?.fetchFailure) {
    fetchMock.mockRejectedValue(options.fetchFailure);
  } else {
    fetchMock.mockResolvedValue(
      options?.response ??
        new Response(
          JSON.stringify({
            access_token: OPENID_TOKEN,
            matrix_server_name: 'matrix.org',
          }),
          { status: 200 },
        ),
    );
  }
  const provider = new MatrixRoomCalendarPrincipalOpenIdProofProvider(
    config,
    identityProvider,
    fetchMock as unknown as typeof fetch,
  );
  return { provider, identityProvider, fetchMock };
}

describe('MatrixRoomCalendarPrincipalOpenIdProofProvider', () => {
  test('requests a user-scoped appservice proof and returns only the selected identity and tagged credential', async () => {
    const { provider, fetchMock } = makeProvider();

    await expect(provider.request()).resolves.toEqual({
      identity: { mode: 'appservice', userId: PRINCIPAL_ID },
      userId: PRINCIPAL_ID,
      credential: {
        accessToken: OPENID_TOKEN,
        matrixServerName: 'matrix.org',
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `https://matrix.example/_matrix/client/v3/user/${encodeURIComponent(PRINCIPAL_ID)}/openid/request_token`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ user_id: PRINCIPAL_ID }),
        headers: expect.objectContaining({
          Authorization: 'Bearer appservice-secret',
        }),
        redirect: 'error',
      }),
    );
  });

  test('bot-account mode uses the bot identity and does not request an appservice user', async () => {
    const { provider, fetchMock } = makeProvider({ mode: 'bot-account' });

    await provider.request();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: '{}' }),
    );
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer bot-secret' }),
    );
  });

  test('identity mode or configured appservice user mismatch fails before OpenID request', async () => {
    const modeMismatch = makeProvider({
      mode: 'bot-account',
      configuredMode: 'appservice',
      principalId: PRINCIPAL_ID,
    });

    await expect(modeMismatch.provider.request()).rejects.toBeInstanceOf(
      RoomCalendarPrincipalOpenIdProofUnavailableError,
    );
    expect(modeMismatch.fetchMock).not.toHaveBeenCalled();

    const wrongPrincipal = makeProvider({ principalId: '@other:matrix.org' });
    await expect(wrongPrincipal.provider.request()).rejects.toBeInstanceOf(
      RoomCalendarPrincipalOpenIdProofUnavailableError,
    );
    expect(wrongPrincipal.fetchMock).not.toHaveBeenCalled();
  });

  test('invalid or oversized OpenID responses return a fixed safe error without exposing credentials', async () => {
    const wrongServer = makeProvider({
      response: new Response(
        JSON.stringify({
          access_token: 'secret-that-must-not-escape',
          matrix_server_name: 'attacker.example',
        }),
        { status: 200 },
      ),
    });
    await expect(wrongServer.provider.request()).rejects.toMatchObject({
      message: 'Room calendar authorization is unavailable',
    });
    expect(wrongServer.fetchMock).toHaveBeenCalledTimes(1);

    const oversized = makeProvider({
      response: new Response('x'.repeat(16 * 1024 + 1), { status: 200 }),
    });
    await expect(oversized.provider.request()).rejects.toMatchObject({
      message: 'Room calendar authorization is unavailable',
    });
  });

  test('transport failures are reduced to a fixed error and never surfaced', async () => {
    const { provider } = makeProvider({
      fetchFailure: new Error('Bearer secret-that-must-not-escape'),
    });

    await expect(provider.request()).rejects.toMatchObject({
      message: 'Room calendar authorization is unavailable',
    });
  });
});
