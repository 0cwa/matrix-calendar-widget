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
  Calendar,
  CalendarMetadataPatch,
} from '@matrix-calendar-widget/calendar';
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
import { useUpdateCalendarMetadata } from '../../calendar';

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;

export function CalendarMetadataDialog({
  calendars,
  onClose,
  open,
}: {
  calendars: Calendar[];
  onClose: () => void;
  open: boolean;
}) {
  const { t } = useTranslation();
  const updateMetadata = useUpdateCalendarMetadata();
  const writableCalendars = useMemo(
    () => calendars.filter((calendar) => !calendar.readOnly),
    [calendars],
  );
  const [calendarId, setCalendarId] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error>();

  const selectedCalendar = writableCalendars.find(
    (calendar) => calendar.id === calendarId,
  );
  const initialDescription = selectedCalendar?.description ?? '';
  const initialColor = selectedCalendar?.color ?? '';
  const descriptionChanged = description !== initialDescription;
  const colorChanged = color.trim() !== initialColor;
  const colorInvalid =
    colorChanged &&
    color.trim().length > 0 &&
    !COLOR_PATTERN.test(color.trim());
  const valid =
    Boolean(selectedCalendar) &&
    (descriptionChanged || colorChanged) &&
    !colorInvalid;

  useEffect(() => {
    if (!open) {
      return;
    }

    const calendar = writableCalendars[0];
    setCalendarId(calendar?.id ?? '');
    setDescription(calendar?.description ?? '');
    setColor(calendar?.color ?? '');
    setError(undefined);
  }, [open, writableCalendars]);

  const handleCalendarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextId = event.target.value;
    const calendar = writableCalendars.find(
      (candidate) => candidate.id === nextId,
    );
    setCalendarId(nextId);
    setDescription(calendar?.description ?? '');
    setColor(calendar?.color ?? '');
    setError(undefined);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !selectedCalendar) {
      return;
    }

    const patch: CalendarMetadataPatch = {};
    if (descriptionChanged) {
      patch.description = description.trim() ? description : null;
    }
    if (colorChanged) {
      patch.color = color.trim() || null;
    }

    setSaving(true);
    setError(undefined);

    try {
      await updateMetadata(selectedCalendar.id, patch);
      onClose();
    } catch {
      setError(
        new Error(
          t('calendars.metadata.error', 'Calendar details could not be saved.'),
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
          {t('calendars.metadata.title', 'Edit calendar details')}
        </DialogTitle>
        <DialogContent>
          <Stack mt={1} spacing={2}>
            {error && <Alert severity="error">{error.message}</Alert>}
            <TextField
              disabled={saving}
              label={t('calendars.metadata.calendar', 'Calendar')}
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
              label={t('calendars.metadata.description', 'Description')}
              multiline
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
            <TextField
              disabled={saving}
              error={colorInvalid}
              helperText={
                colorInvalid
                  ? t(
                      'calendars.metadata.colorInvalid',
                      'Enter a hex color such as #336699 or #336699ff.',
                    )
                  : t(
                      'calendars.metadata.colorHelp',
                      'Leave blank to remove the color. Use #RRGGBB or #RRGGBBAA.',
                    )
              }
              label={t('calendars.metadata.color', 'Color')}
              onChange={(event) => setColor(event.target.value)}
              value={color}
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
            {t('calendars.metadata.submit', 'Save details')}
          </LoadingButton>
        </DialogActions>
      </form>
    </Dialog>
  );
}
