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
  CalendarEventAttachmentInput,
  CalendarEventAttachmentPatch,
  CalendarEventAttachmentValidationError,
  normalizeCalendarEventAttachmentInput,
  normalizeCalendarEventAttachmentPatch,
} from '@matrix-calendar-widget/calendar';
import type {
  CalendarEventFormValues,
  CalendarEventValidationError,
} from './calendarEventForm';

export function attachmentInputFromForm(
  values: CalendarEventFormValues,
): CalendarEventAttachmentInput {
  return normalizeCalendarEventAttachmentInput({
    url: values.attachmentUrl ?? '',
  });
}

export function attachmentPatchFromForm(
  values: CalendarEventFormValues,
): CalendarEventAttachmentPatch {
  const operation = values.attachmentOperation;
  if (operation === 'add') {
    return normalizeCalendarEventAttachmentPatch({
      action: 'add',
      url: values.attachmentUrl ?? '',
    });
  }
  if (operation === 'set') {
    return normalizeCalendarEventAttachmentPatch({
      action: 'set',
      sourceUrl: values.attachmentSourceUrl ?? '',
      url: values.attachmentUrl ?? '',
    });
  }
  if (operation === 'remove') {
    return normalizeCalendarEventAttachmentPatch({
      action: 'remove',
      sourceUrl: values.attachmentSourceUrl ?? '',
    });
  }
  throw new CalendarEventAttachmentValidationError();
}

export function validateAttachment(
  values: CalendarEventFormValues,
): CalendarEventValidationError | undefined {
  if (
    values.attachmentEditable === false ||
    (!values.attachmentChanged &&
      (values.attachmentOperation === undefined ||
        values.attachmentOperation === 'none'))
  ) {
    return undefined;
  }
  try {
    if (values.attachmentOperation === 'add') {
      attachmentInputFromForm(values);
    } else {
      attachmentPatchFromForm(values);
    }
    return undefined;
  } catch (error) {
    if (error instanceof CalendarEventAttachmentValidationError) {
      return 'invalid-attachment';
    }
    throw error;
  }
}
