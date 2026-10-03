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
  CalendarAuthorization,
  CalendarAuthorizationRequest,
  CalendarEvent,
  CalendarEventInput,
  CalendarTimeRange,
  calendarEventTimedDateTimeToDateTime,
  calendarLocalDateTimeToUnixMillis,
  projectCalendarEventOccurrences,
} from '@matrix-calendar-widget/calendar';
import { ServiceUnavailableException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';
import { CalDavEventTransportError } from '../caldav/CalDavEventClient';
import { IAppConfiguration } from '../IAppConfiguration';
import { RoomCalendarBinding } from '../model/IRoomCalendarBinding';
import {
  CalendarCommandEventLabels,
  formatCalendarEventDetails,
  formatCalendarEventOccurrence,
} from './CalendarCommandFormatter';
import {
  CalendarCommandRequest,
  InvalidCalendarCommandError,
  UPCOMING_HORIZON_DAYS,
  calendarResourceHref,
  calendarResourceIdFromHref,
  isWholeEventResourceDeletable,
  parseCalendarCommand,
} from './CalendarCommandParser';
import {
  RoomCalendarBindingError,
  resolveRoomCalendarBinding,
} from './RoomCalendarBindingResolver';
import {
  RoomCalendarCalDavPrincipal,
  RoomCalendarTarget,
} from './RoomCalendarCalDavAccess';

export type CalendarCommandErrorKey =
  | 'badSyntax'
  | 'notAllowed'
  | 'disabled'
  | 'writesDisabled'
  | 'notFound'
  | 'conflict'
  | 'unsafe'
  | 'failed';

export type CalendarCommandTranslation = (
  key: string,
  parameters?: Record<string, unknown>,
) => string;

export interface CalendarCommandCalDavAccessPort {
  forAuthorizedTarget(
    target: RoomCalendarTarget,
    mode: 'read' | 'write',
  ): Promise<RoomCalendarCalDavPrincipal>;
}

export interface CalendarCommandAuthorizationPort {
  forRoom(userId: string, roomId: string): CalendarAuthorization;
}

export interface CalendarCommandEventAccess {
  readonly target: RoomCalendarTarget;
  readonly servicePrincipal: RoomCalendarCalDavPrincipal;
}

export interface CalendarCommandEventResult {
  readonly event: CalendarEvent;
  readonly etag: string;
}

export interface CalendarCommandEventResourceResult extends CalendarCommandEventResult {
  readonly icalendar: string;
}

export interface CalendarCommandEventOperationsPort {
  getEvent(
    access: CalendarCommandEventAccess,
    eventId: string,
  ): Promise<CalendarCommandEventResult>;
  getEventResource(
    access: CalendarCommandEventAccess,
    eventId: string,
  ): Promise<CalendarCommandEventResourceResult>;
  listEvents(
    access: CalendarCommandEventAccess,
    range: CalendarTimeRange,
  ): Promise<CalendarCommandEventResult[]>;
  createEvent(
    access: CalendarCommandEventAccess,
    input: CalendarEventInput,
  ): Promise<CalendarCommandEventResult>;
  deleteEvent(
    access: CalendarCommandEventAccess,
    eventId: string,
    expectedEtag: string,
  ): Promise<void>;
}

type CalendarCommandConfiguration = IAppConfiguration & {
  readonly room_calendar_event_writes_enabled?: boolean;
};

/**
 * Executes the deliberately small bot fallback command surface. This class
 * accepts only typed server services and a localized string function; it
 * never treats the Matrix sender as a CalDAV principal.
 */
export class CalendarCommandService {
  constructor(
    private readonly appConfig: CalendarCommandConfiguration,
    private readonly authorizationFactory: CalendarCommandAuthorizationPort,
    private readonly roomCalendarCalDavAccess: CalendarCommandCalDavAccessPort,
    private readonly eventOperations: CalendarCommandEventOperationsPort,
  ) {}

  async execute(
    roomId: string,
    sender: string,
    commandText: string,
    translate: CalendarCommandTranslation,
  ): Promise<string> {
    try {
      const command = parseCalendarCommand(commandText);
      switch (command.kind) {
        case 'upcoming':
          return await this.upcoming(roomId, sender, command, translate);
        case 'event':
          return await this.event(roomId, sender, command, translate);
        case 'create':
          return await this.create(roomId, sender, command, translate);
        case 'delete':
          return await this.delete(roomId, sender, command, translate);
      }
    } catch (error) {
      return translate(
        `calendarCommandErrors.${calendarCommandErrorKey(error)}`,
      );
    }
  }

  private async upcoming(
    roomId: string,
    sender: string,
    command: Extract<CalendarCommandRequest, { kind: 'upcoming' }>,
    translate: CalendarCommandTranslation,
  ): Promise<string> {
    const { access } = await this.authorizedAccess(roomId, sender, 'read');
    const now = DateTime.utc();
    const range = calendarRange(now, now.plus({ days: UPCOMING_HORIZON_DAYS }));
    const results = await this.eventOperations.listEvents(access, range);
    const projection = projectCalendarEventOccurrences(
      results.map(({ event }) => event),
      range,
      command.timeZone,
    );

    const eventsById = new Map(
      results.map(({ event }) => [event.id, event] as const),
    );
    let hasUnavailableEntries = projection.diagnostics.length > 0;
    if (
      results.some(
        ({ event }) =>
          calendarResourceIdFromHref(
            event.id,
            access.servicePrincipal.calendarUrl,
          ) === undefined,
      )
    ) {
      hasUnavailableEntries = true;
    }
    const occurrences = projection.occurrences
      .map((occurrence) => {
        const resourceId = calendarResourceIdFromHref(
          occurrence.sourceEvent.id,
          access.servicePrincipal.calendarUrl,
        );
        if (!resourceId) {
          hasUnavailableEntries = true;
          return undefined;
        }
        const source = eventsById.get(occurrence.sourceEvent.id);
        if (!source) {
          hasUnavailableEntries = true;
          return undefined;
        }
        return { occurrence, resourceId };
      })
      .filter(
        (value): value is NonNullable<typeof value> => value !== undefined,
      )
      .sort(
        (left, right) =>
          eventStartMillis(left.occurrence.event, command.timeZone) -
          eventStartMillis(right.occurrence.event, command.timeZone),
      )
      .slice(0, command.count);

    if (occurrences.length === 0) {
      if (hasUnavailableEntries) {
        return translate('calendarCommandReplies.upcomingPartial');
      }
      return translate('calendarCommandReplies.noUpcoming');
    }

    const labels = this.eventLabels(translate);
    const lines = occurrences.map(({ occurrence, resourceId }) =>
      formatCalendarEventOccurrence(
        occurrence.event,
        resourceId,
        command.timeZone,
        labels,
      ),
    );
    const response = `${translate('calendarCommandReplies.upcoming')}\n${lines.join('\n')}`;
    return hasUnavailableEntries
      ? `${response}\n\n${translate('calendarCommandReplies.upcomingPartial')}`
      : response;
  }

  private async event(
    roomId: string,
    sender: string,
    command: Extract<CalendarCommandRequest, { kind: 'event' }>,
    translate: CalendarCommandTranslation,
  ): Promise<string> {
    const { access } = await this.authorizedAccess(roomId, sender, 'read');
    const eventHref = calendarResourceHref(
      access.servicePrincipal.calendarUrl,
      command.resourceId,
    );
    if (!eventHref) {
      throw new CalendarCommandFailure('unsafe');
    }

    const result = await this.eventOperations.getEvent(access, eventHref);
    this.assertSameResource(result.event.id, command.resourceId, access);
    const labels = this.eventLabels(translate);
    return `${translate('calendarCommandReplies.eventDetails')}\n${formatCalendarEventDetails(
      result.event,
      command.resourceId,
      command.timeZone,
      labels,
    )}`;
  }

  private async create(
    roomId: string,
    sender: string,
    command: Extract<CalendarCommandRequest, { kind: 'create' }>,
    translate: CalendarCommandTranslation,
  ): Promise<string> {
    const { access } = await this.authorizedAccess(roomId, sender, 'write', {
      action: 'create-event',
    });
    const input: CalendarEventInput = {
      uid: randomUUID(),
      title: command.title,
      description: command.description,
      timing: command.timing,
    };
    const result = await this.eventOperations.createEvent(access, input);
    const resourceId = calendarResourceIdFromHref(
      result.event.id,
      access.servicePrincipal.calendarUrl,
    );
    if (!resourceId) {
      throw new CalendarCommandFailure('unsafe');
    }
    return translate('calendarCommandReplies.eventCreated', { resourceId });
  }

  private async delete(
    roomId: string,
    sender: string,
    command: Extract<CalendarCommandRequest, { kind: 'delete' }>,
    translate: CalendarCommandTranslation,
  ): Promise<string> {
    const { access } = await this.authorizedAccess(roomId, sender, 'write', {
      action: 'delete-event',
      eventId: command.resourceId,
    });
    const eventHref = calendarResourceHref(
      access.servicePrincipal.calendarUrl,
      command.resourceId,
    );
    if (!eventHref) {
      throw new CalendarCommandFailure('unsafe');
    }

    const current = await this.eventOperations.getEventResource(
      access,
      eventHref,
    );
    this.assertSameResource(current.event.id, command.resourceId, access);
    if (!isWholeEventResourceDeletable(current.icalendar)) {
      throw new CalendarCommandFailure('unsafe');
    }
    await this.eventOperations.deleteEvent(access, eventHref, current.etag);
    return translate('calendarCommandReplies.eventDeleted', {
      resourceId: command.resourceId,
    });
  }

  private async authorizedAccess(
    roomId: string,
    sender: string,
    mode: 'read' | 'write',
    writeRequest?:
      | { action: 'create-event' }
      | { action: 'delete-event'; eventId: string },
  ): Promise<{ access: CalendarCommandEventAccess }> {
    if (!this.appConfig.room_calendar_access_enabled) {
      throw new CalendarCommandFailure('disabled');
    }
    if (
      mode === 'write' &&
      this.appConfig.room_calendar_event_writes_enabled !== true
    ) {
      throw new CalendarCommandFailure('writesDisabled');
    }

    let binding: RoomCalendarBinding;
    try {
      binding = resolveRoomCalendarBinding(
        this.appConfig.room_calendar_bindings,
        roomId,
      );
    } catch (error) {
      if (error instanceof RoomCalendarBindingError) {
        throw new CalendarCommandFailure('disabled');
      }
      throw error;
    }

    const authorizationRequest: CalendarAuthorizationRequest =
      writeRequest === undefined
        ? { action: 'read-events', calendarId: binding.calendarId }
        : { ...writeRequest, calendarId: binding.calendarId };
    const allowed = await this.authorizationFactory
      .forRoom(sender, roomId)
      .isAllowed(authorizationRequest);
    if (!allowed) {
      throw new CalendarCommandFailure('notAllowed');
    }

    const target: RoomCalendarTarget = {
      roomId: binding.roomId,
      calendarId: binding.calendarId,
      principal: { kind: 'service' },
    };
    const servicePrincipal =
      await this.roomCalendarCalDavAccess.forAuthorizedTarget(target, mode);
    return { access: { target, servicePrincipal } };
  }

  private assertSameResource(
    eventHref: string,
    expectedId: string,
    access: CalendarCommandEventAccess,
  ): void {
    if (
      calendarResourceIdFromHref(
        eventHref,
        access.servicePrincipal.calendarUrl,
      ) !== expectedId
    ) {
      throw new CalendarCommandFailure('unsafe');
    }
  }

  private eventLabels(
    translate: CalendarCommandTranslation,
  ): CalendarCommandEventLabels {
    return {
      id: translate('calendarCommandReplies.idLabel'),
      title: translate('calendarCommandReplies.titleLabel'),
      when: translate('calendarCommandReplies.whenLabel'),
      description: translate('calendarCommandReplies.descriptionLabel'),
      untitled: translate('calendarCommandReplies.untitled'),
      timeUnavailable: translate('calendarCommandReplies.timeUnavailable'),
    };
  }
}

class CalendarCommandFailure extends Error {
  constructor(readonly errorKey: CalendarCommandErrorKey) {
    super(errorKey);
    this.name = 'CalendarCommandFailure';
  }
}

function calendarRange(start: DateTime, end: DateTime): CalendarTimeRange {
  const rangeStart = start.toISO({ suppressMilliseconds: true });
  const rangeEnd = end.toISO({ suppressMilliseconds: true });
  if (!rangeStart || !rangeEnd) {
    throw new CalendarCommandFailure('failed');
  }
  return { start: rangeStart, end: rangeEnd };
}

function eventStartMillis(event: CalendarEvent, timeZone: string): number {
  if (event.timing.type === 'all-day') {
    return calendarLocalDateTimeToUnixMillis(
      `${event.timing.startDate}T00:00:00`,
      timeZone,
    );
  }
  return calendarEventTimedDateTimeToDateTime(
    event.timing.start,
    timeZone,
  ).toMillis();
}

function calendarCommandErrorKey(error: unknown): CalendarCommandErrorKey {
  if (error instanceof CalendarCommandFailure) {
    return error.errorKey;
  }
  if (error instanceof InvalidCalendarCommandError) {
    return 'badSyntax';
  }
  if (error instanceof ServiceUnavailableException) {
    const response = error.getResponse();
    if (
      response !== null &&
      typeof response === 'object' &&
      'code' in response &&
      response.code === 'room-calendar-caldav-disabled'
    ) {
      return 'disabled';
    }
    return 'failed';
  }
  if (error instanceof CalDavEventTransportError) {
    if (error.code === 'etag-conflict') {
      return 'conflict';
    }
    if (
      error.code === 'request-failed' &&
      error.method === 'GET' &&
      error.status === 404
    ) {
      return 'notFound';
    }
  }

  const operationErrorCode =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  switch (operationErrorCode) {
    case 'event-write-disabled':
      return 'writesDisabled';
    case 'etag-conflict':
      return 'conflict';
    case 'invalid-event-url':
    case 'invalid-event-etag':
    case 'unsafe-event-resource':
      return 'unsafe';
    case 'invalid-room-access':
      return 'disabled';
    default:
      return 'failed';
  }
}
