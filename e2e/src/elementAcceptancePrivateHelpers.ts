/* Modified for Matrix Calendar Widget fork, 2026. */
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
  type Locator,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { ClientRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isAbsolute, join, resolve, sep } from 'node:path';
import {
  PRIVATE_UI_CALENDAR_LIST_ENDPOINTS,
  PRIVATE_UI_CALENDAR_LIST_METHODS,
  classifyPrivateUiCalendarListNetworkFailure,
  type PrivateUiCalendarListEndpoint,
  type PrivateUiCalendarListFailureCategory,
  type PrivateUiCalendarListMethod,
  type PrivateUiCalendarListTransportObservation,
} from '../../dev/element-acceptance-private-ui-checkpoints.mjs';
import {
  type PrivateCalendarListRequestObserver,
  type PrivateDavRequestResult,
} from './elementAcceptanceSupportTypes';
import type { Fixture } from './elementAcceptanceTypes';
export function createPrivateAcceptanceHelpers(
  getFixture: () => Fixture,
  PRIVATE_ACCEPTANCE_GATEWAY_ORIGIN: string,
) {
  function createPrivateCalendarListRequestObserver(
    page: Page,
    expectedRoomId: string,
  ): PrivateCalendarListRequestObserver {
    const observations = new Map<
      string,
      PrivateUiCalendarListTransportObservation
    >();
    let snapshotRecorded = false;

    // These are the read routes in GatewayCalendarRepository's initial list.
    // Request origin and room ID are only matched and never retained.
    const identifyRequest = (
      request: Request,
    ):
      | {
          endpoint: PrivateUiCalendarListEndpoint;
          method: PrivateUiCalendarListMethod;
          key: string;
        }
      | undefined => {
      try {
        const url = new URL(request.url());
        const method = request.method();
        if (
          url.origin !== PRIVATE_ACCEPTANCE_GATEWAY_ORIGIN ||
          url.searchParams.get('roomId') !== expectedRoomId ||
          (method !== 'GET' && method !== 'OPTIONS')
        ) {
          return undefined;
        }

        let endpoint: PrivateUiCalendarListEndpoint | undefined;
        if (url.pathname === '/v1/calendar/context') {
          endpoint = 'room-context';
        } else if (url.pathname === '/v1/calendar/calendars') {
          const target = url.searchParams.get('target');
          if (target === 'personal') endpoint = 'personal-list';
          if (target === 'room') endpoint = 'room-list';
        }
        if (
          !endpoint ||
          !PRIVATE_UI_CALENDAR_LIST_ENDPOINTS.includes(endpoint)
        ) {
          return undefined;
        }
        return { endpoint, method, key: `${endpoint}:${method}` };
      } catch {
        return undefined;
      }
    };

    const onRequest = (request: Request) => {
      const match = identifyRequest(request);
      if (!match) return;
      observations.set(match.key, {
        endpoint: match.endpoint,
        method: match.method,
        outcome: 'pending',
      });
    };

    const onResponse = (response: Response) => {
      const match = identifyRequest(response.request());
      const previous = match ? observations.get(match.key) : undefined;
      if (!match || !previous) return;
      observations.set(match.key, {
        endpoint: previous.endpoint,
        method: previous.method,
        outcome: 'response',
        httpStatus: response.status(),
      });
    };

    const onRequestFailed = (request: Request) => {
      const match = identifyRequest(request);
      const previous = match ? observations.get(match.key) : undefined;
      if (!match || !previous) return;
      observations.set(match.key, {
        endpoint: previous.endpoint,
        method: previous.method,
        outcome: 'network-failure',
        networkFailure: privateCalendarListNetworkFailure(request),
      });
    };

    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('requestfailed', onRequestFailed);

    const dispose = () => {
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
    };
    const snapshot = () =>
      [...observations.values()].sort((left, right) => {
        const endpointOrder =
          PRIVATE_UI_CALENDAR_LIST_ENDPOINTS.indexOf(left.endpoint) -
          PRIVATE_UI_CALENDAR_LIST_ENDPOINTS.indexOf(right.endpoint);
        return (
          endpointOrder ||
          PRIVATE_UI_CALENDAR_LIST_METHODS.indexOf(left.method) -
            PRIVATE_UI_CALENDAR_LIST_METHODS.indexOf(right.method)
        );
      });

    return {
      recordSnapshot: (record) => {
        if (snapshotRecorded) return;
        snapshotRecorded = true;
        try {
          record(snapshot());
        } catch {
          // Bounded request diagnostics never mask an acceptance failure.
        }
        dispose();
      },
      dispose,
    };
  }

  function privateCalendarListNetworkFailure(
    request: Request,
  ): PrivateUiCalendarListFailureCategory {
    return classifyPrivateUiCalendarListNetworkFailure(
      request.failure()?.errorText,
    );
  }

  function waitForPrivateClientResponse(
    page: Page,
    method: 'GET' | 'POST' | 'DELETE',
  ): Promise<Response> {
    return page.waitForResponse(
      (response) => {
        try {
          const url = new URL(response.url());
          return (
            url.origin === new URL(getFixture().gatewayUrl).origin &&
            (method === 'DELETE'
              ? /^\/v1\/calendar\/private-clients\/mcwpc~[a-f0-9]{48}$/u.test(
                  url.pathname,
                )
              : url.pathname === '/v1/calendar/private-clients') &&
            response.request().method() === method
          );
        } catch {
          return false;
        }
      },
      { timeout: 30_000 },
    );
  }

  async function requestPrivateClientListStatus(
    page: Page,
    gatewayUrl: string,
    roomId: string,
    calendarId: string,
  ): Promise<number> {
    return page.evaluate(
      async ({ gatewayUrl, roomId, calendarId }) => {
        type OpenIdCredentials = {
          access_token?: unknown;
          matrix_server_name?: unknown;
        };
        type MatrixClient = {
          getOpenIdToken?: () => Promise<OpenIdCredentials>;
        };
        type MatrixClientWindow = Window & {
          mxMatrixClientPeg?: { get?: () => MatrixClient };
        };

        try {
          const matrixClient = (
            window as MatrixClientWindow
          ).mxMatrixClientPeg?.get?.();
          if (!matrixClient?.getOpenIdToken) return 0;
          const credentials = await matrixClient.getOpenIdToken();
          if (
            typeof credentials.access_token !== 'string' ||
            typeof credentials.matrix_server_name !== 'string'
          ) {
            return 0;
          }
          const query = new URLSearchParams({
            target: 'room',
            roomId,
            calendarId,
          });
          const response = await fetch(
            `${gatewayUrl}/v1/calendar/private-clients?${query.toString()}`,
            {
              headers: {
                Authorization: `MX-Identity ${btoa(
                  JSON.stringify({
                    matrix_server_name: credentials.matrix_server_name,
                    access_token: credentials.access_token,
                  }),
                )}`,
              },
            },
          );
          await response.body?.cancel();
          return response.status;
        } catch {
          return 0;
        }
      },
      { gatewayUrl, roomId, calendarId },
    );
  }

  function requestPrivateDav({
    url,
    username,
    password,
    caCertificate,
    method,
    headers = {},
    body = '',
    expectedText,
  }: {
    url: URL;
    username: string;
    password: string;
    caCertificate: Buffer;
    method: string;
    headers?: Record<string, string>;
    body?: string;
    expectedText?: string;
  }): Promise<PrivateDavRequestResult> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        reject(new Error('Private CalDAV acceptance request failed'));
      };
      const authorization = `Basic ${Buffer.from(
        `${username}:${password}`,
        'utf8',
      ).toString('base64')}`;
      let request: ClientRequest;
      try {
        request = httpsRequest(
          url,
          {
            method,
            headers: {
              accept: '*/*',
              authorization,
              connection: 'close',
              ...headers,
            },
            ca: caCertificate,
            agent: false,
            timeout: 15_000,
          },
          (response) => {
            const chunks: Buffer[] = [];
            let bodyBytes = 0;
            response.on('data', (chunk: Buffer) => {
              bodyBytes += chunk.byteLength;
              if (bodyBytes > 1_000_000) {
                request.destroy();
                fail();
                return;
              }
              chunks.push(Buffer.from(chunk));
            });
            response.once('error', fail);
            response.once('end', () => {
              if (settled) return;
              const responseBody = Buffer.concat(chunks);
              const etag = response.headers.etag;
              settled = true;
              resolve({
                status: response.statusCode ?? 0,
                bodyBytes,
                ...(typeof etag === 'string' ? { etag } : {}),
                ...(expectedText === undefined
                  ? {}
                  : {
                      expectedTextPresent: responseBody.includes(
                        Buffer.from(expectedText, 'utf8'),
                      ),
                    }),
              });
            });
          },
        );
      } catch {
        fail();
        return;
      }
      request.once('error', fail);
      request.once('timeout', () => request.destroy());
      request.end(body);
    });
  }

  async function privateSetupDetailsAbsent(dialog: Locator): Promise<boolean> {
    const counts = await Promise.all(
      ['CalDAV URL', 'Username', 'App password'].map((name) =>
        dialog.getByRole('textbox', { name, exact: true }).count(),
      ),
    );
    return counts.every((count) => count === 0);
  }

  function privateTlsDirectoryMatchesRunnerTemp(): boolean {
    const runnerTemp = process.env.RUNNER_TEMP;
    const tlsDirectory = process.env.ELEMENT_ACCEPTANCE_PRIVATE_TLS_DIR;
    return (
      typeof runnerTemp === 'string' &&
      typeof tlsDirectory === 'string' &&
      isAbsolute(runnerTemp) &&
      isAbsolute(tlsDirectory) &&
      resolve(tlsDirectory).startsWith(`${resolve(runnerTemp)}${sep}`)
    );
  }

  function readPrivateAcceptanceCaCertificate(): Buffer {
    const tlsDirectory = process.env.ELEMENT_ACCEPTANCE_PRIVATE_TLS_DIR;
    if (typeof tlsDirectory !== 'string' || !isAbsolute(tlsDirectory)) {
      throw new Error('Private acceptance CA certificate is unavailable');
    }
    try {
      return readFileSync(join(tlsDirectory, 'ca.pem'));
    } catch {
      throw new Error('Private acceptance CA certificate is unavailable');
    }
  }

  async function selectPrivateAcceptanceCalendar(
    page: Page,
    calendarPicker: Locator,
    targetCalendarOption: Locator,
  ): Promise<boolean> {
    const alreadySelected =
      (await targetCalendarOption.getAttribute('aria-selected')) === 'true';
    if (alreadySelected) {
      await calendarPicker.press('Escape');
      return true;
    }

    const selectedListResponse = waitForPrivateClientResponse(page, 'GET');
    await targetCalendarOption.click();
    return (await selectedListResponse).status() === 200;
  }

  function privateCredentialsMatchGateway(
    username: string,
    password: string,
    credentialUrl: URL,
  ): boolean {
    return [
      /^mcwpc~[a-f0-9]{48}$/u.test(username),
      /^[A-Za-z0-9_-]{43}$/u.test(password),
      credentialUrl.origin === PRIVATE_ACCEPTANCE_GATEWAY_ORIGIN,
      credentialUrl.pathname === `/${username}/calendar/`,
      credentialUrl.username === '',
      credentialUrl.password === '',
      credentialUrl.search === '',
      credentialUrl.hash === '',
    ].every(Boolean);
  }

  function parsePrivateCredentialUrl(credentialUrlText: string): URL {
    try {
      return new URL(credentialUrlText);
    } catch {
      throw new Error('Private app credentials were not rendered');
    }
  }

  function privateDavLifecycleSucceeded(
    principalDiscovery: PrivateDavRequestResult,
    collectionDiscovery: PrivateDavRequestResult,
    createdResource: PrivateDavRequestResult,
    readCreatedResource: PrivateDavRequestResult,
    updatedResource: PrivateDavRequestResult,
    readUpdatedResource: PrivateDavRequestResult,
    deletedResource: PrivateDavRequestResult,
  ): boolean {
    return (
      principalDiscovery.status === 207 &&
      collectionDiscovery.status === 207 &&
      privateDavWriteSucceeded(createdResource) &&
      readCreatedResource.status === 200 &&
      readCreatedResource.expectedTextPresent === true &&
      isStrongPrivateDavEtag(readCreatedResource.etag) &&
      privateDavWriteSucceeded(updatedResource) &&
      readUpdatedResource.status === 200 &&
      readUpdatedResource.expectedTextPresent === true &&
      isStrongPrivateDavEtag(readUpdatedResource.etag) &&
      privateDavWriteSucceeded(deletedResource)
    );
  }

  function privateDavWriteSucceeded(result: PrivateDavRequestResult): boolean {
    return result.status >= 200 && result.status < 300;
  }

  function isStrongPrivateDavEtag(etag: string | undefined): etag is string {
    return typeof etag === 'string' && /^"[\x21\x23-\x7e]{1,200}"$/u.test(etag);
  }

  function privateDavEtagOrEmpty(etag: string | undefined): string {
    return isStrongPrivateDavEtag(etag) ? etag : '';
  }

  function privateDavReadSucceeded(result: PrivateDavRequestResult): boolean {
    return result.status === 200 && result.expectedTextPresent === true;
  }

  function privateDavReadEtagOrEmpty(result: PrivateDavRequestResult): string {
    return privateDavReadSucceeded(result)
      ? privateDavEtagOrEmpty(result.etag)
      : '';
  }

  async function bestEffortDeleteOwnedPrivateDavResource(
    requestBase: {
      username: string;
      password: string;
      caCertificate: Buffer;
    },
    url: URL,
    expectedUid: string,
  ): Promise<void> {
    try {
      const existingResource = await requestPrivateDav({
        ...requestBase,
        url,
        method: 'GET',
        expectedText: `UID:${expectedUid}`,
      });
      if (existingResource.status === 404) return;
      if (
        existingResource.status !== 200 ||
        existingResource.expectedTextPresent !== true ||
        !isStrongPrivateDavEtag(existingResource.etag)
      ) {
        return;
      }

      await requestPrivateDav({
        ...requestBase,
        url,
        method: 'DELETE',
        headers: { 'if-match': existingResource.etag },
      });
    } catch {
      // Best-effort cleanup must not replace the primary acceptance result.
    }
  }

  function revokedPrivateDavCredentialDenied(
    result: PrivateDavRequestResult,
  ): boolean {
    return result.status === 401 && result.bodyBytes === 0;
  }
  return {
    createPrivateCalendarListRequestObserver,
    waitForPrivateClientResponse,
    requestPrivateClientListStatus,
    requestPrivateDav,
    privateSetupDetailsAbsent,
    privateTlsDirectoryMatchesRunnerTemp,
    readPrivateAcceptanceCaCertificate,
    selectPrivateAcceptanceCalendar,
    privateCredentialsMatchGateway,
    parsePrivateCredentialUrl,
    privateDavLifecycleSucceeded,
    privateDavWriteSucceeded,
    isStrongPrivateDavEtag,
    privateDavReadSucceeded,
    privateDavReadEtagOrEmpty,
    bestEffortDeleteOwnedPrivateDavResource,
    revokedPrivateDavCredentialDenied,
  };
}
