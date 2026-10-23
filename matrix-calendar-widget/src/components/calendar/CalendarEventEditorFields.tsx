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
  CalendarEventDateTime,
  CalendarEventDuration,
  CalendarEventRecurrenceDate,
} from '@matrix-calendar-widget/calendar';
import { LoadingButton } from '@mui/lab';
import {
  Alert,
  Button,
  Checkbox,
  DialogContent,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { calendarEventFormStartWeekday } from '../../calendar';
import type { CalendarEventEditorModel } from './useCalendarEventEditor';

export function CalendarEventEditorFields({
  model,
}: {
  model: CalendarEventEditorModel;
}) {
  const {
    t,
    periodDurationHelperId,
    writableCalendars,
    initialCalendar,
    values,
    saving,
    savingRoomReminderSetup,
    error,
    conflict,
    missingOccurrence,
    readOnly,
    chooseScope,
    editingOccurrence,
    editingFollowing,
    occurrenceHasAlarm,
    occurrenceHasChanges,
    attachmentControlsDisabled,
    followingSupported,
    periodValue,
    isRdatePeriodEditable,
    editingEndPeriod,
    invalidPeriodEnd,
    invalidPeriodDuration,
    followingTimingUnchanged,
    periodFormDisabled,
    periodDurationFields,
    timingHelpText,
    handleChange,
    handleAttachmentOperationChange,
    handleAttachmentSourceChange,
    handleCalendarChange,
    handleRecurrenceToggle,
    handleAlarmToggle,
    handleAlarmDurationChange,
    handleAlarmModeChange,
    handleRdateDraftChange,
    handleRdatePeriodEndChange,
    handleRdatePeriodDurationChange,
    handleAddRdate,
    handleAddPeriodRdate,
    handleEditPeriodRdate,
    handleSavePeriodEdit,
    handleRemoveRdate,
    handleCancelRdate,
    handleRemoveExdate,
    handleCancelExdate,
    handleWeekdayModeChange,
    handleMonthlyByDayChange,
    handleWeekdayChange,
    handleTimingTypeChange,
    validationErrorCode,
    weeklyByDayEnabled,
    canChooseWeekdays,
    validationError,
    onSaveAndConfigureRoomReminders,
    handleReloadLatest,
    chooseOccurrenceScope,
    handleOccurrenceTextModeChange,
    chooseFollowingScope,
    chooseSeriesScope,
    calendars,
    event,
    onClose,
    WEEKDAYS,
  } = model;
  if (!values || !initialCalendar) {
    return null;
  }

  return (
    <DialogContent>
      {error && (
        <Alert
          action={
            conflict ? (
              <Button
                color="inherit"
                disabled={saving}
                onClick={handleReloadLatest}
                size="small"
              >
                {t('calendarEvents.editor.reloadLatest', 'Reload latest')}
              </Button>
            ) : missingOccurrence ? (
              <Button color="inherit" onClick={onClose} size="small">
                {t('calendarEvents.details.close', 'Close')}
              </Button>
            ) : undefined
          }
          severity="error"
        >
          {error.message}
        </Alert>
      )}
      {chooseScope ? (
        <Stack mt={1} spacing={2}>
          <Typography>
            {t('calendarEvents.editor.chooseEditScope', 'Choose what to edit')}
          </Typography>
          {occurrenceHasAlarm && (
            <Alert severity="info">
              {t(
                'calendarEvents.editor.instanceAlarmBlocked',
                'This series contains reminder data, so occurrence and following timing edits are unavailable. Edit the entire series instead.',
              )}
            </Alert>
          )}
          {!occurrenceHasAlarm && !followingSupported && (
            <Alert severity="info">
              {t(
                'calendarEvents.editor.unsupportedFollowingTiming',
                'This series cannot use a following timing edit because its recurrence data is outside the bounded rules this editor can safely write.',
              )}
            </Alert>
          )}
          <Stack direction={{ sm: 'row', xs: 'column' }} spacing={1}>
            <Button
              disabled={readOnly || occurrenceHasAlarm}
              onClick={chooseOccurrenceScope}
              variant="outlined"
            >
              {t('calendarEvents.editor.instanceScope', 'This occurrence only')}
            </Button>
            <Button
              disabled={readOnly || occurrenceHasAlarm || !followingSupported}
              onClick={chooseFollowingScope}
              variant="outlined"
            >
              {t('calendarEvents.editor.followingScope', 'This and following')}
            </Button>
            <Button onClick={chooseSeriesScope} variant="outlined">
              {t('calendarEvents.editor.seriesScope', 'Entire series')}
            </Button>
          </Stack>
        </Stack>
      ) : editingOccurrence || editingFollowing ? (
        <Stack mt={1} spacing={2}>
          <Alert severity="info">
            {editingFollowing
              ? t(
                  'calendarEvents.editor.followingTimingOnly',
                  'This occurrence and every later occurrence will use the start and end below. Original recurrence dates and time zone stay unchanged. Timed events keep the entered elapsed duration; all-day events keep the entered whole-day duration.',
                )
              : t(
                  'calendarEvents.editor.instanceEditHelp',
                  'Change only this occurrence’s title, description, location, or timing.',
                )}
          </Alert>
          {editingOccurrence &&
            (
              [
                {
                  field: 'title',
                  label: t('calendarEvents.editor.title', 'Title'),
                  useSeriesLabel: t(
                    'calendarEvents.editor.useSeriesTitle',
                    'Use series title',
                  ),
                },
                {
                  field: 'description',
                  label: t('calendarEvents.editor.description', 'Description'),
                  useSeriesLabel: t(
                    'calendarEvents.editor.useSeriesDescription',
                    'Use series description',
                  ),
                },
                {
                  field: 'location',
                  label: t('calendarEvents.editor.location', 'Location'),
                  useSeriesLabel: t(
                    'calendarEvents.editor.useSeriesLocation',
                    'Use series location',
                  ),
                },
              ] as const
            ).map(({ field, label, useSeriesLabel }) => {
              const unsupported =
                values.occurrenceTextUnsupported?.[field] === true;
              const mode = values.occurrenceTextModes?.[field] ?? 'series';
              return (
                <FormControl key={field}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={mode === 'series'}
                        disabled={readOnly || saving || unsupported}
                        onChange={handleOccurrenceTextModeChange(field)}
                      />
                    }
                    label={useSeriesLabel}
                  />
                  <TextField
                    disabled={
                      readOnly || saving || unsupported || mode === 'series'
                    }
                    label={label}
                    onChange={handleChange(field)}
                    value={values[field]}
                  />
                  {unsupported && (
                    <FormHelperText>
                      {t(
                        'calendarEvents.editor.occurrenceTextUnavailable',
                        'This occurrence has text data this editor cannot safely change.',
                      )}
                    </FormHelperText>
                  )}
                </FormControl>
              );
            })}
          <TextField
            InputLabelProps={{ shrink: true }}
            label={t('calendarEvents.editor.start', 'Start')}
            onChange={handleChange('start')}
            required
            type={values.timingType === 'all-day' ? 'date' : 'datetime-local'}
            value={values.start}
          />
          <TextField
            InputLabelProps={{ shrink: true }}
            label={t('calendarEvents.editor.end', 'End')}
            onChange={handleChange('end')}
            required
            type={values.timingType === 'all-day' ? 'date' : 'datetime-local'}
            value={values.end}
          />
          {values.timingType === 'timed' &&
            (values.timedKind ?? 'zoned') === 'zoned' && (
              <TextField
                label={t('calendarEvents.editor.timezone', 'Time zone')}
                onChange={handleChange('timezone')}
                required
                value={values.timezone}
              />
            )}
          {timingHelpText && (
            <Typography color="text.secondary" variant="body2">
              {timingHelpText}
            </Typography>
          )}
          {followingTimingUnchanged && (
            <Typography color="text.secondary" variant="body2">
              {t(
                'calendarEvents.editor.followingChangeRequired',
                'Change the start or end before saving this and following occurrences.',
              )}
            </Typography>
          )}
          {validationError && (
            <Alert severity="warning">{validationError}</Alert>
          )}
          {readOnly && (
            <Alert severity="warning">
              {t(
                'calendarEvents.editor.readOnly',
                'This calendar is read-only.',
              )}
            </Alert>
          )}
        </Stack>
      ) : (
        <Stack mt={1} spacing={2}>
          <TextField
            disabled={Boolean(event)}
            label={t('calendarEvents.editor.calendar', 'Calendar')}
            onChange={handleCalendarChange}
            select
            SelectProps={{ native: true }}
            value={values.calendarId}
          >
            {(event ? calendars : writableCalendars).map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.name}
              </option>
            ))}
          </TextField>

          <TextField
            autoFocus
            label={t('calendarEvents.editor.title', 'Title')}
            onChange={handleChange('title')}
            required
            value={values.title}
          />

          <FormControlLabel
            control={
              <Switch
                checked={values.timingType === 'all-day'}
                onChange={handleTimingTypeChange}
              />
            }
            label={t('calendarEvents.editor.allDay', 'All day')}
          />

          <TextField
            InputLabelProps={{ shrink: true }}
            label={t('calendarEvents.editor.start', 'Start')}
            onChange={handleChange('start')}
            required
            type={values.timingType === 'all-day' ? 'date' : 'datetime-local'}
            value={values.start}
          />

          <TextField
            InputLabelProps={{ shrink: true }}
            label={t('calendarEvents.editor.end', 'End')}
            onChange={handleChange('end')}
            required
            type={values.timingType === 'all-day' ? 'date' : 'datetime-local'}
            value={values.end}
          />

          {values.timingType === 'timed' &&
            (values.timedKind ?? 'zoned') === 'zoned' && (
              <TextField
                label={t('calendarEvents.editor.timezone', 'Time zone')}
                onChange={handleChange('timezone')}
                required
                value={values.timezone}
              />
            )}
          {values.timingType === 'timed' && timingHelpText && (
            <Typography color="text.secondary" variant="body2">
              {timingHelpText}
            </Typography>
          )}

          <TextField
            label={t('calendarEvents.editor.location', 'Location')}
            onChange={handleChange('location')}
            value={values.location}
          />

          {values.conferenceEditable === false && (
            <Alert severity="info">
              {t(
                'calendarEvents.editor.unsupportedConferenceReadOnly',
                'Conference editing is unavailable for source data this editor cannot safely reconcile. Other edits will preserve it.',
              )}
            </Alert>
          )}

          <TextField
            disabled={values.conferenceEditable === false}
            helperText={t(
              'calendarEvents.editor.conferenceUrlHelp',
              'Use an HTTP(S) link. Clear the URL to remove the conference link.',
            )}
            label={t('calendarEvents.editor.conferenceUrl', 'Conference URL')}
            onChange={handleChange('conferenceUrl')}
            type="url"
            value={values.conferenceUrl}
          />

          <TextField
            disabled={values.conferenceEditable === false}
            label={t(
              'calendarEvents.editor.conferenceLabel',
              'Conference label',
            )}
            onChange={handleChange('conferenceLabel')}
            value={values.conferenceLabel}
          />

          {values.attachmentEditable === false && (
            <Alert severity="info">
              {t(
                'calendarEvents.editor.unsupportedAttachmentReadOnly',
                'Attachment editing is unavailable for source data this editor cannot safely reconcile. Other edits will preserve it.',
              )}
            </Alert>
          )}

          <TextField
            disabled={attachmentControlsDisabled}
            label={t(
              'calendarEvents.editor.attachmentOperation',
              'Attachment link',
            )}
            onChange={handleAttachmentOperationChange}
            select
            value={values.attachmentOperation ?? 'none'}
          >
            <MenuItem value="none">
              {t('calendarEvents.editor.attachmentNoChange', 'No change')}
            </MenuItem>
            <MenuItem value="add">
              {t('calendarEvents.editor.attachmentAdd', 'Add link')}
            </MenuItem>
            {(values.attachmentUrls?.length ?? 0) > 0 && (
              <MenuItem value="set">
                {t('calendarEvents.editor.attachmentReplace', 'Replace link')}
              </MenuItem>
            )}
            {(values.attachmentUrls?.length ?? 0) > 0 && (
              <MenuItem value="remove">
                {t('calendarEvents.editor.attachmentRemove', 'Remove link')}
              </MenuItem>
            )}
          </TextField>

          {(values.attachmentOperation === 'set' ||
            values.attachmentOperation === 'remove') && (
            <TextField
              disabled={attachmentControlsDisabled}
              label={t(
                'calendarEvents.editor.attachmentSource',
                'Existing attachment link',
              )}
              onChange={handleAttachmentSourceChange}
              select
              value={values.attachmentSourceUrl ?? ''}
            >
              {(values.attachmentUrls ?? []).map((url) => (
                <MenuItem key={url} value={url}>
                  {url}
                </MenuItem>
              ))}
            </TextField>
          )}

          {(values.attachmentOperation === 'add' ||
            values.attachmentOperation === 'set') && (
            <TextField
              disabled={attachmentControlsDisabled}
              error={validationErrorCode === 'invalid-attachment'}
              helperText={t(
                'calendarEvents.editor.attachmentUrlHelp',
                'Use an HTTP(S) URL. The link is saved as text; no file is uploaded or fetched.',
              )}
              label={t('calendarEvents.editor.attachmentUrl', 'Attachment URL')}
              onChange={handleChange('attachmentUrl')}
              type="url"
              value={values.attachmentUrl ?? ''}
            />
          )}

          {values.attachmentChanged && (
            <Typography color="text.secondary" variant="body2">
              {t(
                'calendarEvents.editor.attachmentWillBeSaved',
                'One attachment link change will be applied when you save.',
              )}
            </Typography>
          )}

          <TextField
            label={t('calendarEvents.editor.description', 'Description')}
            multiline
            minRows={3}
            onChange={handleChange('description')}
            value={values.description}
          />

          <FormControl component="fieldset">
            <FormControlLabel
              control={
                <Switch
                  checked={Boolean(values.alarmEnabled)}
                  disabled={values.alarmEditable === false}
                  onChange={handleAlarmToggle}
                />
              }
              label={t('calendarEvents.editor.caldavAlarm', 'CalDAV reminder')}
            />
            {values.alarmDisabledReason && (
              <Alert severity="info">
                {t(
                  'calendarEvents.editor.unsupportedAlarmReadOnly',
                  'This event contains alarm data this editor cannot safely change. Other event edits will preserve it.',
                )}
              </Alert>
            )}
            {values.alarmEnabled && values.alarmEditable !== false && (
              <Stack spacing={1}>
                <FormLabel component="legend">
                  {t('calendarEvents.editor.alarmMode', 'Alarm timing')}
                </FormLabel>
                <RadioGroup
                  aria-label={t(
                    'calendarEvents.editor.alarmMode',
                    'Alarm timing',
                  )}
                  onChange={handleAlarmModeChange}
                  row
                  value={values.alarmMode ?? 'relative'}
                >
                  <FormControlLabel
                    control={<Radio />}
                    label={t(
                      'calendarEvents.editor.alarmRelativeMode',
                      'Before the event',
                    )}
                    value="relative"
                  />
                  <FormControlLabel
                    control={<Radio />}
                    label={t(
                      'calendarEvents.editor.alarmAbsoluteMode',
                      'At an exact UTC time',
                    )}
                    value="absolute"
                  />
                </RadioGroup>
                {values.alarmMode === 'absolute' ? (
                  <Stack spacing={1}>
                    <TextField
                      fullWidth
                      helperText={t(
                        'calendarEvents.editor.alarmUtcDateTimeHelp',
                        'Enter YYYY-MM-DDTHH:mm:ssZ in UTC.',
                      )}
                      label={t(
                        'calendarEvents.editor.alarmUtcDateTime',
                        'Exact time (UTC)',
                      )}
                      onChange={handleAlarmDurationChange('alarmUtcDateTime')}
                      placeholder="2026-10-01T08:45:00Z"
                      value={values.alarmUtcDateTime ?? ''}
                    />
                    <Typography color="text.secondary" variant="body2">
                      {t(
                        'calendarEvents.editor.absoluteAlarmBoundary',
                        'This absolute alarm is saved to the calendar and cannot be delivered as a Matrix room reminder.',
                      )}
                    </Typography>
                  </Stack>
                ) : (
                  <Stack spacing={1}>
                    <FormLabel component="legend">
                      {t(
                        'calendarEvents.editor.alarmLeadTime',
                        'Time before the event starts',
                      )}
                    </FormLabel>
                    <Stack direction={{ sm: 'row', xs: 'column' }} spacing={1}>
                      {(
                        [
                          ['alarmWeeks', 'alarmWeeks', 'Weeks before'],
                          ['alarmDays', 'alarmDays', 'Days before'],
                          ['alarmHours', 'alarmHours', 'Hours before'],
                          ['alarmMinutes', 'alarmMinutes', 'Minutes before'],
                          ['alarmSeconds', 'alarmSeconds', 'Seconds before'],
                        ] as const
                      ).map(([field, key, fallback]) => (
                        <TextField
                          inputProps={{ min: 0, step: 1 }}
                          key={field}
                          label={t(`calendarEvents.editor.${key}`, fallback)}
                          onChange={handleAlarmDurationChange(field)}
                          type="number"
                          value={values[field] ?? '0'}
                        />
                      ))}
                    </Stack>
                    <Typography color="text.secondary" variant="body2">
                      {t(
                        'calendarEvents.editor.alarmBoundary',
                        'This stores a CalDAV display alarm for clients that support it. Matrix reminder delivery is separate.',
                      )}
                    </Typography>
                  </Stack>
                )}
              </Stack>
            )}
          </FormControl>

          {onSaveAndConfigureRoomReminders && (
            <Alert severity="info">
              <Stack spacing={1}>
                <Typography variant="body2">
                  {t(
                    'calendarEvents.editor.matrixReminderSaveFirst',
                    'Save this event first. Supported timed Matrix reminders follow the saved CalDAV alert; all-day events need a separate local time and time zone. Choose who Matrix should ping after the save.',
                  )}
                </Typography>
                <LoadingButton
                  data-save-intent="configure-room-reminders"
                  disabled={
                    saving ||
                    Boolean(validationError) ||
                    readOnly ||
                    chooseScope ||
                    missingOccurrence ||
                    followingTimingUnchanged ||
                    (editingOccurrence && !occurrenceHasChanges)
                  }
                  loading={savingRoomReminderSetup}
                  onClick={(submitEvent) => {
                    const form = submitEvent.currentTarget.form;
                    const saveIntent =
                      submitEvent.currentTarget.dataset.saveIntent;

                    if (form && saveIntent && form.reportValidity()) {
                      form.dataset.saveIntent = saveIntent;
                      try {
                        form.requestSubmit();
                      } finally {
                        delete form.dataset.saveIntent;
                      }
                    }
                  }}
                  size="small"
                  type="button"
                  variant="outlined"
                >
                  {t(
                    'calendarEvents.editor.saveAndConfigureMatrixReminders',
                    'Save and configure Matrix reminders',
                  )}
                </LoadingButton>
              </Stack>
            </Alert>
          )}

          <FormControlLabel
            control={
              <Switch
                checked={Boolean(values.repeats)}
                disabled={!values.recurrenceEditable}
                onChange={handleRecurrenceToggle}
              />
            }
            label={t('calendarEvents.editor.repeats', 'Repeats')}
          />

          {values.recurrenceDisabledReason && (
            <Alert severity="info">
              {values.recurrenceDisabledReason === 'complex'
                ? t(
                    'calendarEvents.editor.complexRecurrenceReadOnly',
                    'This event includes additional dates or exceptions. Recurrence editing is disabled, and other changes will preserve them.',
                  )
                : t(
                    'calendarEvents.editor.unsupportedRecurrenceReadOnly',
                    'This recurrence rule or time zone is not supported for editing. Other changes will preserve it.',
                  )}
            </Alert>
          )}

          {values.repeats && values.recurrenceEditable && (
            <>
              <TextField
                label={t('calendarEvents.editor.frequency', 'Frequency')}
                onChange={handleChange('recurrenceFrequency')}
                select
                SelectProps={{ native: true }}
                value={values.recurrenceFrequency ?? 'DAILY'}
              >
                <option value="DAILY">
                  {t('calendarEvents.editor.daily', 'Daily')}
                </option>
                <option value="WEEKLY">
                  {t('calendarEvents.editor.weekly', 'Weekly')}
                </option>
                <option value="MONTHLY">
                  {t('calendarEvents.editor.monthly', 'Monthly')}
                </option>
                <option value="YEARLY">
                  {t('calendarEvents.editor.yearly', 'Yearly')}
                </option>
              </TextField>

              <TextField
                inputProps={{ min: 1, step: 1 }}
                label={t('calendarEvents.editor.interval', 'Repeat every')}
                onChange={handleChange('recurrenceInterval')}
                required
                type="number"
                value={values.recurrenceInterval ?? '1'}
              />

              <TextField
                label={t('calendarEvents.editor.ends', 'Ends')}
                onChange={handleChange('recurrenceEnd')}
                select
                SelectProps={{ native: true }}
                value={values.recurrenceEnd ?? 'never'}
              >
                <option value="never">
                  {t('calendarEvents.editor.never', 'Never')}
                </option>
                <option value="count">
                  {t('calendarEvents.editor.afterCount', 'After occurrences')}
                </option>
                <option value="until">
                  {t('calendarEvents.editor.onDate', 'On date')}
                </option>
              </TextField>

              {values.recurrenceFrequency === 'WEEKLY' && (
                <>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={values.recurrenceWeekdays !== undefined}
                        disabled={!weeklyByDayEnabled && !canChooseWeekdays}
                        onChange={handleWeekdayModeChange}
                      />
                    }
                    label={t(
                      'calendarEvents.editor.chooseWeekdays',
                      'Choose weekdays',
                    )}
                  />
                  {!weeklyByDayEnabled && !canChooseWeekdays && (
                    <Typography color="text.secondary" variant="body2">
                      {t(
                        'calendarEvents.editor.weekdayRuleLimit',
                        'Weekday selection requires a positive whole-number interval.',
                      )}
                    </Typography>
                  )}
                  {weeklyByDayEnabled && (
                    <FormControl component="fieldset">
                      <FormLabel component="legend">
                        {t('calendarEvents.editor.repeatOn', 'Repeat on')}
                      </FormLabel>
                      <FormGroup row sx={{ flexWrap: 'wrap' }}>
                        {WEEKDAYS.map((weekday) => {
                          const startWeekday =
                            calendarEventFormStartWeekday(values);
                          return (
                            <FormControlLabel
                              control={
                                <Checkbox
                                  checked={
                                    weekday === startWeekday ||
                                    values.recurrenceWeekdays?.includes(
                                      weekday,
                                    ) === true
                                  }
                                  disabled={weekday === startWeekday}
                                  onChange={() => handleWeekdayChange(weekday)}
                                />
                              }
                              key={weekday}
                              label={t(
                                `calendarEvents.editor.weekday${weekday}`,
                                weekday,
                              )}
                            />
                          );
                        })}
                      </FormGroup>
                      <Typography color="text.secondary" variant="body2">
                        {t(
                          'calendarEvents.editor.startWeekdayRequired',
                          'The start date’s weekday is always included.',
                        )}
                      </Typography>
                    </FormControl>
                  )}
                </>
              )}

              {values.recurrenceFrequency === 'MONTHLY' && (
                <>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={Boolean(values.recurrenceMonthlyByDay)}
                        onChange={handleMonthlyByDayChange}
                      />
                    }
                    label={t(
                      'calendarEvents.editor.monthlyByDay',
                      'Repeat by weekday',
                    )}
                  />
                  {values.recurrenceMonthlyByDay && (
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      <TextField
                        label={t(
                          'calendarEvents.editor.monthlyOrdinal',
                          'Week of the month',
                        )}
                        onChange={handleChange('recurrenceMonthlyOrdinal')}
                        select
                        SelectProps={{ native: true }}
                        value={values.recurrenceMonthlyOrdinal ?? '1'}
                      >
                        <option value="1">
                          {t('calendarEvents.editor.ordinalFirst', 'First')}
                        </option>
                        <option value="2">
                          {t('calendarEvents.editor.ordinalSecond', 'Second')}
                        </option>
                        <option value="3">
                          {t('calendarEvents.editor.ordinalThird', 'Third')}
                        </option>
                        <option value="4">
                          {t('calendarEvents.editor.ordinalFourth', 'Fourth')}
                        </option>
                        <option value="5">
                          {t('calendarEvents.editor.ordinalFifth', 'Fifth')}
                        </option>
                        <option value="-1">
                          {t('calendarEvents.editor.ordinalLast', 'Last')}
                        </option>
                      </TextField>
                      <TextField
                        label={t(
                          'calendarEvents.editor.monthlyWeekday',
                          'Weekday',
                        )}
                        onChange={handleChange('recurrenceMonthlyWeekday')}
                        select
                        SelectProps={{ native: true }}
                        value={values.recurrenceMonthlyWeekday ?? 'MO'}
                      >
                        {WEEKDAYS.map((weekday) => (
                          <option key={weekday} value={weekday}>
                            {t(
                              `calendarEvents.editor.weekday${weekday}`,
                              weekday,
                            )}
                          </option>
                        ))}
                      </TextField>
                    </Stack>
                  )}
                  {values.recurrenceMonthlyByDay && (
                    <Typography color="text.secondary" variant="body2">
                      {t(
                        'calendarEvents.editor.monthlyOrdinalStartHelp',
                        'The start date must match the selected weekday pattern.',
                      )}
                    </Typography>
                  )}
                </>
              )}

              {values.recurrenceEnd === 'count' && (
                <TextField
                  inputProps={{ min: 1, step: 1 }}
                  label={t(
                    'calendarEvents.editor.occurrenceCount',
                    'Number of occurrences',
                  )}
                  onChange={handleChange('recurrenceCount')}
                  required
                  type="number"
                  value={values.recurrenceCount ?? '2'}
                />
              )}

              {values.recurrenceEnd === 'until' && (
                <TextField
                  InputLabelProps={{ shrink: true }}
                  label={t('calendarEvents.editor.untilDate', 'Until date')}
                  onChange={handleChange('recurrenceUntil')}
                  required
                  type="date"
                  value={values.recurrenceUntil ?? ''}
                />
              )}

              <Typography color="text.secondary" variant="body2">
                {t(
                  'calendarEvents.editor.seriesOnly',
                  'Changes apply to the entire series.',
                )}
              </Typography>
            </>
          )}

          {event && values.rdateEditable && (
            <FormControl component="fieldset">
              <FormLabel component="legend">
                {t(
                  'calendarEvents.editor.additionalDates',
                  'Additional recurrence dates',
                )}
              </FormLabel>
              <Stack spacing={1}>
                {(values.rdateValues ?? []).map((value, index) => {
                  const label = formatRdateValue(value);
                  return (
                    <Stack
                      alignItems="center"
                      direction="row"
                      justifyContent="space-between"
                      key={`${label}-${index}`}
                    >
                      <Typography variant="body2">{label}</Typography>
                      {value.type === 'period' &&
                        isRdatePeriodEditable(value) && (
                          <Button
                            aria-label={t(
                              'calendarEvents.editor.editPeriodDate',
                              'Edit period',
                            ).concat(`: ${label}`)}
                            disabled={
                              Boolean(values.rdateOperation) ||
                              Boolean(values.rdateEditSource) ||
                              values.exdateChanged === true ||
                              values.timingChanged === true ||
                              saving
                            }
                            onClick={() => handleEditPeriodRdate(value)}
                            type="button"
                          >
                            {t('calendarEvents.editor.editPeriod', 'Edit')}
                          </Button>
                        )}
                      <Button
                        aria-label={t(
                          value.type === 'period'
                            ? 'calendarEvents.editor.removePeriodDate'
                            : 'calendarEvents.editor.removeAdditionalDate',
                          value.type === 'period'
                            ? 'Remove period date'
                            : 'Remove additional date',
                        ).concat(`: ${label}`)}
                        disabled={
                          Boolean(values.rdateOperation) ||
                          Boolean(values.rdateEditSource) ||
                          values.exdateChanged === true ||
                          values.timingChanged === true ||
                          saving
                        }
                        onClick={() => handleRemoveRdate(value)}
                        type="button"
                      >
                        {t('calendarEvents.editor.remove', 'Remove')}
                      </Button>
                    </Stack>
                  );
                })}
                <TextField
                  disabled={
                    Boolean(values.rdateOperation) ||
                    values.exdateChanged === true ||
                    values.timingChanged === true ||
                    saving
                  }
                  inputProps={
                    values.originalTiming?.type === 'all-day'
                      ? { 'data-testid': 'rdate-draft' }
                      : {
                          'data-testid': 'rdate-draft',
                          step: values.rdateEditSource ? 1 : 60,
                        }
                  }
                  InputLabelProps={{ shrink: true }}
                  label={
                    values.rdateEditSource
                      ? t('calendarEvents.editor.periodStart', 'Period start')
                      : t(
                          'calendarEvents.editor.additionalDate',
                          'Additional date',
                        )
                  }
                  onChange={handleRdateDraftChange}
                  required
                  type={
                    values.originalTiming?.type === 'all-day'
                      ? 'date'
                      : 'datetime-local'
                  }
                  value={values.rdateDraft ?? ''}
                />
                {values.originalTiming?.type === 'timed' && (
                  <FormHelperText>
                    {values.rdateEditSource
                      ? t(
                          'calendarEvents.editor.periodStartEditHelp',
                          'Update the start while keeping its saved time zone and date-time kind.',
                        )
                      : t(
                          'calendarEvents.editor.periodStartHelp',
                          'For an added period, the date and time above are its start.',
                        )}
                  </FormHelperText>
                )}
                {values.originalTiming?.type === 'timed' &&
                  values.timingType === 'timed' && (
                    <FormControl
                      component="fieldset"
                      disabled={periodFormDisabled}
                    >
                      <FormLabel component="legend">
                        {editingEndPeriod
                          ? t(
                              'calendarEvents.editor.periodEndGroup',
                              'Explicit end of period',
                            )
                          : values.rdateEditSource
                            ? t(
                                'calendarEvents.editor.existingPeriodDuration',
                                'Duration of period',
                              )
                            : t(
                                'calendarEvents.editor.periodDuration',
                                'Duration of added period',
                              )}
                      </FormLabel>
                      {editingEndPeriod ? (
                        <>
                          <TextField
                            inputProps={{
                              'aria-describedby': periodDurationHelperId,
                              'data-testid': 'rdate-period-end',
                              step: 1,
                            }}
                            InputLabelProps={{ shrink: true }}
                            label={t(
                              'calendarEvents.editor.periodEnd',
                              'Period end',
                            )}
                            onChange={handleRdatePeriodEndChange}
                            required
                            type="datetime-local"
                            value={values.rdateEndDraft ?? ''}
                          />
                          <FormHelperText
                            error={invalidPeriodEnd}
                            id={periodDurationHelperId}
                          >
                            {invalidPeriodEnd
                              ? t(
                                  'calendarEvents.editor.invalidPeriodEnd',
                                  'The end must be later than the start and keep its saved date-time kind and time zone.',
                                )
                              : t(
                                  'calendarEvents.editor.periodEndHelp',
                                  'The explicit end keeps its saved date-time kind and time zone.',
                                )}
                          </FormHelperText>
                        </>
                      ) : (
                        <>
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ flexWrap: 'wrap', rowGap: 1 }}
                          >
                            {periodDurationFields.map(({ field, label }) => (
                              <TextField
                                inputProps={{
                                  'aria-describedby': periodDurationHelperId,
                                  min: 0,
                                  step: 1,
                                }}
                                key={field}
                                label={label}
                                onChange={handleRdatePeriodDurationChange(
                                  field,
                                )}
                                size="small"
                                sx={{
                                  flex: '1 1 84px',
                                  minWidth: 82,
                                  maxWidth: 116,
                                }}
                                type="number"
                                value={values[field] ?? ''}
                              />
                            ))}
                          </Stack>
                          <FormHelperText
                            error={invalidPeriodDuration}
                            id={periodDurationHelperId}
                          >
                            {invalidPeriodDuration
                              ? t(
                                  'calendarEvents.editor.invalidRdateDuration',
                                  'Enter a positive duration using whole-number units. Weeks cannot be combined with other units.',
                                )
                              : t(
                                  'calendarEvents.editor.periodDurationHelp',
                                  'Use positive whole numbers. Weeks cannot be combined with days or time units.',
                                )}
                          </FormHelperText>
                        </>
                      )}
                    </FormControl>
                  )}
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                  <Button
                    disabled={
                      Boolean(values.rdateOperation) ||
                      Boolean(values.rdateEditSource) ||
                      values.exdateChanged === true ||
                      values.timingChanged === true ||
                      values.rdateDraft?.trim() === '' ||
                      saving
                    }
                    onClick={handleAddRdate}
                    type="button"
                  >
                    {t('calendarEvents.editor.addAdditionalDate', 'Add date')}
                  </Button>
                  {values.rdateEditSource ? (
                    <Button
                      aria-describedby={
                        editingEndPeriod ? undefined : periodDurationHelperId
                      }
                      disabled={
                        periodFormDisabled || !periodValue || invalidPeriodEnd
                      }
                      onClick={handleSavePeriodEdit}
                      type="button"
                    >
                      {t(
                        'calendarEvents.editor.savePeriodChanges',
                        'Save period changes',
                      )}
                    </Button>
                  ) : (
                    values.originalTiming?.type === 'timed' &&
                    values.timingType === 'timed' && (
                      <Button
                        aria-describedby={periodDurationHelperId}
                        disabled={periodFormDisabled || !periodValue}
                        onClick={handleAddPeriodRdate}
                        type="button"
                      >
                        {t('calendarEvents.editor.addPeriodDate', 'Add period')}
                      </Button>
                    )
                  )}
                  {(values.rdateOperation || values.rdateEditSource) && (
                    <Button
                      disabled={saving}
                      onClick={handleCancelRdate}
                      type="button"
                    >
                      {t(
                        'calendarEvents.editor.cancelDateChange',
                        'Cancel date change',
                      )}
                    </Button>
                  )}
                </Stack>
                {values.rdateOperation && (
                  <Typography color="text.secondary" variant="body2">
                    {values.rdateOperation.action === 'add'
                      ? t(
                          'calendarEvents.editor.dateWillBeAdded',
                          'The date will be added when you save.',
                        )
                      : values.rdateOperation.action === 'add-period'
                        ? t(
                            'calendarEvents.editor.periodWillBeAdded',
                            'The period will be added when you save.',
                          )
                        : values.rdateOperation.action === 'replace-period'
                          ? t(
                              'calendarEvents.editor.periodWillBeUpdated',
                              'The period will be updated when you save.',
                            )
                          : t(
                              'calendarEvents.editor.dateWillBeRemoved',
                              'The date will be removed when you save.',
                            )}
                  </Typography>
                )}
              </Stack>
            </FormControl>
          )}

          {event && values.exdateEditable && (
            <FormControl component="fieldset">
              <FormLabel component="legend">
                {t('calendarEvents.editor.excludedDates', 'Excluded dates')}
              </FormLabel>
              <Stack spacing={1}>
                {(values.exdateValues ?? []).map((value, index) => {
                  const label = formatRdateDateTime(value);
                  return (
                    <Stack
                      alignItems="center"
                      direction="row"
                      justifyContent="space-between"
                      key={`${label}-${index}`}
                    >
                      <Typography variant="body2">{label}</Typography>
                      <Button
                        aria-label={t(
                          'calendarEvents.editor.removeExcludedDate',
                          'Remove excluded date',
                        ).concat(`: ${label}`)}
                        disabled={
                          Boolean(values.exdateOperation) ||
                          Boolean(values.rdateOperation) ||
                          values.timingChanged === true ||
                          saving
                        }
                        onClick={() => handleRemoveExdate(value)}
                        type="button"
                      >
                        {t('calendarEvents.editor.remove', 'Remove')}
                      </Button>
                    </Stack>
                  );
                })}
                {values.exdateOperation && (
                  <Stack direction="row" spacing={1}>
                    <Button
                      disabled={saving}
                      onClick={handleCancelExdate}
                      type="button"
                    >
                      {t(
                        'calendarEvents.editor.cancelDateChange',
                        'Cancel date change',
                      )}
                    </Button>
                    <Typography color="text.secondary" variant="body2">
                      {t(
                        'calendarEvents.editor.excludedDateWillBeRemoved',
                        'The excluded date will be removed when you save.',
                      )}
                    </Typography>
                  </Stack>
                )}
              </Stack>
            </FormControl>
          )}

          {validationError && (
            <Alert severity="warning">{validationError}</Alert>
          )}
          {readOnly && (
            <Alert severity="warning">
              {t(
                'calendarEvents.editor.readOnly',
                'This calendar is read-only.',
              )}
            </Alert>
          )}
        </Stack>
      )}
    </DialogContent>
  );
}

function formatRdateValue(value: CalendarEventRecurrenceDate): string {
  if (value.type === 'period') {
    const { timing } = value;
    return timing.type === 'end'
      ? `${formatRdateDateTime(timing.start)} – ${formatRdateDateTime(timing.end)}`
      : `${formatRdateDateTime(timing.start)} (${formatRdateDuration(timing.duration)})`;
  }
  return formatRdateDateTime(value);
}

function formatRdateDateTime(value: CalendarEventDateTime): string {
  switch (value.type) {
    case 'date':
      return value.value;
    case 'floating-date-time':
      return value.value;
    case 'date-time':
      return `${value.value.local} ${value.value.timezone}`;
  }
}

function formatRdateDuration(duration: CalendarEventDuration): string {
  const parts = [
    duration.weeks && `${duration.weeks}w`,
    duration.days && `${duration.days}d`,
    duration.hours && `${duration.hours}h`,
    duration.minutes && `${duration.minutes}m`,
    duration.seconds && `${duration.seconds}s`,
  ].filter(Boolean);
  return `${duration.isNegative ? '−' : ''}${parts.join(' ') || '0s'}`;
}
