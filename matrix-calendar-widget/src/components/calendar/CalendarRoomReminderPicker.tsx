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
  CalendarEventTiming,
  calendarLocalDateTimeToUnixMillis,
} from '@matrix-calendar-widget/calendar';
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
import { useTranslation } from 'react-i18next';
import {
  CalendarRoomReminderAlarmOption,
  CalendarRoomReminderAllDaySchedule,
} from '../../calendar';
import {
  canSaveDraft,
  createDraft,
  isSameDraft,
  reminderOptionKey,
  sameAllDaySchedule,
  validateAllDayDraft,
  type CalendarReminderMember,
  type ReminderDestinationChoice,
} from './roomReminderModel';
import { useRoomReminderSettings } from './useRoomReminderSettings';

const filterMemberOptions = createFilterOptions<CalendarReminderMember>({
  limit: 100,
  stringify: (member) => `${member.displayName} ${member.userId}`,
});

export function CalendarRoomReminderPicker({
  calendarTimezone,
  eventTiming,
  isRecurringSeries,
  onEditCalendarReminder,
  popperContainer,
  ...settings
}: ReturnType<typeof useRoomReminderSettings> & {
  calendarTimezone?: string;
  eventTiming: CalendarEventTiming;
  isRecurringSeries: boolean;
  onEditCalendarReminder: () => void;
  popperContainer?: () => HTMLElement | null;
}) {
  const { t } = useTranslation();
  const {
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
  } = settings;
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
