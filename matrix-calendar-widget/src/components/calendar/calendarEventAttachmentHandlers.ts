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

import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import type { CalendarEventFormValues } from '../../calendar';

export function createAttachmentHandlers(
  setValues: Dispatch<SetStateAction<CalendarEventFormValues | undefined>>,
) {
  const handleAttachmentOperationChange = (
    change: ChangeEvent<HTMLInputElement>,
  ) => {
    const operation = change.target.value as NonNullable<
      CalendarEventFormValues['attachmentOperation']
    >;
    setValues((current) => {
      if (!current) {
        return current;
      }
      const sourceUrl =
        operation === 'set' || operation === 'remove'
          ? current.attachmentSourceUrl || current.attachmentUrls?.[0] || ''
          : '';
      return {
        ...current,
        attachmentOperation: operation,
        attachmentSourceUrl: sourceUrl,
        attachmentUrl: operation === 'set' ? sourceUrl : '',
        attachmentChanged: operation !== 'none',
      };
    });
  };

  const handleAttachmentSourceChange = (
    change: ChangeEvent<HTMLInputElement>,
  ) => {
    const sourceUrl = change.target.value;
    setValues((current) =>
      current
        ? {
            ...current,
            attachmentSourceUrl: sourceUrl,
            ...(current.attachmentOperation === 'set'
              ? { attachmentUrl: sourceUrl }
              : {}),
            attachmentChanged: true,
          }
        : current,
    );
  };

  return { handleAttachmentOperationChange, handleAttachmentSourceChange };
}
