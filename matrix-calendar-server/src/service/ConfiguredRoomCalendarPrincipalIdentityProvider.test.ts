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

import type { MatrixClient } from 'matrix-bot-sdk';
import type { AppRuntimeContext } from '../AppRuntimeContext';
import type { IAppConfiguration } from '../IAppConfiguration';
import {
  ConfiguredRoomCalendarPrincipalIdentityProvider,
  RoomCalendarPrincipalIdentityUnavailableError,
} from './ConfiguredRoomCalendarPrincipalIdentityProvider';
import { RoomCalendarPrincipalMode } from './RoomCalendarPrincipalIdentity';

const sdkUserId = '@calendar_bot:example.test';
const appServiceUserId = '@_matrix_calendar_service:example.test';

function createProvider(
  mode: RoomCalendarPrincipalMode,
  getUserId: jest.Mock<Promise<string>, []>,
  botUserId = sdkUserId,
) {
  return new ConfiguredRoomCalendarPrincipalIdentityProvider(
    {
      room_calendar_principal_mode: mode,
      application_service_user_id: appServiceUserId,
    } as Pick<
      IAppConfiguration,
      'room_calendar_principal_mode' | 'application_service_user_id'
    >,
    { getUserId } as unknown as Pick<MatrixClient, 'getUserId'>,
    { botUserId } as Pick<AppRuntimeContext, 'botUserId'>,
  );
}

describe('ConfiguredRoomCalendarPrincipalIdentityProvider', () => {
  it('resolves one frozen bot identity from the injected SDK client', async () => {
    const getUserId = jest
      .fn<Promise<string>, []>()
      .mockResolvedValue(sdkUserId);
    const provider = createProvider('bot-account', getUserId);

    const [first, second] = await Promise.all([
      provider.resolve(),
      provider.resolve(),
    ]);

    expect(first).toEqual({ mode: 'bot-account', userId: sdkUserId });
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(getUserId).toHaveBeenCalledTimes(1);
  });

  it('rejects a runtime identity mismatch without returning a principal', async () => {
    const getUserId = jest
      .fn<Promise<string>, []>()
      .mockResolvedValue(sdkUserId);
    const provider = createProvider(
      'bot-account',
      getUserId,
      '@different_bot:example.test',
    );

    await expect(provider.resolve()).rejects.toBeInstanceOf(
      RoomCalendarPrincipalIdentityUnavailableError,
    );
    expect(getUserId).toHaveBeenCalledTimes(1);
  });

  it('hides SDK identity errors and rejects unavailable identities', async () => {
    const getUserId = jest
      .fn<Promise<string>, []>()
      .mockRejectedValue(new Error('synthetic SDK response detail'));
    const provider = createProvider('bot-account', getUserId);

    await expect(provider.resolve()).rejects.toMatchObject({
      name: 'RoomCalendarPrincipalIdentityUnavailableError',
      message: 'Room calendar principal identity is unavailable',
    });
    expect(getUserId).toHaveBeenCalledTimes(1);
  });

  it('retries an unavailable SDK identity instead of caching the rejection', async () => {
    const getUserId = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('synthetic transient failure'))
      .mockResolvedValueOnce(sdkUserId);
    const provider = createProvider('bot-account', getUserId);

    await expect(provider.resolve()).rejects.toBeInstanceOf(
      RoomCalendarPrincipalIdentityUnavailableError,
    );
    await expect(provider.resolve()).resolves.toMatchObject({
      mode: 'bot-account',
      userId: sdkUserId,
    });
    expect(getUserId).toHaveBeenCalledTimes(2);
  });

  it('does not call the SDK for the configured appservice identity', async () => {
    const getUserId = jest.fn<Promise<string>, []>();
    const provider = createProvider('appservice', getUserId);

    await expect(provider.resolve()).resolves.toEqual({
      mode: 'appservice',
      userId: appServiceUserId,
    });
    expect(getUserId).not.toHaveBeenCalled();
  });

  it('rejects a non-canonical SDK identity', async () => {
    const getUserId = jest
      .fn<Promise<string>, []>()
      .mockResolvedValue('invalid');
    const provider = createProvider('bot-account', getUserId, 'invalid');

    await expect(provider.resolve()).rejects.toBeInstanceOf(
      RoomCalendarPrincipalIdentityUnavailableError,
    );
  });
});
