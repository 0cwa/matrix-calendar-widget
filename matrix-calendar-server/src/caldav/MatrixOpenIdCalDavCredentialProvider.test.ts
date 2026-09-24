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
import { IMatrixOpenIdCredential } from '../model/IMatrixOpenIdCredential';
import { IUserContext } from '../model/IUserContext';
import {
  MatrixOpenIdCalDavCredentialError,
  MatrixOpenIdCalDavCredentialProvider,
} from './MatrixOpenIdCalDavCredentialProvider';

const userContext: IUserContext = {
  userId: '@alice:example.test',
  locale: 'en',
  timezone: 'Europe/Stockholm',
};

const credential: IMatrixOpenIdCredential = {
  accessToken: 'openid-token',
  matrixServerName: 'example.test',
};

describe('MatrixOpenIdCalDavCredentialProvider', () => {
  it('encodes the Matrix localpart and exact ADR009 delegated payload', async () => {
    const provider = new MatrixOpenIdCalDavCredentialProvider(
      userContext,
      credential,
    );

    const delegatedPayload = base64url(
      JSON.stringify({
        access_token: 'openid-token',
        matrix_server_name: 'example.test',
      }),
    );
    const expectedBasicValue = Buffer.from(
      `alice:matrix-openid:${delegatedPayload}`,
      'utf8',
    ).toString('base64');

    await expect(provider.getRequestHeaders()).resolves.toEqual({
      Authorization: `Basic ${expectedBasicValue}`,
    });

    const decodedBasic = Buffer.from(expectedBasicValue, 'base64').toString(
      'utf8',
    );
    const encodedPayload = decodedBasic.substring(
      'alice:matrix-openid:'.length,
    );

    expect(JSON.parse(base64url.decode(encodedPayload))).toEqual({
      access_token: 'openid-token',
      matrix_server_name: 'example.test',
    });
  });

  it('fails closed when request-scoped OpenID delegation is absent', async () => {
    const provider = new MatrixOpenIdCalDavCredentialProvider(userContext);

    await expect(provider.getRequestHeaders()).rejects.toEqual(
      new MatrixOpenIdCalDavCredentialError(
        'missing-openid-credential',
        'Matrix OpenID delegation credential is required for CalDAV access',
      ),
    );
  });
});
