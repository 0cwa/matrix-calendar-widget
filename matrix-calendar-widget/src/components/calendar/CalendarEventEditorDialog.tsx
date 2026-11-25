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
import { Button, Dialog, DialogActions, DialogTitle } from '@mui/material';
import { CalendarEventEditorFields } from './CalendarEventEditorFields';
import type { CalendarEventEditorProps } from './useCalendarEventEditor';
import { useCalendarEventEditor } from './useCalendarEventEditor';

export type { CalendarEventEditorProps } from './useCalendarEventEditor';

export function CalendarEventEditorDialog(props: CalendarEventEditorProps) {
  const model = useCalendarEventEditor(props);

  if (!model) {
    return null;
  }

  const {
    t,
    event,
    open,
    onClose,
    saving,
    savingRoomReminderSetup,
    handleSubmit,
    validationError,
    readOnly,
    chooseScope,
    missingOccurrence,
    followingTimingUnchanged,
    editingOccurrence,
    occurrenceHasChanges,
  } = model;

  return (
    <Dialog
      fullWidth
      maxWidth="sm"
      onClose={saving ? undefined : onClose}
      open={open}
    >
      <form
        aria-label={
          event
            ? t('calendarEvents.editor.editTitle', 'Edit event')
            : t('calendarEvents.editor.createTitle', 'Create event')
        }
        onSubmit={handleSubmit}
      >
        <DialogTitle>
          {event
            ? t('calendarEvents.editor.editTitle', 'Edit event')
            : t('calendarEvents.editor.createTitle', 'Create event')}
        </DialogTitle>

        <CalendarEventEditorFields model={model} />

        <DialogActions>
          <Button disabled={saving} onClick={onClose}>
            {t('cancel', 'Cancel')}
          </Button>
          <LoadingButton
            disabled={
              saving ||
              Boolean(validationError) ||
              readOnly ||
              chooseScope ||
              missingOccurrence ||
              followingTimingUnchanged ||
              (editingOccurrence && !occurrenceHasChanges)
            }
            loading={saving && !savingRoomReminderSetup}
            type="submit"
            variant="contained"
          >
            {event
              ? t('calendarEvents.editor.save', 'Save')
              : t('calendarEvents.editor.create', 'Create event')}
          </LoadingButton>
        </DialogActions>
      </form>
    </Dialog>
  );
}
