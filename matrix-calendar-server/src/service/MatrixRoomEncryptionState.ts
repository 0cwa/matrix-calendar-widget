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

import { MatrixClient, MatrixError } from 'matrix-bot-sdk';
import { Matrix404Error } from '../error/Matrix404Error';

export type MatrixRoomStateLookupPort = Pick<MatrixClient, 'getRoomStateEvent'>;

/**
 * Only the trusted Matrix 404/M_NOT_FOUND pair proves that a state event is
 * absent. Every other lookup failure leaves the state unknown.
 */
export function isTrustedMatrixMissingStateError(error: unknown): boolean {
  return (
    (error instanceof MatrixError || error instanceof Matrix404Error) &&
    error.statusCode === 404 &&
    error.errcode === 'M_NOT_FOUND'
  );
}

export async function isRoomConfirmedUnencrypted(
  matrixClient: MatrixRoomStateLookupPort,
  roomId: string,
): Promise<boolean> {
  try {
    await matrixClient.getRoomStateEvent(roomId, 'm.room.encryption', '');
    return false;
  } catch (error) {
    return isTrustedMatrixMissingStateError(error);
  }
}
