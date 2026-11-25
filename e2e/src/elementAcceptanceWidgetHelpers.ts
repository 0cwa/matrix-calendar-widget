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

import { expect, type Locator, type Page } from '@playwright/test';
import { performance } from 'node:perf_hooks';
import { raceCalendarReadyOrIdentityPrompt } from '../../dev/element-acceptance-performance.mjs';
import { elapsedMilliseconds } from './elementAcceptancePerformanceHelpers';
import type {
  Phase,
  PinnedControlObservation,
} from './elementAcceptanceSupportTypes';
import type { OpenCalendarWidgetOptions } from './elementAcceptanceTypes';
import { ElementWebPage } from './pages/elementWebPage';

export function createElementWidgetHelpers(
  supportContext: {
    activePhase: Phase;
    pendingPinnedControlObservation: PinnedControlObservation | undefined;
  },
  record: (
    phase: Phase,
    status: 'started' | 'passed' | 'failed',
    httpStatus?: number,
    count?: number,
    extra?: {
      controlVisible?: boolean;
      panelPresent?: boolean;
      teamRoomMatches?: boolean;
    },
  ) => void,
) {
  function recordJourneyFailure(
    phase: Phase,
    httpStatus: number | undefined,
    alreadyRecorded: boolean,
    teamRoomMatches?: boolean,
  ) {
    if (!alreadyRecorded) {
      const observation =
        supportContext.pendingPinnedControlObservation?.phase === phase
          ? supportContext.pendingPinnedControlObservation
          : undefined;
      record(phase, 'failed', httpStatus, observation?.count, {
        ...(observation
          ? {
              controlVisible: observation.controlVisible,
              ...(observation.panelPresent === undefined
                ? {}
                : { panelPresent: observation.panelPresent }),
            }
          : {}),
        ...(teamRoomMatches === undefined ? {} : { teamRoomMatches }),
      });
    }
    supportContext.pendingPinnedControlObservation = undefined;
  }

  async function openCalendarWidget(
    element: ElementWebPage,
    page: Page,
    {
      expectWidgetWarning,
      waitForCalendar = true,
      captureMemberADiagnostics = false,
      onTiming,
    }: OpenCalendarWidgetOptions,
  ) {
    const startupStartedAt = performance.now();
    const activationStartedAt = startupStartedAt;
    await openPinnedElementWidget(
      page,
      'Matrix Calendar',
      captureMemberADiagnostics,
    );
    onTiming?.('activation', elapsedMilliseconds(activationStartedAt));
    if (captureMemberADiagnostics) {
      if (!expectWidgetWarning)
        supportContext.activePhase = 'widget-a-warning-not-required';
    }
    if (expectWidgetWarning) {
      await element.approveWidgetWarning();
      if (captureMemberADiagnostics)
        record(supportContext.activePhase, 'passed');
    } else if (captureMemberADiagnostics) {
      record(supportContext.activePhase, 'passed');
    }
    if (captureMemberADiagnostics) {
      supportContext.activePhase = 'widget-a-capabilities-approval';
    }
    const capabilityApprovalStartedAt = performance.now();
    await element.approveWidgetCapabilities();
    onTiming?.(
      'capability-approval',
      elapsedMilliseconds(capabilityApprovalStartedAt),
    );
    if (captureMemberADiagnostics) record(supportContext.activePhase, 'passed');
    if (captureMemberADiagnostics) {
      supportContext.activePhase = 'widget-a-identity-approval';
    }
    const identityContinue = page
      .getByRole('dialog')
      .getByRole('button', { name: 'Continue', exact: true })
      .first();
    const frame = element.widgetByTitle('Matrix Calendar');
    const identityApprovalStartedAt = performance.now();
    let identityApprovalDurationMs = 0;
    let identityDialogShown: boolean;
    if (onTiming && waitForCalendar) {
      const createEventButton = frame.getByRole('button', {
        name: 'Create event',
        exact: true,
      });
      identityDialogShown = await raceCalendarReadyOrIdentityPrompt(
        () => expect(createEventButton).toBeEnabled({ timeout: 30_000 }),
        () => identityContinue.waitFor({ state: 'visible', timeout: 30_000 }),
      );
    } else {
      await identityContinue
        .waitFor({ state: 'visible', timeout: 8_000 })
        .catch(() => undefined);
      identityDialogShown = await identityContinue
        .isVisible()
        .catch(() => false);
    }
    if (captureMemberADiagnostics) {
      record(
        identityDialogShown
          ? 'widget-a-identity-dialog-observed'
          : 'widget-a-identity-dialog-not-required',
        'passed',
      );
    }
    if (identityDialogShown) {
      if (captureMemberADiagnostics) {
        supportContext.activePhase = 'widget-a-identity-approval';
      }
      await element.approveWidgetIdentity();
      identityApprovalDurationMs = elapsedMilliseconds(
        identityApprovalStartedAt,
      );
      if (captureMemberADiagnostics) {
        record(supportContext.activePhase, 'passed');
        supportContext.activePhase = 'widget-a-iframe-ready';
      }
    } else if (captureMemberADiagnostics) {
      supportContext.activePhase = 'widget-a-iframe-ready';
    }
    onTiming?.('identity-approval', identityApprovalDurationMs);
    const iframeReadyStartedAt = performance.now();
    if (captureMemberADiagnostics) {
      supportContext.activePhase = 'widget-a-iframe-attached';
      await page
        .locator('iframe[title="Matrix Calendar"]')
        .waitFor({ state: 'attached', timeout: 30_000 });
      record(supportContext.activePhase, 'passed');
      supportContext.activePhase = 'widget-a-iframe-ready';
    }
    if (waitForCalendar) {
      await frame
        .getByRole('button', { name: 'Create event', exact: true })
        .waitFor();
    }
    onTiming?.('iframe-ready', elapsedMilliseconds(iframeReadyStartedAt));
    onTiming?.('widget-startup', elapsedMilliseconds(startupStartedAt));
    return frame;
  }

  async function openPinnedElementWidget(
    page: Page,
    widgetName: string,
    captureMemberADiagnostics = false,
  ): Promise<void> {
    const roomHeader = page.locator('header.mx_RoomHeader');
    const rightPanel = page.getByRole('complementary');
    await clickPinnedWidgetControl(
      roomHeader.locator('button.mx_RoomHeader_infoWrapper'),
      captureMemberADiagnostics ? 'widget-a-room-info-button' : undefined,
    );
    await clickPinnedWidgetControl(
      rightPanel.getByRole('menuitem', { name: 'Extensions' }),
      captureMemberADiagnostics ? 'widget-a-extensions-menuitem' : undefined,
      rightPanel,
    );

    await clickPinnedWidgetControl(
      rightPanel.getByRole('button', { name: widgetName }),
      captureMemberADiagnostics ? 'widget-a-extension-row' : undefined,
      rightPanel,
    );
  }

  async function clickPinnedWidgetControl(
    control: Locator,
    diagnosticPhase?:
      | 'widget-a-room-info-button'
      | 'widget-a-extensions-menuitem'
      | 'widget-a-extension-row',
    panel?: Locator,
  ): Promise<void> {
    if (!diagnosticPhase) {
      await control.click();
      return;
    }

    supportContext.activePhase = diagnosticPhase;
    await control.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
    const count = Math.min(await control.count(), 2);
    const visibleControl = control.filter({ visible: true });
    const visibleCount = Math.min(await visibleControl.count(), 2);
    const controlVisible = visibleCount > 0;
    const panelPresent = panel
      ? (await panel.filter({ visible: true }).count()) > 0
      : undefined;
    supportContext.pendingPinnedControlObservation = {
      phase: diagnosticPhase,
      count,
      controlVisible,
      ...(panelPresent === undefined ? {} : { panelPresent }),
    };

    if (
      count !== 1 ||
      visibleCount !== 1 ||
      !controlVisible ||
      panelPresent === false
    ) {
      throw new Error('Pinned Element widget control unavailable');
    }

    await visibleControl.click({ timeout: 8_000 });
    record(diagnosticPhase, 'passed', undefined, count, {
      controlVisible,
      ...(panelPresent === undefined ? {} : { panelPresent }),
    });
    supportContext.pendingPinnedControlObservation = undefined;
  }

  async function openEventEditor(
    frame: ReturnType<ElementWebPage['widgetByTitle']>,
    title: string,
  ) {
    const row = frame.getByRole('listitem', { name: title });
    await expect(row).toBeVisible();
    await row.click();
    const details = frame.getByRole('dialog').last();
    await details.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(
      frame.getByRole('dialog').last().getByRole('textbox', { name: 'Title' }),
    ).toBeVisible();
  }

  return {
    recordJourneyFailure,
    openCalendarWidget,
    openPinnedElementWidget,
    clickPinnedWidgetControl,
    openEventEditor,
  };
}
