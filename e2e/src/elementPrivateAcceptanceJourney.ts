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
  expect,
  test,
  type Browser,
  type BrowserContext,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { createPrivateUiCheckpointJournal } from '../../dev/element-acceptance-private-ui-checkpoints.mjs';
import type {
  PrivateCalendarListRequestObserver,
  PrivateJourneyContext,
} from './elementAcceptanceSupport';

export async function runElementPrivateAcceptanceJourney(
  browser: Browser,
  privateUiJournal:
    | ReturnType<typeof createPrivateUiCheckpointJournal>
    | undefined,
  journey: PrivateJourneyContext,
): Promise<void> {
  const {
    requirePrivateUiCheckpointJournal,
    readFixture,
    PRIVATE_ACCEPTANCE_GATEWAY_ORIGIN,
    privateTlsDirectoryMatchesRunnerTemp,
    readPrivateAcceptanceCaCertificate,
    authenticateInElement,
    openFixtureRoom,
    createPrivateCalendarListRequestObserver,
    openCalendarWidget,
    waitForPrivateClientResponse,
    selectPrivateAcceptanceCalendar,
    parsePrivateCredentialUrl,
    privateCredentialsMatchGateway,
    privateSetupDetailsAbsent,
    requestPrivateDav,
    privateDavWriteSucceeded,
    privateDavReadSucceeded,
    isStrongPrivateDavEtag,
    privateDavReadEtagOrEmpty,
    privateDavLifecycleSucceeded,
    bestEffortDeleteOwnedPrivateDavResource,
    requestPrivateClientListStatus,
    revokedPrivateDavCredentialDenied,
  } = journey;
  test.setTimeout(360_000);
  const checkpoint = requirePrivateUiCheckpointJournal(privateUiJournal);
  const caCertificate = await checkpoint.run('private-ui-fixture-ready', () => {
    journey.fixture = readFixture();
    const privateGatewayOriginMatches =
      new URL(journey.fixture.gatewayUrl).origin ===
      PRIVATE_ACCEPTANCE_GATEWAY_ORIGIN;
    expect(privateGatewayOriginMatches).toBe(true);
    expect(privateTlsDirectoryMatchesRunnerTemp()).toBe(true);
    return readPrivateAcceptanceCaCertificate();
  });

  const allowedOrigins = new Set([
    new URL(journey.fixture.elementUrl).origin,
    new URL(journey.fixture.homeserverUrl).origin,
    new URL(journey.fixture.gatewayUrl).origin,
    new URL(journey.fixture.widgetUrl).origin,
    'http://localhost:8008',
  ]);
  const contexts: BrowserContext[] = [];
  let blockedExternalRequests = 0;
  let calendarListRequestObserver:
    | PrivateCalendarListRequestObserver
    | undefined;
  const makeContext = async () => {
    const context = await browser.newContext({
      locale: 'en-US',
      timezoneId: 'Europe/Stockholm',
      viewport: { width: 1440, height: 900 },
    });
    contexts.push(context);
    await context.route('**/*', async (route) => {
      let origin: string;
      try {
        origin = new URL(route.request().url()).origin;
      } catch {
        blockedExternalRequests += 1;
        await route.abort('blockedbyclient');
        return;
      }
      if (!allowedOrigins.has(origin)) {
        blockedExternalRequests += 1;
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    return context;
  };

  try {
    const { contextA, pageA } = await checkpoint.run(
      'private-ui-member-a-auth',
      async () => {
        const contextA = await makeContext();
        const pageA = await authenticateInElement(
          contextA,
          journey.fixture.users.memberA,
        );
        return { contextA, pageA };
      },
    );
    const teamRoomA = await checkpoint.run('private-ui-member-a-room', () =>
      openFixtureRoom(
        pageA,
        journey.fixture.roomName,
        journey.fixture.teamRoomId,
      ),
    );
    calendarListRequestObserver = createPrivateCalendarListRequestObserver(
      pageA,
      journey.fixture.teamRoomId,
    );
    const frameA = await checkpoint.run(
      'private-ui-member-a-widget-ready',
      () =>
        openCalendarWidget(teamRoomA, pageA, {
          expectWidgetWarning: false,
        }),
    );
    const privateClientButtonA = frameA.getByRole('button', {
      name: 'Calendar app access',
      exact: true,
    });
    await checkpoint.run('private-ui-access-button-visible', () =>
      expect(privateClientButtonA).toBeVisible(),
    );
    await checkpoint.run('private-ui-access-button-enabled', () =>
      expect(privateClientButtonA).toBeEnabled(),
    );
    calendarListRequestObserver.recordSnapshot((observations) =>
      checkpoint.recordCalendarListTransport(observations),
    );
    const initialListResponse = waitForPrivateClientResponse(pageA, 'GET');
    await checkpoint.run('private-ui-access-button-click', () =>
      privateClientButtonA.click(),
    );
    const dialogA = frameA.getByRole('dialog').last();
    await checkpoint.run('private-ui-dialog-visible', () =>
      expect(dialogA).toBeVisible(),
    );
    await checkpoint.run('private-ui-initial-list', async () => {
      const response = await initialListResponse;
      expect(response.status()).toBe(200);
    });

    const calendarPicker = dialogA.getByRole('combobox', {
      name: 'Calendar',
    });
    await checkpoint.run('private-ui-calendar-select', async () => {
      await calendarPicker.click();
      const targetCalendarOption = frameA.getByRole('option', {
        name: 'Synthetic team calendar',
        exact: true,
      });
      await expect(targetCalendarOption).toHaveCount(1);
      expect(
        await selectPrivateAcceptanceCalendar(
          pageA,
          calendarPicker,
          targetCalendarOption,
        ),
      ).toBe(true);
    });

    let publicFeedMutationCount = 0;
    pageA.on('request', (request) => {
      try {
        const url = new URL(request.url());
        if (
          url.origin === PRIVATE_ACCEPTANCE_GATEWAY_ORIGIN &&
          url.pathname === '/v1/calendar-feeds/publication' &&
          ['PUT', 'DELETE'].includes(request.method())
        ) {
          publicFeedMutationCount += 1;
        }
      } catch {
        // Keep only the mutation count; never retain the request URL.
      }
    });

    const { credentialUrlText, credentialUrl, username, password } =
      await checkpoint.run('private-ui-credential-issue-reveal', async () => {
        const createResponse = waitForPrivateClientResponse(pageA, 'POST');
        await dialogA
          .getByRole('button', {
            name: 'Create app access',
            exact: true,
          })
          .click();
        expect((await createResponse).status()).toBe(201);

        const credentialUrlText = await dialogA
          .getByRole('textbox', { name: 'CalDAV URL', exact: true })
          .inputValue();
        const credentialUrl = parsePrivateCredentialUrl(credentialUrlText);
        const username = await dialogA
          .getByRole('textbox', { name: 'Username', exact: true })
          .inputValue();
        const password = await dialogA
          .getByRole('textbox', { name: 'App password', exact: true })
          .inputValue();
        expect(
          privateCredentialsMatchGateway(username, password, credentialUrl),
        ).toBe(true);
        return { credentialUrlText, credentialUrl, username, password };
      });
    await checkpoint.run('private-ui-no-publication', () => {
      expect(publicFeedMutationCount).toBe(0);
    });

    await checkpoint.run('private-ui-credential-hide', async () => {
      await expect(
        dialogA.getByText('Status: Active', { exact: true }),
      ).toBeVisible();
      await dialogA
        .getByRole('button', { name: 'Hide setup details', exact: true })
        .click();
      expect(await privateSetupDetailsAbsent(dialogA)).toBe(true);
    });

    await checkpoint.run('private-ui-storage-check', async () => {
      const browserStorage = JSON.stringify(await contextA.storageState());
      const appCredentialWasPersisted =
        browserStorage.includes(username) ||
        browserStorage.includes(password) ||
        browserStorage.includes(credentialUrlText);
      expect(appCredentialWasPersisted).toBe(false);
    });

    const reopenedDialogA = await checkpoint.run(
      'private-ui-list-reopen',
      async () => {
        await dialogA
          .getByRole('button', { name: 'Close', exact: true })
          .click();
        const listedAfterReopen = waitForPrivateClientResponse(pageA, 'GET');
        await privateClientButtonA.click();
        const dialog = frameA.getByRole('dialog').last();
        expect((await listedAfterReopen).status()).toBe(200);
        expect(await privateSetupDetailsAbsent(dialog)).toBe(true);
        await expect(
          dialog.getByText('Status: Active', { exact: true }),
        ).toBeVisible();
        return dialog;
      },
    );

    const principalUrl = new URL('../', credentialUrl);
    const collectionUrl = new URL(credentialUrl.href);
    const eventResourceId = randomUUID();
    const resourceUrl = new URL(
      `private-ui-${eventResourceId}.ics`,
      collectionUrl,
    );
    const eventUid = `private-ui-${eventResourceId}@acceptance.invalid`;
    const timeValue = (value: Date) =>
      value
        .toISOString()
        .replace(/[-:]/gu, '')
        .replace(/\.\d{3}Z$/u, 'Z');
    const eventStart = new Date(Date.now() + 5 * 60_000);
    const eventEnd = new Date(eventStart.getTime() + 30 * 60_000);
    const originalSummary = 'Private UI acceptance original';
    const updatedSummary = 'Private UI acceptance updated';
    const makeIcs = (summary: string) =>
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Matrix Calendar Widget//Private Acceptance//EN',
        'BEGIN:VEVENT',
        `UID:${eventUid}`,
        `DTSTAMP:${timeValue(new Date())}`,
        `DTSTART:${timeValue(eventStart)}`,
        `DTEND:${timeValue(eventEnd)}`,
        `SUMMARY:${summary}`,
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n');
    const discoveryBody = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
    ].join('');
    const requestBase = {
      username,
      password,
      caCertificate,
    };
    try {
      const principalDiscovery = await checkpoint.run(
        'private-ui-dav-principal-discovery',
        async () => {
          const result = await requestPrivateDav({
            ...requestBase,
            url: principalUrl,
            method: 'PROPFIND',
            headers: { depth: '0', 'content-type': 'application/xml' },
            body: discoveryBody,
          });
          expect(result.status).toBe(207);
          return result;
        },
      );
      const collectionDiscovery = await checkpoint.run(
        'private-ui-dav-collection-discovery',
        async () => {
          const result = await requestPrivateDav({
            ...requestBase,
            url: collectionUrl,
            method: 'PROPFIND',
            headers: { depth: '1', 'content-type': 'application/xml' },
            body: discoveryBody,
          });
          expect(result.status).toBe(207);
          return result;
        },
      );
      const createdResource = await checkpoint.run(
        'private-ui-dav-create',
        async () => {
          const result = await requestPrivateDav({
            ...requestBase,
            url: resourceUrl,
            method: 'PUT',
            headers: {
              'content-type': 'text/calendar; charset=utf-8',
              'if-none-match': '*',
            },
            body: makeIcs(originalSummary),
          });
          expect(privateDavWriteSucceeded(result)).toBe(true);
          return result;
        },
      );
      const readCreatedResource = await checkpoint.run(
        'private-ui-dav-read-created',
        async () => {
          const result = await requestPrivateDav({
            ...requestBase,
            url: resourceUrl,
            method: 'GET',
            expectedText: `SUMMARY:${originalSummary}`,
          });
          expect(privateDavReadSucceeded(result)).toBe(true);
          expect(isStrongPrivateDavEtag(result.etag)).toBe(true);
          return result;
        },
      );
      const updatedResource = await checkpoint.run(
        'private-ui-dav-update',
        async () => {
          const result = await requestPrivateDav({
            ...requestBase,
            url: resourceUrl,
            method: 'PUT',
            headers: {
              'content-type': 'text/calendar; charset=utf-8',
              'if-match': privateDavReadEtagOrEmpty(readCreatedResource),
            },
            body: makeIcs(updatedSummary),
          });
          expect(privateDavWriteSucceeded(result)).toBe(true);
          return result;
        },
      );
      const readUpdatedResource = await checkpoint.run(
        'private-ui-dav-read-updated',
        async () => {
          const result = await requestPrivateDav({
            ...requestBase,
            url: resourceUrl,
            method: 'GET',
            expectedText: `SUMMARY:${updatedSummary}`,
          });
          expect(privateDavReadSucceeded(result)).toBe(true);
          expect(isStrongPrivateDavEtag(result.etag)).toBe(true);
          return result;
        },
      );
      const deletedResource = await checkpoint.run(
        'private-ui-dav-delete',
        async () => {
          const result = await requestPrivateDav({
            ...requestBase,
            url: resourceUrl,
            method: 'DELETE',
            headers: {
              'if-match': privateDavReadEtagOrEmpty(readUpdatedResource),
            },
          });
          expect(privateDavWriteSucceeded(result)).toBe(true);
          return result;
        },
      );
      expect(
        privateDavLifecycleSucceeded(
          principalDiscovery,
          collectionDiscovery,
          createdResource,
          readCreatedResource,
          updatedResource,
          readUpdatedResource,
          deletedResource,
        ),
      ).toBe(true);
    } finally {
      // This only deletes this random resource after verifying its UID and
      // current strong ETag. Cleanup failure never masks the test failure.
      await checkpoint.cleanup('private-ui-dav-cleanup', () =>
        bestEffortDeleteOwnedPrivateDavResource(
          requestBase,
          resourceUrl,
          eventUid,
        ),
      );
    }

    const memberBPage = await checkpoint.run(
      'private-ui-member-b-auth',
      async () => {
        const memberBContext = await makeContext();
        return authenticateInElement(
          memberBContext,
          journey.fixture.users.memberB,
        );
      },
    );
    const memberBRoom = await checkpoint.run('private-ui-member-b-room', () =>
      openFixtureRoom(
        memberBPage,
        journey.fixture.roomName,
        journey.fixture.teamRoomId,
      ),
    );
    const memberBFrame = await checkpoint.run(
      'private-ui-member-b-widget-ready',
      () =>
        openCalendarWidget(memberBRoom, memberBPage, {
          expectWidgetWarning: true,
        }),
    );
    await checkpoint.run('private-ui-member-b-deny', async () => {
      const memberBDialogList = waitForPrivateClientResponse(
        memberBPage,
        'GET',
      );
      await memberBFrame
        .getByRole('button', {
          name: 'Calendar app access',
          exact: true,
        })
        .click();
      const memberBDialog = memberBFrame.getByRole('dialog').last();
      expect((await memberBDialogList).status()).toBe(403);
      await expect(
        memberBDialog.getByRole('button', {
          name: 'Create app access',
          exact: true,
        }),
      ).toHaveCount(0);
    });

    const outsiderPage = await checkpoint.run(
      'private-ui-outsider-auth',
      async () => {
        const outsiderContext = await makeContext();
        return authenticateInElement(
          outsiderContext,
          journey.fixture.users.outsider,
        );
      },
    );
    const outsiderRoom = await checkpoint.run('private-ui-outsider-room', () =>
      openFixtureRoom(
        outsiderPage,
        journey.fixture.outsiderRoomName,
        journey.fixture.outsiderRoomId,
      ),
    );
    await checkpoint.run('private-ui-outsider-widget-ready', () =>
      openCalendarWidget(outsiderRoom, outsiderPage, {
        expectWidgetWarning: false,
        waitForCalendar: false,
      }),
    );
    await checkpoint.run('private-ui-outsider-deny', async () => {
      const outsiderPrivateClientStatus = await requestPrivateClientListStatus(
        outsiderPage,
        journey.fixture.gatewayUrl,
        journey.fixture.teamRoomId,
        journey.fixture.calendarId,
      );
      expect(outsiderPrivateClientStatus).toBe(403);
    });

    await checkpoint.run('private-ui-revoke', async () => {
      const revokeResponse = waitForPrivateClientResponse(pageA, 'DELETE');
      await reopenedDialogA
        .getByRole('button', { name: 'Revoke', exact: true })
        .click();
      await reopenedDialogA
        .getByRole('button', { name: 'Revoke access', exact: true })
        .click();
      expect((await revokeResponse).status()).toBe(200);
      await expect(
        reopenedDialogA.getByText('Status: Revoked', { exact: true }),
      ).toBeVisible();
    });

    await checkpoint.run('private-ui-dav-deny-after-revoke', async () => {
      const davAfterRevoke = await requestPrivateDav({
        ...requestBase,
        url: resourceUrl,
        method: 'GET',
      });
      expect(revokedPrivateDavCredentialDenied(davAfterRevoke)).toBe(true);
    });
    await checkpoint.run('private-ui-egress-check', async () => {
      expect(blockedExternalRequests).toBe(0);
      expect(publicFeedMutationCount).toBe(0);
    });
  } finally {
    calendarListRequestObserver?.recordSnapshot((observations) =>
      checkpoint.recordCalendarListTransport(observations),
    );
    calendarListRequestObserver?.dispose();
    await checkpoint.cleanup('private-ui-context-cleanup', async () => {
      await Promise.all(
        contexts.map((context) => context.close().catch(() => undefined)),
      );
    });
  }
}
