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
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarDiagnostics } from '../../calendar';
import {
  isCalendarDiagnosticsRepository,
  useCalendarRepository,
} from '../../calendar';
import { CopyableTextButton } from '../common/CopyableTextButton';

export function CalendarDiagnosticsDialog({
  onClose,
  open,
}: {
  onClose: () => void;
  open: boolean;
}) {
  const { t } = useTranslation();
  const repository = useCalendarRepository();
  const [diagnostics, setDiagnostics] = useState<CalendarDiagnostics>();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [copyError, setCopyError] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    let current = true;
    setDiagnostics(undefined);
    setLoading(true);
    setLoadError(false);
    setCopyError(false);

    const loadDiagnostics = async () => {
      try {
        if (!isCalendarDiagnosticsRepository(repository)) {
          throw new Error('Calendar diagnostics are not supported');
        }

        const result = await repository.getCalendarDiagnostics();
        if (current) {
          setDiagnostics(result);
        }
      } catch {
        if (current) {
          setLoadError(true);
        }
      } finally {
        if (current) {
          setLoading(false);
        }
      }
    };

    void loadDiagnostics();

    return () => {
      current = false;
    };
  }, [open, repository]);

  return (
    <Dialog fullWidth maxWidth="sm" onClose={onClose} open={open}>
      <DialogTitle>
        {t('calendars.diagnostics.title', 'CalDAV collection diagnostics')}
      </DialogTitle>
      <DialogContent>
        <Stack mt={1} spacing={2}>
          <Typography>
            {t(
              'calendars.diagnostics.description',
              'Copy a collection URL when helping an administrator diagnose calendar access. URLs are shown as text and will not open when selected.',
            )}
          </Typography>
          {loadError && (
            <Alert severity="error">
              {t(
                'calendars.diagnostics.loadError',
                'CalDAV diagnostics are unavailable for this room.',
              )}
            </Alert>
          )}
          {copyError && (
            <Alert severity="error">
              {t(
                'calendars.diagnostics.copyError',
                'The collection URL could not be copied. Check clipboard permissions and try again.',
              )}
            </Alert>
          )}
          {loading && (
            <CircularProgress
              aria-label={t(
                'calendars.diagnostics.loading',
                'Loading calendar diagnostics',
              )}
              size={24}
            />
          )}
          {!loading && diagnostics?.calendars.length === 0 && (
            <Typography>
              {t(
                'calendars.diagnostics.empty',
                'No calendar collection URLs are available.',
              )}
            </Typography>
          )}
          {diagnostics?.calendars.map(({ name, url }) => (
            <Box
              key={url}
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                p: 1.5,
              }}
            >
              <Stack
                alignItems={{ xs: 'flex-start', sm: 'center' }}
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                spacing={1}
              >
                <Box sx={{ minWidth: 0 }}>
                  {name && <Typography fontWeight="medium">{name}</Typography>}
                  <Typography
                    component="code"
                    sx={{ overflowWrap: 'anywhere', userSelect: 'text' }}
                  >
                    {url}
                  </Typography>
                </Box>
                <CopyableTextButton
                  copiedLabel={t('calendars.diagnostics.copied', 'Copied')}
                  label={t('calendars.diagnostics.copy', 'Copy URL')}
                  onCopy={() => setCopyError(false)}
                  onCopyError={() => setCopyError(true)}
                  text={url}
                />
              </Stack>
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('close', 'Close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
