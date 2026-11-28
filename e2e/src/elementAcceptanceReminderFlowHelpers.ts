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
  type Page,
  type Request,
  type Response,
} from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import {
  planReminderAllDayEvent,
  planReminderAllDaySchedule,
  planReminderTimedEvent,
  reminderFixtureAllDayExpectedScheduleMatches,
  reminderFixtureLocalDateTimeToUnixMillis,
} from '../../dev/element-acceptance-reminder-timing.mjs';
import { readReminderAllDayScheduleFields } from '../../dev/element-reminder-all-day-readback.mjs';
import {
  REMINDER_ALL_DAY_CALDAV_ALARM_LEAD_MINUTES,
  REMINDER_ALL_DAY_TIMEZONE,
  reminderPlanForMarkerIndex,
  summarizeReminderRecipientRoster,
} from './elementAcceptanceReminderHelpers';
import { isRecord } from './elementAcceptanceShared';
import type {
  BlockedRequestDiagnostic,
  MemberAriaHiddenState,
  MemberCssVisibility,
  MemberInertState,
  MemberInputExpandedState,
  MemberPickerObservationError,
  Phase,
  PublicFeedBrowserObservation,
  ReminderAlarmUiObservation,
  ReminderConfigurationObservation,
  ReminderCreationResult,
  ReminderFlow,
  ReminderPlan,
  ReminderReadbackReference,
  ReminderTimelineSnapshot,
} from './elementAcceptanceSupportTypes';
import type { Fixture, G6StageRecord } from './elementAcceptanceTypes';

type RecordStage = (
  phase: Phase,
  status: 'started' | 'passed' | 'failed',
  httpStatus?: number,
  count?: number,
  extra?: {
    originMatchesElement?: boolean;
    controlVisible?: boolean;
    panelPresent?: boolean;
    teamRoomMatches?: boolean;
    blockedRequestDiagnostics?: BlockedRequestDiagnostic[];
    blockedRequestDiagnosticOverflow?: boolean;
    relativeAlarmReadback?: boolean;
    reminderEnabled?: boolean;
    canaryDelivered?: boolean;
    roomMentioned?: boolean;
    selectedMemberMentioned?: boolean;
    targetMentioned?: boolean;
    expectedRoomRecipient?: boolean;
    expectedSelectedRecipient?: boolean;
    deliveredAfterDue?: boolean;
    allMarkersOnce?: boolean;
    targetSettingsReadback?: boolean;
    allDayScheduleReadback?: boolean;
    canManageReminders?: boolean;
  } & Partial<ReminderConfigurationObservation> &
    Partial<ReminderAlarmUiObservation> &
    Partial<PublicFeedBrowserObservation> &
    Partial<Omit<G6StageRecord, 'phase' | 'status' | 'httpStatus' | 'count'>>,
) => void;

export function createReminderAcceptanceHelpers(
  supportContext: {
    fixture: Fixture;
    activePhase: Phase;
    activeReminderFailureRecorded: boolean;
  },
  record: RecordStage,
  waitForGatewayResponse: (
    page: Page,
    method: string,
    pathname: string,
  ) => Promise<Response>,
) {
  // The standard Element side panel measured a 319 CSS-pixel content viewport.
  const MIN_REMINDER_LAYOUT_VIEWPORT_WIDTH = 319;

  const MAX_REMINDER_LAYOUT_VIEWPORT_WIDTH = 420;

  // Allow one default 60-second scheduler interval plus its 30-second scan deadline.
  const REMINDER_SCAN_INTERVAL_MS = 60_000;

  const REMINDER_SCAN_DEADLINE_MS = 30_000;

  const REMINDER_POST_DUE_SCAN_ALLOWANCE_MS =
    REMINDER_SCAN_INTERVAL_MS + REMINDER_SCAN_DEADLINE_MS;

  const REMINDER_TIMELINE_POLL_MS = 5_000;

  const REMINDER_TIMED_TIMEZONE = 'Europe/Stockholm';

  function readReminderFlow(): ReminderFlow {
    const value = process.env.ELEMENT_ACCEPTANCE_REMINDER_FLOW;
    if (value === 'initial' || value === 'restart' || value === 'restore') {
      return value;
    }
    throw new Error('Reminder acceptance flow is unavailable');
  }

  function reminderEventFilePath(): string {
    const runnerTemp = process.env.RUNNER_TEMP;
    const eventFile = process.env.ELEMENT_ACCEPTANCE_REMINDER_EVENT_FILE;
    if (!runnerTemp || !eventFile || !isAbsolute(eventFile)) {
      throw new Error('Reminder acceptance fixture is unavailable');
    }
    const privateRoot = resolve(runnerTemp) + sep;
    const resolvedPath = resolve(eventFile);
    if (!resolvedPath.startsWith(privateRoot)) {
      throw new Error('Reminder acceptance fixture is unavailable');
    }
    return resolvedPath;
  }

  function readReminderEventTitles(): string[] {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(reminderEventFilePath(), 'utf8'));
    } catch {
      throw new Error('Reminder acceptance markers are unavailable');
    }
    if (
      !Array.isArray(value) ||
      value.length > 3 ||
      value.some(
        (title) =>
          typeof title !== 'string' ||
          !/^Reminder acceptance [0-9a-f-]{36}$/u.test(title),
      ) ||
      new Set(value).size !== value.length
    ) {
      throw new Error('Reminder acceptance markers are invalid');
    }
    return value;
  }

  function writeReminderEventTitles(titles: readonly string[]): void {
    if (
      titles.length < 1 ||
      titles.length > 3 ||
      titles.some(
        (title) => !/^Reminder acceptance [0-9a-f-]{36}$/u.test(title),
      ) ||
      new Set(titles).size !== titles.length
    ) {
      throw new Error('Reminder acceptance markers are invalid');
    }
    writeFileSync(reminderEventFilePath(), `${JSON.stringify(titles)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  async function createAndConfigureReminder(
    frame: FrameLocator,
    page: Page,
    title: string,
    markerPlan: ReminderPlan,
  ): Promise<ReminderCreationResult> {
    supportContext.activePhase = 'reminder-event-create-dialog';
    record(supportContext.activePhase, 'started');
    await frame
      .getByRole('button', { name: 'Create event', exact: true })
      .click();
    const editor = frame.getByRole('dialog').last();
    await expect(editor).toBeVisible({ timeout: 15_000 });

    const fixtureNow = Date.now();
    const timedPlan = markerPlan.allDay
      ? undefined
      : planReminderTimedEvent(fixtureNow, REMINDER_TIMED_TIMEZONE);
    const allDayPlan = markerPlan.allDay
      ? planReminderAllDayEvent(
          fixtureNow,
          markerPlan.allDayTimezone ?? REMINDER_ALL_DAY_TIMEZONE,
        )
      : undefined;
    const dueAt = timedPlan?.dueAt ?? allDayPlan!.dueAt;
    const startValue =
      timedPlan?.startValue ?? allDayPlan!.scheduleLocalDateTime;
    const endValue = timedPlan?.endValue ?? '';
    const eventStartDate = allDayPlan?.eventStartDate;
    const eventEndDate = allDayPlan?.eventEndDate;
    const alarmLeadMinutes =
      timedPlan?.alarmLeadMinutes ??
      markerPlan.caldavAlarmLeadMinutes ??
      REMINDER_ALL_DAY_CALDAV_ALARM_LEAD_MINUTES;
    const completePlan: ReminderPlan = {
      ...markerPlan,
      ...(eventStartDate ? { allDayEventDate: eventStartDate } : {}),
    };
    await editor.getByRole('combobox', { name: 'Calendar' }).selectOption({
      value: `matrix-calendar-target://room/${encodeURIComponent(supportContext.fixture.calendarId)}`,
    });
    await editor.getByRole('textbox', { name: 'Title' }).fill(title);
    const alarmToggle = editor.getByLabel('Calendar app alert');
    if (await alarmToggle.isChecked()) await alarmToggle.uncheck();
    if (markerPlan.allDay) {
      await editor.getByLabel('All day').check();
      await editor
        .getByRole('textbox', { name: 'Start' })
        .fill(eventStartDate!);
      await editor.getByRole('textbox', { name: 'End' }).fill(eventEndDate!);
    } else {
      await editor.getByRole('textbox', { name: 'Start' }).fill(startValue);
      await editor.getByRole('textbox', { name: 'End' }).fill(endValue);
      const timezoneField = editor.getByRole('combobox', {
        name: 'Time zone',
      });
      await timezoneField.fill(REMINDER_TIMED_TIMEZONE);
      // Close the zone suggestions so they cannot cover the dialog actions.
      await timezoneField.press('Tab');
    }
    record(supportContext.activePhase, 'passed');

    supportContext.activePhase = 'reminder-event-created';
    record(supportContext.activePhase, 'started');
    const createResponse = waitForGatewayResponse(
      page,
      'POST',
      '/v1/calendar/events',
    );
    await editor
      .getByRole('button', { name: 'Create event', exact: true })
      .click();
    const response = await createResponse;
    const status = response.status();
    if (status < 200 || status >= 300) {
      record(supportContext.activePhase, 'failed', status);
      supportContext.activeReminderFailureRecorded = true;
      throw new Error('The reminder event was not created');
    }
    record(supportContext.activePhase, 'passed', status);

    supportContext.activePhase = 'reminder-event-visible';
    try {
      await expect(frame.getByRole('listitem', { name: title })).toBeVisible({
        timeout: 20_000,
      });
    } catch {
      record(supportContext.activePhase, 'failed', status, 0);
      supportContext.activeReminderFailureRecorded = true;
      throw new Error(
        'The created reminder event was not visible in the widget',
      );
    }
    record(supportContext.activePhase, 'passed', status, 1);

    supportContext.activePhase = 'reminder-alarm-ui-readback';
    const alarmObservation: ReminderAlarmUiObservation = {
      alarmUiStep: 'event-row-visible',
      alarmUiPatchStatus: 0,
      alarmUiRelativeAlarmReadback: false,
      alarmUiAlarmToggleReadback: false,
      alarmUiRelativeTriggerReadback: false,
      alarmUiOffsetReadback: false,
      alarmUiEditorClosed: false,
      alarmUiDetailsClosed: false,
    };
    const alarmSaved = await addCalDavAlarmFromReminderSettings(
      frame,
      page,
      title,
      alarmLeadMinutes,
      alarmObservation,
    );
    const alarmReadback =
      alarmSaved &&
      (await readBackRelativeAlarm(
        frame,
        title,
        {
          expectedDueAt: markerPlan.allDay ? undefined : dueAt,
          expectedAlarmLeadMinutes: alarmLeadMinutes,
        },
        alarmObservation,
      ));
    if (!alarmReadback) {
      record(
        supportContext.activePhase,
        'failed',
        alarmObservation.alarmUiPatchStatus || undefined,
        1,
        {
          ...alarmObservation,
          relativeAlarmReadback: false,
        },
      );
      supportContext.activeReminderFailureRecorded = true;
      throw new Error('The relative alarm did not reload from the event');
    }
    alarmObservation.alarmUiStep = 'complete';
    alarmObservation.alarmUiRelativeAlarmReadback = true;
    record(
      supportContext.activePhase,
      'passed',
      alarmObservation.alarmUiPatchStatus,
      1,
      {
        ...alarmObservation,
        relativeAlarmReadback: true,
      },
    );

    supportContext.activePhase = 'reminder-room-configuration-enabled';
    const reminderConfiguration = await setRoomReminder(
      frame,
      page,
      title,
      completePlan,
    );

    const titles = readReminderEventTitles();
    titles.push(title);
    writeReminderEventTitles(titles);
    return {
      dueAt: markerPlan.allDay ? reminderConfiguration.dueAt! : dueAt,
      alarmLeadMinutes,
      ...(eventStartDate ? { allDayEventDate: eventStartDate } : {}),
    };
  }

  function addCalendarDays(date: string, days: number): string {
    const [year, month, day] = date.split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + days));
    return [
      String(next.getUTCFullYear()).padStart(4, '0'),
      String(next.getUTCMonth() + 1).padStart(2, '0'),
      String(next.getUTCDate()).padStart(2, '0'),
    ].join('-');
  }

  async function readBackRelativeAlarm(
    frame: FrameLocator,
    title: string,
    readbackReference?: ReminderReadbackReference,
    observation: Pick<
      ReminderAlarmUiObservation,
      | 'alarmUiStep'
      | 'alarmUiRelativeAlarmReadback'
      | 'alarmUiAlarmToggleReadback'
      | 'alarmUiRelativeTriggerReadback'
      | 'alarmUiOffsetReadback'
      | 'alarmUiEditorClosed'
      | 'alarmUiDetailsClosed'
    > = {
      alarmUiStep: 'event-row-visible',
      alarmUiRelativeAlarmReadback: false,
      alarmUiAlarmToggleReadback: false,
      alarmUiRelativeTriggerReadback: false,
      alarmUiOffsetReadback: false,
      alarmUiEditorClosed: false,
      alarmUiDetailsClosed: false,
    },
    onReadbackError?: (error: unknown) => void,
  ): Promise<boolean> {
    try {
      observation.alarmUiRelativeAlarmReadback = false;
      observation.alarmUiAlarmToggleReadback = false;
      observation.alarmUiRelativeTriggerReadback = false;
      observation.alarmUiOffsetReadback = false;
      observation.alarmUiEditorClosed = false;
      observation.alarmUiDetailsClosed = false;
      const row = frame.getByRole('listitem', { name: title });
      observation.alarmUiStep = 'event-row-visible';
      await expect(row).toBeVisible();
      observation.alarmUiStep = 'event-open';
      await row.click();
      const details = frame.getByRole('dialog').last();
      observation.alarmUiStep = 'details-ready';
      await expect(
        details.getByRole('button', { name: 'Edit', exact: true }),
      ).toBeVisible();
      observation.alarmUiStep = 'readback-editor-open';
      await details.getByRole('button', { name: 'Edit', exact: true }).click();
      const editor = frame.getByRole('dialog', {
        name: 'Edit event',
        exact: true,
      });
      observation.alarmUiStep = 'readback-editor-ready';
      await expect(
        editor.getByRole('textbox', { name: 'Title' }),
      ).toBeVisible();
      observation.alarmUiStep = 'readback-alarm-toggle';
      observation.alarmUiAlarmToggleReadback = await editor
        .getByLabel('Calendar app alert')
        .isChecked();
      observation.alarmUiStep = 'readback-relative-option';
      observation.alarmUiRelativeTriggerReadback = await editor
        .getByRole('radio', { name: 'Before the event' })
        .isChecked();
      observation.alarmUiStep = 'readback-offset';
      const allDayEvent = await editor.getByLabel('All day').isChecked();
      const leadMinutes = Number(
        await editor
          .getByRole('spinbutton', { name: 'Minutes before' })
          .inputValue(),
      );
      const expectedLeadMinutes = readbackReference?.expectedAlarmLeadMinutes;
      let timedRangeMatches = allDayEvent;
      let dueMatchesReference = allDayEvent;
      if (!allDayEvent) {
        const startValue = await editor
          .getByRole('textbox', { name: 'Start' })
          .inputValue();
        const endValue = await editor
          .getByRole('textbox', { name: 'End' })
          .inputValue();
        const timezone = await editor
          .getByRole('combobox', { name: 'Time zone' })
          .inputValue();
        const startAt = reminderFixtureLocalDateTimeToUnixMillis(
          startValue,
          timezone,
        );
        const endAt = reminderFixtureLocalDateTimeToUnixMillis(
          endValue,
          timezone,
        );
        const dueAt =
          startAt !== undefined && Number.isSafeInteger(leadMinutes)
            ? startAt - leadMinutes * 60_000
            : undefined;
        const expectedStartAt =
          readbackReference?.expectedDueAt !== undefined &&
          expectedLeadMinutes !== undefined
            ? readbackReference.expectedDueAt + expectedLeadMinutes * 60_000
            : undefined;
        timedRangeMatches =
          startAt !== undefined &&
          endAt !== undefined &&
          endAt - startAt === 60 * 60_000 &&
          timezone === REMINDER_TIMED_TIMEZONE &&
          (expectedStartAt === undefined || startAt === expectedStartAt);
        dueMatchesReference =
          dueAt !== undefined &&
          (readbackReference?.expectedDueAt !== undefined
            ? dueAt === readbackReference.expectedDueAt
            : readbackReference?.deliveredAt !== undefined &&
              readbackReference.deliveredAt >= dueAt &&
              readbackReference.deliveredAt - dueAt <=
                REMINDER_POST_DUE_SCAN_ALLOWANCE_MS);
      }
      observation.alarmUiOffsetReadback =
        Number.isSafeInteger(leadMinutes) &&
        leadMinutes > 0 &&
        leadMinutes <= 48 * 60 + 1 &&
        (expectedLeadMinutes === undefined ||
          leadMinutes === expectedLeadMinutes);
      observation.alarmUiOffsetReadback &&=
        timedRangeMatches && dueMatchesReference;
      observation.alarmUiStep = 'readback-editor-cancelled';
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
      observation.alarmUiStep = 'readback-editor-hidden';
      await expect(editor).toBeHidden({ timeout: 20_000 });
      observation.alarmUiEditorClosed = true;
      const parentDetails = frame.getByRole('dialog').last();
      observation.alarmUiStep = 'details-ready-after-save';
      await expect(parentDetails).toBeVisible();
      observation.alarmUiStep = 'readback-details-hidden';
      await parentDetails
        .getByRole('button', { name: 'Close', exact: true })
        .click();
      await expect(parentDetails).toBeHidden({ timeout: 20_000 });
      observation.alarmUiDetailsClosed = true;
      observation.alarmUiRelativeAlarmReadback =
        observation.alarmUiAlarmToggleReadback &&
        observation.alarmUiRelativeTriggerReadback &&
        observation.alarmUiOffsetReadback;
      return observation.alarmUiRelativeAlarmReadback;
    } catch (error) {
      onReadbackError?.(error);
      return false;
    }
  }

  async function addCalDavAlarmFromReminderSettings(
    frame: FrameLocator,
    page: Page,
    title: string,
    leadMinutes: number,
    observation: Pick<
      ReminderAlarmUiObservation,
      | 'alarmUiStep'
      | 'alarmUiPatchStatus'
      | 'alarmUiEditorClosed'
      | 'alarmUiDetailsClosed'
    >,
  ): Promise<boolean> {
    try {
      const row = frame.getByRole('listitem', { name: title });
      observation.alarmUiStep = 'event-row-visible';
      await expect(row).toBeVisible();
      observation.alarmUiStep = 'event-open';
      await row.click();
      const details = frame.getByRole('dialog').last();
      observation.alarmUiStep = 'details-ready';
      await expect(details).toBeVisible();
      observation.alarmUiStep = 'settings-open';
      await details
        .getByRole('button', { name: 'Matrix room notifications', exact: true })
        .click();
      const editCalDavButton = details.getByRole('button', {
        name: 'Edit calendar app alert',
        exact: true,
      });
      observation.alarmUiStep = 'edit-button-ready';
      await expect(editCalDavButton).toBeVisible({ timeout: 20_000 });
      await editCalDavButton.click();

      const editor = frame.getByRole('dialog', {
        name: 'Edit event',
        exact: true,
      });
      observation.alarmUiStep = 'editor-ready';
      await expect(editor).toBeVisible();
      const alarmToggle = editor.getByLabel('Calendar app alert');
      observation.alarmUiStep = 'alarm-toggle-read';
      if (!(await alarmToggle.isChecked())) {
        observation.alarmUiStep = 'alarm-toggle-enabled';
        await alarmToggle.check();
      }
      observation.alarmUiStep = 'relative-option-selected';
      await editor.getByRole('radio', { name: 'Before the event' }).check();
      observation.alarmUiStep = 'offset-entered';
      await editor
        .getByRole('spinbutton', { name: 'Minutes before' })
        .fill(String(leadMinutes));
      const saveResponse = page.waitForResponse(
        (response) => {
          const url = new URL(response.url());
          return (
            url.origin === new URL(supportContext.fixture.gatewayUrl).origin &&
            url.pathname === '/v1/calendar/events' &&
            response.request().method() === 'PATCH'
          );
        },
        { timeout: 30_000 },
      );
      observation.alarmUiStep = 'save-response-armed';
      await editor.getByRole('button', { name: 'Save', exact: true }).click();
      observation.alarmUiStep = 'save-clicked';
      const response = await saveResponse;
      observation.alarmUiPatchStatus = response.status();
      observation.alarmUiStep = 'patch-response-received';
      observation.alarmUiStep = 'editor-hidden';
      await expect(editor).toBeHidden({ timeout: 20_000 });
      observation.alarmUiEditorClosed = true;
      const parentDetails = frame.getByRole('dialog').last();
      observation.alarmUiStep = 'details-ready-after-save';
      await expect(parentDetails).toBeVisible();
      await parentDetails
        .getByRole('button', { name: 'Close', exact: true })
        .click();
      observation.alarmUiStep = 'details-hidden';
      await expect(parentDetails).toBeHidden({ timeout: 20_000 });
      observation.alarmUiDetailsClosed = true;
      return response.status() >= 200 && response.status() < 300;
    } catch {
      return false;
    }
  }

  async function setRoomReminder(
    frame: FrameLocator,
    page: Page,
    title: string,
    plan: ReminderPlan,
  ): Promise<{
    enabled: boolean;
    httpStatus: number | null;
    dueAt?: number;
  }> {
    const row = frame.getByRole('listitem', { name: title });
    const details = frame.getByRole('dialog').last();
    const observation: ReminderConfigurationObservation = {
      reminderStep: 'event-details',
      reminderSettingsButtonCount: 0,
      reminderSettingsButtonVisible: false,
      reminderOptionsGetCount: 0,
      reminderOptionsGetStatus: 0,
      reminderConfigGetCount: 0,
      reminderConfigGetStatus: 0,
      recipientRosterGetCount: 0,
      recipientRosterHttpStatus: 0,
      recipientRosterCount: 0,
      recipientRosterShapeValid: false,
      recipientRosterTargetPresent: false,
      recipientRosterOutcome: 'unobserved',
      reminderDestinationControlCount: 0,
      recipientKind: 'unknown',
      recipientSelectionAttempted: false,
      recipientSelectionStep: 'destination-clicked',
      recipientOptionCount: 0,
      memberInputProbeInstalled: false,
      memberInputDomCount: 0,
      memberInputAriaExpanded: 'not-observed',
      memberInputControlsTokenCount: 0,
      memberInputControlsNodePresent: false,
      memberInputControlsListbox: false,
      memberListboxDomCount: 0,
      memberOptionDomCount: 0,
      memberListboxOwnAriaHidden: 'not-observed',
      memberListboxAncestorAriaHidden: 'not-observed',
      memberListboxOwnInert: 'not-observed',
      memberListboxAncestorInert: 'not-observed',
      memberListboxCssVisibility: 'not-observed',
      memberNoOptionsTextPresent: false,
      memberLoadErrorVisible: false,
      memberPickerObservationError: 'none',
      memberQueryMatchesTargetAfterFill: false,
      memberQueryMatchesTargetAtOptionCount: false,
      memberInputFocusedBeforeFill: false,
      memberDocumentFocusedBeforeFill: false,
      memberInputFocusedAfterFill: false,
      memberDocumentFocusedAfterFill: false,
      memberInputEventMatchedTarget: false,
      memberInputBlurEventCount: 0,
      memberInputSameNodeAfterFill: false,
      memberListboxCount: 0,
      memberInputControlsUniqueListbox: false,
      memberOptionCount: 0,
      memberOptionsContainingTargetIdCount: 0,
      selectedMemberTagCount: 0,
      selectedMemberKeyboardFlow: false,
      reminderTargetMatches: false,
      allDayScheduleMatches: false,
      narrowSidePanelSafe: false,
      narrowViewportWithinRange: 'not-observed',
      narrowDialogWithinViewport: 'not-observed',
      narrowDialogContentsFit: 'not-observed',
      narrowDocumentContentsFit: 'not-observed',
      narrowViewportWidth: 'not-observed',
      narrowDialogWidth: 'not-observed',
      narrowDialogClientWidth: 'not-observed',
      narrowDialogScrollWidth: 'not-observed',
      narrowDocumentClientWidth: 'not-observed',
      narrowDocumentScrollWidth: 'not-observed',
      reminderPutCount: 0,
      reminderPutStatus: 0,
    };
    let effectivePlan = plan;
    let dueAt: number | undefined;
    let latestRecipientRosterRequest: Request | undefined;
    let latestRecipientRosterResponse: Response | undefined;
    let sampleMemberPickerDomState: (() => Promise<void>) | undefined;
    const noteMemberPickerObservationError = (
      error: Exclude<MemberPickerObservationError, 'none' | 'multiple'>,
    ) => {
      if (
        observation.memberPickerObservationError === 'none' ||
        observation.memberPickerObservationError === error
      ) {
        observation.memberPickerObservationError = error;
      } else {
        observation.memberPickerObservationError = 'multiple';
      }
    };
    const roomPath = `/v1/calendar/rooms/${supportContext.fixture.teamRoomId}/reminders`;
    const gatewayOrigin = new URL(supportContext.fixture.gatewayUrl).origin;
    const classifyRequest = (urlValue: string, method: string) => {
      try {
        const url = new URL(urlValue);
        if (url.origin !== gatewayOrigin) return undefined;
        const pathname = decodeURIComponent(url.pathname);
        if (method === 'GET' && pathname === `${roomPath}/recipients`) {
          return 'recipients' as const;
        }
        if (method === 'GET' && pathname === `${roomPath}/options`) {
          return 'options' as const;
        }
        if (method === 'GET' && pathname === roomPath) {
          return 'config' as const;
        }
        if (method === 'PUT' && pathname === roomPath) {
          return 'put' as const;
        }
      } catch {
        return undefined;
      }
      return undefined;
    };
    const onRequest = (request: Request) => {
      const kind = classifyRequest(request.url(), request.method());
      if (kind === 'recipients') {
        observation.recipientRosterGetCount = Math.min(
          observation.recipientRosterGetCount + 1,
          2,
        );
        latestRecipientRosterRequest = request;
        latestRecipientRosterResponse = undefined;
        observation.recipientRosterHttpStatus = 0;
        observation.recipientRosterCount = 0;
        observation.recipientRosterShapeValid = false;
        observation.recipientRosterTargetPresent = false;
        observation.recipientRosterOutcome = 'unobserved';
      } else if (kind === 'options') {
        observation.reminderOptionsGetCount = Math.min(
          observation.reminderOptionsGetCount + 1,
          2,
        );
      } else if (kind === 'config') {
        observation.reminderConfigGetCount = Math.min(
          observation.reminderConfigGetCount + 1,
          2,
        );
      } else if (kind === 'put') {
        observation.reminderPutCount = Math.min(
          observation.reminderPutCount + 1,
          2,
        );
        try {
          const body: unknown = request.postDataJSON();
          const target =
            isRecord(body) && isRecord(body.target) ? body.target : undefined;
          if (target?.kind === 'room') {
            observation.reminderTargetMatches = plan.recipient === 'room';
          } else if (
            target?.kind === 'users' &&
            Array.isArray(target.userIds)
          ) {
            observation.reminderTargetMatches =
              plan.recipient === 'selected' &&
              target.userIds.length === 1 &&
              target.userIds[0] === supportContext.fixture.users.memberB.userId;
          }
          const allDaySchedule = isRecord(body)
            ? body.allDaySchedule
            : undefined;
          if (effectivePlan.allDay) {
            observation.allDayScheduleMatches =
              Boolean(effectivePlan.allDaySchedule) &&
              isRecord(allDaySchedule) &&
              allDaySchedule.daysBefore ===
                effectivePlan.allDaySchedule?.daysBefore &&
              allDaySchedule.localTime ===
                effectivePlan.allDaySchedule?.localTime &&
              allDaySchedule.timezone ===
                effectivePlan.allDaySchedule?.timezone;
          } else {
            observation.allDayScheduleMatches = allDaySchedule === null;
          }
        } catch {
          observation.reminderTargetMatches = false;
          observation.allDayScheduleMatches = false;
        }
      }
    };
    const onResponse = (response: Response) => {
      const kind = classifyRequest(response.url(), response.request().method());
      if (
        kind === 'recipients' &&
        response.request() === latestRecipientRosterRequest
      ) {
        observation.recipientRosterHttpStatus = response.status();
        latestRecipientRosterResponse = response;
      } else if (kind === 'options') {
        observation.reminderOptionsGetStatus = response.status();
      } else if (kind === 'config') {
        observation.reminderConfigGetStatus = response.status();
      } else if (kind === 'put') {
        observation.reminderPutStatus = response.status();
      }
    };
    const onRequestFailed = (request: Request) => {
      if (
        classifyRequest(request.url(), request.method()) === 'recipients' &&
        request === latestRecipientRosterRequest
      ) {
        observation.recipientRosterHttpStatus = 0;
        observation.recipientRosterCount = 0;
        observation.recipientRosterShapeValid = false;
        observation.recipientRosterTargetPresent = false;
        observation.recipientRosterOutcome = 'http_error';
      }
    };
    const sampleRecipientRosterResponse = async () => {
      const response = latestRecipientRosterResponse;
      if (!response) return;

      const status = response.status();
      observation.recipientRosterHttpStatus = status;
      if (status < 200 || status >= 300) {
        observation.recipientRosterCount = 0;
        observation.recipientRosterShapeValid = false;
        observation.recipientRosterTargetPresent = false;
        observation.recipientRosterOutcome = 'http_error';
        return;
      }

      try {
        const roster = summarizeReminderRecipientRoster(
          await response.json(),
          supportContext.fixture.users.memberB.userId,
        );
        observation.recipientRosterCount = roster.recipientRosterCount;
        observation.recipientRosterShapeValid =
          roster.recipientRosterShapeValid;
        observation.recipientRosterTargetPresent =
          roster.recipientRosterTargetPresent;
        observation.recipientRosterOutcome = roster.recipientRosterOutcome;
      } catch {
        observation.recipientRosterCount = 0;
        observation.recipientRosterShapeValid = false;
        observation.recipientRosterTargetPresent = false;
        observation.recipientRosterOutcome = 'invalid_shape';
      }
    };
    const writeFailure = async () => {
      await sampleRecipientRosterResponse();
      await sampleMemberPickerDomState?.();
      const httpStatus =
        observation.reminderPutStatus ||
        observation.reminderOptionsGetStatus ||
        observation.reminderConfigGetStatus ||
        undefined;
      record(supportContext.activePhase, 'failed', httpStatus, undefined, {
        ...observation,
        reminderEnabled: false,
      });
      supportContext.activeReminderFailureRecorded = true;
    };

    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('requestfailed', onRequestFailed);
    try {
      await expect(row).toBeVisible();
      await row.click();
      await expect(details).toBeVisible();
      observation.reminderStep = 'settings-control';
      const settingsButton = details.getByRole('button', {
        name: 'Matrix room notifications',
        exact: true,
      });
      observation.reminderSettingsButtonCount = Math.min(
        await settingsButton.count(),
        2,
      );
      observation.reminderSettingsButtonVisible =
        observation.reminderSettingsButtonCount === 1 &&
        (await settingsButton.isVisible().catch(() => false));
      if (!observation.reminderSettingsButtonVisible) {
        throw new Error('Reminder settings control is unavailable');
      }

      observation.reminderStep = 'options-load';
      await settingsButton.click();
      const destination = details.getByRole('combobox', {
        name: 'Who to notify in this room',
      });
      await destination
        .waitFor({ state: 'visible', timeout: 20_000 })
        .catch(() => {});
      observation.reminderDestinationControlCount = Math.min(
        await destination.count(),
        2,
      );
      if (
        observation.reminderDestinationControlCount !== 1 ||
        observation.reminderOptionsGetCount === 0 ||
        observation.reminderConfigGetCount === 0 ||
        observation.reminderOptionsGetStatus < 200 ||
        observation.reminderOptionsGetStatus >= 300 ||
        observation.reminderConfigGetStatus < 200 ||
        observation.reminderConfigGetStatus >= 300
      ) {
        observation.reminderStep = 'destination-control';
        throw new Error('Matrix reminder destination control is unavailable');
      }

      const layout = await details.evaluate(
        (element, viewportBounds) => {
          const viewportWidth = document.documentElement.clientWidth;
          const dialogWidth = element.getBoundingClientRect().width;
          const dialogClientWidth = element.clientWidth;
          const dialogScrollWidth = element.scrollWidth;
          const documentClientWidth = document.documentElement.clientWidth;
          const documentScrollWidth = document.documentElement.scrollWidth;
          const viewportWithinRange =
            viewportWidth >= viewportBounds.minimum &&
            viewportWidth <= viewportBounds.maximum;
          const dialogWithinViewport = dialogWidth <= viewportWidth + 1;
          const dialogContentsFit = dialogScrollWidth <= dialogClientWidth + 1;
          const documentContentsFit = documentScrollWidth <= viewportWidth + 1;
          const safe =
            viewportWidth >= viewportBounds.minimum &&
            viewportWidth <= viewportBounds.maximum &&
            dialogWidth <= viewportWidth + 1 &&
            dialogScrollWidth <= dialogClientWidth + 1 &&
            documentScrollWidth <= viewportWidth + 1;
          // Keep raw dimensions for validation; only sanitizer output is rounded.
          const boundedDimension = (value: number): number | 'not-observed' =>
            Number.isFinite(value) && value >= 0 && value <= 100_000
              ? value
              : 'not-observed';

          return {
            safe,
            viewportWithinRange,
            dialogWithinViewport,
            dialogContentsFit,
            documentContentsFit,
            viewportWidth: boundedDimension(viewportWidth),
            dialogWidth: boundedDimension(dialogWidth),
            dialogClientWidth: boundedDimension(dialogClientWidth),
            dialogScrollWidth: boundedDimension(dialogScrollWidth),
            documentClientWidth: boundedDimension(documentClientWidth),
            documentScrollWidth: boundedDimension(documentScrollWidth),
          };
        },
        {
          minimum: MIN_REMINDER_LAYOUT_VIEWPORT_WIDTH,
          maximum: MAX_REMINDER_LAYOUT_VIEWPORT_WIDTH,
        },
      );
      observation.narrowSidePanelSafe = layout.safe;
      observation.narrowViewportWithinRange = layout.viewportWithinRange;
      observation.narrowDialogWithinViewport = layout.dialogWithinViewport;
      observation.narrowDialogContentsFit = layout.dialogContentsFit;
      observation.narrowDocumentContentsFit = layout.documentContentsFit;
      observation.narrowViewportWidth = layout.viewportWidth;
      observation.narrowDialogWidth = layout.dialogWidth;
      observation.narrowDialogClientWidth = layout.dialogClientWidth;
      observation.narrowDialogScrollWidth = layout.dialogScrollWidth;
      observation.narrowDocumentClientWidth = layout.documentClientWidth;
      observation.narrowDocumentScrollWidth = layout.documentScrollWidth;

      observation.reminderStep = 'recipient-selection';
      observation.recipientSelectionAttempted = true;
      observation.recipientKind = plan.recipient;
      observation.recipientSelectionStep = 'destination-clicked';
      await destination.click();
      // MUI renders Select and Autocomplete listboxes in a frame-level portal,
      // outside the event details dialog subtree.
      const destinationListbox = frame
        .getByRole('listbox')
        .filter({ visible: true });
      observation.recipientSelectionStep = 'destination-listbox-ready';
      await expect(destinationListbox).toHaveCount(1, { timeout: 15_000 });
      const destinationListboxId = await destinationListbox.evaluateAll(
        (listboxes) =>
          listboxes.length === 1 && listboxes[0].id.length > 0
            ? listboxes[0].id
            : undefined,
      );
      expect(destinationListboxId).toBeTruthy();
      const selectedDestinationListbox = frame.locator(
        `[id=${JSON.stringify(destinationListboxId)}]`,
      );
      const destinationOption = destinationListbox.getByRole('option', {
        name: plan.recipient === 'room' ? 'Whole room' : 'Selected people',
        exact: true,
      });
      observation.recipientOptionCount = Math.min(
        await destinationOption.count(),
        2,
      );
      observation.recipientSelectionStep = 'destination-option-selected';
      await destinationOption.click();
      observation.recipientSelectionStep = 'destination-menu-close-wait';
      await selectedDestinationListbox.waitFor({
        state: 'hidden',
        timeout: 15_000,
      });
      observation.recipientSelectionStep = 'destination-menu-closed';
      let selectedMemberKeyboardFlow = false;
      if (plan.recipient === 'selected') {
        const memberInput = details.getByRole('combobox', {
          name: 'Selected people',
        });
        const memberListbox = frame
          .getByRole('listbox')
          .filter({ visible: true });
        sampleMemberPickerDomState = async () => {
          try {
            const sample = await memberInput.evaluateAll((inputs) => {
              const capCount = (count: number) => Math.min(count, 2);
              if (inputs.length !== 1) {
                return {
                  observationError:
                    inputs.length === 0
                      ? ('input-missing' as const)
                      : ('input-not-unique' as const),
                  inputDomCount: capCount(inputs.length),
                  inputAriaExpanded: 'not-observed' as const,
                  controlsTokenCount: 0,
                  controlsNodePresent: false,
                  controlsListbox: false,
                  listboxDomCount: 0,
                  optionDomCount: 0,
                  listboxOwnAriaHidden: 'not-observed' as const,
                  listboxAncestorAriaHidden: 'not-observed' as const,
                  listboxOwnInert: 'not-observed' as const,
                  listboxAncestorInert: 'not-observed' as const,
                  listboxCssVisibility: 'not-observed' as const,
                  noOptionsTextPresent: false,
                  loadErrorVisible: false,
                };
              }

              const input = inputs[0];
              const doc = input.ownerDocument;
              const mapAriaHidden = (
                element: Element | null,
              ): MemberAriaHiddenState => {
                if (!element) return 'not-observed';
                const value = element.getAttribute('aria-hidden');
                if (value === null) return 'absent';
                if (value === 'true' || value === 'false') return value;
                return 'other';
              };
              const ancestorAriaHidden = (
                element: Element | null,
              ): MemberAriaHiddenState => {
                if (!element) return 'not-observed';
                let ancestor = element.parentElement;
                let depth = 0;
                let foundOther = false;
                for (; ancestor && depth < 32; depth += 1) {
                  const value = ancestor.getAttribute('aria-hidden');
                  if (value === 'true') return 'true';
                  if (value !== null && value !== 'false') foundOther = true;
                  ancestor = ancestor.parentElement;
                }
                if (ancestor) return 'other';
                return foundOther ? 'other' : 'false';
              };
              const inertState = (
                element: Element | null,
              ): MemberInertState => {
                if (!element) return 'not-observed';
                const isInert =
                  element.hasAttribute('inert') ||
                  ('inert' in element &&
                    Boolean(
                      (element as HTMLElement & { inert?: boolean }).inert,
                    ));
                return isInert ? 'true' : 'false';
              };
              const ancestorInert = (
                element: Element | null,
              ): MemberInertState => {
                if (!element) return 'not-observed';
                let ancestor = element.parentElement;
                let depth = 0;
                for (; ancestor && depth < 32; depth += 1) {
                  if (
                    ancestor.hasAttribute('inert') ||
                    ('inert' in ancestor &&
                      Boolean(
                        (ancestor as HTMLElement & { inert?: boolean }).inert,
                      ))
                  ) {
                    return 'true';
                  }
                  ancestor = ancestor.parentElement;
                }
                return ancestor ? 'not-observed' : 'false';
              };
              const cssVisibility = (
                element: Element | null,
              ): MemberCssVisibility => {
                if (!element) return 'not-observed';
                if (!doc.defaultView) return 'unknown';
                let current: Element | null = element;
                let depth = 0;
                for (; current && depth < 32; depth += 1) {
                  const style = doc.defaultView.getComputedStyle(current);
                  if (
                    current.hasAttribute('hidden') ||
                    style.display === 'none' ||
                    style.visibility === 'hidden' ||
                    style.visibility === 'collapse' ||
                    style.opacity === '0'
                  ) {
                    return 'hidden';
                  }
                  current = current.parentElement;
                }
                return current ? 'unknown' : 'visible';
              };
              const controls =
                input
                  .getAttribute('aria-controls')
                  ?.trim()
                  .split(/\s+/u)
                  .filter(Boolean) ?? [];
              const controlledNode =
                controls.length === 1 ? doc.getElementById(controls[0]) : null;
              const listboxes = Array.from(
                doc.querySelectorAll('[role="listbox"]'),
              );
              const alertNodes = Array.from(
                doc.querySelectorAll('[role="alert"]'),
              );
              const loadErrorVisible = alertNodes.some(
                (alert) =>
                  /could not load joined room members/iu.test(
                    alert.textContent ?? '',
                  ) && cssVisibility(alert) === 'visible',
              );
              const controlledText = controlledNode?.textContent
                ?.replace(/\s+/gu, ' ')
                .trim();
              const expanded = input.getAttribute('aria-expanded');

              return {
                observationError: 'none' as const,
                inputDomCount: 1,
                inputAriaExpanded: (expanded === null
                  ? 'absent'
                  : expanded === 'true' || expanded === 'false'
                    ? expanded
                    : 'other') as MemberInputExpandedState,
                controlsTokenCount: capCount(controls.length),
                controlsNodePresent: controlledNode !== null,
                controlsListbox:
                  controlledNode?.getAttribute('role') === 'listbox',
                listboxDomCount: capCount(listboxes.length),
                optionDomCount: capCount(
                  controlledNode?.querySelectorAll('[role="option"]').length ??
                    0,
                ),
                listboxOwnAriaHidden: mapAriaHidden(controlledNode),
                listboxAncestorAriaHidden: ancestorAriaHidden(controlledNode),
                listboxOwnInert: inertState(controlledNode),
                listboxAncestorInert: ancestorInert(controlledNode),
                listboxCssVisibility: cssVisibility(controlledNode),
                noOptionsTextPresent: Boolean(
                  controlledText &&
                  /^(?:no options(?: available)?|no matching members)$/iu.test(
                    controlledText,
                  ),
                ),
                loadErrorVisible,
              };
            });

            observation.memberInputDomCount = sample.inputDomCount;
            observation.memberInputAriaExpanded = sample.inputAriaExpanded;
            observation.memberInputControlsTokenCount =
              sample.controlsTokenCount;
            observation.memberInputControlsNodePresent =
              sample.controlsNodePresent;
            observation.memberInputControlsListbox = sample.controlsListbox;
            observation.memberListboxDomCount = sample.listboxDomCount;
            observation.memberOptionDomCount = sample.optionDomCount;
            observation.memberListboxOwnAriaHidden =
              sample.listboxOwnAriaHidden;
            observation.memberListboxAncestorAriaHidden =
              sample.listboxAncestorAriaHidden;
            observation.memberListboxOwnInert = sample.listboxOwnInert;
            observation.memberListboxAncestorInert =
              sample.listboxAncestorInert;
            observation.memberListboxCssVisibility =
              sample.listboxCssVisibility;
            observation.memberNoOptionsTextPresent =
              sample.noOptionsTextPresent;
            observation.memberLoadErrorVisible = sample.loadErrorVisible;
            if (sample.observationError !== 'none') {
              noteMemberPickerObservationError(sample.observationError);
            }
          } catch {
            noteMemberPickerObservationError('dom-sample');
          }
        };
        const measureMemberInputListboxAssociation = async () => {
          let controls: string | null;
          try {
            controls = await memberInput.evaluateAll((inputs) =>
              inputs.length === 1
                ? inputs[0].getAttribute('aria-controls')
                : null,
            );
          } catch {
            noteMemberPickerObservationError('input-association');
            return false;
          }
          let controlledIds: string[];
          try {
            controlledIds = await memberListbox.evaluateAll((listboxes) =>
              listboxes.map((listbox) => listbox.id),
            );
          } catch {
            noteMemberPickerObservationError('listbox-association');
            return false;
          }
          const tokens = controls?.trim().split(/\s+/u) ?? [];
          return (
            tokens.length === 1 &&
            tokens[0].length > 0 &&
            controlledIds.length === 1 &&
            controlledIds[0] === tokens[0]
          );
        };
        const expectedMemberUserId =
          supportContext.fixture.users.memberB.userId;
        const memberInputProbeKey = '__calendarRoomReminderInputProbe';
        observation.recipientSelectionStep = 'member-input-probe-install';
        const beforeFill = await memberInput
          .evaluateAll(
            (inputs, { expectedUserId, probeKey }) => {
              if (inputs.length !== 1) return undefined;
              const input = inputs[0] as HTMLInputElement;
              type InputProbe = {
                input: HTMLInputElement;
                matchedTargetValue: boolean;
                blurEventCount: number;
                onInput: () => void;
                onBlur: () => void;
              };
              const probe: InputProbe = {
                input,
                matchedTargetValue: false,
                blurEventCount: 0,
                onInput: () => undefined,
                onBlur: () => undefined,
              };
              probe.onInput = () => {
                if (input.value === expectedUserId) {
                  probe.matchedTargetValue = true;
                }
              };
              probe.onBlur = () => {
                probe.blurEventCount = Math.min(probe.blurEventCount + 1, 2);
              };
              input.addEventListener('input', probe.onInput, true);
              input.addEventListener('blur', probe.onBlur, true);
              (window as unknown as Record<string, unknown>)[probeKey] = probe;
              return {
                inputFocused: document.activeElement === input,
                documentFocused: document.hasFocus(),
              };
            },
            {
              expectedUserId: expectedMemberUserId,
              probeKey: memberInputProbeKey,
            },
          )
          .catch(() => undefined);
        observation.memberInputProbeInstalled = beforeFill !== undefined;
        if (!beforeFill) {
          noteMemberPickerObservationError('input-probe-install');
        }
        if (beforeFill) {
          observation.memberInputFocusedBeforeFill = beforeFill.inputFocused;
          observation.memberDocumentFocusedBeforeFill =
            beforeFill.documentFocused;
        }

        try {
          observation.recipientSelectionStep = 'member-input-clicked';
          await memberInput.click({ timeout: 15_000 });
          observation.recipientSelectionStep = 'member-query-entered';
          await memberInput.fill(expectedMemberUserId);
          await expect(memberInput).toHaveValue(expectedMemberUserId, {
            timeout: 15_000,
          });
          observation.recipientSelectionStep = 'member-query-settled';
        } finally {
          const afterFill = await memberInput
            .evaluateAll(
              (inputs, { expectedUserId, probeKey }) => {
                type InputProbe = {
                  input: HTMLInputElement;
                  matchedTargetValue: boolean;
                  blurEventCount: number;
                  onInput: () => void;
                  onBlur: () => void;
                };
                const probe = (window as unknown as Record<string, unknown>)[
                  probeKey
                ] as InputProbe | undefined;
                const input = inputs.length === 1 ? inputs[0] : undefined;
                const result = {
                  queryMatchesTarget:
                    input instanceof HTMLInputElement &&
                    input.value === expectedUserId,
                  inputFocused:
                    input instanceof HTMLInputElement &&
                    document.activeElement === input,
                  documentFocused: document.hasFocus(),
                  inputEventMatchedTarget: probe?.matchedTargetValue ?? false,
                  blurEventCount: Math.min(probe?.blurEventCount ?? 0, 2),
                  sameInputNode: Boolean(
                    input instanceof HTMLInputElement &&
                    probe &&
                    input === probe.input,
                  ),
                };
                if (probe) {
                  probe.input.removeEventListener('input', probe.onInput, true);
                  probe.input.removeEventListener('blur', probe.onBlur, true);
                  delete (window as unknown as Record<string, unknown>)[
                    probeKey
                  ];
                }
                return result;
              },
              {
                expectedUserId: expectedMemberUserId,
                probeKey: memberInputProbeKey,
              },
            )
            .catch(() => undefined);
          if (!afterFill) {
            noteMemberPickerObservationError('input-probe-read');
          }
          if (afterFill) {
            observation.memberQueryMatchesTargetAfterFill =
              afterFill.queryMatchesTarget;
            observation.memberInputFocusedAfterFill = afterFill.inputFocused;
            observation.memberDocumentFocusedAfterFill =
              afterFill.documentFocused;
            observation.memberInputEventMatchedTarget =
              afterFill.inputEventMatchedTarget;
            observation.memberInputBlurEventCount = afterFill.blurEventCount;
            observation.memberInputSameNodeAfterFill = afterFill.sameInputNode;
          }
        }
        await sampleMemberPickerDomState?.();
        observation.recipientSelectionStep = 'member-listbox-ready';
        try {
          observation.memberListboxCount = Math.min(
            await memberListbox.count(),
            2,
          );
        } catch {
          noteMemberPickerObservationError('listbox-count');
          throw new Error('Member listbox observation failed');
        }
        try {
          await expect
            .poll(
              async () => {
                const associated = await measureMemberInputListboxAssociation();
                observation.memberInputControlsUniqueListbox = associated;
                return associated;
              },
              { timeout: 15_000 },
            )
            .toBe(true);
          await expect(memberListbox).toHaveCount(1, { timeout: 15_000 });
        } finally {
          observation.memberListboxCount = await memberListbox
            .count()
            .then((count) => Math.min(count, 2))
            .catch(() => {
              noteMemberPickerObservationError('listbox-final-count');
              return observation.memberListboxCount;
            });
          observation.memberInputControlsUniqueListbox =
            await measureMemberInputListboxAssociation().catch(() => {
              noteMemberPickerObservationError('listbox-association');
              return false;
            });
        }
        expect(observation.memberInputControlsUniqueListbox).toBe(true);
        const memberOptions = memberListbox.getByRole('option');
        const memberOption = memberOptions.first();
        observation.recipientSelectionStep = 'member-option-ready';
        await memberOption.waitFor({ state: 'visible', timeout: 15_000 });
        observation.memberQueryMatchesTargetAtOptionCount =
          (await memberInput.inputValue()) ===
          supportContext.fixture.users.memberB.userId;
        observation.memberOptionCount = Math.min(
          await memberOptions.count(),
          2,
        );
        observation.memberOptionsContainingTargetIdCount = Math.min(
          await memberOptions.evaluateAll(
            (options, expectedId) =>
              options.filter((option) =>
                option.textContent?.includes(expectedId),
              ).length,
            supportContext.fixture.users.memberB.userId,
          ),
          2,
        );
        observation.recipientSelectionStep = 'member-option-count-checked';
        await expect(memberOptions).toHaveCount(1);
        observation.recipientSelectionStep = 'member-arrow-down';
        await memberInput.press('ArrowDown');
        observation.recipientSelectionStep = 'member-enter';
        await memberInput.press('Enter');
        // Enter closes the selected option popup. A second Escape bubbles to the
        // owning Dialog and closes the whole reminder form.
        await expect(memberListbox).toHaveCount(0, { timeout: 15_000 });
        observation.recipientSelectionStep = 'member-keyboard-closed';
        observation.selectedMemberTagCount = Math.min(
          await details.locator('.MuiAutocomplete-tag').count(),
          2,
        );
        selectedMemberKeyboardFlow = observation.selectedMemberTagCount === 1;
        observation.selectedMemberKeyboardFlow = selectedMemberKeyboardFlow;
        expect(selectedMemberKeyboardFlow).toBe(true);
      }
      observation.recipientSelectionStep = 'complete';

      if (plan.allDay && plan.allDayEventDate) {
        const timezone = plan.allDayTimezone ?? REMINDER_ALL_DAY_TIMEZONE;
        const refreshedSchedule = planReminderAllDaySchedule(
          Date.now(),
          plan.allDayEventDate,
          timezone,
        );
        dueAt = refreshedSchedule.dueAt;
        const scheduleValue = refreshedSchedule.scheduleLocalDateTime;
        const localDate = scheduleValue.slice(0, 10);
        const schedule = {
          daysBefore: refreshedSchedule.daysBefore,
          localTime: refreshedSchedule.localTime,
          timezone,
        };
        const reconstructedDueAt = reminderFixtureLocalDateTimeToUnixMillis(
          `${addCalendarDays(plan.allDayEventDate, -schedule.daysBefore)}T${schedule.localTime}`,
          timezone,
        );
        if (
          addCalendarDays(plan.allDayEventDate, -schedule.daysBefore) !==
            localDate ||
          reconstructedDueAt !== dueAt
        ) {
          throw new Error('All-day reminder schedule date is no longer future');
        }
        effectivePlan = { ...plan, allDaySchedule: schedule };
        await details
          .getByRole('spinbutton', { name: 'Days before event' })
          .fill(String(schedule.daysBefore));
        await details.getByLabel('Local time').fill(schedule.localTime);
        const timezoneInput = details.getByRole('combobox', {
          name: 'Notification time zone',
        });
        await timezoneInput.fill(schedule.timezone);
        await timezoneInput.press('Tab');
      }

      observation.reminderStep = 'put-response';
      const putResponse = page
        .waitForResponse(
          (response) =>
            classifyRequest(response.url(), response.request().method()) ===
            'put',
          { timeout: 15_000 },
        )
        .catch(() => undefined);
      await details
        .getByRole('button', { name: 'Save room notification', exact: true })
        .click();
      const response = await putResponse;
      if (response) observation.reminderPutStatus = response.status();
      if (
        observation.reminderPutCount !== 1 ||
        observation.reminderPutStatus < 200 ||
        observation.reminderPutStatus >= 300 ||
        !observation.reminderTargetMatches ||
        !observation.allDayScheduleMatches ||
        (plan.recipient === 'selected' && !selectedMemberKeyboardFlow)
      ) {
        throw new Error(
          'Matrix reminder configuration did not match its target',
        );
      }
      if (plan.recipient === 'selected') {
        observation.reminderStep = 'post-put-layout';
        if (!observation.narrowSidePanelSafe) {
          throw new Error('Selected-recipient layout safety check failed');
        }
        observation.reminderStep = 'put-response';
      }

      await details
        .getByRole('button', {
          name: 'Close Matrix room notifications',
          exact: true,
        })
        .click();
      await settingsButton.click();
      await destination.waitFor({ state: 'visible', timeout: 20_000 });
      const savedDestination = (await destination.innerText()).trim();
      const expectedDestination =
        plan.recipient === 'room' ? 'Whole room' : 'Selected people';
      const savedTargetMatches =
        savedDestination === expectedDestination &&
        (await details
          .getByText(
            plan.recipient === 'room'
              ? 'Matrix pings the whole room.'
              : 'Matrix pings the selected people.',
            { exact: true },
          )
          .isVisible()
          .catch(() => false));
      const savedScheduleFields = await readReminderAllDayScheduleFields(
        details,
        effectivePlan.allDay,
      );
      const savedDaysBefore = savedScheduleFields.daysBefore;
      const savedLocalTime = savedScheduleFields.localTime;
      const savedTimezone = savedScheduleFields.timezone;
      const savedScheduleDate = effectivePlan.allDayEventDate
        ? addCalendarDays(effectivePlan.allDayEventDate, -savedDaysBefore)
        : undefined;
      const savedScheduleDueAt =
        savedScheduleDate && /^\d{2}:\d{2}$/u.test(savedLocalTime)
          ? reminderFixtureLocalDateTimeToUnixMillis(
              `${savedScheduleDate}T${savedLocalTime}`,
              savedTimezone,
            )
          : undefined;
      const savedScheduleMatches = effectivePlan.allDay
        ? dueAt !== undefined &&
          savedDaysBefore === effectivePlan.allDaySchedule?.daysBefore &&
          savedLocalTime === effectivePlan.allDaySchedule?.localTime &&
          savedTimezone === effectivePlan.allDaySchedule?.timezone &&
          savedScheduleDate ===
            addCalendarDays(
              effectivePlan.allDayEventDate!,
              -effectivePlan.allDaySchedule!.daysBefore,
            ) &&
          savedScheduleDueAt === dueAt
        : true;
      observation.reminderTargetMatches &&= savedTargetMatches;
      observation.allDayScheduleMatches &&= savedScheduleMatches;
      if (!savedTargetMatches || !savedScheduleMatches) {
        throw new Error('Saved Matrix reminder settings did not reload');
      }

      await details
        .getByRole('button', {
          name: 'Close Matrix room notifications',
          exact: true,
        })
        .click();
      await details.getByRole('button', { name: 'Close', exact: true }).click();
      observation.reminderStep = 'complete';
      await sampleRecipientRosterResponse();
      record(
        supportContext.activePhase,
        'passed',
        observation.reminderPutStatus,
        1,
        {
          ...observation,
          reminderEnabled: true,
        },
      );
      return {
        enabled: true,
        httpStatus: observation.reminderPutStatus,
        ...(dueAt === undefined ? {} : { dueAt }),
      };
    } catch {
      if (!supportContext.activeReminderFailureRecorded) await writeFailure();
      throw new Error('Room reminder configuration could not be confirmed');
    } finally {
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
    }
  }

  async function readBackReminderMarkers(
    frame: FrameLocator,
    titles: readonly string[],
    readbackReferences: ReadonlyMap<
      string,
      ReminderReadbackReference
    > = new Map(),
    onReadbackError?: (error: unknown) => void,
  ): Promise<{
    count: number;
    relativeAlarmReadback: boolean;
    reminderEnabled: boolean;
    targetSettingsReadback: boolean;
    allDayScheduleReadback: boolean;
  }> {
    let relativeAlarmReadback = true;
    let reminderEnabled = true;
    let targetSettingsReadback = true;
    let allDayScheduleReadback = true;
    for (const [index, title] of titles.entries()) {
      const plan = reminderPlanForMarkerIndex(index);
      const readbackReference = {
        ...readbackReferences.get(title),
        ...(plan.caldavAlarmLeadMinutes === undefined
          ? {}
          : { expectedAlarmLeadMinutes: plan.caldavAlarmLeadMinutes }),
      };
      relativeAlarmReadback =
        (await readBackRelativeAlarm(
          frame,
          title,
          readbackReference,
          undefined,
          onReadbackError,
        )) && relativeAlarmReadback;
      const settings = await readBackMatrixReminder(
        frame,
        title,
        plan,
        readbackReference,
      );
      reminderEnabled = settings.enabled && reminderEnabled;
      targetSettingsReadback = settings.targetMatches && targetSettingsReadback;
      allDayScheduleReadback =
        settings.allDayScheduleMatches && allDayScheduleReadback;
    }
    return {
      count: titles.length,
      relativeAlarmReadback,
      reminderEnabled,
      targetSettingsReadback,
      allDayScheduleReadback,
    };
  }

  async function readBackMatrixReminder(
    frame: FrameLocator,
    title: string,
    plan: ReminderPlan,
    readbackReference?: ReminderReadbackReference,
  ): Promise<{
    enabled: boolean;
    targetMatches: boolean;
    allDayScheduleMatches: boolean;
  }> {
    const row = frame.getByRole('listitem', { name: title });
    await expect(row).toBeVisible();
    await row.click();
    const details = frame.getByRole('dialog').last();
    await expect(details).toBeVisible();
    let eventStartDate: string | undefined;
    let eventEndDate: string | undefined;
    let allDayEvent = !plan.allDay;
    if (plan.allDay) {
      await details.getByRole('button', { name: 'Edit', exact: true }).click();
      const editor = frame.getByRole('dialog', {
        name: 'Edit event',
        exact: true,
      });
      await expect(editor.getByLabel('All day')).toBeVisible();
      allDayEvent = await editor.getByLabel('All day').isChecked();
      eventStartDate = await editor
        .getByRole('textbox', { name: 'Start' })
        .inputValue();
      eventEndDate = await editor
        .getByRole('textbox', { name: 'End' })
        .inputValue();
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(editor).toBeHidden({ timeout: 20_000 });
    }
    await details
      .getByRole('button', { name: 'Matrix room notifications', exact: true })
      .click();
    const destination = details.getByRole('combobox', {
      name: 'Who to notify in this room',
    });
    const available = await destination
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (!available) {
      await details.getByRole('button', { name: 'Close', exact: true }).click();
      return {
        enabled: false,
        targetMatches: false,
        allDayScheduleMatches: !plan.allDay,
      };
    }
    const destinationLabel = (await destination.innerText()).trim();
    const expectedDestination =
      plan.recipient === 'room' ? 'Whole room' : 'Selected people';
    const targetMatches = destinationLabel === expectedDestination;
    const savedState = await details
      .getByText(
        plan.recipient === 'room'
          ? 'Matrix pings the whole room.'
          : 'Matrix pings the selected people.',
        { exact: true },
      )
      .isVisible()
      .catch(() => false);
    const scheduleFields = await readReminderAllDayScheduleFields(
      details,
      plan.allDay,
    );
    const { daysBefore, localTime, timezone } = scheduleFields;
    const scheduleDate = eventStartDate
      ? addCalendarDays(eventStartDate, -daysBefore)
      : undefined;
    const scheduleDueAt =
      scheduleDate && /^\d{2}:\d{2}$/u.test(localTime)
        ? reminderFixtureLocalDateTimeToUnixMillis(
            `${scheduleDate}T${localTime}`,
            timezone,
          )
        : undefined;
    const expectedScheduleMatches =
      reminderFixtureAllDayExpectedScheduleMatches({
        allDay: plan.allDay,
        expectedDueAt: readbackReference?.expectedDueAt,
        eventStartDate,
        daysBefore,
        localTime,
        timeZone: timezone,
      });
    const deliveryMatchesDue =
      scheduleDueAt !== undefined &&
      (readbackReference?.expectedDueAt !== undefined
        ? scheduleDueAt === readbackReference.expectedDueAt &&
          expectedScheduleMatches
        : readbackReference?.deliveredAt !== undefined &&
          readbackReference.deliveredAt >= scheduleDueAt &&
          readbackReference.deliveredAt - scheduleDueAt <=
            REMINDER_POST_DUE_SCAN_ALLOWANCE_MS);
    const allDayScheduleMatches = plan.allDay
      ? allDayEvent &&
        Boolean(
          eventStartDate && /^\d{4}-\d{2}-\d{2}$/u.test(eventStartDate),
        ) &&
        (readbackReference?.expectedAllDayEventDate === undefined ||
          eventStartDate === readbackReference.expectedAllDayEventDate) &&
        eventEndDate === eventStartDate &&
        Number.isSafeInteger(daysBefore) &&
        /^\d{2}:\d{2}$/u.test(localTime) &&
        timezone === plan.allDayTimezone &&
        expectedScheduleMatches &&
        deliveryMatchesDue
      : true;
    await details
      .getByRole('button', {
        name: 'Close Matrix room notifications',
        exact: true,
      })
      .click();
    await details.getByRole('button', { name: 'Close', exact: true }).click();
    return {
      enabled: targetMatches && savedState,
      targetMatches: targetMatches && savedState,
      allDayScheduleMatches,
    };
  }

  async function inspectReminderTimeline(
    titles: readonly string[],
  ): Promise<ReminderTimelineSnapshot> {
    const empty: ReminderTimelineSnapshot = {
      httpStatus: null,
      complete: false,
      markerCounts: titles.map(() => 0),
      markerTargetsMatch: titles.map(() => false),
      markerRoomMentions: titles.map(() => false),
      markerSelectedMemberMentions: titles.map(() => false),
      markerTimestamps: titles.map(() => null),
    };
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      const endpoint = new URL(
        `/_matrix/client/v3/rooms/${encodeURIComponent(supportContext.fixture.teamRoomId)}/messages`,
        supportContext.fixture.homeserverUrl,
      );
      endpoint.searchParams.set('dir', 'b');
      endpoint.searchParams.set('limit', '100');
      response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${supportContext.fixture.serviceSender.accessToken}`,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return empty;
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return { ...empty, httpStatus: response.status };
    }

    let chunk: unknown;
    try {
      const payload: unknown = await response.json();
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !Array.isArray((payload as { chunk?: unknown }).chunk)
      ) {
        return { ...empty, httpStatus: response.status };
      }
      chunk = (payload as { chunk: unknown[] }).chunk;
    } catch {
      return { ...empty, httpStatus: response.status };
    }
    if (!Array.isArray(chunk) || chunk.length >= 100) {
      return { ...empty, httpStatus: response.status };
    }

    const events = chunk.filter(isRecord);
    const markerCounts: number[] = [];
    const markerTargetsMatch: boolean[] = [];
    const markerRoomMentions: boolean[] = [];
    const markerSelectedMemberMentions: boolean[] = [];
    const markerTimestamps: Array<number | null> = [];
    for (const [index, title] of titles.entries()) {
      const matching = events.filter((event) => {
        const content = isRecord(event.content) ? event.content : undefined;
        return (
          event.type === 'm.room.message' &&
          content?.msgtype === 'm.text' &&
          content.body === `Reminder: ${title}`
        );
      });
      markerCounts.push(Math.min(matching.length, 2));
      const serviceEvent =
        matching.length === 1 &&
        matching[0].sender === supportContext.fixture.serviceSender.userId;
      const content =
        serviceEvent && isRecord(matching[0].content)
          ? matching[0].content
          : undefined;
      const mentions =
        content && isRecord(content['m.mentions'])
          ? content['m.mentions']
          : undefined;
      const userIds = mentions?.user_ids;
      const plan = reminderPlanForMarkerIndex(index);
      const roomMention =
        serviceEvent &&
        mentions?.room === true &&
        (!Object.hasOwn(mentions, 'user_ids') ||
          (Array.isArray(userIds) && userIds.length === 0));
      const selectedMemberMention =
        serviceEvent &&
        mentions !== undefined &&
        (!Object.hasOwn(mentions, 'room') || mentions.room === false) &&
        Array.isArray(userIds) &&
        userIds.length === 1 &&
        userIds[0] === supportContext.fixture.users.memberB.userId;
      markerRoomMentions.push(roomMention);
      markerSelectedMemberMentions.push(selectedMemberMention);
      markerTargetsMatch.push(
        plan.recipient === 'room' ? roomMention : selectedMemberMention,
      );
      const timestamp = serviceEvent ? matching[0].origin_server_ts : undefined;
      markerTimestamps.push(
        typeof timestamp === 'number' && Number.isSafeInteger(timestamp)
          ? timestamp
          : null,
      );
    }
    return {
      httpStatus: response.status,
      complete: true,
      markerCounts,
      markerTargetsMatch,
      markerRoomMentions,
      markerSelectedMemberMentions,
      markerTimestamps,
    };
  }

  async function waitForReminderDelivery(
    title: string,
    titles: readonly string[],
    dueAt: number,
  ): Promise<ReminderTimelineSnapshot & { deliveredAfterDue: boolean }> {
    const deadline = dueAt + REMINDER_POST_DUE_SCAN_ALLOWANCE_MS;
    let latest = await inspectReminderTimeline(titles);
    while (Date.now() <= deadline) {
      const markerIndex = titles.indexOf(title);
      if (latest.httpStatus !== 200 || !latest.complete) {
        return { ...latest, deliveredAfterDue: false };
      }
      if ((latest.markerCounts[markerIndex] ?? 0) > 0) {
        const deliveredAt = latest.markerTimestamps[markerIndex];
        return {
          ...latest,
          deliveredAfterDue: deliveredAt !== null && deliveredAt >= dueAt,
        };
      }
      await new Promise((resolve) =>
        setTimeout(resolve, REMINDER_TIMELINE_POLL_MS),
      );
      latest = await inspectReminderTimeline(titles);
    }
    return { ...latest, deliveredAfterDue: false };
  }

  return {
    readReminderFlow,
    readReminderEventTitles,
    createAndConfigureReminder,
    readBackReminderMarkers,
    inspectReminderTimeline,
    waitForReminderDelivery,
  };
}
