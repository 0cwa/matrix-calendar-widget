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

import { Injectable } from '@nestjs/common';
import { IMatrixOpenIdCredential } from '../model/IMatrixOpenIdCredential';
import { IUserContext } from '../model/IUserContext';
import { CalDavCredentialProvider } from './CalDavCredentialProvider';
import { MatrixOpenIdCalDavCredentialProvider } from './MatrixOpenIdCalDavCredentialProvider';

/**
 * Creates request-scoped CalDAV credentials. Production always uses the
 * validated Matrix OpenID delegation provider; the factory boundary also
 * lets contract tests supply the pinned Radicale image's supported test auth.
 */
@Injectable()
export class MatrixOpenIdCalDavCredentialProviderFactory {
  forRequest(
    userContext: IUserContext,
    openIdCredential?: IMatrixOpenIdCredential,
  ): CalDavCredentialProvider {
    return this.forPrincipal(userContext.userId, openIdCredential);
  }

  forPrincipal(
    userId: string,
    openIdCredential?: IMatrixOpenIdCredential,
  ): CalDavCredentialProvider {
    return new MatrixOpenIdCalDavCredentialProvider(userId, openIdCredential);
  }
}
