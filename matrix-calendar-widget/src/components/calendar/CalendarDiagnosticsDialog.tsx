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
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalDavCalendarDiagnostic,
  CalendarDiagnosticsRepository,
} from '../../calendar';
import { CopyableTextButton } from '../common/CopyableTextButton';

export function CalendarDiagnosticsDialog({
  onClose,
  open,
  repository,
}: {
  onClose: () => void;
  open: boolean;
  repository: CalendarDiagnosticsRepository;
}) {
  const { t } = useTranslation();
  const [calendars, setCalendars] = useState<CalDavCalendarDiagnostic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    let ignore = false;
    setLoading(true);
    setError(false);
    setCalendars([]);

    async function loadDiagnostics() {
      try {
        const result = await repository.getCalendarDiagnostics();
        if (!ignore) {
          setCalendars(result);
        }
      } catch {
        if (!ignore) {
          setError(true);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void loadDiagnostics();

    return () => {
      ignore = true;
    };
  }, [open, repository]);

  return (
    <Dialog
      aria-describedby="calendar-diagnostics-description"
      aria-labelledby="calendar-diagnostics-title"
      fullWidth
      maxWidth="md"
      onClose={onClose}
      open={open}
    >
      <DialogTitle id="calendar-diagnostics-title">
        {t('calendarDiagnostics.title', 'Advanced CalDAV diagnostics')}
      </DialogTitle>
      <DialogContent>
        <Stack mt={1} spacing={2}>
          <DialogContentText id="calendar-diagnostics-description">
            {t(
              'calendarDiagnostics.description',
              'Copy a calendar collection URL to share with an administrator. Only calendar managers can view these URLs.',
            )}
          </DialogContentText>

          {loading && (
            <CircularProgress
              aria-label={t(
                'calendarDiagnostics.loading',
                'Loading diagnostics',
              )}
              size={24}
            />
          )}

          {error && (
            <Alert role="alert" severity="error">
              {t(
                'calendarDiagnostics.error',
                'CalDAV diagnostics could not be loaded. Calendar manager permission may be required.',
              )}
            </Alert>
          )}

          {!loading && !error && calendars.length === 0 && (
            <Alert role="status" severity="info">
              {t(
                'calendarDiagnostics.empty',
                'No calendar collection URLs are available.',
              )}
            </Alert>
          )}

          {!error &&
            calendars.map((calendar) => {
              const name =
                calendar.name ||
                t('calendarDiagnostics.unnamedCalendar', 'Unnamed calendar');
              return (
                <Stack
                  alignItems="flex-start"
                  direction="row"
                  key={calendar.url}
                  spacing={1}
                >
                  <Stack flex={1} minWidth={0} spacing={0.5}>
                    <Typography fontWeight="medium">{name}</Typography>
                    <Typography
                      component="code"
                      sx={{ overflowWrap: 'anywhere' }}
                    >
                      {calendar.url}
                    </Typography>
                  </Stack>
                  <CopyableTextButton
                    itemLabel={t(
                      'calendarDiagnostics.copyItemLabel',
                      '{{name}} CalDAV URL',
                      { name },
                    )}
                    text={calendar.url}
                  />
                </Stack>
              );
            })}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('close', 'Close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
