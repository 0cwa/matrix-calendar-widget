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
  CalDavDiscoveryResult,
  DiscoveredCalDavCalendar,
} from '../caldav/CalDavDiscoveryClient';
import { CalDavDiscoveryClient } from '../caldav/CalDavDiscoveryClient';
import { MatrixOpenIdCalDavCredentialProvider } from '../caldav/MatrixOpenIdCalDavCredentialProvider';
import type { RoomCalendarBinding } from '../model/IRoomCalendarBinding';
import {
  isSafeRoomCalendarServiceUserLocalpart,
  parseRoomCalendarServiceUserId,
} from './RoomCalendarCalDavAccess';
import type { RoomCalendarPrincipalOpenIdProofPort } from './RoomCalendarPrincipalOpenIdProofProvider';
import type {
  RoomCalendarSetupCalDavMode,
  RoomCalendarSetupCalDavOutcome,
  RoomCalendarSetupCalDavPort,
} from './RoomCalendarSetupPorts';

const APP_OWNED_CALENDAR_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const GENERATED_CALENDAR_ID =
  /^calendar-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SETUP_CALDAV_DEADLINE_MS = 10_000;

export interface RoomCalendarSetupDiscoveryPort {
  discover(): Promise<CalDavDiscoveryResult>;
  createCalendar(
    displayName: string,
    collectionName: string,
  ): Promise<DiscoveredCalDavCalendar>;
}

export type RoomCalendarSetupDiscoveryFactory = (
  radicaleUrl: string,
  credentialProvider: MatrixOpenIdCalDavCredentialProvider,
  fetchImpl: typeof fetch,
) => RoomCalendarSetupDiscoveryPort;

/**
 * Reconciles only the server-reserved collection ID. Existing collection
 * discovery is compared against the exact expected URL and never by name.
 */
export class RoomCalendarSetupCalDavProvisioner implements RoomCalendarSetupCalDavPort {
  constructor(
    private readonly radicaleUrl: string | undefined,
    private readonly proofProvider: RoomCalendarPrincipalOpenIdProofPort,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly discoveryFactory: RoomCalendarSetupDiscoveryFactory = (
      radicaleUrl,
      credentialProvider,
      fetchImpl,
    ) => new CalDavDiscoveryClient(radicaleUrl, credentialProvider, fetchImpl),
  ) {}

  async reconcile(
    binding: RoomCalendarBinding,
    mode: RoomCalendarSetupCalDavMode,
  ): Promise<RoomCalendarSetupCalDavOutcome> {
    if (
      !this.radicaleUrl ||
      !APP_OWNED_CALENDAR_ID.test(binding.calendarId) ||
      (mode === 'create-if-missing' &&
        !GENERATED_CALENDAR_ID.test(binding.calendarId)) ||
      (mode !== 'create-if-missing' && mode !== 'verify-only')
    ) {
      return 'conflict';
    }

    const deadlineController = new AbortController();
    const deadline = setTimeout(
      () => deadlineController.abort(),
      SETUP_CALDAV_DEADLINE_MS,
    );
    try {
      const proof = await this.proofProvider.request(deadlineController.signal);
      const scopedFetch: typeof fetch = (input, init = {}) => {
        const requestSignal = init.signal;
        const signal = requestSignal
          ? AbortSignal.any([deadlineController.signal, requestSignal])
          : deadlineController.signal;
        // Fetch abort also interrupts a response body that is still being read.
        return this.fetchImpl(input, { ...init, signal });
      };
      const client = this.discoveryFactory(
        this.radicaleUrl,
        new MatrixOpenIdCalDavCredentialProvider(
          proof.userId,
          proof.credential,
        ),
        scopedFetch,
      );
      const expectedHomeUrl = expectedPrincipalCalendarHomeUrl(
        this.radicaleUrl,
        proof.userId,
      );
      if (!expectedHomeUrl) return 'conflict';

      const initial = await inspectExactCollection(
        client,
        binding.calendarId,
        expectedHomeUrl,
        mode === 'create-if-missing',
      );
      if (initial === 'home-mismatch') {
        throw new Error('Room calendar home does not match bound access');
      }
      if (initial === 'existing' || initial === 'conflict') return initial;
      if (mode === 'verify-only') return 'missing';

      try {
        await client.createCalendar('Matrix Calendar', binding.calendarId);
      } catch {
        if (deadlineController.signal.aborted) {
          // Keep the pending reservation; a later call gets a fresh deadline
          // and reconciles this same opaque ID.
          throw new Error('Room calendar collection could not be reconciled');
        }
        // A conflict can follow a successful MKCALENDAR. Inspect the same ID
        // before deciding whether the reserved row can advance.
        const retry = await inspectExactCollection(
          client,
          binding.calendarId,
          expectedHomeUrl,
          true,
        );
        if (retry === 'home-mismatch') {
          throw new Error('Room calendar home does not match bound access');
        }
        if (retry === 'existing' || retry === 'conflict') return retry;
        throw new Error('Room calendar collection could not be reconciled');
      }

      const verified = await inspectExactCollection(
        client,
        binding.calendarId,
        expectedHomeUrl,
        true,
      );
      if (verified === 'home-mismatch') {
        throw new Error('Room calendar home does not match bound access');
      }
      if (verified === 'existing') return 'created';
      return verified === 'conflict' ? 'conflict' : 'missing';
    } finally {
      clearTimeout(deadline);
    }
  }
}

async function inspectExactCollection(
  client: RoomCalendarSetupDiscoveryPort,
  calendarId: string,
  expectedHomeUrl: string,
  requireVeventOnly: boolean,
): Promise<'existing' | 'missing' | 'conflict' | 'home-mismatch'> {
  const discovery = await client.discover();
  if (
    normalizeCollectionHref(discovery.calendarHomeUrl) !==
    normalizeCollectionHref(expectedHomeUrl)
  ) {
    return 'home-mismatch';
  }
  const expectedHref = expectedCollectionHref(expectedHomeUrl, calendarId);
  if (!expectedHref) return 'conflict';

  const matches = discovery.calendars.filter(
    (calendar) => normalizeCollectionHref(calendar.href) === expectedHref,
  );
  if (matches.length === 0) return 'missing';
  if (matches.length !== 1) return 'conflict';

  const [calendar] = matches;
  if (requireVeventOnly) {
    if (
      calendar.components?.length !== 1 ||
      calendar.components[0] !== 'VEVENT' ||
      calendar.readOnly !== false
    ) {
      return 'conflict';
    }
  } else if (
    calendar.components !== undefined &&
    !calendar.components.includes('VEVENT')
  ) {
    return 'conflict';
  }

  return 'existing';
}

function expectedPrincipalCalendarHomeUrl(
  radicaleUrl: string,
  userId: string,
): string | undefined {
  const parsedUserId = parseRoomCalendarServiceUserId(userId);
  if (
    !parsedUserId ||
    !isSafeRoomCalendarServiceUserLocalpart(parsedUserId.localpart)
  ) {
    return undefined;
  }

  try {
    const base = new URL(radicaleUrl);
    if (
      (base.protocol !== 'http:' && base.protocol !== 'https:') ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    ) {
      return undefined;
    }
    if (!base.pathname.endsWith('/')) base.pathname = `${base.pathname}/`;
    return new URL(
      `${encodeURIComponent(parsedUserId.localpart)}/`,
      base,
    ).toString();
  } catch {
    return undefined;
  }
}

function expectedCollectionHref(
  calendarHomeUrl: string,
  calendarId: string,
): string | undefined {
  try {
    const home = new URL(calendarHomeUrl);
    if (home.username || home.password || home.search || home.hash) {
      return undefined;
    }
    if (!home.pathname.endsWith('/')) home.pathname = `${home.pathname}/`;
    return normalizeCollectionHref(
      new URL(`${encodeURIComponent(calendarId)}/`, home).toString(),
    );
  } catch {
    return undefined;
  }
}

function normalizeCollectionHref(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) {
      return undefined;
    }
    url.pathname = url.pathname.replace(/\/+$/u, '');
    return url.toString();
  } catch {
    return undefined;
  }
}
