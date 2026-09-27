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

import { Calendar } from '@matrix-calendar-widget/calendar';
import { LoadingButton } from '@mui/lab';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdateCalendarColor } from '../../calendar';

const HEX_COLOR = /^#[\da-fA-F]{6}$/;

export function CalendarColorDialog({
  calendars,
  onClose,
  open,
}: {
  calendars: Calendar[];
  onClose: () => void;
  open: boolean;
}) {
  const { t } = useTranslation();
  const updateColor = useUpdateCalendarColor();
  const writableCalendars = useMemo(
    () => calendars.filter((calendar) => calendar.readOnly === false),
    [calendars],
  );
  const [calendarId, setCalendarId] = useState('');
  const [color, setColor] = useState('');
  const [originalColor, setOriginalColor] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error>();

  useEffect(() => {
    if (!open) {
      return;
    }

    const calendar = writableCalendars[0];
    const nextColor = calendar?.color ?? '';
    setCalendarId(calendar?.id ?? '');
    setColor(nextColor);
    setOriginalColor(nextColor);
    setError(undefined);
  }, [open, writableCalendars]);

  const handleCalendarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextId = event.target.value;
    const calendar = writableCalendars.find(
      (candidate) => candidate.id === nextId,
    );
    const nextColor = calendar?.color ?? '';
    setCalendarId(nextId);
    setColor(nextColor);
    setOriginalColor(nextColor);
    setError(undefined);
  };

  const unchanged = color === originalColor;
  const valid = unchanged || color === '' || HEX_COLOR.test(color);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!calendarId || unchanged || !valid) {
      return;
    }

    setSaving(true);
    setError(undefined);

    try {
      await updateColor(calendarId, color);
      onClose();
    } catch {
      setError(
        new Error(
          t('calendars.color.error', 'The calendar color could not be saved.'),
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      fullWidth
      maxWidth="sm"
      onClose={saving ? undefined : onClose}
      open={open}
    >
      <form onSubmit={handleSubmit}>
        <DialogTitle>
          {t('calendars.color.title', 'Edit calendar color')}
        </DialogTitle>
        <DialogContent>
          <Stack mt={1} spacing={2}>
            {error && <Alert severity="error">{error.message}</Alert>}
            <TextField
              disabled={saving}
              label={t('calendars.color.calendar', 'Calendar')}
              onChange={handleCalendarChange}
              select
              SelectProps={{ native: true }}
              value={calendarId}
            >
              {writableCalendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </option>
              ))}
            </TextField>
            <TextField
              disabled={saving}
              error={!valid}
              helperText={
                valid
                  ? t(
                      'calendars.color.hint',
                      'Enter a six-digit hex color, such as #336699.',
                    )
                  : t(
                      'calendars.color.invalid',
                      'Use a six-digit hex color in the form #RRGGBB.',
                    )
              }
              label={t('calendars.color.label', 'Color')}
              onChange={(event) => setColor(event.target.value)}
              value={color}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={saving} onClick={onClose}>
            {t('cancel', 'Cancel')}
          </Button>
          <Button
            disabled={saving || color === ''}
            onClick={() => setColor('')}
          >
            {t('calendars.color.clear', 'Clear color')}
          </Button>
          <LoadingButton
            disabled={!calendarId || unchanged || !valid}
            loading={saving}
            type="submit"
            variant="contained"
          >
            {t('calendars.color.submit', 'Save color')}
          </LoadingButton>
        </DialogActions>
      </form>
    </Dialog>
  );
}
