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
import { useRenameCalendar } from '../../calendar';

export function CalendarRenameDialog({
  calendars,
  onClose,
  open,
}: {
  calendars: Calendar[];
  onClose: () => void;
  open: boolean;
}) {
  const { t } = useTranslation();
  const renameCalendar = useRenameCalendar();
  const writableCalendars = useMemo(
    () => calendars.filter((calendar) => !calendar.readOnly),
    [calendars],
  );
  const [calendarId, setCalendarId] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error>();

  useEffect(() => {
    if (!open) {
      return;
    }

    const calendar = writableCalendars[0];
    setCalendarId(calendar?.id ?? '');
    setName(calendar?.name ?? '');
    setError(undefined);
  }, [open, writableCalendars]);

  const handleCalendarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextId = event.target.value;
    const calendar = writableCalendars.find(
      (candidate) => candidate.id === nextId,
    );
    setCalendarId(nextId);
    setName(calendar?.name ?? '');
    setError(undefined);
  };

  const nameRequired = name.trim().length === 0;
  const valid = Boolean(calendarId) && !nameRequired;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) {
      return;
    }

    setSaving(true);
    setError(undefined);

    try {
      await renameCalendar(calendarId, name.trim());
      onClose();
    } catch {
      setError(
        new Error(
          t('calendars.rename.error', 'The calendar could not be renamed.'),
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      fullWidth
      maxWidth="xs"
      onClose={saving ? undefined : onClose}
      open={open}
    >
      <form onSubmit={handleSubmit}>
        <DialogTitle>
          {t('calendars.rename.title', 'Rename calendar')}
        </DialogTitle>
        <DialogContent>
          <Stack mt={1} spacing={2}>
            {error && <Alert severity="error">{error.message}</Alert>}
            <TextField
              disabled={saving}
              label={t('calendars.rename.calendar', 'Calendar')}
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
              autoFocus
              disabled={saving}
              error={nameRequired}
              helperText={
                nameRequired
                  ? t(
                      'calendars.rename.nameRequired',
                      'A calendar name is required.',
                    )
                  : undefined
              }
              label={t('calendars.rename.name', 'Calendar name')}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={saving} onClick={onClose}>
            {t('cancel', 'Cancel')}
          </Button>
          <LoadingButton
            disabled={!valid}
            loading={saving}
            type="submit"
            variant="contained"
          >
            {t('calendars.rename.submit', 'Rename calendar')}
          </LoadingButton>
        </DialogActions>
      </form>
    </Dialog>
  );
}
