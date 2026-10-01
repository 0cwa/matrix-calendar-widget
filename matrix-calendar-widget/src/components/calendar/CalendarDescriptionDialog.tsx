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
import { useUpdateCalendarDescription } from '../../calendar';

export function CalendarDescriptionDialog({
  calendars,
  onClose,
  open,
}: {
  calendars: Calendar[];
  onClose: () => void;
  open: boolean;
}) {
  const { t } = useTranslation();
  const updateDescription = useUpdateCalendarDescription();
  const writableCalendars = useMemo(
    () => calendars.filter((calendar) => calendar.readOnly === false),
    [calendars],
  );
  const [calendarId, setCalendarId] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error>();

  useEffect(() => {
    if (!open) {
      return;
    }

    const calendar = writableCalendars[0];
    setCalendarId(calendar?.id ?? '');
    setDescription(calendar?.description ?? '');
    setError(undefined);
  }, [open, writableCalendars]);

  const handleCalendarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextId = event.target.value;
    const calendar = writableCalendars.find(
      (candidate) => candidate.id === nextId,
    );
    setCalendarId(nextId);
    setDescription(calendar?.description ?? '');
    setError(undefined);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!calendarId) {
      return;
    }

    setSaving(true);
    setError(undefined);

    try {
      await updateDescription(calendarId, description);
      onClose();
    } catch {
      setError(
        new Error(
          t(
            'calendars.description.error',
            'The calendar description could not be saved.',
          ),
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
          {t('calendars.description.title', 'Edit calendar description')}
        </DialogTitle>
        <DialogContent>
          <Stack mt={1} spacing={2}>
            {error && <Alert severity="error">{error.message}</Alert>}
            <TextField
              disabled={saving}
              label={t('calendars.description.calendar', 'Calendar')}
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
              label={t('calendars.description.label', 'Description')}
              multiline
              minRows={3}
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={saving} onClick={onClose}>
            {t('cancel', 'Cancel')}
          </Button>
          <LoadingButton
            disabled={!calendarId}
            loading={saving}
            type="submit"
            variant="contained"
          >
            {t('calendars.description.submit', 'Save description')}
          </LoadingButton>
        </DialogActions>
      </form>
    </Dialog>
  );
}
