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

import { CalendarRepositoryError } from '@matrix-calendar-widget/calendar';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Typography,
} from '@mui/material';
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Explains why no events are shown and offers the next step, if there is one. */
export function CalendarEventsEmptyState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <Box
        alignItems="center"
        display="flex"
        flexWrap="wrap"
        gap={1}
        justifyContent="space-between"
        px={1.5}
        py={0.75}
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          overflowWrap: 'anywhere',
        }}
      >
        <Box role="status" sx={{ minWidth: 0 }}>
          <Typography
            color="text.secondary"
            variant="body2"
            fontWeight="medium"
          >
            {title}
          </Typography>
        </Box>
        {action}
      </Box>
    );
  }
  return (
    <Box
      alignItems="center"
      display="flex"
      flexDirection="column"
      gap={1}
      px={2}
      py={2}
      sx={{ overflowWrap: 'anywhere' }}
      textAlign="center"
    >
      <Box role="status">
        <Typography fontWeight="bold" variant="body1">
          {title}
        </Typography>
        {description && (
          <Typography color="text.secondary" variant="body2">
            {description}
          </Typography>
        )}
      </Box>
      {action}
    </Box>
  );
}

export function CalendarEventsLoading() {
  const { t } = useTranslation();

  return (
    <Box
      alignItems="center"
      display="flex"
      height="100%"
      justifyContent="center"
      minHeight={120}
    >
      <CircularProgress
        aria-label={t('calendarEvents.loading', 'Loading calendar events')}
      />
    </Box>
  );
}

export function CalendarEventsLoadError({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Box m={2}>
      <Alert
        action={
          isRetryableLoadError(error) ? (
            <Button color="inherit" onClick={onRetry} size="small">
              {t('calendarEvents.retry', 'Retry')}
            </Button>
          ) : undefined
        }
        severity="error"
      >
        {t('calendarEvents.loadError', 'Calendar events could not be loaded.')}
      </Alert>
    </Box>
  );
}

/** Asking again cannot change these answers. */
function isRetryableLoadError(error: Error): boolean {
  return !(
    error instanceof CalendarRepositoryError &&
    (error.code === 'capability-unavailable' ||
      error.code === 'invalid-range' ||
      error.code === 'unsupported-calendar-components')
  );
}
