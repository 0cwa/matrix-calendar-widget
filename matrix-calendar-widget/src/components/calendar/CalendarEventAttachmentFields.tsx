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

import { Alert, MenuItem, TextField, Typography } from '@mui/material';
import type { CalendarEventEditorModel } from './useCalendarEventEditor';

export function CalendarEventAttachmentFields({
  model,
}: {
  model: CalendarEventEditorModel;
}) {
  const {
    values,
    t,
    event,
    attachmentControlsDisabled,
    validationErrorCode,
    handleChange,
    handleAttachmentOperationChange,
    handleAttachmentSourceChange,
  } = model;
  if (!values) return null;
  return (
    <>
      {values.attachmentEditable === false && (
        <Alert severity="info">
          {t(
            'calendarEvents.editor.unsupportedAttachmentReadOnly',
            'Attachment editing is unavailable for source data this editor cannot safely reconcile. Other edits will preserve it.',
          )}
        </Alert>
      )}

      <TextField
        disabled={attachmentControlsDisabled}
        label={t(
          'calendarEvents.editor.attachmentOperation',
          'Attachment link',
        )}
        onChange={handleAttachmentOperationChange}
        select
        value={values.attachmentOperation ?? 'none'}
      >
        <MenuItem value="none">
          {event
            ? t('calendarEvents.editor.attachmentNoChange', 'No change')
            : t('calendarEvents.editor.attachmentNone', 'No attachment')}
        </MenuItem>
        <MenuItem value="add">
          {t('calendarEvents.editor.attachmentAdd', 'Add link')}
        </MenuItem>
        {(values.attachmentUrls?.length ?? 0) > 0 && (
          <MenuItem value="set">
            {t('calendarEvents.editor.attachmentReplace', 'Replace link')}
          </MenuItem>
        )}
        {(values.attachmentUrls?.length ?? 0) > 0 && (
          <MenuItem value="remove">
            {t('calendarEvents.editor.attachmentRemove', 'Remove link')}
          </MenuItem>
        )}
      </TextField>

      {(values.attachmentOperation === 'set' ||
        values.attachmentOperation === 'remove') && (
        <TextField
          disabled={attachmentControlsDisabled}
          label={t(
            'calendarEvents.editor.attachmentSource',
            'Existing attachment link',
          )}
          onChange={handleAttachmentSourceChange}
          select
          value={values.attachmentSourceUrl ?? ''}
        >
          {(values.attachmentUrls ?? []).map((url) => (
            <MenuItem key={url} value={url}>
              {url}
            </MenuItem>
          ))}
        </TextField>
      )}

      {(values.attachmentOperation === 'add' ||
        values.attachmentOperation === 'set') && (
        <TextField
          disabled={attachmentControlsDisabled}
          error={validationErrorCode === 'invalid-attachment'}
          helperText={t(
            'calendarEvents.editor.attachmentUrlHelp',
            'Use an HTTP(S) URL. The link is saved as text; no file is uploaded or fetched.',
          )}
          label={t('calendarEvents.editor.attachmentUrl', 'Attachment URL')}
          onChange={handleChange('attachmentUrl')}
          type="url"
          value={values.attachmentUrl ?? ''}
        />
      )}

      {values.attachmentChanged && (
        <Typography color="text.secondary" variant="body2">
          {event
            ? t(
                'calendarEvents.editor.attachmentWillBeSaved',
                'One attachment link change will be applied when you save.',
              )
            : t(
                'calendarEvents.editor.attachmentWillBeAdded',
                'The link will be added when you create the event.',
              )}
        </Typography>
      )}
    </>
  );
}
