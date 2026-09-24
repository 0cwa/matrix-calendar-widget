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
import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreateCalendar } from '../../calendar';

export function CalendarCreateDialog({
  onClose,
  open,
}: {
  onClose: () => void;
  open: boolean;
}) {
  const { t } = useTranslation();
  const createCalendar = useCreateCalendar();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error>();

  useEffect(() => {
    if (open) {
      setName('');
      setError(undefined);
    }
  }, [open]);

  const valid = name.trim().length > 0;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) {
      return;
    }

    setSaving(true);
    setError(undefined);

    try {
      await createCalendar(name.trim());
      onClose();
    } catch {
      setError(
        new Error(
          t('calendars.create.error', 'The calendar could not be created.'),
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
        <DialogTitle>{t('calendars.create.title', 'Create calendar')}</DialogTitle>
        <DialogContent>
          <Stack mt={1} spacing={2}>
            {error && (
              <Alert role="alert" severity="error">
                {error.message}
              </Alert>
            )}
            <TextField
              autoFocus
              disabled={saving}
              label={t('calendars.create.name', 'Calendar name')}
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
            {t('calendars.create.submit', 'Create calendar')}
          </LoadingButton>
        </DialogActions>
      </form>
    </Dialog>
  );
}
