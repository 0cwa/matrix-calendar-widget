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

import AddLinkIcon from '@mui/icons-material/AddLink';
import { Alert, Button, TextField } from '@mui/material';
import { useState } from 'react';
import { CalendarEventAttachmentFields } from './CalendarEventAttachmentFields';
import type { CalendarEventEditorModel } from './useCalendarEventEditor';

/**
 * Conference and attachment links. They start behind one button only when there
 * is nothing to show: stored values, unsupported source data, edits and errors
 * always keep the fields on screen.
 */
export function CalendarEventLinkFields({
  model,
}: {
  model: CalendarEventEditorModel;
}) {
  const { t, values, event, validationErrorCode, handleChange } = model;
  const [revealed, setRevealed] = useState(false);
  if (!values) return null;

  const invalidConference = validationErrorCode === 'invalid-conference';
  const needsFields =
    Boolean(values.conferenceUrl) ||
    Boolean(values.conferenceLabel) ||
    values.conferenceEditable === false ||
    values.conferenceChanged === true ||
    (values.attachmentUrls?.length ?? 0) > 0 ||
    values.attachmentEditable === false ||
    values.attachmentChanged === true ||
    invalidConference ||
    validationErrorCode === 'invalid-attachment';

  if (!revealed && !needsFields) {
    return (
      <Button
        onClick={() => setRevealed(true)}
        startIcon={<AddLinkIcon />}
        sx={{ alignSelf: 'flex-start', textAlign: 'start' }}
        type="button"
      >
        {t(
          'calendarEvents.editor.addLinks',
          'Add conference or attachment link',
        )}
      </Button>
    );
  }

  return (
    <>
      {values.conferenceEditable === false && (
        <Alert severity="info">
          {t(
            'calendarEvents.editor.unsupportedConferenceReadOnly',
            'Conference editing is unavailable for source data this editor cannot safely reconcile. Other edits will preserve it.',
          )}
        </Alert>
      )}

      <TextField
        // The button that revealed these fields is gone, so focus moves here.
        autoFocus={revealed}
        disabled={values.conferenceEditable === false}
        error={invalidConference}
        helperText={
          event
            ? t(
                'calendarEvents.editor.conferenceUrlHelp',
                'Use an HTTP(S) link. Clear the URL to remove the conference link.',
              )
            : t(
                'calendarEvents.editor.conferenceUrlCreateHelp',
                'Optional. Use an HTTP(S) link.',
              )
        }
        label={t('calendarEvents.editor.conferenceUrl', 'Conference URL')}
        onChange={handleChange('conferenceUrl')}
        type="url"
        value={values.conferenceUrl}
      />

      <TextField
        disabled={values.conferenceEditable === false}
        error={invalidConference}
        label={t('calendarEvents.editor.conferenceLabel', 'Conference label')}
        onChange={handleChange('conferenceLabel')}
        value={values.conferenceLabel}
      />

      <CalendarEventAttachmentFields model={model} />
    </>
  );
}
