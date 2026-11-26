/* Modified for Matrix Calendar Widget fork, 2026. */
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

import { isRecord } from './elementAcceptanceShared';
import type { ReminderPlan } from './elementAcceptanceSupportTypes';

const MAX_REMINDER_RECIPIENT_ROSTER_SIZE = 20_000;

export function summarizeReminderRecipientRoster(
  value: unknown,
  expectedUserId: string,
): {
  recipientRosterCount: number;
  recipientRosterShapeValid: boolean;
  recipientRosterTargetPresent: boolean;
  recipientRosterOutcome: 'empty' | 'invalid_shape' | 'nonempty';
} {
  const invalid = (recipientRosterCount = 0) => ({
    recipientRosterCount,
    recipientRosterShapeValid: false,
    recipientRosterTargetPresent: false,
    recipientRosterOutcome: 'invalid_shape' as const,
  });
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    !('recipients' in value) ||
    !Array.isArray(value.recipients)
  ) {
    return invalid();
  }

  const recipients = value.recipients;
  const recipientRosterCount = Math.min(
    recipients.length,
    MAX_REMINDER_RECIPIENT_ROSTER_SIZE,
  );
  if (recipients.length > MAX_REMINDER_RECIPIENT_ROSTER_SIZE) {
    return invalid(recipientRosterCount);
  }

  const seen = new Set<string>();
  for (const recipient of recipients) {
    if (
      !isRecord(recipient) ||
      Object.keys(recipient).length !== 2 ||
      !('userId' in recipient) ||
      typeof recipient.userId !== 'string' ||
      !/^@[^\s:#?]+:[^\s?#]+$/u.test(recipient.userId) ||
      seen.has(recipient.userId) ||
      !('displayName' in recipient)
    ) {
      return invalid(recipientRosterCount);
    }
    const displayName = recipient.displayName;
    const displayNameValid =
      displayName === null ||
      (typeof displayName === 'string' &&
        Array.from(displayName).length <= 256 &&
        displayName.length > 0 &&
        !Array.from(displayName).some((character) => {
          const codePoint = character.codePointAt(0);
          return (
            codePoint !== undefined &&
            (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
          );
        }) &&
        displayName ===
          displayName.normalize('NFC').replace(/\s+/gu, ' ').trim());
    if (!displayNameValid) return invalid(recipientRosterCount);
    seen.add(recipient.userId);
  }

  return {
    recipientRosterCount,
    recipientRosterShapeValid: true,
    recipientRosterTargetPresent: seen.has(expectedUserId),
    recipientRosterOutcome: recipientRosterCount === 0 ? 'empty' : 'nonempty',
  };
}

export const REMINDER_ALL_DAY_TIMEZONE = 'Asia/Tokyo';

export const REMINDER_ALL_DAY_CALDAV_ALARM_LEAD_MINUTES = 1;

export function reminderPlanForMarkerIndex(index: number): ReminderPlan {
  if (index === 1) {
    return {
      recipient: 'selected',
      allDay: true,
      allDayTimezone: REMINDER_ALL_DAY_TIMEZONE,
      caldavAlarmLeadMinutes: REMINDER_ALL_DAY_CALDAV_ALARM_LEAD_MINUTES,
    };
  }
  if (index === 0 || index === 2) {
    return { recipient: 'room', allDay: false };
  }
  throw new Error('Reminder acceptance marker plan is unavailable');
}
