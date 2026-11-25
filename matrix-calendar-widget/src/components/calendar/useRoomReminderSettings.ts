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
  const lastHandledOpenRequest = useRef(0);
  const eventTimingIdentity = JSON.stringify(eventTiming);
  const load = useCallback(async () => {
    if (!canManageReminders || !reminderRepository) {
      return;
    }
    const requestId = ++requestSequence.current;
    setOpen(true);
    setLoading(true);
    setError(false);
    setOptions([]);
    setConfigurations({});
    setOrphanedConfigurations([]);
    setDrafts({});
    setMemberSearchQueries({});
    setRoomRecipients([]);
    try {
      const [availableOptions, allConfigurations, currentMembers] =
        await Promise.all([
          reminderRepository.listRoomReminderAlarmOptions(calendarId, eventId),
          reminderRepository.listRoomReminderConfigurations(),
          loadRoomRecipients(),
        ]);
      if (requestSequence.current !== requestId) return;
      const membersUnavailable = currentMembers === undefined;
      const loadedMembers = currentMembers ?? [];
      const eventOptions = availableOptions.filter(
        (candidate) => candidate.eventUid === eventUid,
      );
      const eventConfigurations = allConfigurations.filter(
        (configuration) => configuration.eventUid === eventUid,
      );
      const optionKeys = new Set<string>();
      const byKey: Record<string, CalendarRoomReminderConfiguration> = {};
      const draftByKey: Record<string, ReminderDraft> = {};
      for (const option of eventOptions) {
        const key = reminderOptionKey(option);
        if (optionKeys.has(key)) throw new Error('Ambiguous alarm option');
        optionKeys.add(key);
        const matches = eventConfigurations.filter(
          (configuration) => reminderOptionKey(configuration) === key,
        );
        if (matches.length > 1) {
          throw new Error('Ambiguous reminder configuration');
        }
        const configuration = matches[0];
        if (configuration) byKey[key] = configuration;
        draftByKey[key] = createDraft(
          configuration,
          loadedMembers,
          calendarTimezone,
          membersUnavailable,
        );
      }
      setOptions(eventOptions);
      setConfigurations(byKey);
      setOrphanedConfigurations(
        eventConfigurations.filter(
          (configuration) => !optionKeys.has(reminderOptionKey(configuration)),
        ),
      );
      setDrafts(draftByKey);
      setMemberSearchQueries({});
    } catch {
      if (requestSequence.current === requestId) setError(true);
    } finally {
      if (requestSequence.current === requestId) setLoading(false);
    }
  }, [
    calendarId,
    calendarTimezone,
    canManageReminders,
    eventId,
    eventUid,
    loadRoomRecipients,
    reminderRepository,
  ]);

  useEffect(() => {
    requestSequence.current += 1;
    rosterRequestSequence.current += 1;
    setOpen(false);
    setLoading(false);
    setSavingKey(undefined);
    setError(false);
    setOptions([]);
    setConfigurations({});
    setOrphanedConfigurations([]);
    setDrafts({});
    setMemberSearchQueries({});
    setRoomRecipients([]);
    setRoomMembersUnavailable(false);
    setRoomMembersLoading(false);
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
  ]);

  useEffect(
    () => () => {
      requestSequence.current += 1;
    },
    [],
  );

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
        setConfigurations((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
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
      setConfigurations((current) => ({ ...current, [key]: saved }));
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
      setOrphanedConfigurations((current) =>
        current.filter((candidate) => reminderOptionKey(candidate) !== key),
      );
    } catch {
      if (requestSequence.current === requestId) setError(true);
    } finally {
      if (requestSequence.current === requestId) setSavingKey(undefined);
    }
  };

  return {
    reminderRepository,
    open,
    setOpen,
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
