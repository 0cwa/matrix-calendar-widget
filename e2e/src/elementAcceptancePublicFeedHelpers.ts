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
  type FrameLocator,
  type Locator,
  type Page,
  type Response,
} from '@playwright/test';
import { isRecord } from './elementAcceptanceShared';
import {
  PUBLIC_FEED_MANAGEMENT_ERROR_CODES,
  type AnonymousPublicFeedResponse,
  type Phase,
  type PublicFeedBrowserObservation,
  type PublicFeedManagementErrorCode,
} from './elementAcceptanceSupportTypes';
import type { Fixture } from './elementAcceptanceTypes';

export function createPublicFeedAcceptanceHelpers(
  supportContext: {
    fixture: Fixture;
    activePhase: Phase;
    activeReminderFailureRecorded: boolean;
  },
  record: (
    phase: Phase,
    status: 'started' | 'passed' | 'failed',
    httpStatus?: number,
    count?: number,
    extra?: Partial<PublicFeedBrowserObservation>,
  ) => void,
) {
  const PUBLIC_FEED_MANAGEMENT_ERROR_CODE_SET = new Set<string>(
    PUBLIC_FEED_MANAGEMENT_ERROR_CODES,
  );

  function classifyPublicFeedManagementErrorCode(
    state: unknown,
  ): PublicFeedManagementErrorCode {
    if (!isRecord(state) || typeof state.code !== 'string') {
      return 'unclassified';
    }
    return PUBLIC_FEED_MANAGEMENT_ERROR_CODE_SET.has(state.code)
      ? (state.code as PublicFeedManagementErrorCode)
      : 'unclassified';
  }

  async function waitForPublicFeedPublicationResponse(
    page: Page,
    method: 'GET' | 'PUT' | 'DELETE',
    targetScope: 'any' | 'fixture-room' = 'any',
  ): Promise<Response> {
    const gatewayOrigin = new URL(supportContext.fixture.gatewayUrl).origin;
    return page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          url.origin === gatewayOrigin &&
          url.pathname === '/v1/calendar-feeds/publication' &&
          response.request().method() === method &&
          (targetScope === 'any' || publicFeedManagementTargetMatches(response))
        );
      },
      { timeout: 20_000 },
    );
  }

  function publicFeedManagementTargetMatches(response: Response): boolean {
    try {
      const url = new URL(response.url());
      return (
        url.origin === new URL(supportContext.fixture.gatewayUrl).origin &&
        url.pathname === '/v1/calendar-feeds/publication' &&
        url.searchParams.get('target') === 'room' &&
        url.searchParams.get('calendarId') ===
          supportContext.fixture.calendarId &&
        url.searchParams.get('roomId') === supportContext.fixture.teamRoomId
      );
    } catch {
      return false;
    }
  }

  async function fetchAnonymousPublicFeed(
    url: string,
    method: 'GET' | 'HEAD',
  ): Promise<AnonymousPublicFeedResponse> {
    const headers = new Headers({ Accept: 'text/calendar' });
    try {
      const response = await fetch(url, {
        method,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      let body = new Uint8Array();
      try {
        body = new Uint8Array(await response.arrayBuffer());
      } catch {
        // Retain the observed status and closed headers if the body read fails.
      }
      return {
        status: response.status,
        contentType: response.headers.get('Content-Type') ?? undefined,
        contentLength: response.headers.get('Content-Length') ?? undefined,
        cacheControl: response.headers.get('Cache-Control') ?? undefined,
        pragma: response.headers.get('Pragma') ?? undefined,
        nosniff: response.headers.get('X-Content-Type-Options') ?? undefined,
        body,
      };
    } catch {
      return { body: new Uint8Array() };
    }
  }

  async function verifyPublicFeedBrowserLifecycle(
    frame: FrameLocator,
    page: Page,
    eventTitle: string,
  ): Promise<void> {
    supportContext.activePhase = 'public-feed-browser-lifecycle';
    record(supportContext.activePhase, 'started');
    const observation: PublicFeedBrowserObservation = {
      publicFeedLifecycleStep: 'opening-dialog',
      publicConsentGateObserved: false,
      publicManagerPublishSucceeded: false,
      publicUrlOriginAndRouteMatch: false,
      anonymousGetContainsCanonicalEvent: false,
      anonymousHeadMatchesGet: false,
      unpublishSucceeded: false,
      anonymousGetDeniedAfterUnpublish: false,
      anonymousHeadDeniedAfterUnpublish: false,
    };
    let publicUrl: string | undefined;
    let dialog: Locator | undefined;
    let publicationCreated = false;
    try {
      const publicFeedButton = frame.getByRole('button', {
        name: 'Public feed',
        exact: true,
      });
      await expect(publicFeedButton).toBeVisible();
      observation.publicFeedLifecycleStep = 'loading-settings';
      const initialSettingsResponse = waitForPublicFeedPublicationResponse(
        page,
        'GET',
      );
      await publicFeedButton.click();
      dialog = frame.getByRole('dialog', {
        name: 'Public calendar feed',
      });
      await expect(dialog).toBeVisible();
      const settingsResponse = await initialSettingsResponse;
      let managementResponse = settingsResponse;
      observation.publicFeedManagementGetStatus = settingsResponse.status();
      let managementState: unknown = await settingsResponse
        .json()
        .catch(() => null);
      if (settingsResponse.status() === 503) {
        observation.publicFeedManagementErrorCode =
          classifyPublicFeedManagementErrorCode(managementState);
      }

      observation.publicFeedLifecycleStep = 'selecting-target-calendar';
      const calendarSelect = dialog.getByRole('combobox', {
        name: 'Calendar',
      });
      let selectedCalendarName = (await calendarSelect.innerText()).trim();
      if (selectedCalendarName !== 'Room calendar') {
        const targetSettingsResponse = waitForPublicFeedPublicationResponse(
          page,
          'GET',
          'fixture-room',
        );
        await calendarSelect.click();
        // MUI renders Select options in a frame-level portal. Scope the choice
        // to the one visible listbox instead of querying the frame for options.
        const calendarListbox = frame
          .getByRole('listbox')
          .filter({ visible: true });
        await expect(calendarListbox).toHaveCount(1);
        await calendarListbox
          .getByRole('option', {
            name: 'Room calendar',
            exact: true,
          })
          .click();
        await expect(calendarSelect).toHaveText('Room calendar');
        const response = await targetSettingsResponse;
        managementResponse = response;
        observation.publicFeedManagementGetStatus = response.status();
        managementState = await response.json().catch(() => null);
        if (response.status() === 503) {
          observation.publicFeedManagementErrorCode =
            classifyPublicFeedManagementErrorCode(managementState);
        }
        selectedCalendarName = (await calendarSelect.innerText()).trim();
      }
      observation.publicFeedTargetCalendarMatches =
        selectedCalendarName === 'Room calendar';
      observation.publicFeedManagementTargetMatches =
        publicFeedManagementTargetMatches(managementResponse);
      observation.publicFeedSettingsEnabled =
        isRecord(managementState) && managementState.enabled === true;
      observation.publicFeedSettingsUnpublished =
        isRecord(managementState) && managementState.published === false;
      if (!observation.publicFeedManagementTargetMatches) {
        throw new Error(
          'Public feed management target did not match the fixture',
        );
      }

      const managerCanPublish =
        isRecord(managementState) &&
        managementState.enabled === true &&
        managementState.published === false;
      const consent = dialog.getByRole('checkbox', {
        name: 'I understand that anyone with the link can read this calendar.',
        exact: true,
      });
      const publishButton = dialog.getByRole('button', {
        name: 'Publish feed',
        exact: true,
      });
      observation.publicFeedLifecycleStep = 'awaiting-consent-control';
      observation.publicFeedConsentCheckboxCount = Math.min(
        await consent.count(),
        10,
      );
      observation.publicFeedConsentCheckboxVisible =
        observation.publicFeedConsentCheckboxCount > 0 &&
        (await consent.isVisible());
      observation.publicFeedConsentCheckboxChecked =
        observation.publicFeedConsentCheckboxCount > 0 &&
        (await consent.isChecked());
      observation.publicFeedPublishButtonCount = Math.min(
        await publishButton.count(),
        10,
      );
      await expect(consent).toBeVisible();
      observation.publicFeedConsentCheckboxCount = Math.min(
        await consent.count(),
        10,
      );
      observation.publicFeedConsentCheckboxVisible = await consent.isVisible();
      observation.publicFeedConsentCheckboxChecked = await consent.isChecked();
      const publishDisabledBeforeConsent = await publishButton.isDisabled();
      observation.publicFeedPublishDisabledBeforeConsent =
        publishDisabledBeforeConsent;
      observation.publicFeedLifecycleStep = 'toggling-consent';
      await consent.check();
      observation.publicFeedLifecycleStep = 'verifying-consent';
      observation.publicFeedConsentCheckboxChecked = await consent.isChecked();
      const publishEnabledAfterConsent = !(await publishButton.isDisabled());
      observation.publicFeedPublishDisabledAfterConsent =
        !publishEnabledAfterConsent;
      observation.publicConsentGateObserved =
        managerCanPublish &&
        publishDisabledBeforeConsent &&
        publishEnabledAfterConsent;
      if (!observation.publicConsentGateObserved) {
        throw new Error('Manager publication consent gate was not observed');
      }

      observation.publicFeedLifecycleStep = 'publishing';
      const publishResponsePromise = waitForPublicFeedPublicationResponse(
        page,
        'PUT',
      );
      await publishButton.click();
      const publishResponse = await publishResponsePromise;
      observation.publicFeedPublishStatus = publishResponse.status();
      const publishedState: unknown = await publishResponse
        .json()
        .catch(() => null);
      publicationCreated =
        publishResponse.status() >= 200 &&
        publishResponse.status() < 300 &&
        isRecord(publishedState) &&
        publishedState.published === true;
      observation.publicManagerPublishSucceeded = publicationCreated;
      if (!publicationCreated) {
        throw new Error('Manager publication did not succeed');
      }

      observation.publicFeedLifecycleStep = 'checking-public-feed';
      const publicUrlInput = dialog.getByRole('textbox', {
        name: 'Public feed URL',
        exact: true,
      });
      await expect(publicUrlInput).toBeVisible();
      publicUrl = await publicUrlInput.inputValue();
      let parsedPublicUrl: URL | undefined;
      try {
        parsedPublicUrl = new URL(publicUrl);
      } catch {
        parsedPublicUrl = undefined;
      }
      observation.publicUrlOriginAndRouteMatch =
        parsedPublicUrl !== undefined &&
        parsedPublicUrl.origin ===
          new URL(supportContext.fixture.gatewayUrl).origin &&
        /^\/v1\/public-calendar-feeds\/[A-Za-z0-9_.-]+$/u.test(
          parsedPublicUrl.pathname,
        ) &&
        parsedPublicUrl.username === '' &&
        parsedPublicUrl.password === '' &&
        parsedPublicUrl.search === '' &&
        parsedPublicUrl.hash === '';
      if (!observation.publicUrlOriginAndRouteMatch) {
        throw new Error('Public feed URL did not match the synthetic gateway');
      }

      const [publicGet, publicHead] = await Promise.all([
        fetchAnonymousPublicFeed(publicUrl, 'GET'),
        fetchAnonymousPublicFeed(publicUrl, 'HEAD'),
      ]);
      observation.publicFeedGetStatus = publicGet.status;
      observation.publicFeedHeadStatus = publicHead.status;
      let feedText = '';
      try {
        feedText = new TextDecoder('utf-8', { fatal: true }).decode(
          publicGet.body,
        );
      } catch {
        feedText = '';
      }
      const getHeadersAreSafe =
        publicGet.cacheControl?.toLowerCase().includes('no-store') === true &&
        publicGet.pragma?.toLowerCase() === 'no-cache' &&
        publicGet.nosniff?.toLowerCase() === 'nosniff';
      observation.anonymousGetContainsCanonicalEvent =
        publicGet.status === 200 &&
        publicGet.contentType?.toLowerCase().startsWith('text/calendar') ===
          true &&
        getHeadersAreSafe &&
        feedText.startsWith('BEGIN:VCALENDAR') &&
        feedText.includes('BEGIN:VEVENT') &&
        feedText.includes(eventTitle) &&
        feedText.trimEnd().endsWith('END:VCALENDAR');
      const headHeadersAreSafe =
        publicHead.cacheControl?.toLowerCase().includes('no-store') === true &&
        publicHead.pragma?.toLowerCase() === 'no-cache' &&
        publicHead.nosniff?.toLowerCase() === 'nosniff';
      observation.anonymousHeadMatchesGet =
        publicHead.status === 200 &&
        publicHead.contentType?.toLowerCase().startsWith('text/calendar') ===
          true &&
        headHeadersAreSafe &&
        publicHead.body.byteLength === 0 &&
        publicHead.contentLength === String(publicGet.body.byteLength);
      if (
        !observation.anonymousGetContainsCanonicalEvent ||
        !observation.anonymousHeadMatchesGet
      ) {
        throw new Error('Anonymous public feed GET/HEAD did not match');
      }

      observation.publicFeedLifecycleStep = 'unpublishing';
      const unpublishResponsePromise = waitForPublicFeedPublicationResponse(
        page,
        'DELETE',
      );
      await dialog
        .getByRole('button', { name: 'Unpublish', exact: true })
        .click();
      const unpublishResponse = await unpublishResponsePromise;
      observation.publicFeedUnpublishStatus = unpublishResponse.status();
      observation.unpublishSucceeded =
        unpublishResponse.status() >= 200 && unpublishResponse.status() < 300;
      if (!observation.unpublishSucceeded) {
        throw new Error('Public feed could not be unpublished');
      }
      publicationCreated = false;

      observation.publicFeedLifecycleStep = 'checking-revocation';
      const [revokedGet, revokedHead] = await Promise.all([
        fetchAnonymousPublicFeed(publicUrl, 'GET'),
        fetchAnonymousPublicFeed(publicUrl, 'HEAD'),
      ]);
      observation.publicFeedRevokedGetStatus = revokedGet.status;
      observation.publicFeedRevokedHeadStatus = revokedHead.status;
      observation.anonymousGetDeniedAfterUnpublish =
        revokedGet.status === 404 && revokedGet.body.byteLength === 0;
      observation.anonymousHeadDeniedAfterUnpublish =
        revokedHead.status === 404 && revokedHead.body.byteLength === 0;
      if (
        !observation.anonymousGetDeniedAfterUnpublish ||
        !observation.anonymousHeadDeniedAfterUnpublish
      ) {
        throw new Error('Public feed remained available after unpublishing');
      }

      observation.publicFeedLifecycleStep = 'complete';
      record(
        supportContext.activePhase,
        'passed',
        observation.publicFeedRevokedGetStatus,
        undefined,
        observation,
      );
    } catch {
      supportContext.activeReminderFailureRecorded = true;
      record(
        supportContext.activePhase,
        'failed',
        undefined,
        undefined,
        observation,
      );
      throw new Error('Public calendar feed lifecycle could not be confirmed');
    } finally {
      if (publicationCreated && dialog) {
        try {
          const unpublishButton = dialog.getByRole('button', {
            name: 'Unpublish',
            exact: true,
          });
          if (await unpublishButton.isVisible()) {
            const cleanupResponse = waitForPublicFeedPublicationResponse(
              page,
              'DELETE',
            );
            await unpublishButton.click();
            await cleanupResponse;
          }
        } catch {
          // The isolated Element stack is removed by the acceptance job.
        }
      }
    }
  }

  return { verifyPublicFeedBrowserLifecycle };
}
