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
  CalendarEventDuration,
  CalendarEventId,
  CalendarEventTiming,
  CalendarId,
  calendarLocalDateTimeToUnixMillis,
} from '@matrix-calendar-widget/calendar';
import {
  isValidRoomMemberStateEvent,
  STATE_EVENT_ROOM_MEMBER,
  type RoomMemberStateEventContent,
} from '@matrix-widget-toolkit/api';
import { useWidgetApi } from '@matrix-widget-toolkit/react';
import {
  Alert,
  Autocomplete,
  Button,
  createFilterOptions,
  Divider,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarRoomReminderAlarmOption,
  CalendarRoomReminderAllDaySchedule,
  CalendarRoomReminderConfiguration,
  CalendarRoomReminderIdentity,
  CalendarRoomReminderRecipient,
  CalendarRoomReminderTarget,
  isCalendarRoomReminderRepository,
  useCalendarRepository,
} from '../../calendar';
import { isBotUser } from '../../lib/utils';

type CalendarReminderMember = Readonly<{
  userId: string;
  displayName: string;
}>;

type ReminderDestinationChoice = 'off' | 'room' | 'users';

type ReminderDraft = Readonly<{
  destination: ReminderDestinationChoice;
  userIds: readonly string[];
  allDaySchedule: CalendarRoomReminderAllDaySchedule;
  departedUserIds: readonly string[];
}>;

type CalendarRoomReminderControlProps = {
  calendarId: CalendarId;
  eventId: CalendarEventId;
  eventUid: string;
  roomId?: string;
  calendarTimezone?: string;
  popperContainer?: () => HTMLElement | null;
  eventTiming: CalendarEventTiming;
  isRecurringSeries: boolean;
  openRequest?: number;
  refreshToken: number;
  canManageReminders: boolean;
  onEditCalendarReminder: () => void;
};

const filterMemberOptions = createFilterOptions<CalendarReminderMember>({
  limit: 100,
  stringify: (member) => `${member.displayName} ${member.userId}`,
});

export function CalendarRoomReminderControl({
  calendarId,
  eventId,
  eventUid,
  roomId,
  calendarTimezone,
  popperContainer,
  eventTiming,
  isRecurringSeries,
  openRequest = 0,
  refreshToken,
  canManageReminders,
  onEditCalendarReminder,
}: CalendarRoomReminderControlProps) {
  const { t } = useTranslation();
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
  const [roomRecipients, setRoomRecipients] = useState<
    CalendarRoomReminderRecipient[]
  >([]);
  const [roomMembersUnavailable, setRoomMembersUnavailable] = useState(false);
  const [roomMembersLoading, setRoomMembersLoading] = useState(false);
  const requestSequence = useRef(0);
  const rosterRequestSequence = useRef(0);
  const lastHandledOpenRequest = useRef(0);
  const members = useMemo(
    () =>
      roomRecipients
        .filter((recipient) => !isBotUser(recipient.userId))
        .map((recipient) => ({
          userId: recipient.userId,
          displayName: recipient.displayName?.trim() || recipient.userId,
        })),
    [roomRecipients],
  );
  const joinedMemberIds = useMemo(
    () => new Set(members.map((member) => member.userId)),
    [members],
  );
  const eventTimingIdentity = JSON.stringify(eventTiming);
  const memberById = useMemo(
    () => new Map(members.map((member) => [member.userId, member])),
    [members],
  );
  const loadRoomRecipients = useCallback(async () => {
    const requestId = ++rosterRequestSequence.current;
    const listRecipients = reminderRepository?.listRoomReminderRecipients;
    if (!roomId || typeof listRecipients !== 'function') {
      setRoomRecipients([]);
      setRoomMembersUnavailable(true);
      setRoomMembersLoading(false);
      return undefined;
    }

    setRoomMembersLoading(true);
    try {
      const recipients = await listRecipients.call(reminderRepository);
      if (rosterRequestSequence.current !== requestId) return undefined;
      setRoomRecipients(recipients);
      setRoomMembersUnavailable(false);
      return recipients
        .filter((recipient) => !isBotUser(recipient.userId))
        .map((recipient) => ({
          userId: recipient.userId,
          displayName: recipient.displayName?.trim() || recipient.userId,
        }));
    } catch {
      if (rosterRequestSequence.current === requestId) {
        setRoomRecipients([]);
        setRoomMembersUnavailable(true);
      }
      return undefined;
    } finally {
      if (rosterRequestSequence.current === requestId) {
        setRoomMembersLoading(false);
      }
    }
  }, [reminderRepository, roomId]);
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

  if (!canManageReminders || !reminderRepository) {
    return null;
  }

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
    if (!draft || savingKey) return;
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
    if (savingKey) return;
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

  const renderOption = (
    option: CalendarRoomReminderAlarmOption,
    index: number,
  ) => {
    const key = reminderOptionKey(option);
    const controlId = `calendar-room-reminder-${index}`;
    const configuration = configurations[key];
    const draft =
      drafts[key] ?? createDraft(configuration, members, calendarTimezone);
    const changed = !isSameDraft(draft, configuration, option);
    const departedUserIds = new Set(
      roomMembersUnavailable
        ? draft.departedUserIds
        : [
            ...draft.departedUserIds,
            ...draft.userIds.filter((userId) => !joinedMemberIds.has(userId)),
          ],
    );
    const missingMembers = departedUserIds.size > 0;
    const targetValue =
      configuration?.target.kind === 'room'
        ? 'room'
        : configuration?.target.kind === 'users'
          ? 'users'
          : 'off';
    const selectedRecurringSeries =
      isRecurringSeries && option.recurrenceId === null;
    const now = Date.now();
    const pastSchedule = option.requiresAllDaySchedule
      ? getAllDaySchedulePastState(draft.allDaySchedule, eventTiming, now)
      : undefined;
    const scheduleChanged =
      option.requiresAllDaySchedule &&
      !sameAllDaySchedule(draft.allDaySchedule, configuration?.allDaySchedule);
    const pastScheduleBlocksSave =
      pastSchedule === 'past' &&
      !selectedRecurringSeries &&
      draft.destination !== 'off' &&
      (configuration === undefined || scheduleChanged);
    const selectedPeopleUnavailable =
      draft.destination === 'users' &&
      (roomMembersLoading ||
        roomMembersUnavailable ||
        draft.userIds.length === 0 ||
        draft.userIds.some((userId) => !joinedMemberIds.has(userId)));

    return (
      <Stack key={key} spacing={1.25} sx={{ py: 1.25 }}>
        <Stack spacing={0.35}>
          <Typography variant="subtitle2">
            {formatOption(option, index + 1, t)}
          </Typography>
          {!option.supported && (
            <Typography color="text.secondary" variant="body2">
              {formatUnavailableReason(option.unavailableReason, t)}
            </Typography>
          )}
          {option.supported && (
            <Typography color="text.secondary" variant="body2">
              {t(
                'calendarEvents.roomReminder.channels',
                'CalDAV keeps the calendar alert. Matrix controls who gets pinged in this room.',
              )}
            </Typography>
          )}
        </Stack>

        {option.supported ? (
          <Stack spacing={1.25}>
            <FormControl size="small" fullWidth>
              <InputLabel id={`${controlId}-destination-label`}>
                {t(
                  'calendarEvents.roomReminder.destination',
                  'Matrix destination',
                )}
              </InputLabel>
              <Select
                label={t(
                  'calendarEvents.roomReminder.destination',
                  'Matrix destination',
                )}
                labelId={`${controlId}-destination-label`}
                onChange={(event) =>
                  updateDraft(key, {
                    destination: event.target
                      .value as ReminderDestinationChoice,
                  })
                }
                value={draft.destination}
              >
                <MenuItem value="off">
                  {t('calendarEvents.roomReminder.off', 'Off')}
                </MenuItem>
                <MenuItem value="room">
                  {t('calendarEvents.roomReminder.wholeRoom', 'Whole room')}
                </MenuItem>
                <MenuItem
                  disabled={
                    roomMembersLoading ||
                    roomMembersUnavailable ||
                    members.length === 0
                  }
                  value="users"
                >
                  {t(
                    'calendarEvents.roomReminder.selectedPeople',
                    'Selected people',
                  )}
                </MenuItem>
              </Select>
              <FormHelperText>
                {t(
                  'calendarEvents.roomReminder.destinationHelp',
                  'Off leaves the CalDAV alert in place and stops Matrix pings.',
                )}
              </FormHelperText>
            </FormControl>

            {(members.length === 0 || roomMembersUnavailable) && (
              <Alert severity="info">
                <Stack
                  alignItems="center"
                  direction="row"
                  justifyContent="space-between"
                  spacing={1}
                >
                  <span>
                    {roomMembersUnavailable
                      ? t(
                          'calendarEvents.roomReminder.membersUnavailable',
                          'The calendar server could not load joined room members.',
                        )
                      : t(
                          'calendarEvents.roomReminder.noMembers',
                          'No joined people are available to select.',
                        )}
                  </span>
                  <Button
                    disabled={roomMembersLoading}
                    onClick={() => void loadRoomRecipients()}
                    size="small"
                  >
                    {roomMembersLoading
                      ? t(
                          'calendarEvents.roomReminder.loading',
                          'Loading reminder settings…',
                        )
                      : t('calendarEvents.roomReminder.retry', 'Retry')}
                  </Button>
                </Stack>
              </Alert>
            )}

            {draft.destination === 'users' && (
              <>
                <Autocomplete
                  filterOptions={filterMemberOptions}
                  getOptionLabel={(member) => member.displayName}
                  isOptionEqualToValue={(left, right) =>
                    left.userId === right.userId
                  }
                  limitTags={4}
                  multiple
                  slotProps={{ popper: { container: popperContainer } }}
                  onClose={() =>
                    setMemberSearchQueries((current) => ({
                      ...current,
                      [key]: '',
                    }))
                  }
                  onChange={(_, selected) => {
                    updateDraft(key, {
                      userIds: selected
                        .slice(0, 50)
                        .map((member) => member.userId),
                    });
                    setMemberSearchQueries((current) => ({
                      ...current,
                      [key]: '',
                    }));
                  }}
                  onInputChange={(_, value, reason) => {
                    if (reason === 'reset') return;
                    setMemberSearchQueries((current) => ({
                      ...current,
                      [key]: value,
                    }));
                  }}
                  inputValue={memberSearchQueries[key] ?? ''}
                  options={members as CalendarReminderMember[]}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      helperText={t(
                        'calendarEvents.roomReminder.peopleHelp',
                        'Only joined room members appear here. Up to 50 people can be pinged.',
                      )}
                      label={t(
                        'calendarEvents.roomReminder.selectedPeople',
                        'Selected people',
                      )}
                    />
                  )}
                  value={draft.userIds.map(
                    (userId) =>
                      memberById.get(userId) ?? {
                        userId,
                        displayName: userId,
                      },
                  )}
                />
                {missingMembers && (
                  <Alert severity="warning">
                    {t(
                      'calendarEvents.roomReminder.departedPeople',
                      '{{count}} saved recipient(s) are no longer joined. They will not be pinged. Save to remove them from this reminder.',
                      { count: departedUserIds.size },
                    )}
                  </Alert>
                )}
              </>
            )}

            {option.requiresAllDaySchedule && draft.destination !== 'off' && (
              <AllDayScheduleFields
                destination={draft.destination}
                eventTiming={eventTiming}
                isRecurringSeries={selectedRecurringSeries}
                now={now}
                onChange={(allDaySchedule) =>
                  updateDraft(key, { allDaySchedule })
                }
                schedule={draft.allDaySchedule}
                t={t}
              />
            )}

            <Stack
              alignItems={{ sm: 'center', xs: 'stretch' }}
              direction={{ sm: 'row', xs: 'column' }}
              spacing={1}
            >
              <Button
                disabled={
                  !changed ||
                  Boolean(savingKey) ||
                  !canSaveDraft(draft, option) ||
                  selectedPeopleUnavailable ||
                  pastScheduleBlocksSave
                }
                onClick={() => void save(option, draft.destination)}
                size="small"
                variant="contained"
              >
                {savingKey === key
                  ? t('calendarEvents.roomReminder.saving', 'Saving…')
                  : t(
                      'calendarEvents.roomReminder.save',
                      'Save Matrix destination',
                    )}
              </Button>
              {targetValue !== 'off' && !changed && (
                <Typography color="text.secondary" variant="body2">
                  {targetValue === 'room'
                    ? t(
                        'calendarEvents.roomReminder.roomSaved',
                        'Matrix pings the whole room.',
                      )
                    : t(
                        'calendarEvents.roomReminder.peopleSaved',
                        'Matrix pings the selected people.',
                      )}
                </Typography>
              )}
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={0.75}>
            {configuration && (
              <Alert severity="warning">
                {t(
                  'calendarEvents.roomReminder.savedUnsupported',
                  'This saved Matrix reminder cannot be delivered with the current CalDAV alarm. Update or remove the calendar alarm, then configure Matrix again.',
                )}
              </Alert>
            )}
            <Button
              onClick={onEditCalendarReminder}
              size="small"
              sx={{ alignSelf: 'flex-start' }}
            >
              {t(
                'calendarEvents.roomReminder.editCalDavAlarm',
                'Edit CalDAV reminder',
              )}
            </Button>
          </Stack>
        )}
        {index < options.length - 1 && <Divider />}
      </Stack>
    );
  };

  const orphanedRows = orphanedConfigurations.map((configuration, index) => {
    const key = reminderOptionKey(configuration);
    return (
      <Stack key={key} spacing={0.75} sx={{ py: 1 }}>
        <Typography variant="subtitle2">
          {t(
            'calendarEvents.roomReminder.missingCalDavAlarm',
            'CalDAV alarm no longer available',
          )}
        </Typography>
        <Typography color="text.secondary" variant="body2">
          {t(
            'calendarEvents.roomReminder.orphaned',
            'This Matrix destination refers to an alarm that is no longer in the event.',
          )}
        </Typography>
        <Button
          disabled={Boolean(savingKey)}
          onClick={() => void removeOrphan(configuration)}
          size="small"
          sx={{ alignSelf: 'flex-start' }}
        >
          {t(
            'calendarEvents.roomReminder.removeMatrixDestination',
            'Remove Matrix destination',
          )}
        </Button>
        {index < orphanedConfigurations.length - 1 && <Divider />}
      </Stack>
    );
  });

  return (
    <Stack spacing={0.75}>
      <Button
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : void load())}
        size="small"
        sx={{ alignSelf: 'flex-start' }}
      >
        {open
          ? t('calendarEvents.roomReminder.close', 'Close reminder settings')
          : t('calendarEvents.roomReminder.action', 'Reminder settings')}
      </Button>
      {open && (
        <Stack spacing={1}>
          <Typography color="text.secondary" variant="body2">
            {t(
              'calendarEvents.roomReminder.description',
              'CalDAV alerts are saved in the event for calendar apps. Matrix destinations control who this room bot pings. Reminder delivery also requires current room permissions.',
            )}
          </Typography>
          {loading && (
            <Typography
              aria-live="polite"
              color="text.secondary"
              variant="body2"
            >
              {t(
                'calendarEvents.roomReminder.loading',
                'Loading reminder settings…',
              )}
            </Typography>
          )}
          {!loading && !error && options.length === 0 && (
            <Alert severity="info">
              {t(
                'calendarEvents.roomReminder.noCalDavAlarms',
                'There is no CalDAV reminder in this event yet. Add one first, then choose who Matrix should ping.',
              )}
            </Alert>
          )}
          {!loading && options.map(renderOption)}
          {!loading && orphanedRows}
          {!loading && options.length === 0 && (
            <Button
              onClick={onEditCalendarReminder}
              size="small"
              sx={{ alignSelf: 'flex-start' }}
            >
              {t(
                'calendarEvents.roomReminder.editCalDavAlarm',
                'Edit CalDAV reminder',
              )}
            </Button>
          )}
          {savingKey && (
            <Typography
              aria-live="polite"
              color="text.secondary"
              variant="body2"
            >
              {t('calendarEvents.roomReminder.saving', 'Saving…')}
            </Typography>
          )}
          {error && (
            <Alert severity="error">
              {t(
                'calendarEvents.roomReminder.saveError',
                'Matrix reminder settings were not saved. The CalDAV alert is unchanged. Check the selected people and time zone, and choose a future reminder time, then retry.',
              )}
            </Alert>
          )}
        </Stack>
      )}
    </Stack>
  );
}

function createDraft(
  configuration: CalendarRoomReminderConfiguration | undefined,
  members: readonly CalendarReminderMember[],
  calendarTimezone?: string,
  membersUnavailable = false,
): ReminderDraft {
  const configuredIds =
    configuration?.target.kind === 'users'
      ? [...configuration.target.userIds]
      : [];
  const joinedIds = new Set(members.map((member) => member.userId));
  return {
    destination: configuration?.target.kind ?? 'off',
    userIds: membersUnavailable
      ? configuredIds
      : configuredIds.filter((userId) => joinedIds.has(userId)),
    departedUserIds: membersUnavailable
      ? []
      : configuredIds.filter((userId) => !joinedIds.has(userId)),
    allDaySchedule: configuration?.allDaySchedule ?? {
      daysBefore: 0,
      localTime: '09:00',
      timezone: calendarTimezone ?? '',
    },
  };
}

function sameAllDaySchedule(
  left: CalendarRoomReminderAllDaySchedule,
  right: CalendarRoomReminderAllDaySchedule | null | undefined,
): boolean {
  return (
    right !== null &&
    right !== undefined &&
    left.daysBefore === right.daysBefore &&
    left.localTime === right.localTime &&
    left.timezone === right.timezone
  );
}

function isSameDraft(
  draft: ReminderDraft,
  configuration: CalendarRoomReminderConfiguration | undefined,
  option: CalendarRoomReminderAlarmOption,
): boolean {
  if (draft.destination === 'off') return configuration === undefined;
  if (!configuration) return false;
  const sameTarget =
    draft.destination === configuration.target.kind &&
    (draft.destination !== 'users' ||
      (configuration.target.kind === 'users' &&
        sameStrings(draft.userIds, configuration.target.userIds)));
  const validSchedule = validateAllDayDraft(draft.allDaySchedule);
  const sameSchedule = option.requiresAllDaySchedule
    ? validSchedule !== null &&
      JSON.stringify(validSchedule) ===
        JSON.stringify(configuration.allDaySchedule)
    : configuration.allDaySchedule === null;
  return sameTarget && sameSchedule && draft.departedUserIds.length === 0;
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return (
    leftSorted.length === rightSorted.length &&
    leftSorted.every((value, index) => value === rightSorted[index])
  );
}

function canSaveDraft(
  draft: ReminderDraft,
  option: CalendarRoomReminderAlarmOption,
): boolean {
  if (draft.destination === 'users') {
    if (draft.userIds.length === 0 || draft.userIds.length > 50) {
      return false;
    }
  }
  return (
    !option.requiresAllDaySchedule ||
    draft.destination === 'off' ||
    validateAllDayDraft(draft.allDaySchedule) !== null
  );
}

function validateAllDayDraft(
  schedule: CalendarRoomReminderAllDaySchedule,
): CalendarRoomReminderAllDaySchedule | null {
  if (
    !Number.isSafeInteger(schedule.daysBefore) ||
    schedule.daysBefore < 0 ||
    schedule.daysBefore > 366 ||
    !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(schedule.localTime) ||
    schedule.timezone.trim() !== schedule.timezone ||
    schedule.timezone.length === 0 ||
    schedule.timezone.length > 64
  ) {
    return null;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: schedule.timezone });
  } catch {
    return null;
  }
  return { ...schedule };
}

function AllDayScheduleFields({
  destination,
  eventTiming,
  isRecurringSeries,
  now,
  onChange,
  schedule,
  t,
}: {
  destination: ReminderDestinationChoice;
  eventTiming: CalendarEventTiming;
  isRecurringSeries: boolean;
  now: number;
  onChange: (schedule: CalendarRoomReminderAllDaySchedule) => void;
  schedule: CalendarRoomReminderAllDaySchedule;
  t: TFunction;
}) {
  const preview =
    eventTiming.type === 'all-day'
      ? previewAllDayDate(eventTiming.startDate, schedule.daysBefore)
      : undefined;
  const pastSchedule = getAllDaySchedulePastState(schedule, eventTiming, now);
  const destinationLabel =
    destination === 'room'
      ? t('calendarEvents.roomReminder.wholeRoomPreview', 'the whole room')
      : t(
          'calendarEvents.roomReminder.selectedPeoplePreview',
          'the selected people',
        );
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">
        {t(
          'calendarEvents.roomReminder.allDaySchedule',
          'Matrix reminder time for this all-day event',
        )}
      </Typography>
      <Stack direction={{ sm: 'row', xs: 'column' }} spacing={1}>
        <TextField
          inputProps={{ min: 0, max: 366, step: 1 }}
          label={t(
            'calendarEvents.roomReminder.daysBefore',
            'Days before event',
          )}
          onChange={(event) =>
            onChange({ ...schedule, daysBefore: Number(event.target.value) })
          }
          type="number"
          value={schedule.daysBefore}
        />
        <TextField
          label={t('calendarEvents.roomReminder.localTime', 'Local time')}
          onChange={(event) =>
            onChange({ ...schedule, localTime: event.target.value })
          }
          type="time"
          value={schedule.localTime}
        />
        <TextField
          fullWidth
          helperText={t(
            'calendarEvents.roomReminder.timezoneHelp',
            'Enter an IANA time zone, for example Europe/Stockholm. This visible choice is saved with the Matrix schedule.',
          )}
          label={t('calendarEvents.roomReminder.timezone', 'Time zone (IANA)')}
          onChange={(event) =>
            onChange({ ...schedule, timezone: event.target.value })
          }
          value={schedule.timezone}
        />
      </Stack>
      <Typography color="text.secondary" variant="body2">
        {preview
          ? t(
              'calendarEvents.roomReminder.preview',
              'Preview: Matrix will ping {{destination}} on {{date}} at {{time}} ({{timezone}}).',
              {
                destination: destinationLabel,
                date: preview,
                time: schedule.localTime || '09:00',
                timezone:
                  schedule.timezone ||
                  t(
                    'calendarEvents.roomReminder.chooseTimezone',
                    'choose a time zone',
                  ),
              },
            )
          : t(
              'calendarEvents.roomReminder.previewUnavailable',
              'Choose the local time and IANA time zone for this Matrix reminder.',
            )}
      </Typography>
      {pastSchedule === 'past' && (
        <Alert severity="warning">
          {isRecurringSeries
            ? t(
                'calendarEvents.roomReminder.pastRecurring',
                'This time has passed for the selected occurrence. Matrix does not send past reminders. The schedule applies to any future occurrences that remain in this series; if none remain, no reminder will be sent.',
              )
            : t(
                'calendarEvents.roomReminder.pastOneTime',
                'This reminder time has already passed. Matrix does not send past reminders. Choose a future time before saving.',
              )}
        </Alert>
      )}
    </Stack>
  );
}

function getAllDaySchedulePastState(
  schedule: CalendarRoomReminderAllDaySchedule,
  eventTiming: CalendarEventTiming,
  now: number,
): 'past' | 'future' | undefined {
  const validSchedule = validateAllDayDraft(schedule);
  if (!validSchedule || eventTiming.type !== 'all-day') return undefined;
  const reminderDate = previewAllDayDate(
    eventTiming.startDate,
    validSchedule.daysBefore,
  );
  const dueAt = calendarLocalDateTimeToUnixMillis(
    `${reminderDate}T${validSchedule.localTime}:00`,
    validSchedule.timezone,
  );
  if (!Number.isFinite(dueAt)) return undefined;
  return dueAt <= now ? 'past' : 'future';
}

function previewAllDayDate(startDate: string, daysBefore: number): string {
  const [year, month, day] = startDate.split('-').map(Number);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isSafeInteger(daysBefore)
  ) {
    return startDate;
  }
  return new Date(Date.UTC(year, month - 1, day - daysBefore))
    .toISOString()
    .slice(0, 10);
}

function formatOption(
  option: CalendarRoomReminderAlarmOption,
  index: number,
  t: TFunction,
): string {
  if (!option.trigger || !option.relatedTo) {
    return t(
      'calendarEvents.roomReminder.optionUnavailableLabel',
      'Alarm {{index}} from CalDAV',
      { index },
    );
  }
  const duration = formatDuration(option.trigger);
  const relative =
    option.relatedTo === 'start'
      ? t(
          'calendarEvents.roomReminder.relativeToStart',
          '{{duration}} relative to event start',
          { duration },
        )
      : t(
          'calendarEvents.roomReminder.relativeToEnd',
          '{{duration}} relative to event end',
          { duration },
        );
  const timing = !option.repeat
    ? relative
    : t(
        'calendarEvents.roomReminder.repeatLabel',
        '{{timing}}; repeats {{count}} times every {{interval}}',
        {
          timing: relative,
          count: option.repeat.count,
          interval: formatDuration(option.repeat.interval),
        },
      );
  return t(
    'calendarEvents.roomReminder.optionLabel',
    'Alarm {{index}}: {{timing}}',
    {
      index,
      timing,
    },
  );
}

function formatUnavailableReason(
  reason: CalendarRoomReminderAlarmOption['unavailableReason'],
  t: TFunction,
): string {
  switch (reason) {
    case 'unsupported-timezone':
      return t(
        'calendarEvents.roomReminder.unsupportedTimezone',
        'The event uses time-zone rules this reminder service cannot resolve.',
      );
    case 'unsupported-event-timing':
      return t(
        'calendarEvents.roomReminder.unsupportedEventTiming',
        'The event time is floating or otherwise unsupported for Matrix delivery.',
      );
    case 'absolute-trigger':
      return t(
        'calendarEvents.roomReminder.absoluteTrigger',
        'This alarm fires at an exact UTC time, so Matrix cannot follow the event if it moves.',
      );
    case 'unsupported-trigger':
      return t(
        'calendarEvents.roomReminder.unsupportedTrigger',
        'This alarm uses a trigger or repeat pattern Matrix delivery cannot schedule.',
      );
    default:
      return t(
        'calendarEvents.roomReminder.unsupportedTrigger',
        'This alarm uses a trigger or repeat pattern Matrix delivery cannot schedule.',
      );
  }
}

function reminderOptionKey(option: CalendarRoomReminderIdentity): string {
  return JSON.stringify([
    option.eventUid,
    option.alarmUid,
    option.recurrenceId,
  ]);
}

function formatDuration(duration: CalendarEventDuration): string {
  const parts = [
    duration.weeks > 0 ? `${duration.weeks}w` : undefined,
    duration.days > 0 ? `${duration.days}d` : undefined,
    duration.hours > 0 ? `${duration.hours}h` : undefined,
    duration.minutes > 0 ? `${duration.minutes}m` : undefined,
    duration.seconds > 0 ? `${duration.seconds}s` : undefined,
  ].filter((part): part is string => part !== undefined);
  const value = parts.length > 0 ? parts.join(' ') : '0s';
  return duration.isNegative ? `−${value}` : value;
}
