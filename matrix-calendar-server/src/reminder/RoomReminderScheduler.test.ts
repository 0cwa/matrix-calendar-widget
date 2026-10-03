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

import { InMemoryRoomReminderStore } from '../../test/util/InMemoryRoomReminderStore';
import {
  CanonicalReminderSchedulerSource,
  ReminderCandidateCursor,
  ReminderDueCandidate,
  ReminderSchedulerWindow,
  ROOM_REMINDER_SCHEDULER_LIMITS,
  RoomReminderScheduler,
  RoomReminderSchedulerSender,
} from './RoomReminderScheduler';
import {
  createReminderDeliveryKey,
  RoomReminderConfiguration,
} from './RoomReminderStore';

const roomId = '!team:example.org';
const calendarId = 'team-calendar';
const senderUserId = '@calendar-bot:example.org';
const now = new Date('2026-10-02T10:00:00.000Z');
const dueAt = new Date(now.getTime() - 60_000);
const binding = { roomId, calendarId };

function configuration(eventUid: string): RoomReminderConfiguration {
  return {
    roomId,
    calendarId,
    eventUid,
    recurrenceId: null,
    alarmUid: 'alarm-1',
  };
}

function candidate(
  config: RoomReminderConfiguration,
  recurrenceId: string,
  triggerOrdinal = 0,
): ReminderDueCandidate {
  return {
    identity: {
      roomId: config.roomId,
      calendarId: config.calendarId,
      eventUid: config.eventUid,
      recurrenceId,
      alarmUid: config.alarmUid,
      triggerOrdinal,
    },
    dueAt,
  };
}

function compareCandidate(
  left: ReminderDueCandidate,
  right: ReminderDueCandidate,
): number {
  return (
    left.identity.recurrenceId.localeCompare(right.identity.recurrenceId) ||
    left.identity.triggerOrdinal - right.identity.triggerOrdinal
  );
}

function createHarness(
  options: ConstructorParameters<typeof RoomReminderScheduler>[1] = {},
) {
  const store = new InMemoryRoomReminderStore();
  const candidates = new Map<string, ReminderDueCandidate[]>();
  const canonical: CanonicalReminderSchedulerSource = {
    listDueCandidates: jest.fn(
      async (
        config: RoomReminderConfiguration,
        window: ReminderSchedulerWindow,
        after: ReminderCandidateCursor | undefined,
        limit: 1,
      ) => {
        const afterKey = after
          ? `${after.recurrenceId}\u0000${String(after.triggerOrdinal).padStart(12, '0')}`
          : undefined;
        return (candidates.get(config.eventUid) ?? [])
          .filter(
            (entry) =>
              entry.dueAt >= window.notBefore &&
              entry.dueAt <= window.through &&
              (afterKey === undefined || candidateSortKey(entry) > afterKey),
          )
          .sort(compareCandidate)
          .slice(0, limit);
      },
    ),
    resolveCurrentDelivery: jest.fn(
      async (
        config: RoomReminderConfiguration,
        identity: ReminderDueCandidate['identity'],
        window: ReminderSchedulerWindow,
      ) => {
        const current = (candidates.get(config.eventUid) ?? []).find(
          (entry) =>
            entry.identity.recurrenceId === identity.recurrenceId &&
            entry.identity.triggerOrdinal === identity.triggerOrdinal,
        );
        if (
          !current ||
          current.dueAt < window.notBefore ||
          current.dueAt > window.through
        ) {
          return undefined;
        }
        return {
          dueAt: current.dueAt,
          body: `Reminder for ${config.eventUid}`,
        };
      },
    ),
  };
  const sent: Array<{
    roomId: string;
    message: unknown;
    transactionId: string;
  }> = [];
  const sender: RoomReminderSchedulerSender = {
    sendRoomMention: jest.fn(
      async (target, _calendarId, message, transactionId) => {
        sent.push({ roomId: target, message, transactionId });
      },
    ),
  };
  const runtime = {
    getCurrentConfiguration: jest.fn(async () => ({
      roomCalendarBindings: [binding],
      applicationServiceSenderUserId: senderUserId,
      roomCalendarAccessEnabled: true,
      roomReminderDeliveryEnabled: true,
      reminderStoreEnabled: true,
    })),
  };
  const matrixState = {
    isRoomEncrypted: jest.fn(async () => false),
    getJoinedRoomMembers: jest.fn(async () => [senderUserId]),
    getPowerLevels: jest.fn(async () => ({
      users: { [senderUserId]: 100 },
      events: { 'm.room.message': 0 },
      notifications: { room: 0 },
    })),
    getRoomVersion: jest.fn(async () => '10'),
  };
  const scheduler = new RoomReminderScheduler(
    {
      store,
      runtime,
      canonical,
      matrixState,
      sender,
      now: () => new Date(now),
    },
    options,
  );

  return {
    store,
    candidates,
    canonical,
    sender,
    sent,
    runtime,
    matrixState,
    scheduler,
  };
}

function candidateSortKey(candidateValue: ReminderDueCandidate): string {
  return `${candidateValue.identity.recurrenceId}\u0000${String(candidateValue.identity.triggerOrdinal).padStart(12, '0')}`;
}

describe('RoomReminderScheduler', () => {
  it('sends a current firing with a stable transaction ID and marks it sent', async () => {
    const harness = createHarness();
    const config = configuration('planning');
    const firing = candidate(config, '20261002T100000Z');
    await harness.store.upsertConfiguration(config);
    harness.candidates.set(config.eventUid, [firing]);

    const report = await harness.scheduler.runOnce();

    expect(report.deliveriesSent).toBe(1);
    expect(report.deliveryClaimAttempts).toBe(1);
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0].roomId).toBe(roomId);
    expect(harness.sent[0].transactionId).toBe(
      `mcal-reminder-${createReminderDeliveryKey(firing.identity)}`,
    );
    expect(harness.sent[0].message).toEqual({
      type: 'm.room.message',
      content: {
        msgtype: 'm.text',
        body: 'Reminder for planning',
        'm.mentions': { room: true },
      },
    });
  });

  it('reuses the same Matrix transaction ID after an accepted send loses its response', async () => {
    const harness = createHarness();
    const config = configuration('crash-planning');
    const firing = candidate(config, '20261002T100000Z');
    await harness.store.upsertConfiguration(config);
    harness.candidates.set(config.eventUid, [firing]);
    let calls = 0;
    harness.sender.sendRoomMention = jest.fn(
      async (target, _calendarId, message, transactionId) => {
        calls += 1;
        harness.sent.push({ roomId: target, message, transactionId });
        if (calls === 1) {
          throw new Error('simulated accepted send with lost response');
        }
      },
    );

    const first = await harness.scheduler.runOnce();
    const retry = await harness.scheduler.runOnce();

    expect(first.deliveryClaimsReleased).toBe(1);
    expect(retry.deliveriesSent).toBe(1);
    expect(harness.sent.map((entry) => entry.transactionId)).toEqual([
      `mcal-reminder-${createReminderDeliveryKey(firing.identity)}`,
      `mcal-reminder-${createReminderDeliveryKey(firing.identity)}`,
    ]);
  });

  it('does not read canonical calendar content for an encrypted room', async () => {
    const harness = createHarness();
    const config = configuration('encrypted-room');
    await harness.store.upsertConfiguration(config);
    harness.matrixState.isRoomEncrypted.mockResolvedValue(true);

    const report = await harness.scheduler.runOnce();

    expect(report.deliveriesDenied).toBe(1);
    expect(harness.canonical.listDueCandidates).not.toHaveBeenCalled();
    expect(harness.canonical.resolveCurrentDelivery).not.toHaveBeenCalled();
    expect(harness.sent).toHaveLength(0);
  });

  it('aborts stalled canonical work and releases its claim before the lease expires', async () => {
    jest.useFakeTimers({ doNotFake: ['performance'] });
    try {
      const harness = createHarness();
      const config = configuration('cancel-stalled-refresh');
      const firing = candidate(config, '20261002T100000Z');
      await harness.store.upsertConfiguration(config);
      harness.candidates.set(config.eventUid, [firing]);

      let resolveStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        resolveStarted = resolve;
      });
      let observedAbort = false;
      harness.canonical.resolveCurrentDelivery = jest.fn(
        async (_configuration, _identity, _window, signal) => {
          resolveStarted();
          return new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                observedAbort = true;
                reject(new Error('canonical lookup aborted'));
              },
              { once: true },
            );
          });
        },
      );
      const release = jest.spyOn(harness.store, 'releaseDeliveryClaim');
      const markSent = jest.spyOn(harness.store, 'markDeliverySent');

      const scan = harness.scheduler.runOnce();
      await started;
      await jest.advanceTimersByTimeAsync(
        ROOM_REMINDER_SCHEDULER_LIMITS.operationTimeoutMs,
      );
      const report = await scan;

      expect(observedAbort).toBe(true);
      expect(report.deliveryClaimsAcquired).toBe(1);
      expect(report.deliveryClaimsReleased).toBe(1);
      expect(report.deliveriesSent).toBe(0);
      expect(harness.sent).toHaveLength(0);
      expect(markSent).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
      expect(ROOM_REMINDER_SCHEDULER_LIMITS.deliveryLeaseMs).toBeGreaterThan(
        ROOM_REMINDER_SCHEDULER_LIMITS.postClaimWorkDeadlineMs +
          ROOM_REMINDER_SCHEDULER_LIMITS.postClaimReleaseReserveMs,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('propagates lifecycle cancellation and releases an in-flight claim', async () => {
    const harness = createHarness();
    const config = configuration('cancel-from-lifecycle');
    const firing = candidate(config, '20261002T100000Z');
    await harness.store.upsertConfiguration(config);
    harness.candidates.set(config.eventUid, [firing]);

    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    let observedAbort = false;
    harness.canonical.resolveCurrentDelivery = jest.fn(
      async (_configuration, _identity, _window, signal) => {
        resolveStarted();
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              observedAbort = true;
              reject(new Error('canonical lookup aborted'));
            },
            { once: true },
          );
        });
      },
    );
    const release = jest.spyOn(harness.store, 'releaseDeliveryClaim');
    const markSent = jest.spyOn(harness.store, 'markDeliverySent');
    const controller = new AbortController();

    const scan = harness.scheduler.runOnce(controller.signal);
    await started;
    controller.abort();
    const report = await scan;

    expect(observedAbort).toBe(true);
    expect(report.deliveryClaimsAcquired).toBe(1);
    expect(report.deliveryClaimsReleased).toBe(1);
    expect(report.deliveriesSent).toBe(0);
    expect(harness.sent).toHaveLength(0);
    expect(markSent).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('round-robins firing identities so a claim cap does not starve later configs or occurrences', async () => {
    const harness = createHarness({ maxDeliveryClaimsPerRun: 1 });
    const firstConfig = configuration('alpha');
    const secondConfig = configuration('beta');
    const alphaFirings = [
      candidate(firstConfig, '20261002T090000Z'),
      candidate(firstConfig, '20261002T100000Z'),
    ];
    const betaFirings = [candidate(secondConfig, '20261002T100000Z')];
    await harness.store.upsertConfiguration(firstConfig);
    await harness.store.upsertConfiguration(secondConfig);
    harness.candidates.set(firstConfig.eventUid, alphaFirings);
    harness.candidates.set(secondConfig.eventUid, betaFirings);

    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      reports.push(await harness.scheduler.runOnce());
    }

    expect(reports.map((report) => report.deliveryClaimAttempts)).toEqual([
      1, 1, 1,
    ]);
    expect(
      harness.sent.map((entry) => (entry.message as any).content.body),
    ).toEqual([
      'Reminder for alpha',
      'Reminder for beta',
      'Reminder for alpha',
    ]);
  });

  it('releases a claim when the binding disappears before delivery', async () => {
    const harness = createHarness();
    const config = configuration('removed-binding');
    await harness.store.upsertConfiguration(config);
    harness.candidates.set(config.eventUid, [
      candidate(config, '20261002T100000Z'),
    ]);
    harness.runtime.getCurrentConfiguration = jest
      .fn()
      .mockResolvedValueOnce({
        roomCalendarBindings: [binding],
        applicationServiceSenderUserId: senderUserId,
        roomCalendarAccessEnabled: true,
        roomReminderDeliveryEnabled: true,
        reminderStoreEnabled: true,
      })
      .mockResolvedValueOnce({
        roomCalendarBindings: [],
        applicationServiceSenderUserId: senderUserId,
        roomCalendarAccessEnabled: true,
        roomReminderDeliveryEnabled: true,
        reminderStoreEnabled: true,
      });

    const report = await harness.scheduler.runOnce();

    expect(report.deliveriesStale).toBe(1);
    expect(report.deliveryClaimsReleased).toBe(1);
    expect(harness.sent).toHaveLength(0);
    expect(harness.matrixState.getJoinedRoomMembers).toHaveBeenCalledTimes(1);
  });

  it('releases a claim when the delivery gate is disabled after claim', async () => {
    const harness = createHarness();
    const config = configuration('gate-disabled-after-claim');
    await harness.store.upsertConfiguration(config);
    harness.candidates.set(config.eventUid, [
      candidate(config, '20261002T100000Z'),
    ]);
    harness.runtime.getCurrentConfiguration = jest
      .fn()
      .mockResolvedValueOnce({
        roomCalendarBindings: [binding],
        applicationServiceSenderUserId: senderUserId,
        roomCalendarAccessEnabled: true,
        roomReminderDeliveryEnabled: true,
        reminderStoreEnabled: true,
      })
      .mockResolvedValueOnce({
        roomCalendarBindings: [],
        applicationServiceSenderUserId: senderUserId,
        roomCalendarAccessEnabled: true,
        roomReminderDeliveryEnabled: false,
        reminderStoreEnabled: true,
      });

    const report = await harness.scheduler.runOnce();

    expect(report.deliveryClaimsAcquired).toBe(1);
    expect(report.deliveriesDenied).toBe(1);
    expect(report.deliveryClaimsReleased).toBe(1);
    expect(harness.canonical.resolveCurrentDelivery).not.toHaveBeenCalled();
    expect(harness.sent).toHaveLength(0);
  });

  it('releases a claim when the exact configuration was deleted after claiming', async () => {
    const harness = createHarness();
    const config = configuration('deleted-config');
    await harness.store.upsertConfiguration(config);
    harness.candidates.set(config.eventUid, [
      candidate(config, '20261002T100000Z'),
    ]);
    jest.spyOn(harness.store, 'hasConfiguration').mockResolvedValue(false);

    const report = await harness.scheduler.runOnce();

    expect(report.deliveriesStale).toBe(1);
    expect(report.deliveryClaimsReleased).toBe(1);
    expect(harness.sent).toHaveLength(0);
  });

  it('fails closed when the current Matrix mention policy denies delivery', async () => {
    const harness = createHarness();
    const config = configuration('denied');
    await harness.store.upsertConfiguration(config);
    harness.candidates.set(config.eventUid, [
      candidate(config, '20261002T100000Z'),
    ]);
    harness.matrixState.getJoinedRoomMembers = jest.fn(async () => []);

    const report = await harness.scheduler.runOnce();

    expect(report.deliveriesDenied).toBe(1);
    expect(report.deliveryClaimAttempts).toBe(0);
    expect(harness.canonical.listDueCandidates).not.toHaveBeenCalled();
    expect(harness.sent).toHaveLength(0);
  });

  it('advances beyond already-sent candidates after a bounded cursor is evicted', async () => {
    const harness = createHarness({
      maxDeliveryClaimsPerRun: 1,
      maxCandidateCursorEntries: 1,
      maxConfigurationsPerRun: 1,
    });
    const firstConfig = configuration('cursor-a');
    const secondConfig = configuration('cursor-b');
    const firstFiring = candidate(firstConfig, '20261002T090000Z');
    const secondFiring = candidate(firstConfig, '20261002T100000Z');
    await harness.store.upsertConfiguration(firstConfig);
    await harness.store.upsertConfiguration(secondConfig);
    harness.candidates.set(firstConfig.eventUid, [firstFiring, secondFiring]);
    harness.candidates.set(secondConfig.eventUid, [
      candidate(secondConfig, '20261002T100000Z'),
    ]);

    await harness.scheduler.runOnce();
    await harness.scheduler.runOnce();
    harness.candidates.set(secondConfig.eventUid, []);
    await harness.scheduler.runOnce();
    await harness.scheduler.runOnce();
    await harness.scheduler.runOnce();
    await harness.scheduler.runOnce();
    await harness.scheduler.runOnce();

    expect(
      harness.sent.map((entry) => (entry.message as any).content.body),
    ).toEqual([
      'Reminder for cursor-a',
      'Reminder for cursor-b',
      'Reminder for cursor-a',
    ]);
    expect(
      (harness.canonical.listDueCandidates as jest.Mock).mock.calls.some(
        (call) => call[0].eventUid === firstConfig.eventUid && call[2],
      ),
    ).toBe(true);
  });

  it('retains the due-candidate keyset under a one-claim run cap', async () => {
    const harness = createHarness({ maxDeliveryClaimsPerRun: 1 });
    const config = configuration('candidate-page');
    const firstFiring = candidate(config, '20261002T090000Z');
    const secondFiring = candidate(config, '20261002T100000Z');
    await harness.store.upsertConfiguration(config);
    harness.candidates.set(config.eventUid, [firstFiring, secondFiring]);

    const first = await harness.scheduler.runOnce();
    const second = await harness.scheduler.runOnce();

    expect(first.deliveryClaimAttempts).toBe(1);
    expect(second.deliveryClaimAttempts).toBe(1);
    expect(harness.sent.map((entry) => entry.transactionId)).toEqual([
      `mcal-reminder-${createReminderDeliveryKey(firstFiring.identity)}`,
      `mcal-reminder-${createReminderDeliveryKey(secondFiring.identity)}`,
    ]);
  });

  it('bounds candidate cursor memory when configuration identities rotate', async () => {
    const harness = createHarness({
      maxDeliveryClaimsPerRun: 1,
      maxCandidateCursorEntries: 1,
    });
    const firstConfig = configuration('cursor-bound-a');
    const secondConfig = configuration('cursor-bound-b');
    await harness.store.upsertConfiguration(firstConfig);
    await harness.store.upsertConfiguration(secondConfig);
    harness.candidates.set(firstConfig.eventUid, [
      candidate(firstConfig, '20261002T100000Z'),
    ]);
    harness.candidates.set(secondConfig.eventUid, [
      candidate(secondConfig, '20261002T100000Z'),
    ]);

    for (let index = 0; index < 3; index += 1) {
      await harness.scheduler.runOnce();
    }
    expect(
      (harness.scheduler as any).candidateCursors.size,
    ).toBeLessThanOrEqual(1);
  });

  it('rejects over-sized runtime bindings without scanning or sending', async () => {
    const harness = createHarness({ maxBindingsPerRun: 1 });
    harness.runtime.getCurrentConfiguration = jest.fn(async () => ({
      roomCalendarBindings: [
        binding,
        { roomId: '!other:example.org', calendarId: 'other' },
      ],
      applicationServiceSenderUserId: senderUserId,
      roomCalendarAccessEnabled: true,
      roomReminderDeliveryEnabled: true,
      reminderStoreEnabled: true,
    }));

    const report = await harness.scheduler.runOnce();

    expect(report.bindingLimitExceeded).toBe(1);
    expect(report.bindingsVisited).toBe(0);
    expect(harness.sent).toHaveLength(0);
  });
});
