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

import { test } from '@playwright/test';
import { createPrivateUiCheckpointJournal } from '../../dev/element-acceptance-private-ui-checkpoints.mjs';
import { createElementAcceptanceSupport } from './elementAcceptanceSupport';
import { runElementFunctionalAcceptanceJourney } from './elementFunctionalAcceptanceJourney';
import { runElementPerformanceAcceptanceJourney } from './elementPerformanceAcceptanceJourney';
import { runElementPrivateAcceptanceJourney } from './elementPrivateAcceptanceJourney';
import { runElementReminderAcceptanceJourney } from './elementReminderAcceptanceJourney';

const support = createElementAcceptanceSupport();

test.afterEach(async ({}, testInfo) => {
  support.finishActiveReminderFlowDiagnostic(testInfo.status);
});

test('Element Web members share events and enforce room authorization', async ({
  browser,
}) => {
  await runElementFunctionalAcceptanceJourney(
    browser,
    support.createFunctionalJourneyContext(),
  );
});

test('Element Web measures the ordinary 0-and-25-event calendar profile', async ({
  browser,
}) => {
  await runElementPerformanceAcceptanceJourney(
    browser,
    support.createPerformanceJourneyContext(),
  );
});

test('Element Web delivers room-timed and selected-member all-day reminders across restart and restore', async ({
  browser,
}) => {
  await runElementReminderAcceptanceJourney(
    browser,
    support.createReminderJourneyContext(),
  );
});

test('Element Web preserves unsupported events and supports client interactions', async ({
  browser,
}) => {
  test.setTimeout(360_000);
  await support.runG6(browser);
});
if (process.env.ELEMENT_ACCEPTANCE_PRIVATE_UI === 'true') {
  test.describe('private calendar app acceptance', () => {
    let privateUiJournal:
      ReturnType<typeof createPrivateUiCheckpointJournal> | undefined;

    test.beforeEach(() => {
      const stageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
      const sourceSha = process.env.ELEMENT_ACCEPTANCE_SOURCE_SHA;
      if (process.env.ROOM_CALENDAR_PRINCIPAL_MODE !== 'bot-account') {
        throw new Error('Private acceptance requires the normal bot profile');
      }
      if (!stageFile || !sourceSha) {
        throw new Error('Private acceptance checkpoints are unavailable');
      }
      privateUiJournal = createPrivateUiCheckpointJournal({
        stageFile,
        sourceSha,
        profile: 'normal-bot',
      });
    });

    test.afterEach(async ({}, testInfo) => {
      privateUiJournal?.finish(testInfo.status);
      privateUiJournal = undefined;
    });

    test('Element Web manages private app access and revokes CalDAV authorization', async ({
      browser,
    }) => {
      await runElementPrivateAcceptanceJourney(
        browser,
        privateUiJournal,
        support.createPrivateJourneyContext(),
      );
    });
  });
}
