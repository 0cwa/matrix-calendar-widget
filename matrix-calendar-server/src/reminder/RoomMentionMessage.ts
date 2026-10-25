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

export type RoomMentionMessage = {
  readonly type: 'm.room.message';
  readonly content: {
    readonly msgtype: 'm.text';
    readonly body: string;
    readonly 'm.mentions':
      | Readonly<{ room: true }>
      | Readonly<{ user_ids: readonly string[] }>;
  };
};

export type ReminderMentionTarget =
  | Readonly<{ kind: 'room' }>
  | Readonly<{ kind: 'users'; userIds: readonly string[] }>;

export const MAX_REMINDER_MENTION_USER_IDS = 50;

/** Build the standard Matrix room-wide mention shape without user targets. */
export function buildRoomMentionMessage(body: string): RoomMentionMessage {
  return buildReminderMentionMessage(body, { kind: 'room' });
}

/** Build standard Matrix mention metadata for a bounded selected-user set. */
export function buildUserMentionMessage(
  body: string,
  userIds: readonly string[],
): RoomMentionMessage {
  return buildReminderMentionMessage(body, { kind: 'users', userIds });
}

export function buildReminderMentionMessage(
  body: string,
  target: ReminderMentionTarget,
): RoomMentionMessage {
  if (body.trim().length === 0) {
    throw new TypeError('Room mention message body must not be empty');
  }

  const mentions =
    target.kind === 'room'
      ? { room: true as const }
      : { user_ids: normalizeUserIds(target.userIds) };

  return {
    type: 'm.room.message',
    content: {
      msgtype: 'm.text',
      body,
      'm.mentions': mentions,
    },
  };
}

function normalizeUserIds(userIds: readonly string[]): string[] {
  const unique = [...new Set(userIds)].sort();
  if (
    unique.length === 0 ||
    unique.length > MAX_REMINDER_MENTION_USER_IDS ||
    unique.some((userId) => !isCanonicalMatrixUserId(userId))
  ) {
    throw new TypeError('Selected reminder recipients are invalid');
  }
  return unique;
}

function isCanonicalMatrixUserId(value: string): boolean {
  return /^@[^:\s?#]+:[^\s?#]+$/.test(value);
}
