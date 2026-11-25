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

import { FormControlLabel, Switch, TextField, Typography } from '@mui/material';
import type { CalendarEventEditorModel } from './useCalendarEventEditor';

export function CalendarEventTimingFields({
  model,
  occurrence = false,
}: {
  model: CalendarEventEditorModel;
  occurrence?: boolean;
}) {
  const {
    values,
    t,
    handleChange,
    timingHelpText,
    followingTimingUnchanged,
    handleTimingTypeChange,
  } = model;
  if (!values) return null;
  return occurrence ? (
    <>
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
    </>
  ) : (
    <>
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
    </>
  );
}
