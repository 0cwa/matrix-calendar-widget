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
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeleteCalendar } from '../../calendar';

export function CalendarDeleteDialog({
  calendars,
  onClose,
  open,
}: {
  calendars: Calendar[];
  onClose: () => void;
  open: boolean;
}) {
  const { t } = useTranslation();
  const deleteCalendar = useDeleteCalendar();
  const firstCalendar = calendars[0];
  const [calendarId, setCalendarId] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<Error>();

  useEffect(() => {
    if (open) {
      setCalendarId(firstCalendar?.id ?? '');
      setError(undefined);
    }
  }, [firstCalendar?.id, open]);

  const selectedCalendar =
    calendars.find((calendar) => calendar.id === calendarId) ?? firstCalendar;

  const handleCalendarChange = (event: ChangeEvent<HTMLInputElement>) => {
    setCalendarId(event.target.value);
    setError(undefined);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedCalendar) {
      return;
    }

    setDeleting(true);
    setError(undefined);

    try {
      await deleteCalendar(selectedCalendar.id);
      onClose();
    } catch {
      setError(
        new Error(
          t('calendars.delete.error', 'The calendar could not be deleted.'),
        ),
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog
      fullWidth
      maxWidth="xs"
      onClose={deleting ? undefined : onClose}
      open={open}
    >
      <form onSubmit={handleSubmit}>
        <DialogTitle>
          {t('calendars.delete.title', 'Delete calendar')}
        </DialogTitle>
        <DialogContent>
          <Stack mt={1} spacing={2}>
            {error && (
              <Alert role="alert" severity="error">
                {error.message}
              </Alert>
            )}
            <TextField
              disabled={deleting}
              label={t('calendars.delete.calendar', 'Calendar')}
              onChange={handleCalendarChange}
              select
              SelectProps={{ native: true }}
              value={calendarId}
            >
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </option>
              ))}
            </TextField>
            {selectedCalendar && (
              <DialogContentText>
                {t(
                  'calendars.delete.description',
                  'Delete “{{name}}” and all of its events? This cannot be undone.',
                  { name: selectedCalendar.name },
                )}
              </DialogContentText>
            )}
            <DialogContentText>
              {t(
                'calendars.delete.safeguard',
                'Calendars containing unsupported or unknown data are protected and cannot be deleted here.',
              )}
            </DialogContentText>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={deleting} onClick={onClose}>
            {t('cancel', 'Cancel')}
          </Button>
          <LoadingButton
            color="error"
            disabled={!selectedCalendar}
            loading={deleting}
            type="submit"
            variant="contained"
          >
            {t('calendars.delete.submit', 'Delete calendar')}
          </LoadingButton>
        </DialogActions>
      </form>
    </Dialog>
  );
}
