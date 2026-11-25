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
  Alert,
  Button,
  Checkbox,
  DialogContent,
  FormControl,
  FormControlLabel,
  FormHelperText,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { CalendarEventAlarmFields } from './CalendarEventAlarmFields';
import { CalendarEventAttachmentFields } from './CalendarEventAttachmentFields';
import { CalendarEventRecurrenceFields } from './CalendarEventRecurrenceFields';
import type { CalendarEventEditorModel } from './useCalendarEventEditor';

export function CalendarEventEditorFields({
  model,
}: {
  model: CalendarEventEditorModel;
}) {
  const {
    t,
    writableCalendars,
    initialCalendar,
    values,
    saving,
    error,
    conflict,
    missingOccurrence,
    readOnly,
    chooseScope,
    editingOccurrence,
    editingFollowing,
    occurrenceHasAlarm,
    followingSupported,
    followingTimingUnchanged,
    timingHelpText,
    handleChange,
    handleCalendarChange,
    handleTimingTypeChange,
    validationError,
    handleReloadLatest,
    chooseOccurrenceScope,
    handleOccurrenceTextModeChange,
    chooseFollowingScope,
    chooseSeriesScope,
    calendars,
    event,
    onClose,
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

          <CalendarEventAttachmentFields model={model} />

          <TextField
            label={t('calendarEvents.editor.description', 'Description')}
            multiline
            minRows={3}
            onChange={handleChange('description')}
            value={values.description}
          />

          <CalendarEventAlarmFields model={model} />

          <CalendarEventRecurrenceFields model={model} />

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
