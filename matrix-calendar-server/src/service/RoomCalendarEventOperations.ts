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
  CalendarEvent,
  CalendarEventAttachmentValidationError,
  CalendarEventConferenceValidationError,
  CalendarEventInput,
  CalendarEventOccurrenceValidationError,
  CalendarEventPatch,
  CalendarTimeRange,
  validateCalendarEventInputAttachment,
  validateCalendarEventInputConference,
  validateCalendarEventPatchAttachment,
  validateCalendarEventPatchConference,
  validateCalendarEventPatchOccurrence,
} from '@matrix-calendar-widget/calendar';
import { Injectable } from '@nestjs/common';
import { UserID } from 'matrix-bot-sdk';
import {
  CalDavEventClient,
  CalDavEventResource,
  DEFAULT_CALDAV_EVENT_RESPONSE_MAX_BYTES,
  MAX_FOLLOWING_RESOURCE_BYTES,
} from '../caldav';
import { isSafeSingleVeventSeries } from '../caldav/ICalendarDeletionSafety';
import {
  ICalendarEventCodec,
  ICalendarEventCodecError,
} from '../caldav/ICalendarEventCodec';
import { MatrixOpenIdCalDavCredentialProvider } from '../caldav/MatrixOpenIdCalDavCredentialProvider';
import { IMatrixOpenIdCredential } from '../model/IMatrixOpenIdCredential';
import { RoomCalendarBinding } from '../model/IRoomCalendarBinding';
import { resolveRoomCalendarBinding } from './RoomCalendarBindingResolver';
import {
  isSafeRoomCalendarServiceUserLocalpart,
  RoomCalendarTarget,
} from './RoomCalendarCalDavAccess';

/**
 * Appservice identity returned by the room access gate after actor
 * authorization and exact binding resolution. Never construct this from an
 * HTTP request or a widget actor's OpenID credential.
 */
export interface RoomCalendarEventServicePrincipal {
  readonly userId: string;
  readonly calendarUrl: string;
  readonly credential: IMatrixOpenIdCredential;
}

/**
 * Internal capability passed from the pre-I/O room authorization gate to the
 * event operation helper. Runtime callers must obtain the principal only
 * after checking actor membership, action power, and the exact room binding.
 */
export interface AuthorizedRoomCalendarEventAccess {
  readonly target: RoomCalendarTarget;
  readonly servicePrincipal: RoomCalendarEventServicePrincipal;
}

export interface RoomCalendarEventResult {
  readonly event: CalendarEvent;
  readonly etag: string;
  /** True only when a conditional update was verified as an exact no-op. */
  readonly noOp?: true;
}

/** Internal server-only source for consumers that must inspect canonical ICS. */
export interface RoomCalendarEventResourceResult extends RoomCalendarEventResult {
  readonly icalendar: string;
}

export type RoomCalendarEventOperationErrorCode =
  | 'invalid-room-access'
  | 'invalid-event-url'
  | 'invalid-event-etag'
  | 'invalid-event-input'
  | 'event-write-disabled'
  | 'unsafe-event-resource'
  | 'event-too-large'
  | 'etag-conflict';

export interface RoomCalendarEventOperationOptions {
  readonly eventWritesEnabled?: boolean;
  readonly maxResponseBytes?: number;
  readonly radicaleBaseUrl?: string;
  readonly roomCalendarBindings?: readonly RoomCalendarBinding[];
  readonly servicePrincipalUserId?: string;
}

/** Safe local error; it never includes collection, event, or credential data. */
export class RoomCalendarEventOperationError extends Error {
  constructor(public readonly code: RoomCalendarEventOperationErrorCode) {
    super(`Room calendar event operation failed (${code})`);
    this.name = 'RoomCalendarEventOperationError';
  }
}

/**
 * Provides event operations for callers that completed Matrix actor
 * authorization and received an appservice principal. The access and write
 * gates are checked separately at their respective boundaries.
 */
@Injectable()
export class RoomCalendarEventOperations {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly options: RoomCalendarEventOperationOptions = {},
  ) {}

  async getEvent(
    access: AuthorizedRoomCalendarEventAccess,
    eventId: string,
  ): Promise<RoomCalendarEventResult> {
    const scope = validateAccess(
      access,
      this.options.roomCalendarBindings,
      this.options.radicaleBaseUrl,
      this.options.servicePrincipalUserId,
    );
    const eventUrl = collectionChildUrl(scope.collectionUrl, eventId);
    const resource = await this.client(scope.servicePrincipal).getEvent(
      eventUrl,
    );
    return resolveResource(scope.calendarId, resource);
  }

  async getEventResource(
    access: AuthorizedRoomCalendarEventAccess,
    eventId: string,
  ): Promise<RoomCalendarEventResourceResult> {
    const scope = validateAccess(
      access,
      this.options.roomCalendarBindings,
      this.options.radicaleBaseUrl,
      this.options.servicePrincipalUserId,
    );
    const eventUrl = collectionChildUrl(scope.collectionUrl, eventId, true);
    const resource = await this.client(scope.servicePrincipal).getEvent(
      eventUrl,
    );
    return {
      ...resolveResource(scope.calendarId, resource),
      icalendar: resource.icalendar,
    };
  }

  async listEvents(
    access: AuthorizedRoomCalendarEventAccess,
    range: CalendarTimeRange,
  ): Promise<RoomCalendarEventResult[]> {
    const scope = validateAccess(
      access,
      this.options.roomCalendarBindings,
      this.options.radicaleBaseUrl,
      this.options.servicePrincipalUserId,
    );
    const resources = await this.client(scope.servicePrincipal).listEvents(
      scope.collectionUrl,
      range,
    );
    return resources.map((resource) => {
      collectionChildUrl(scope.collectionUrl, resource.href);
      return resolveResource(scope.calendarId, resource);
    });
  }

  async createEvent(
    access: AuthorizedRoomCalendarEventAccess,
    input: CalendarEventInput,
  ): Promise<RoomCalendarEventResult> {
    this.assertWritesEnabled();
    const scope = validateAccess(
      access,
      this.options.roomCalendarBindings,
      this.options.radicaleBaseUrl,
      this.options.servicePrincipalUserId,
    );
    try {
      validateCalendarEventInputConference(input);
      validateCalendarEventInputAttachment(input);
    } catch (error) {
      if (
        error instanceof CalendarEventConferenceValidationError ||
        error instanceof CalendarEventAttachmentValidationError
      ) {
        throw new RoomCalendarEventOperationError('invalid-event-input');
      }
      throw error;
    }
    if (
      !input ||
      typeof input.uid !== 'string' ||
      input.uid.length === 0 ||
      Buffer.byteLength(input.uid, 'utf8') > 251 ||
      containsSlashOrControlCharacters(input.uid) ||
      /%[0-9a-f]{2}/i.test(input.uid)
    ) {
      throw new RoomCalendarEventOperationError('invalid-event-input');
    }

    let eventUrl: string;
    try {
      eventUrl = new URL(
        `${encodeURIComponent(input.uid)}.ics`,
        scope.collectionUrl,
      ).toString();
    } catch {
      throw new RoomCalendarEventOperationError('invalid-event-input');
    }

    const codec = new ICalendarEventCodec();
    const encoded = codec.create(scope.calendarId, eventUrl, input);
    const client = this.client(scope.servicePrincipal);
    await client.createEvent(eventUrl, encoded.icalendar);
    return resolveResource(scope.calendarId, await client.getEvent(eventUrl));
  }

  async updateEvent(
    access: AuthorizedRoomCalendarEventAccess,
    eventId: string,
    expectedEtag: string,
    patch: CalendarEventPatch,
  ): Promise<RoomCalendarEventResult> {
    this.assertWritesEnabled();
    const scope = validateAccess(
      access,
      this.options.roomCalendarBindings,
      this.options.radicaleBaseUrl,
      this.options.servicePrincipalUserId,
    );
    try {
      validateCalendarEventPatchConference(patch);
      validateCalendarEventPatchAttachment(patch);
      validateCalendarEventPatchOccurrence(patch);
    } catch (error) {
      if (
        error instanceof CalendarEventConferenceValidationError ||
        error instanceof CalendarEventAttachmentValidationError ||
        error instanceof CalendarEventOccurrenceValidationError
      ) {
        throw new RoomCalendarEventOperationError('invalid-event-input');
      }
      throw error;
    }
    const eventUrl = collectionChildUrl(scope.collectionUrl, eventId);
    const etag = requireExpectedEtag(expectedEtag);
    const client = this.client(scope.servicePrincipal);
    const codec = new ICalendarEventCodec();
    const current = await client.getEvent(eventUrl);
    let encoded;
    try {
      encoded = codec
        .parse(scope.calendarId, eventUrl, current.icalendar)
        .applyPatch(patch ?? {});
    } catch (error) {
      if (
        error instanceof ICalendarEventCodecError &&
        error.code === 'event-too-large'
      ) {
        throw new RoomCalendarEventOperationError('event-too-large');
      }
      throw error;
    }

    if (
      patch?.recurrence &&
      'following' in patch.recurrence &&
      Buffer.byteLength(encoded.icalendar, 'utf8') >
        Math.min(
          MAX_FOLLOWING_RESOURCE_BYTES,
          this.options.maxResponseBytes ??
            DEFAULT_CALDAV_EVENT_RESPONSE_MAX_BYTES,
        )
    ) {
      throw new RoomCalendarEventOperationError('event-too-large');
    }

    if (
      encoded.icalendar === current.icalendar &&
      etag === current.etag &&
      (Object.prototype.hasOwnProperty.call(patch, 'conference') ||
        Object.prototype.hasOwnProperty.call(patch, 'attachment') ||
        (patch?.recurrence &&
          ('occurrence' in patch.recurrence ||
            'following' in patch.recurrence)))
    ) {
      return { ...resolveResource(scope.calendarId, current), noOp: true };
    }

    // Keep the caller's validator. A stale edit must fail with 412 rather
    // than silently applying the patch to the newly read resource version.
    await client.updateEvent(eventUrl, etag, encoded.icalendar);
    return resolveResource(scope.calendarId, await client.getEvent(eventUrl));
  }

  async deleteEvent(
    access: AuthorizedRoomCalendarEventAccess,
    eventId: string,
    expectedEtag: string,
  ): Promise<void> {
    this.assertWritesEnabled();
    const scope = validateAccess(
      access,
      this.options.roomCalendarBindings,
      this.options.radicaleBaseUrl,
      this.options.servicePrincipalUserId,
    );
    const eventUrl = collectionChildUrl(scope.collectionUrl, eventId);
    const etag = requireExpectedEtag(expectedEtag);
    const client = this.client(scope.servicePrincipal);
    const current = await client.getEvent(eventUrl);
    if (current.etag !== etag) {
      throw new RoomCalendarEventOperationError('etag-conflict');
    }
    assertSingleVeventSeries(current.icalendar);
    await client.deleteEvent(eventUrl, etag);
  }

  private assertWritesEnabled(): void {
    if (this.options.eventWritesEnabled !== true) {
      throw new RoomCalendarEventOperationError('event-write-disabled');
    }
  }

  private client(
    principal: RoomCalendarEventServicePrincipal,
  ): CalDavEventClient {
    const credentialProvider = new MatrixOpenIdCalDavCredentialProvider(
      principal.userId,
      principal.credential,
    );
    return new CalDavEventClient(
      credentialProvider,
      this.fetchImpl,
      this.options.maxResponseBytes,
    );
  }
}

function validateAccess(
  access: AuthorizedRoomCalendarEventAccess,
  roomCalendarBindings: readonly RoomCalendarBinding[] | undefined,
  radicaleBaseUrl: string | undefined,
  expectedServicePrincipalUserId: string | undefined,
): {
  calendarId: string;
  collectionUrl: string;
  servicePrincipal: RoomCalendarEventServicePrincipal;
} {
  const { target, servicePrincipal } = access ?? {};
  if (
    !target ||
    target.principal?.kind !== 'service' ||
    !servicePrincipal ||
    typeof target.roomId !== 'string' ||
    typeof target.calendarId !== 'string'
  ) {
    throw new RoomCalendarEventOperationError('invalid-room-access');
  }

  try {
    resolveRoomCalendarBinding(
      roomCalendarBindings,
      target.roomId,
      target.calendarId,
    );
  } catch {
    throw new RoomCalendarEventOperationError('invalid-room-access');
  }

  let localpart: string;
  let serverName: string;
  try {
    const parsedUserId = new UserID(servicePrincipal.userId);
    localpart = parsedUserId.localpart;
    serverName = parsedUserId.domain;
    const delimiter = servicePrincipal.userId.indexOf(':');
    if (
      !servicePrincipal.userId.startsWith('@') ||
      servicePrincipal.userId !== expectedServicePrincipalUserId ||
      delimiter <= 1 ||
      delimiter === servicePrincipal.userId.length - 1 ||
      !localpart ||
      !serverName ||
      !isSafeRoomCalendarServiceUserLocalpart(localpart) ||
      servicePrincipal.userId.slice(1, delimiter) !== localpart ||
      servicePrincipal.userId.slice(delimiter + 1) !== serverName ||
      !servicePrincipal.credential ||
      typeof servicePrincipal.credential.accessToken !== 'string' ||
      servicePrincipal.credential.accessToken.length === 0 ||
      servicePrincipal.credential.matrixServerName !== serverName
    ) {
      throw new Error('invalid service principal');
    }
  } catch {
    throw new RoomCalendarEventOperationError('invalid-room-access');
  }

  let collection: URL;
  let expectedCollection: URL;
  try {
    collection = new URL(servicePrincipal.calendarUrl);
    if (!radicaleBaseUrl) {
      throw new Error('Radicale base URL is unavailable');
    }
    const base = new URL(radicaleBaseUrl);
    if (
      (base.protocol !== 'http:' && base.protocol !== 'https:') ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    ) {
      throw new Error('invalid Radicale base URL');
    }
    if (!base.pathname.endsWith('/')) {
      base.pathname = `${base.pathname}/`;
    }
    expectedCollection = new URL(
      `${encodeURIComponent(localpart)}/${encodeURIComponent(target.calendarId)}/`,
      base,
    );
  } catch {
    throw new RoomCalendarEventOperationError('invalid-room-access');
  }
  if (
    (collection.protocol !== 'http:' && collection.protocol !== 'https:') ||
    collection.username ||
    collection.password ||
    collection.search ||
    collection.hash ||
    collection.origin !== expectedCollection.origin ||
    collection.pathname !== expectedCollection.pathname
  ) {
    throw new RoomCalendarEventOperationError('invalid-room-access');
  }

  return {
    calendarId: target.calendarId,
    collectionUrl: collection.toString(),
    servicePrincipal,
  };
}

function collectionChildUrl(
  collectionUrl: string,
  eventId: string,
  requireIcsFilename = true,
): string {
  if (typeof eventId !== 'string' || eventId.length > 4096) {
    throw new RoomCalendarEventOperationError('invalid-event-url');
  }

  let eventUrl: URL;
  let collection: URL;
  try {
    eventUrl = new URL(eventId);
    collection = new URL(collectionUrl);
  } catch {
    throw new RoomCalendarEventOperationError('invalid-event-url');
  }

  const childPath = eventUrl.pathname.slice(collection.pathname.length);
  if (
    eventUrl.origin !== collection.origin ||
    eventUrl.username ||
    eventUrl.password ||
    eventUrl.search ||
    eventUrl.hash ||
    !collection.pathname.endsWith('/') ||
    !eventUrl.pathname.startsWith(collection.pathname) ||
    childPath.length === 0 ||
    childPath.includes('/')
  ) {
    throw new RoomCalendarEventOperationError('invalid-event-url');
  }

  try {
    const decodedLeaf = decodeURIComponent(childPath);
    if (
      decodedLeaf.length === 0 ||
      decodedLeaf === '.' ||
      decodedLeaf === '..' ||
      Buffer.byteLength(decodedLeaf, 'utf8') > 255 ||
      containsSlashOrControlCharacters(decodedLeaf) ||
      /%[0-9a-f]{2}/i.test(decodedLeaf) ||
      (requireIcsFilename && !decodedLeaf.toLowerCase().endsWith('.ics'))
    ) {
      throw new Error('unsafe event resource leaf');
    }
  } catch {
    throw new RoomCalendarEventOperationError('invalid-event-url');
  }
  return eventUrl.toString();
}

function containsSlashOrControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      value[index] === '/' ||
      value[index] === '\\' ||
      code <= 0x1f ||
      code === 0x7f
    ) {
      return true;
    }
  }
  return false;
}

function requireExpectedEtag(etag: string): string {
  // If-Match must name one concrete strong validator; wildcard and lists
  // would not express the caller's expected resource version.
  if (
    typeof etag !== 'string' ||
    etag.trim() !== etag ||
    !/^"[\x21\x23-\x7e]*"$/.test(etag)
  ) {
    throw new RoomCalendarEventOperationError('invalid-event-etag');
  }
  return etag;
}

function resolveResource(
  calendarId: string,
  resource: CalDavEventResource,
): RoomCalendarEventResult {
  const event = new ICalendarEventCodec().parse(
    calendarId,
    resource.href,
    resource.icalendar,
  ).event;
  return { event, etag: resource.etag };
}

function assertSingleVeventSeries(icalendar: string): void {
  if (!isSafeSingleVeventSeries(icalendar)) {
    throw new RoomCalendarEventOperationError('unsafe-event-resource');
  }
}
