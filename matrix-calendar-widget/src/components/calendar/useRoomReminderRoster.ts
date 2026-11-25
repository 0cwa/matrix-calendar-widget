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

import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  CalendarRoomReminderRecipient,
  CalendarRoomReminderRepository,
} from '../../calendar';
import { isBotUser } from '../../lib/utils';

export function useRoomReminderRoster(
  reminderRepository: CalendarRoomReminderRepository | undefined,
  roomId: string | undefined,
) {
  const [roomRecipients, setRoomRecipients] = useState<
    CalendarRoomReminderRecipient[]
  >([]);
  const [roomMembersUnavailable, setRoomMembersUnavailable] = useState(false);
  const [roomMembersLoading, setRoomMembersLoading] = useState(false);
  const rosterRequestSequence = useRef(0);
  const members = useMemo(
    () =>
      roomRecipients
        .filter((recipient) => !isBotUser(recipient.userId))
        .map((recipient) => ({
          userId: recipient.userId,
          displayName: recipient.displayName?.trim() || recipient.userId,
        })),
    [roomRecipients],
  );
  const joinedMemberIds = useMemo(
    () => new Set(members.map((member) => member.userId)),
    [members],
  );
  const memberById = useMemo(
    () => new Map(members.map((member) => [member.userId, member])),
    [members],
  );
  const loadRoomRecipients = useCallback(async () => {
    const requestId = ++rosterRequestSequence.current;
    const listRecipients = reminderRepository?.listRoomReminderRecipients;
    if (!roomId || typeof listRecipients !== 'function') {
      setRoomRecipients([]);
      setRoomMembersUnavailable(true);
      setRoomMembersLoading(false);
      return undefined;
    }

    setRoomMembersLoading(true);
    try {
      const recipients = await listRecipients.call(reminderRepository);
      if (rosterRequestSequence.current !== requestId) return undefined;
      setRoomRecipients(recipients);
      setRoomMembersUnavailable(false);
      return recipients
        .filter((recipient) => !isBotUser(recipient.userId))
        .map((recipient) => ({
          userId: recipient.userId,
          displayName: recipient.displayName?.trim() || recipient.userId,
        }));
    } catch {
      if (rosterRequestSequence.current === requestId) {
        setRoomRecipients([]);
        setRoomMembersUnavailable(true);
      }
      return undefined;
    } finally {
      if (rosterRequestSequence.current === requestId) {
        setRoomMembersLoading(false);
      }
    }
  }, [reminderRepository, roomId]);
  return {
    members,
    joinedMemberIds,
    memberById,
    roomMembersUnavailable,
    roomMembersLoading,
    loadRoomRecipients,
    setRoomRecipients,
    setRoomMembersUnavailable,
    setRoomMembersLoading,
    rosterRequestSequence,
  };
}
