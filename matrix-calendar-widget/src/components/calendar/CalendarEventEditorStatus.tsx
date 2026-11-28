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

import { Alert, Box, Button, Stack } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import type { CalendarEventEditorModel } from './useCalendarEventEditor';

/**
 * Save errors and the reasons that block saving. Rendered between the scrolling
 * fields and the actions, so they stay visible wherever the form is scrolled.
 */
export function CalendarEventEditorStatus({
  model,
  blockingReasonId,
}: {
  model: CalendarEventEditorModel;
  blockingReasonId: string;
}) {
  const {
    t,
    saving,
    error,
    conflict,
    missingOccurrence,
    readOnly,
    chooseScope,
    validationError,
    validationErrorCode,
    showTitleRequiredError,
    handleReloadLatest,
    onClose,
  } = model;
  const blockingValidation = chooseScope ? undefined : validationError;
  const visibleBlockingValidation =
    validationErrorCode === 'title-required' && !showTitleRequiredError
      ? undefined
      : blockingValidation;
  const blockingReadOnly = !chooseScope && readOnly;

  if (!error && !visibleBlockingValidation && !blockingReadOnly) {
    return blockingValidation ? (
      <Box component="span" id={blockingReasonId} sx={visuallyHidden}>
        {blockingValidation}
      </Box>
    ) : null;
  }

  return (
    <Stack
      flexShrink={0}
      maxHeight="30vh"
      overflow="auto"
      px={3}
      pt={1}
      spacing={1}
    >
      {error && (
        <Alert
          action={
            conflict ? (
              <Button
                color="inherit"
                disabled={saving}
                onClick={handleReloadLatest}
                size="small"
              >
                {t('calendarEvents.editor.reloadLatest', 'Reload latest')}
              </Button>
            ) : missingOccurrence ? (
              <Button color="inherit" onClick={onClose} size="small">
                {t('calendarEvents.details.close', 'Close')}
              </Button>
            ) : undefined
          }
          severity="error"
        >
          {error.message}
        </Alert>
      )}
      {(visibleBlockingValidation || blockingReadOnly) && (
        <Stack id={blockingReasonId} spacing={1}>
          {visibleBlockingValidation && (
            <Alert severity="warning">{visibleBlockingValidation}</Alert>
          )}
          {blockingReadOnly && (
            <Alert severity="warning">
              {t(
                'calendarEvents.editor.readOnly',
                'This calendar is read-only.',
              )}
            </Alert>
          )}
        </Stack>
      )}
    </Stack>
  );
}
