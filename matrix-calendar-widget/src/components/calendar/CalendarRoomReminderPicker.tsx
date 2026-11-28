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
  const { t, i18n } = useTranslation();
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
    const recipients = describeRecipients(
      draft.destination,
      roomMembersUnavailable
        ? draft.userIds
        : draft.userIds.filter((userId) => joinedMemberIds.has(userId)),
      memberById,
      members,
      i18n.language,
      t,
    );
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
              {option.requiresAllDaySchedule
                ? t(
                    'calendarEvents.roomReminder.allDayTiming',
                    'This event lasts all day, so the room notification has its own day, time and time zone. The alert’s lead time does not set them.',
                  )
                : formatTimedTiming(eventTiming, t)}
            </Typography>
          )}
        </Stack>

        {option.supported ? (
          <Stack spacing={1.25}>
            <FormControl size="small" fullWidth>
              <InputLabel id={`${controlId}-destination-label`}>
                {t(
                  'calendarEvents.roomReminder.destination',
                  'Who to notify in this room',
                )}
              </InputLabel>
              <Select
                label={t(
                  'calendarEvents.roomReminder.destination',
                  'Who to notify in this room',
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
                  'Off keeps the calendar app alert and sends no Matrix room notification.',
                )}
              </FormHelperText>
            </FormControl>

            {(members.length === 0 || roomMembersUnavailable) && (
              <Alert severity="info">
                <Stack alignItems="flex-start" spacing={1}>
                  <span>
                    {roomMembersUnavailable
                      ? t(
                          'calendarEvents.roomReminder.membersUnavailable',
                          'The calendar server could not load joined room members. Selected people cannot be saved until it can; Whole room and Off still work.',
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
                  getOptionLabel={(member) => memberName(member, members)}
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
                        'Only joined room members appear here. Up to 50 people can be pinged. Everyone in the room can still read the message.',
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
                      '{{count}} saved recipient(s) are no longer joined. They will not be pinged. Save to remove them from this room notification.',
                      { count: departedUserIds.size },
                    )}
                  </Alert>
                )}
              </>
            )}

            {option.requiresAllDaySchedule && draft.destination !== 'off' && (
              <AllDayScheduleFields
                eventTiming={eventTiming}
                isRecurringSeries={selectedRecurringSeries}
                now={now}
                onChange={(allDaySchedule) =>
                  updateDraft(key, { allDaySchedule })
                }
                recipients={recipients}
                schedule={draft.allDaySchedule}
                t={t}
              />
            )}

            {!option.requiresAllDaySchedule && draft.destination !== 'off' && (
              <Typography color="text.secondary" variant="body2">
                {recipients === undefined
                  ? t(
                      'calendarEvents.roomReminder.previewNoPeople',
                      'Choose at least one person to preview who Matrix will ping.',
                    )
                  : t(
                      'calendarEvents.roomReminder.timedPreview',
                      'Preview: Matrix will ping {{destination}} when this alert is due.',
                      { destination: recipients },
                    )}
              </Typography>
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
                      'Save room notification',
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
                  'This saved Matrix room notification cannot be delivered with the current calendar app alert. Update or remove the alert, then set up the notification again.',
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
                'Edit calendar app alert',
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
            'Calendar app alert no longer available',
          )}
        </Typography>
        <Typography color="text.secondary" variant="body2">
          {t(
            'calendarEvents.roomReminder.orphaned',
            'This Matrix room notification refers to an alert that is no longer on the event.',
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
            'Remove room notification',
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
          ? t(
              'calendarEvents.roomReminder.close',
              'Close Matrix room notifications',
            )
          : t(
              'calendarEvents.roomReminder.action',
              'Matrix room notifications',
            )}
      </Button>
      {open && (
        <Stack spacing={1}>
          <Typography color="text.secondary" variant="body2">
            {t(
              'calendarEvents.roomReminder.description',
              'Calendar app alerts are saved with the event for calendar apps. Matrix room notifications are separate messages from the room bot in this room. Delivery also requires current room permissions.',
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
                'There is no calendar app alert on this event yet. Add one first, then choose who Matrix should ping.',
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
                'Edit calendar app alert',
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
                'Matrix room notification settings were not saved. The calendar app alert is unchanged. Check the selected people and time zone, and choose a future notification time, then retry.',
              )}
            </Alert>
          )}
        </Stack>
      )}
    </Stack>
  );
}

function AllDayScheduleFields({
  eventTiming,
  isRecurringSeries,
  now,
  onChange,
  recipients,
  schedule,
  t,
}: {
  eventTiming: CalendarEventTiming;
  isRecurringSeries: boolean;
  now: number;
  onChange: (schedule: CalendarRoomReminderAllDaySchedule) => void;
  recipients: string | undefined;
  schedule: CalendarRoomReminderAllDaySchedule;
  t: TFunction;
}) {
  const preview =
    eventTiming.type === 'all-day' && validateAllDayDraft(schedule)
      ? previewAllDayDate(eventTiming.startDate, schedule.daysBefore)
      : undefined;
  const pastSchedule = getAllDaySchedulePastState(schedule, eventTiming, now);
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">
        {t(
          'calendarEvents.roomReminder.allDaySchedule',
          'When to notify for this all-day event',
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
            'Area/city name, for example Europe/Stockholm. The local time is read in this zone.',
          )}
          label={t(
            'calendarEvents.roomReminder.timezone',
            'Notification time zone',
          )}
          onChange={(event) =>
            onChange({ ...schedule, timezone: event.target.value })
          }
          value={schedule.timezone}
        />
      </Stack>
      <Typography color="text.secondary" variant="body2">
        {recipients === undefined
          ? t(
              'calendarEvents.roomReminder.previewNoPeople',
              'Choose at least one person to preview who Matrix will ping.',
            )
          : preview
            ? t(
                'calendarEvents.roomReminder.preview',
                'Preview: Matrix will ping {{destination}} on {{date}} at {{time}} ({{timezone}}).',
                {
                  destination: recipients,
                  date: preview,
                  time: schedule.localTime,
                  timezone: schedule.timezone,
                },
              )
            : t(
                'calendarEvents.roomReminder.previewUnavailable',
                'Enter the days before, local time and a valid time zone to preview this room notification.',
              )}
      </Typography>
      {pastSchedule === 'past' && (
        <Alert severity="warning">
          {isRecurringSeries
            ? t(
                'calendarEvents.roomReminder.pastRecurring',
                'This time has passed for the selected occurrence. Matrix does not send past notifications. The schedule applies to any future occurrences that remain in this series; if none remain, no notification will be sent.',
              )
            : t(
                'calendarEvents.roomReminder.pastOneTime',
                'This notification time has already passed. Matrix does not send past notifications. Choose a future time before saving.',
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

/** Names who a draft would ping. Undefined while no person is selected. */
function describeRecipients(
  destination: ReminderDestinationChoice,
  userIds: readonly string[],
  memberById: ReadonlyMap<string, CalendarReminderMember>,
  members: readonly CalendarReminderMember[],
  language: string,
  t: TFunction,
): string | undefined {
  if (destination === 'room') {
    return t(
      'calendarEvents.roomReminder.wholeRoomPreview',
      'everyone in this room',
    );
  }
  if (destination !== 'users' || userIds.length === 0) return undefined;
  const names = new Intl.ListFormat(language, { type: 'conjunction' }).format(
    userIds.map((userId) => {
      const member = memberById.get(userId);
      return member ? memberName(member, members) : userId;
    }),
  );
  return t(
    'calendarEvents.roomReminder.selectedPeoplePreview',
    '{{names}} in this room',
    { names },
  );
}

/** Adds the Matrix ID when two joined people share a display name. */
function memberName(
  member: CalendarReminderMember,
  members: readonly CalendarReminderMember[],
): string {
  const shared = members.some(
    (other) =>
      other.userId !== member.userId &&
      other.displayName === member.displayName,
  );
  return shared
    ? `${member.displayName} (${member.userId})`
    : member.displayName;
}

function formatTimedTiming(
  eventTiming: CalendarEventTiming,
  t: TFunction,
): string {
  const timezone =
    eventTiming.type === 'timed' && eventTiming.start.type === 'zoned'
      ? eventTiming.start.timezone
      : undefined;
  return timezone
    ? t(
        'calendarEvents.roomReminder.timedTiming',
        'Follows this calendar app alert. Event time zone: {{timezone}}.',
        { timezone },
      )
    : t(
        'calendarEvents.roomReminder.timedTimingNoZone',
        'Follows this calendar app alert.',
      );
}

function formatOption(
  option: CalendarRoomReminderAlarmOption,
  index: number,
  t: TFunction,
): string {
  if (!option.trigger || !option.relatedTo) {
    return t(
      'calendarEvents.roomReminder.optionUnavailableLabel',
      'Calendar app alert {{index}}',
      { index },
    );
  }
  const relative = formatTrigger(option.trigger, option.relatedTo, t);
  const timing = !option.repeat
    ? relative
    : t(
        'calendarEvents.roomReminder.repeatLabel',
        '{{timing}}; repeats {{count}} times every {{interval}}',
        {
          timing: relative,
          count: option.repeat.count,
          interval: formatDuration(option.repeat.interval, t),
        },
      );
  return t(
    'calendarEvents.roomReminder.optionLabel',
    'Calendar app alert {{index}}: {{timing}}',
    {
      index,
      timing,
    },
  );
}

function formatTrigger(
  trigger: CalendarEventDuration,
  relatedTo: 'start' | 'end',
  t: TFunction,
): string {
  const { weeks, days, hours, minutes, seconds } = trigger;
  if (!(weeks || days || hours || minutes || seconds)) {
    return relatedTo === 'start'
      ? t('calendarEvents.roomReminder.atStart', 'when the event starts')
      : t('calendarEvents.roomReminder.atEnd', 'when the event ends');
  }
  const duration = formatDuration(trigger, t);
  if (trigger.isNegative) {
    return relatedTo === 'start'
      ? t(
          'calendarEvents.roomReminder.beforeStart',
          '{{duration}} before the event starts',
          { duration },
        )
      : t(
          'calendarEvents.roomReminder.beforeEnd',
          '{{duration}} before the event ends',
          { duration },
        );
  }
  return relatedTo === 'start'
    ? t(
        'calendarEvents.roomReminder.afterStart',
        '{{duration}} after the event starts',
        { duration },
      )
    : t(
        'calendarEvents.roomReminder.afterEnd',
        '{{duration}} after the event ends',
        { duration },
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
        'Matrix room notifications cannot resolve the time-zone rules this event uses.',
      );
    case 'unsupported-event-timing':
      return t(
        'calendarEvents.roomReminder.unsupportedEventTiming',
        'Matrix room notifications need a supported event time with a time zone.',
      );
    case 'absolute-trigger':
      return t(
        'calendarEvents.roomReminder.absoluteTrigger',
        'This alert is set to an exact UTC time, so a Matrix room notification cannot follow the event if it moves.',
      );
    case 'unsupported-trigger':
      return t(
        'calendarEvents.roomReminder.unsupportedTrigger',
        'Matrix room notifications cannot schedule the timing or repeat pattern of this alert.',
      );
    default:
      return t(
        'calendarEvents.roomReminder.unsupportedTrigger',
        'Matrix room notifications cannot schedule the timing or repeat pattern of this alert.',
      );
  }
}

function formatDuration(duration: CalendarEventDuration, t: TFunction): string {
  const { weeks, days, hours, minutes, seconds } = duration;
  const parts: string[] = [];
  if (weeks > 0) {
    parts.push(
      t('calendarEvents.roomReminder.weeks', '{{count}} weeks', {
        count: weeks,
      }),
    );
  }
  if (days > 0) {
    parts.push(
      t('calendarEvents.roomReminder.days', '{{count}} days', { count: days }),
    );
  }
  if (hours > 0) {
    parts.push(
      t('calendarEvents.roomReminder.hours', '{{count}} hours', {
        count: hours,
      }),
    );
  }
  if (minutes > 0) {
    parts.push(
      t('calendarEvents.roomReminder.minutes', '{{count}} minutes', {
        count: minutes,
      }),
    );
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(
      t('calendarEvents.roomReminder.seconds', '{{count}} seconds', {
        count: seconds,
      }),
    );
  }
  return parts.join(' ');
}
