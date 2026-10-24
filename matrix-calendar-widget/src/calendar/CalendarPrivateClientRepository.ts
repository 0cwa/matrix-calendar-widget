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

import type {
  CalendarId,
  CalendarRepository,
} from '@matrix-calendar-widget/calendar';

export type PrivateCalendarClientTarget =
  | Readonly<{ target: 'personal'; calendarId: string }>
  | Readonly<{ target: 'room'; roomId: string; calendarId: string }>;

export type PrivateCalendarClientMetadata = Readonly<{
  appId: string;
  target: PrivateCalendarClientTarget;
  state: 'pending' | 'active' | 'revoked';
  mapState: 'pending' | 'present' | 'cleanup-pending' | 'removed';
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}>;

export type CreatedPrivateCalendarClient = Readonly<{
  client: PrivateCalendarClientMetadata;
  secret: string;
  calendarUrl: string;
}>;

export interface CalendarPrivateClientRepository {
  listPrivateCalendarClients(
    calendarId: CalendarId,
  ): Promise<readonly PrivateCalendarClientMetadata[]>;

  createPrivateCalendarClient(
    calendarId: CalendarId,
  ): Promise<CreatedPrivateCalendarClient>;

  revokePrivateCalendarClient(
    appId: string,
  ): Promise<PrivateCalendarClientMetadata>;
}

export function isCalendarPrivateClientRepository(
  repository: CalendarRepository,
): repository is CalendarRepository & CalendarPrivateClientRepository {
  return (
    'listPrivateCalendarClients' in repository &&
    typeof repository.listPrivateCalendarClients === 'function' &&
    'createPrivateCalendarClient' in repository &&
    typeof repository.createPrivateCalendarClient === 'function' &&
    'revokePrivateCalendarClient' in repository &&
    typeof repository.revokePrivateCalendarClient === 'function'
  );
}
