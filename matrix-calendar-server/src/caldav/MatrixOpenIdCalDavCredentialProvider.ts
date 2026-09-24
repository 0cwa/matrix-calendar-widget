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

import base64url from 'base64url';
import { UserID } from 'matrix-bot-sdk';
import { IMatrixOpenIdCredential } from '../model/IMatrixOpenIdCredential';
import { IUserContext } from '../model/IUserContext';
import { CalDavCredentialProvider } from './CalDavCredentialProvider';

export type MatrixOpenIdCalDavCredentialErrorCode = 'missing-openid-credential';

export class MatrixOpenIdCalDavCredentialError extends Error {
  constructor(
    public readonly code: MatrixOpenIdCalDavCredentialErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MatrixOpenIdCalDavCredentialError';
  }
}

export class MatrixOpenIdCalDavCredentialProvider implements CalDavCredentialProvider {
  constructor(
    private readonly userContext: IUserContext,
    private readonly openIdCredential?: IMatrixOpenIdCredential,
  ) {}

  async getRequestHeaders(): Promise<Readonly<Record<string, string>>> {
    if (!this.openIdCredential) {
      throw new MatrixOpenIdCalDavCredentialError(
        'missing-openid-credential',
        'Matrix OpenID delegation credential is required for CalDAV access',
      );
    }

    const username = new UserID(this.userContext.userId).localpart;
    const delegatedCredential = `matrix-openid:${base64url(
      JSON.stringify({
        access_token: this.openIdCredential.accessToken,
        matrix_server_name: this.openIdCredential.matrixServerName,
      }),
    )}`;
    const authorization = Buffer.from(
      `${username}:${delegatedCredential}`,
      'utf8',
    ).toString('base64');

    return {
      Authorization: `Basic ${authorization}`,
    };
  }
}
