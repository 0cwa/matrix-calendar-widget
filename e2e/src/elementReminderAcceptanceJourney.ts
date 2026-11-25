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

import { expect, test, type Browser } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createReminderFlowDiagnosticState } from '../../dev/element-reminder-flow-diagnostics.mjs';
import type {
  ReminderFlow,
  ReminderJourneyContext,
  ReminderReadbackReference,
} from './elementCalendarAcceptance.spec';

export async function runElementReminderAcceptanceJourney(
  browser: Browser,
  journey: ReminderJourneyContext,
): Promise<void> {
  const {
    readReminderFlow,
    enterActiveReminderFlowStage,
    readFixture,
    readReminderEventTitles,
    completeActiveReminderFlowStage,
    failActiveReminderFlow,
    record,
    authenticateInElement,
    observeReminderWidgetContextResponse,
    openMemberARoomWithDiagnostics,
    recordMemberARoomObservation,
    requireMemberARoom,
    openCalendarWidget,
    inspectReminderTimeline,
    readBackReminderMarkers,
    captureReminderFlowReadbackError,
    reminderPlanForMarkerIndex,
    createAndConfigureReminder,
    verifyPublicFeedBrowserLifecycle,
    waitForReminderDelivery,
  } = journey;
  test.setTimeout(360_000);
  journey.activeReminderFlowDiagnostic = undefined;
  journey.activeReminderFailureRecorded = false;
  let flow: ReminderFlow;
  let eventTitles: string[];
  try {
    flow = readReminderFlow();
    journey.activeReminderFlowDiagnostic =
      createReminderFlowDiagnosticState(flow);
    enterActiveReminderFlowStage('fixture');
    journey.fixture = readFixture();
    eventTitles = readReminderEventTitles();
    completeActiveReminderFlowStage('fixture');
  } catch (error) {
    failActiveReminderFlow(error);
    record('reminder-ui-readback', 'failed', undefined, 0);
    throw new Error('Reminder acceptance journey.fixture state is unavailable');
  }
  const expectedPriorCount =
    flow === 'initial' ? 0 : flow === 'restart' ? 1 : 2;
  if (eventTitles.length !== expectedPriorCount) {
    failActiveReminderFlow(
      new Error('Reminder acceptance journey.fixture state is inconsistent'),
    );
    record('reminder-ui-readback', 'failed', undefined, eventTitles.length);
    throw new Error(
      'Reminder acceptance journey.fixture state is inconsistent',
    );
  }

  enterActiveReminderFlowStage('room-context');
  const allowedOrigins = new Set([
    new URL(journey.fixture.elementUrl).origin,
    new URL(journey.fixture.homeserverUrl).origin,
    'http://localhost:8008',
    new URL(journey.fixture.gatewayUrl).origin,
    new URL(journey.fixture.widgetUrl).origin,
  ]);
  let blockedRequests = 0;
  let failureHttpStatus: number | undefined;
  let failureAlreadyRecorded = false;
  const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'Europe/Stockholm',
    viewport: { width: 1440, height: 900 },
  });

  try {
    await context.route('**/*', async (route) => {
      let requestOrigin: string;
      try {
        requestOrigin = new URL(route.request().url()).origin;
      } catch {
        blockedRequests = Math.min(blockedRequests + 1, 100_000);
        await route.abort('blockedbyclient');
        return;
      }
      if (!allowedOrigins.has(requestOrigin)) {
        blockedRequests = Math.min(blockedRequests + 1, 100_000);
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });

    journey.activePhase = 'member-a-authenticated';
    const page = await authenticateInElement(
      context,
      journey.fixture.users.memberA,
    );
    record(journey.activePhase, 'passed');
    journey.activePhase = 'reminder-room-context';
    const reminderContextResponseObserver =
      observeReminderWidgetContextResponse(page, journey.fixture.teamRoomId);
    void reminderContextResponseObserver.response.catch(() => undefined);
    const reminderRoom = await openMemberARoomWithDiagnostics(
      page,
      journey.fixture.roomName,
      journey.fixture.teamRoomId,
      journey.fixture.users.memberA.userId,
      { captureReminderRoomLayout: true },
    );
    recordMemberARoomObservation(
      reminderRoom,
      'reminder-room-context',
      reminderContextResponseObserver.snapshot(),
    );
    failureAlreadyRecorded = Boolean(reminderRoom.failureCode);
    const element = requireMemberARoom(reminderRoom);

    journey.activePhase = 'reminder-widget-context';
    const frame = await openCalendarWidget(element, page, {
      expectWidgetWarning: false,
    });
    if (flow === 'restart') {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(
        frame.getByRole('button', { name: 'Create event', exact: true }),
      ).toBeVisible();
    }
    const contextResult = await reminderContextResponseObserver.response;
    failureHttpStatus = contextResult.status();
    const contextPayload: unknown = await contextResult
      .json()
      .catch(() => null);
    const canManageReminders =
      contextPayload !== null &&
      typeof contextPayload === 'object' &&
      'roomCalendar' in contextPayload &&
      contextPayload.roomCalendar !== null &&
      typeof contextPayload.roomCalendar === 'object' &&
      'canManageReminders' in contextPayload.roomCalendar &&
      contextPayload.roomCalendar.canManageReminders === true;
    if (failureHttpStatus !== 200 || !canManageReminders) {
      record(journey.activePhase, 'failed', failureHttpStatus, undefined, {
        canManageReminders,
      });
      failureAlreadyRecorded = true;
      throw new Error('Reminder room context was not authorized');
    }
    record(journey.activePhase, 'passed', failureHttpStatus, undefined, {
      canManageReminders,
    });
    failureHttpStatus = undefined;
    completeActiveReminderFlowStage('room-context');

    const priorReminderReadbackReferences = new Map<
      string,
      ReminderReadbackReference
    >();
    if (eventTitles.length > 0 && flow !== 'initial') {
      enterActiveReminderFlowStage('prior-state');
      journey.activePhase =
        flow === 'restart'
          ? 'reminder-restart-prior-state'
          : 'reminder-restore-prior-state';
      const timeline = await inspectReminderTimeline(eventTitles);
      const markersOnce =
        timeline.complete &&
        timeline.markerCounts.every((count) => count === 1) &&
        timeline.markerTargetsMatch.every(Boolean);
      if (timeline.httpStatus !== 200 || !markersOnce) {
        record(
          journey.activePhase,
          'failed',
          timeline.httpStatus ?? undefined,
          eventTitles.length,
          { allMarkersOnce: markersOnce },
        );
        failureAlreadyRecorded = true;
        throw new Error(
          flow === 'restart'
            ? 'Restarted reminder markers were not preserved'
            : 'Restored reminder markers were not preserved',
        );
      }
      record(
        journey.activePhase,
        'passed',
        timeline.httpStatus,
        eventTitles.length,
        {
          allMarkersOnce: true,
        },
      );
      completeActiveReminderFlowStage('prior-state');
      for (const [index, title] of eventTitles.entries()) {
        const deliveredAt = timeline.markerTimestamps[index];
        if (deliveredAt !== null && deliveredAt !== undefined) {
          priorReminderReadbackReferences.set(title, { deliveredAt });
        }
      }
    }

    if (eventTitles.length > 0) {
      enterActiveReminderFlowStage('prior-state-ui-readback');
      journey.activePhase = 'reminder-ui-readback';
      const existingReadback = await readBackReminderMarkers(
        frame,
        eventTitles,
        priorReminderReadbackReferences,
        captureReminderFlowReadbackError,
      );
      if (
        !existingReadback.relativeAlarmReadback ||
        !existingReadback.reminderEnabled ||
        !existingReadback.targetSettingsReadback ||
        !existingReadback.allDayScheduleReadback
      ) {
        record(
          journey.activePhase,
          'failed',
          undefined,
          existingReadback.count,
          {
            relativeAlarmReadback: existingReadback.relativeAlarmReadback,
            reminderEnabled: existingReadback.reminderEnabled,
            targetSettingsReadback: existingReadback.targetSettingsReadback,
            allDayScheduleReadback: existingReadback.allDayScheduleReadback,
          },
        );
        failureAlreadyRecorded = true;
        throw new Error('Persisted reminder settings did not reload');
      }
      record(journey.activePhase, 'passed', undefined, existingReadback.count, {
        relativeAlarmReadback: existingReadback.relativeAlarmReadback,
        reminderEnabled: existingReadback.reminderEnabled,
        targetSettingsReadback: existingReadback.targetSettingsReadback,
        allDayScheduleReadback: existingReadback.allDayScheduleReadback,
      });
      completeActiveReminderFlowStage('prior-state-ui-readback');
    }

    enterActiveReminderFlowStage('marker-creation');
    const markerTitle = `Reminder acceptance ${randomUUID()}`;
    const markerPlan = reminderPlanForMarkerIndex(eventTitles.length);
    const createdReminder = await createAndConfigureReminder(
      frame,
      page,
      markerTitle,
      markerPlan,
    );
    const dueAt = createdReminder.dueAt;
    eventTitles.push(markerTitle);

    const reminderReadbackReferences = new Map(priorReminderReadbackReferences);
    reminderReadbackReferences.set(markerTitle, {
      expectedDueAt: dueAt,
      expectedAlarmLeadMinutes: createdReminder.alarmLeadMinutes,
      ...(createdReminder.allDayEventDate
        ? { expectedAllDayEventDate: createdReminder.allDayEventDate }
        : {}),
    });
    completeActiveReminderFlowStage('marker-creation');
    enterActiveReminderFlowStage('marker-ui-readback');
    journey.activePhase = 'reminder-ui-readback';
    const allReadback = await readBackReminderMarkers(
      frame,
      eventTitles,
      reminderReadbackReferences,
      captureReminderFlowReadbackError,
    );
    if (
      !allReadback.relativeAlarmReadback ||
      !allReadback.reminderEnabled ||
      !allReadback.targetSettingsReadback ||
      !allReadback.allDayScheduleReadback
    ) {
      record(journey.activePhase, 'failed', undefined, allReadback.count, {
        relativeAlarmReadback: allReadback.relativeAlarmReadback,
        reminderEnabled: allReadback.reminderEnabled,
        targetSettingsReadback: allReadback.targetSettingsReadback,
        allDayScheduleReadback: allReadback.allDayScheduleReadback,
      });
      failureAlreadyRecorded = true;
      throw new Error('Reminder settings did not reload after configuration');
    }
    record(journey.activePhase, 'passed', undefined, allReadback.count, {
      relativeAlarmReadback: allReadback.relativeAlarmReadback,
      reminderEnabled: allReadback.reminderEnabled,
      targetSettingsReadback: allReadback.targetSettingsReadback,
      allDayScheduleReadback: allReadback.allDayScheduleReadback,
    });
    completeActiveReminderFlowStage('marker-ui-readback');

    enterActiveReminderFlowStage('delivery');
    if (flow === 'initial') {
      await verifyPublicFeedBrowserLifecycle(frame, page, markerTitle);
    }

    const deliveryPhase =
      flow === 'initial'
        ? 'reminder-initial-delivery'
        : flow === 'restart'
          ? 'reminder-restart-scheduler-scan'
          : 'reminder-restore-scheduler-scan';
    journey.activePhase = deliveryPhase;
    record(journey.activePhase, 'started');
    const delivery = await waitForReminderDelivery(
      markerTitle,
      eventTitles,
      dueAt,
    );
    const allMarkersOnce =
      delivery.complete &&
      delivery.markerCounts.every((count) => count === 1) &&
      delivery.markerTargetsMatch.every(Boolean);
    const targetMentioned = delivery.markerTargetsMatch.at(-1) === true;
    const roomMentioned = delivery.markerRoomMentions.at(-1) === true;
    const selectedMemberMentioned =
      delivery.markerSelectedMemberMentions.at(-1) === true;
    const deliveryPassed =
      delivery.httpStatus === 200 &&
      delivery.markerCounts.at(-1) === 1 &&
      targetMentioned &&
      (markerPlan.recipient === 'room'
        ? roomMentioned && !selectedMemberMentioned
        : selectedMemberMentioned && !roomMentioned) &&
      delivery.deliveredAfterDue &&
      allMarkersOnce;
    if (!deliveryPassed) {
      record(
        journey.activePhase,
        'failed',
        delivery.httpStatus ?? undefined,
        eventTitles.length,
        {
          canaryDelivered: delivery.markerCounts.at(-1) === 1,
          roomMentioned,
          selectedMemberMentioned,
          targetMentioned,
          expectedRoomRecipient: markerPlan.recipient === 'room',
          expectedSelectedRecipient: markerPlan.recipient === 'selected',
          deliveredAfterDue: delivery.deliveredAfterDue,
          allMarkersOnce,
        },
      );
      failureAlreadyRecorded = true;
      throw new Error('Reminder scheduler delivery was not observed');
    }
    record(
      journey.activePhase,
      'passed',
      delivery.httpStatus ?? undefined,
      eventTitles.length,
      {
        canaryDelivered: true,
        roomMentioned,
        selectedMemberMentioned,
        targetMentioned: true,
        expectedRoomRecipient: markerPlan.recipient === 'room',
        expectedSelectedRecipient: markerPlan.recipient === 'selected',
        deliveredAfterDue: true,
        allMarkersOnce: true,
      },
    );

    if (flow !== 'initial') {
      journey.activePhase =
        flow === 'restart'
          ? 'reminder-restart-no-duplicate'
          : 'reminder-restore-no-duplicate';
      const afterScan = await inspectReminderTimeline(eventTitles);
      const markersOnce =
        afterScan.complete &&
        afterScan.markerCounts.every((count) => count === 1) &&
        afterScan.markerTargetsMatch.every(Boolean);
      if (afterScan.httpStatus !== 200 || !markersOnce) {
        record(
          journey.activePhase,
          'failed',
          afterScan.httpStatus ?? undefined,
          eventTitles.length,
          {
            allMarkersOnce: markersOnce,
          },
        );
        failureAlreadyRecorded = true;
        throw new Error('A previously sent reminder was repeated');
      }
      record(
        journey.activePhase,
        'passed',
        afterScan.httpStatus,
        eventTitles.length,
        {
          allMarkersOnce: true,
        },
      );
    }

    journey.activePhase = 'reminder-browser-egress';
    if (blockedRequests !== 0) {
      record(journey.activePhase, 'failed', undefined, blockedRequests);
      failureAlreadyRecorded = true;
      throw new Error('Reminder browser attempted an unapproved request');
    }
    record(journey.activePhase, 'passed', undefined, blockedRequests);
    completeActiveReminderFlowStage('delivery');
    enterActiveReminderFlowStage('complete');
    completeActiveReminderFlowStage('complete');
  } catch (error) {
    failActiveReminderFlow(error);
    if (!failureAlreadyRecorded && !journey.activeReminderFailureRecorded) {
      record(journey.activePhase, 'failed', failureHttpStatus);
    }
    throw new Error('Element reminder acceptance journey failed');
  } finally {
    await context.close();
  }
}
