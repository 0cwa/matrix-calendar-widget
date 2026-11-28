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

import type {
  CalendarEventId,
  CalendarEventTiming,
  CalendarId,
} from '@matrix-calendar-widget/calendar';
import {
  isValidRoomMemberStateEvent,
  STATE_EVENT_ROOM_MEMBER,
  type RoomMemberStateEventContent,
} from '@matrix-widget-toolkit/api';
import { useWidgetApi } from '@matrix-widget-toolkit/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isCalendarRoomReminderRepository,
  useCalendarRepository,
  type CalendarRoomReminderAlarmOption,
  type CalendarRoomReminderConfiguration,
  type CalendarRoomReminderTarget,
} from '../../calendar';
import {
  createDraft,
  reminderOptionKey,
  validateAllDayDraft,
  type ReminderDestinationChoice,
  type ReminderDraft,
} from './roomReminderModel';
import { useRoomReminderRoster } from './useRoomReminderRoster';

export function useRoomReminderSettings({
  calendarId,
  eventId,
  eventUid,
  roomId,
  calendarTimezone,
  eventTiming,
  isRecurringSeries,
  openRequest = 0,
  refreshToken,
  canManageReminders,
}: {
  calendarId: CalendarId;
  eventId: CalendarEventId;
  eventUid: string;
  roomId?: string;
  calendarTimezone?: string;
  eventTiming: CalendarEventTiming;
  isRecurringSeries: boolean;
  openRequest?: number;
  refreshToken: number;
  canManageReminders: boolean;
}) {
  const widgetApi = useWidgetApi();
  const repository = useCalendarRepository();
  const reminderRepository = isCalendarRoomReminderRepository(repository)
    ? repository
    : undefined;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string>();
  const [error, setError] = useState(false);
  const [options, setOptions] = useState<CalendarRoomReminderAlarmOption[]>([]);
  const [configurations, setConfigurations] = useState<
    Record<string, CalendarRoomReminderConfiguration>
  >({});
  const [orphanedConfigurations, setOrphanedConfigurations] = useState<
    CalendarRoomReminderConfiguration[]
  >([]);
  const [drafts, setDrafts] = useState<Record<string, ReminderDraft>>({});
  const [memberSearchQueries, setMemberSearchQueries] = useState<
    Record<string, string>
  >({});
  const {
    members,
    joinedMemberIds,
    memberById,
    roomMembersUnavailable,
    roomMembersLoading,
    loadRoomRecipients,
    setRoomRecipients,
    setRoomMembersUnavailable,
    setRoomMembersLoading,
    rosterRequestSequence,
  } = useRoomReminderRoster(reminderRepository, roomId);
  const requestSequence = useRef(0);
  const expandSequence = useRef(0);
  const lastHandledOpenRequest = useRef(0);
  const eventTimingIdentity = JSON.stringify(eventTiming);
  type Snapshot = {
    options: CalendarRoomReminderAlarmOption[];
    configurations: Record<string, CalendarRoomReminderConfiguration>;
    orphanedConfigurations: CalendarRoomReminderConfiguration[];
  };
  const emptySnapshot = (): Snapshot => ({
    options: [],
    configurations: {},
    orphanedConfigurations: [],
  });
  const snapshotRef = useRef<Snapshot>(emptySnapshot());
  const statusRef = useRef<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [snapshotStatus, setSnapshotStatus] = useState(statusRef.current);
  const inFlight = useRef<{
    version: number;
    promise: Promise<Snapshot | undefined>;
  } | null>(null);
  const updateSnapshot = (snapshot: Snapshot) => {
    snapshotRef.current = snapshot;
    setOptions(snapshot.options);
    setConfigurations(snapshot.configurations);
    setOrphanedConfigurations(snapshot.orphanedConfigurations);
  };
  const updateStatus = (status: typeof statusRef.current) => {
    statusRef.current = status;
    setSnapshotStatus(status);
  };
  const ensureSnapshot = useCallback((): Promise<Snapshot | undefined> => {
    if (!canManageReminders || !reminderRepository)
      return Promise.resolve(undefined);
    if (statusRef.current === 'ready')
      return Promise.resolve(snapshotRef.current);
    const version = requestSequence.current;
    if (inFlight.current?.version === version) return inFlight.current.promise;
    updateStatus('loading');
    const promise = (async () => {
      try {
        const [availableOptions, allConfigurations] = await Promise.all([
          reminderRepository.listRoomReminderAlarmOptions(calendarId, eventId),
          reminderRepository.listRoomReminderConfigurations(),
        ]);
        const eventOptions = availableOptions.filter(
          (option) => option.eventUid === eventUid,
        );
        const eventConfigurations = allConfigurations.filter(
          (configuration) => configuration.eventUid === eventUid,
        );
        const keys = new Set<string>();
        const byKey: Record<string, CalendarRoomReminderConfiguration> = {};
        for (const option of eventOptions) {
          const key = reminderOptionKey(option);
          if (keys.has(key)) throw new Error('Ambiguous alarm option');
          keys.add(key);
          const matches = eventConfigurations.filter(
            (configuration) => reminderOptionKey(configuration) === key,
          );
          if (matches.length > 1)
            throw new Error('Ambiguous reminder configuration');
          if (matches[0]) byKey[key] = matches[0];
        }
        const snapshot = {
          options: eventOptions,
          configurations: byKey,
          orphanedConfigurations: eventConfigurations.filter(
            (configuration) => !keys.has(reminderOptionKey(configuration)),
          ),
        };
        if (requestSequence.current !== version) return undefined;
        updateSnapshot(snapshot);
        updateStatus('ready');
        return snapshot;
      } catch {
        if (requestSequence.current === version) updateStatus('error');
        return undefined;
      } finally {
        if (inFlight.current?.version === version) inFlight.current = null;
      }
    })();
    inFlight.current = { version, promise };
    return promise;
  }, [calendarId, eventId, eventUid, canManageReminders, reminderRepository]);

  const load = useCallback(async () => {
    if (!canManageReminders || !reminderRepository) return;
    const version = requestSequence.current;
    const expansion = ++expandSequence.current;
    setOpen(true);
    setLoading(true);
    setError(false);
    setMemberSearchQueries({});
    const [snapshot, currentMembers] = await Promise.all([
      ensureSnapshot(),
      loadRoomRecipients(),
    ]);
    if (
      requestSequence.current !== version ||
      expandSequence.current !== expansion
    )
      return;
    if (!snapshot) {
      setError(true);
    } else {
      const next: Record<string, ReminderDraft> = {};
      for (const option of snapshot.options) {
        const key = reminderOptionKey(option);
        next[key] = createDraft(
          snapshot.configurations[key],
          currentMembers ?? [],
          calendarTimezone,
          currentMembers === undefined,
        );
      }
      setDrafts(next);
    }
    setLoading(false);
  }, [
    canManageReminders,
    reminderRepository,
    ensureSnapshot,
    loadRoomRecipients,
    calendarTimezone,
  ]);

  useEffect(() => {
    requestSequence.current += 1;
    expandSequence.current += 1;
    rosterRequestSequence.current += 1;
    inFlight.current = null;
    setOpen(false);
    setLoading(false);
    setSavingKey(undefined);
    setError(false);
    updateSnapshot(emptySnapshot());
    updateStatus(canManageReminders && reminderRepository ? 'loading' : 'idle');
    setDrafts({});
    setMemberSearchQueries({});
    setRoomRecipients([]);
    setRoomMembersUnavailable(false);
    setRoomMembersLoading(false);
    void ensureSnapshot();
    return () => {
      requestSequence.current += 1;
      expandSequence.current += 1;
      rosterRequestSequence.current += 1;
      inFlight.current = null;
    };
  }, [
    calendarId,
    eventId,
    eventUid,
    eventTimingIdentity,
    isRecurringSeries,
    canManageReminders,
    calendarTimezone,
    refreshToken,
    repository,
    roomId,
    rosterRequestSequence,
    setRoomMembersLoading,
    setRoomMembersUnavailable,
    setRoomRecipients,
    ensureSnapshot,
    reminderRepository,
  ]);

  useEffect(() => {
    if (
      openRequest === 0 ||
      openRequest === lastHandledOpenRequest.current ||
      !canManageReminders ||
      !roomId ||
      !reminderRepository
    ) {
      return;
    }
    lastHandledOpenRequest.current = openRequest;
    void load();
  }, [canManageReminders, load, openRequest, reminderRepository, roomId]);

  useEffect(() => {
    if (!open || loading || !roomId) return;
    let refreshTimeout: ReturnType<typeof setTimeout> | undefined;
    const subscription = widgetApi
      .observeStateEvents<RoomMemberStateEventContent>(
        STATE_EVENT_ROOM_MEMBER,
        { roomIds: [roomId] },
      )
      .subscribe(
        (event) => {
          if (!isValidRoomMemberStateEvent(event) || event.room_id !== roomId) {
            return;
          }
          if (refreshTimeout !== undefined) clearTimeout(refreshTimeout);
          refreshTimeout = setTimeout(() => void loadRoomRecipients(), 100);
        },
        () => undefined,
      );
    return () => {
      if (refreshTimeout !== undefined) clearTimeout(refreshTimeout);
      subscription.unsubscribe();
    };
  }, [loadRoomRecipients, loading, open, roomId, widgetApi]);

  const updateDraft = (key: string, patch: Partial<ReminderDraft>) => {
    setDrafts((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
  };

  const save = async (
    option: CalendarRoomReminderAlarmOption,
    destination: ReminderDestinationChoice,
  ) => {
    const key = reminderOptionKey(option);
    const draft = drafts[key];
    if (!draft || savingKey || !reminderRepository) return;
    const requestId = requestSequence.current;
    setSavingKey(key);
    setError(false);
    try {
      if (destination === 'off') {
        const configured = configurations[key];
        if (configured)
          await reminderRepository.disableRoomReminder(configured);
        if (requestSequence.current !== requestId) return;
        const next = { ...snapshotRef.current.configurations };
        delete next[key];
        updateSnapshot({ ...snapshotRef.current, configurations: next });
        return;
      }

      let target: CalendarRoomReminderTarget;
      if (destination === 'room') {
        target = { kind: 'room' };
      } else {
        const unique = [...new Set(draft.userIds)].sort();
        if (
          unique.length === 0 ||
          unique.length > 50 ||
          unique.some((userId) => !joinedMemberIds.has(userId))
        ) {
          setError(true);
          return;
        }
        target = { kind: 'users', userIds: unique };
      }

      const allDaySchedule = option.requiresAllDaySchedule
        ? validateAllDayDraft(draft.allDaySchedule)
        : null;
      if (option.requiresAllDaySchedule && !allDaySchedule) {
        setError(true);
        return;
      }
      const saved = await reminderRepository.enableRoomReminder(
        calendarId,
        eventId,
        option.alarmUid,
        option.recurrenceId,
        target,
        allDaySchedule,
      );
      if (
        requestSequence.current !== requestId ||
        saved.eventUid !== eventUid ||
        saved.alarmUid !== option.alarmUid ||
        saved.recurrenceId !== option.recurrenceId
      ) {
        throw new Error('Reminder identity changed');
      }
      updateSnapshot({
        ...snapshotRef.current,
        configurations: { ...snapshotRef.current.configurations, [key]: saved },
      });
      setDrafts((current) => ({
        ...current,
        [key]: { ...current[key], departedUserIds: [] },
      }));
    } catch {
      if (requestSequence.current === requestId) {
        setError(true);
        void loadRoomRecipients();
      }
    } finally {
      if (requestSequence.current === requestId) setSavingKey(undefined);
    }
  };

  const removeOrphan = async (
    configuration: CalendarRoomReminderConfiguration,
  ) => {
    if (savingKey || !reminderRepository) return;
    const key = reminderOptionKey(configuration);
    const requestId = requestSequence.current;
    setSavingKey(key);
    setError(false);
    try {
      await reminderRepository.disableRoomReminder(configuration);
      if (requestSequence.current !== requestId) return;
      updateSnapshot({
        ...snapshotRef.current,
        orphanedConfigurations:
          snapshotRef.current.orphanedConfigurations.filter(
            (candidate) => reminderOptionKey(candidate) !== key,
          ),
      });
    } catch {
      if (requestSequence.current === requestId) setError(true);
    } finally {
      if (requestSequence.current === requestId) setSavingKey(undefined);
    }
  };

  return {
    reminderRepository,
    open,
    setOpen: (value: boolean) => {
      if (!value) {
        if (savingKey) return;
        expandSequence.current += 1;
        setLoading(false);
      }
      setOpen(value);
    },
    summaryLoading:
      canManageReminders &&
      Boolean(reminderRepository) &&
      (snapshotStatus === 'idle' || snapshotStatus === 'loading'),
    summaryError: snapshotStatus === 'error',
    loading,
    savingKey,
    error,
    options,
    configurations,
    orphanedConfigurations,
    drafts,
    memberSearchQueries,
    setMemberSearchQueries,
    members,
    joinedMemberIds,
    memberById,
    roomMembersUnavailable,
    roomMembersLoading,
    loadRoomRecipients,
    load,
    updateDraft,
    save,
    removeOrphan,
  };
}
