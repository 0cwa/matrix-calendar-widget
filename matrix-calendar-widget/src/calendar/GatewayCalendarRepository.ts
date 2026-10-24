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
  Calendar,
  CalendarEvent,
  CalendarEventDiagnosticsRepository,
  CalendarEventId,
  CalendarEventInput,
  CalendarEventListResult,
  CalendarEventPatch,
  CalendarId,
  CalendarRepository,
  CalendarRepositoryError,
  CalendarTimeRange,
  type CalendarEventProjectionDiagnosticSummary,
} from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';
import type { CalendarDiagnostics } from './CalendarDiagnosticsRepository';
import type {
  CalendarPublicFeedPublication,
  CalendarPublicFeedRepository,
} from './CalendarPublicFeedRepository';
import type {
  CalendarRoomReminderAlarmOption,
  CalendarRoomReminderAllDaySchedule,
  CalendarRoomReminderConfiguration,
  CalendarRoomReminderIdentity,
  CalendarRoomReminderRepository,
  CalendarRoomReminderTarget,
} from './CalendarRoomReminderRepository';
import type {
  CalendarEventsWithAvailability,
  CalendarListWithAvailability,
  CalendarRoomCapabilities,
  CalendarTargetAvailabilityRepository,
} from './CalendarTargetAvailabilityRepository';
import { GatewayCalendarTransport } from './GatewayCalendarTransport';

type CalendarTarget = 'personal' | 'room';

type CalendarReference = {
  target: CalendarTarget;
  calendarId: CalendarId;
  publicCalendarId: CalendarId;
};

type EventReference = CalendarReference & {
  eventId: CalendarEventId;
  publicEventId: CalendarEventId;
  etag?: string;
};

const PUBLIC_CALENDAR_ID_PREFIX = 'matrix-calendar-target://';
const PUBLIC_EVENT_ID_PREFIX = 'matrix-calendar-event://';

type CalendarGatewayContextResource = {
  roomId?: unknown;
  roomCalendar?: unknown;
};

type CalendarGatewayEventResource = {
  event: CalendarEvent;
  etag: string;
};

type CalendarGatewayEventListResource = {
  events: CalendarGatewayEventResource[];
  diagnostics: CalendarEventProjectionDiagnosticSummary[];
};

export type GatewayCalendarRepositoryOptions = {
  baseUrl: string;
  roomId: string;
  getAuthorizationHeader: () => Promise<string | undefined>;
  getViewerTimezone?: () => string;
  getRoomCalendarCapabilities?: () => Promise<
    CalendarRoomCapabilities | undefined
  >;
  fetchImpl?: typeof fetch;
};

export class GatewayCalendarRepository
  implements
    CalendarRepository,
    CalendarEventDiagnosticsRepository,
    CalendarTargetAvailabilityRepository,
    CalendarRoomReminderRepository,
    CalendarPublicFeedRepository
{
  private readonly calendarReferences = new Map<
    CalendarId,
    CalendarReference
  >();
  private readonly eventReferencesByPublicId = new Map<
    CalendarEventId,
    EventReference
  >();
  private readonly transport: GatewayCalendarTransport;

  constructor(private readonly options: GatewayCalendarRepositoryOptions) {
    this.transport = new GatewayCalendarTransport(options);
  }

  async listCalendars(): Promise<Calendar[]> {
    return (await this.listCalendarsWithAvailability()).calendars;
  }

  async listCalendarsWithAvailability(): Promise<CalendarListWithAvailability> {
    const [personalResult, capabilitiesResult] = await Promise.allSettled([
      this.transport.requestJson<Calendar[]>(
        this.transport.url('/v1/calendar/calendars', {
          roomId: this.options.roomId,
          target: 'personal',
        }),
      ),
      this.loadRawRoomCalendarCapabilities(),
    ]);
    const calendars: Calendar[] = [];
    let partialAvailability = false;
    let canManageCalendarCollections = false;
    let roomCapabilities: CalendarRoomCapabilities | undefined;

    if (personalResult.status === 'fulfilled') {
      canManageCalendarCollections = true;
      calendars.push(
        ...personalResult.value.map((calendar) =>
          this.rememberCalendar('personal', calendar),
        ),
      );
    } else {
      partialAvailability = true;
    }

    if (capabilitiesResult.status === 'rejected') {
      partialAvailability = true;
    } else if (capabilitiesResult.value) {
      const capabilities = capabilitiesResult.value;
      if (capabilities.canReadEvents) {
        try {
          const roomCalendars = await this.transport.requestJson<Calendar[]>(
            this.transport.url('/v1/calendar/calendars', {
              roomId: this.options.roomId,
              target: 'room',
            }),
          );
          if (
            roomCalendars.length !== 1 ||
            roomCalendars[0]?.id !== capabilities.calendarId
          ) {
            throw new CalendarRepositoryError(
              'request-failed',
              'Room calendar target did not match the validated context',
            );
          }
          roomCapabilities = capabilities;
          calendars.push(
            ...roomCalendars.map((calendar) =>
              this.rememberCalendar('room', {
                ...calendar,
                operatorManaged: true,
              }),
            ),
          );
        } catch {
          partialAvailability = true;
        }
      } else {
        roomCapabilities = capabilities;
      }
    }

    const hasRoomCalendar = calendars.some(
      (calendar) => this.calendarReferences.get(calendar.id)?.target === 'room',
    );
    if (personalResult.status === 'rejected' && !hasRoomCalendar) {
      throw personalResult.reason;
    }

    return {
      calendars,
      partialAvailability,
      canManageCalendarCollections,
      roomCapabilities: roomCapabilities
        ? this.toPublicRoomCapabilities(roomCapabilities)
        : undefined,
    };
  }

  async getRoomCalendarCapabilities(): Promise<
    CalendarRoomCapabilities | undefined
  > {
    const capabilities = await this.loadRawRoomCalendarCapabilities();
    return capabilities
      ? this.toPublicRoomCapabilities(capabilities)
      : undefined;
  }

  private async loadRawRoomCalendarCapabilities(): Promise<
    CalendarRoomCapabilities | undefined
  > {
    if (this.options.getRoomCalendarCapabilities) {
      return validateRoomCapabilities(
        await this.options.getRoomCalendarCapabilities(),
      );
    }

    const context =
      await this.transport.requestJson<CalendarGatewayContextResource>(
        this.transport.url('/v1/calendar/context', {
          roomId: this.options.roomId,
        }),
      );
    const capabilities = validateRoomCapabilities(context?.roomCalendar);
    if (!capabilities) {
      return undefined;
    }
    if (
      !isSafeMatrixRoomId(context?.roomId) ||
      context.roomId !== this.options.roomId
    ) {
      throw new CalendarRepositoryError(
        'request-failed',
        'Calendar gateway returned an invalid authorized room context',
      );
    }
    return { ...capabilities, roomId: context.roomId };
  }

  private toPublicRoomCapabilities(
    capabilities: CalendarRoomCapabilities,
  ): CalendarRoomCapabilities {
    return {
      ...capabilities,
      // Calendar/event IDs exposed to the widget are target-scoped.
      // Keep room capabilities in that same namespace so callers can compare
      // them with projected event and calendar IDs.
      calendarId: this.publicCalendarId('room', capabilities.calendarId),
    };
  }

  async getPublicCalendarFeedPublication(
    calendarId: CalendarId,
  ): Promise<CalendarPublicFeedPublication> {
    const reference = this.referenceForCalendar(calendarId);
    return this.transport.requestJson<CalendarPublicFeedPublication>(
      this.transport.url('/v1/calendar-feeds/publication', {
        target: reference.target,
        calendarId: reference.calendarId,
        ...(reference.target === 'room' ? { roomId: this.options.roomId } : {}),
      }),
      { cache: 'no-store' },
    );
  }

  async publishPublicCalendarFeed(
    calendarId: CalendarId,
    confirmed: boolean,
  ): Promise<CalendarPublicFeedPublication> {
    const reference = this.referenceForCalendar(calendarId);
    return this.transport.requestJson<CalendarPublicFeedPublication>(
      this.transport.url('/v1/calendar-feeds/publication', {}),
      {
        method: 'PUT',
        body: JSON.stringify({
          target: reference.target,
          calendarId: reference.calendarId,
          ...(reference.target === 'room'
            ? { roomId: this.options.roomId }
            : {}),
          confirmed,
        }),
      },
    );
  }

  async unpublishPublicCalendarFeed(
    calendarId: CalendarId,
  ): Promise<CalendarPublicFeedPublication> {
    const reference = this.referenceForCalendar(calendarId);
    return this.transport.requestJson<CalendarPublicFeedPublication>(
      this.transport.url('/v1/calendar-feeds/publication', {}),
      {
        method: 'DELETE',
        body: JSON.stringify({
          target: reference.target,
          calendarId: reference.calendarId,
          ...(reference.target === 'room'
            ? { roomId: this.options.roomId }
            : {}),
        }),
      },
    );
  }

  async listRoomReminderAlarmOptions(
    calendarId: CalendarId,
    eventId: CalendarEventId,
  ): Promise<CalendarRoomReminderAlarmOption[]> {
    const reference = this.roomEventReference(calendarId, eventId);
    const response = await this.transport.requestJson<unknown>(
      this.transport.url(
        `/v1/calendar/rooms/${encodePathSegment(this.options.roomId)}/reminders/options`,
        { eventId: reference.eventId },
      ),
      { cache: 'no-store' },
    );
    return parseRoomReminderOptions(response);
  }

  async listRoomReminderConfigurations(): Promise<
    CalendarRoomReminderConfiguration[]
  > {
    const configurations: CalendarRoomReminderConfiguration[] = [];
    let cursor: string | undefined;
    const maxPages = 20;
    for (let page = 0; page < maxPages; page += 1) {
      const response = await this.transport.requestJson<unknown>(
        this.transport.url(
          `/v1/calendar/rooms/${encodePathSegment(this.options.roomId)}/reminders`,
          { limit: '100', ...(cursor ? { cursor } : {}) },
        ),
        { cache: 'no-store' },
      );
      const parsed = parseRoomReminderConfigurationPage(response);
      configurations.push(...parsed.items);
      if (!parsed.nextCursor) {
        return configurations;
      }
      cursor = parsed.nextCursor;
    }
    throw new CalendarRepositoryError(
      'request-failed',
      'Room reminder settings are unavailable',
    );
  }

  async enableRoomReminder(
    calendarId: CalendarId,
    eventId: CalendarEventId,
    alarmUid: string,
    recurrenceId: string | null,
    target: CalendarRoomReminderTarget,
    allDaySchedule: CalendarRoomReminderAllDaySchedule | null,
  ): Promise<CalendarRoomReminderConfiguration> {
    const reference = this.roomEventReference(calendarId, eventId);
    const response = await this.transport.requestJson<unknown>(
      this.transport.url(
        `/v1/calendar/rooms/${encodePathSegment(this.options.roomId)}/reminders`,
        {},
      ),
      {
        method: 'PUT',
        cache: 'no-store',
        body: JSON.stringify({
          eventId: reference.eventId,
          recurrenceId,
          alarmUid,
          target,
          allDaySchedule,
        }),
      },
    );
    return parseRoomReminderConfiguration(response);
  }

  async disableRoomReminder(
    identity: CalendarRoomReminderIdentity,
  ): Promise<void> {
    const response = await this.transport.requestJson<unknown>(
      this.transport.url(
        `/v1/calendar/rooms/${encodePathSegment(this.options.roomId)}/reminders`,
        {},
      ),
      {
        method: 'DELETE',
        cache: 'no-store',
        body: JSON.stringify(identity),
      },
    );
    if (
      !response ||
      typeof response !== 'object' ||
      !('deleted' in response) ||
      response.deleted !== true
    ) {
      throw new CalendarRepositoryError(
        'request-failed',
        'Room reminder settings are unavailable',
      );
    }
  }

  async getCalendarDiagnostics(): Promise<CalendarDiagnostics> {
    return this.transport.requestJson<CalendarDiagnostics>(
      this.transport.url('/v1/calendar/calendars/diagnostics', {
        roomId: this.options.roomId,
        target: 'personal',
      }),
    );
  }

  async createCalendar(name: string): Promise<Calendar> {
    return this.rememberCalendar(
      'personal',
      await this.transport.requestJson<Calendar>(
        this.transport.url('/v1/calendar/calendars', {
          roomId: this.options.roomId,
          target: 'personal',
        }),
        {
          method: 'POST',
          body: JSON.stringify({ name }),
        },
      ),
    );
  }

  async renameCalendar(calendarId: CalendarId, name: string): Promise<void> {
    const reference = this.managedCalendarReference(calendarId);
    await this.transport.requestVoid(
      this.transport.url('/v1/calendar/calendars', {
        roomId: this.options.roomId,
        target: reference.target,
        calendarId: reference.calendarId,
      }),
      {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      },
    );
  }

  async updateCalendarDescription(
    calendarId: CalendarId,
    description: string,
  ): Promise<void> {
    const reference = this.managedCalendarReference(calendarId);
    await this.transport.requestVoid(
      this.transport.url('/v1/calendar/calendars/description', {
        roomId: this.options.roomId,
        target: reference.target,
        calendarId: reference.calendarId,
      }),
      {
        method: 'PATCH',
        body: JSON.stringify({ description }),
      },
    );
  }

  async updateCalendarColor(
    calendarId: CalendarId,
    color: string,
  ): Promise<void> {
    const reference = this.managedCalendarReference(calendarId);
    await this.transport.requestVoid(
      this.transport.url('/v1/calendar/calendars/color', {
        roomId: this.options.roomId,
        target: reference.target,
        calendarId: reference.calendarId,
      }),
      {
        method: 'PATCH',
        body: JSON.stringify({ color }),
      },
    );
  }

  async deleteCalendar(calendarId: CalendarId): Promise<void> {
    const reference = this.managedCalendarReference(calendarId);
    try {
      await this.transport.requestVoid(
        this.transport.url('/v1/calendar/calendars', {
          roomId: this.options.roomId,
          target: reference.target,
          calendarId: reference.calendarId,
        }),
        { method: 'DELETE' },
      );
    } catch (error) {
      if (
        error instanceof CalendarRepositoryError &&
        error.code === 'event-conflict'
      ) {
        throw new CalendarRepositoryError(
          'request-failed',
          'Calendar deletion was rejected by the gateway',
        );
      }
      throw error;
    }
  }

  async listEvents(
    calendarIds: CalendarId[],
    range: CalendarTimeRange,
  ): Promise<CalendarEvent[]> {
    return (await this.listEventsWithDiagnostics(calendarIds, range)).events;
  }

  async listEventsWithDiagnostics(
    calendarIds: CalendarId[],
    range: CalendarTimeRange,
  ): Promise<CalendarEventListResult> {
    const { partialAvailability: _partialAvailability, ...result } =
      await this.listEventsWithAvailability(calendarIds, range);
    return result;
  }

  async listEventsWithAvailability(
    calendarIds: CalendarId[],
    range: CalendarTimeRange,
  ): Promise<CalendarEventsWithAvailability> {
    const viewerTimezone =
      this.options.getViewerTimezone?.() ?? DateTime.local().zoneName ?? 'UTC';
    const results = await Promise.allSettled(
      calendarIds.map((publicCalendarId) => {
        const reference = this.referenceForCalendar(publicCalendarId);
        return this.transport
          .requestJson<CalendarGatewayEventListResource>(
            this.transport.url('/v1/calendar/events', {
              roomId: this.options.roomId,
              target: reference.target,
              calendarId: reference.calendarId,
              start: range.start,
              end: range.end,
              timezone: viewerTimezone,
            }),
          )
          .then((result) => ({ publicCalendarId, reference, result }));
      }),
    );
    const successfulResults = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const failedResults = results.filter(
      (result) => result.status === 'rejected',
    );
    if (failedResults.length > 0 && successfulResults.length === 0) {
      throw failedResults[0].reason;
    }

    return {
      events: successfulResults.flatMap(({ reference, result }) =>
        result.events.map((resource) => this.remember(reference, resource)),
      ),
      diagnostics: successfulResults
        .flatMap(({ publicCalendarId, result }) =>
          result.diagnostics.map((diagnostic) => ({
            ...diagnostic,
            calendarId: publicCalendarId,
          })),
        )
        .sort(
          (left, right) =>
            left.calendarId.localeCompare(right.calendarId) ||
            left.reason.localeCompare(right.reason),
        ),
      partialAvailability: failedResults.length > 0,
    };
  }

  async getEvent(
    calendarId: CalendarId,
    eventId: CalendarEventId,
  ): Promise<CalendarEvent> {
    const calendarReference = this.referenceForCalendar(calendarId);
    const reference = this.referenceForEvent(calendarReference, eventId);
    return this.remember(
      calendarReference,
      await this.transport.requestJson<CalendarGatewayEventResource>(
        this.transport.url('/v1/calendar/event', {
          roomId: this.options.roomId,
          target: reference.target,
          calendarId: reference.calendarId,
          eventId: reference.eventId,
        }),
      ),
    );
  }

  async createEvent(
    calendarId: CalendarId,
    input: CalendarEventInput,
  ): Promise<CalendarEvent> {
    const reference = this.referenceForCalendar(calendarId);
    return this.remember(
      reference,
      await this.transport.requestJson<CalendarGatewayEventResource>(
        this.transport.url('/v1/calendar/events', {
          roomId: this.options.roomId,
          target: reference.target,
          calendarId: reference.calendarId,
        }),
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
      ),
    );
  }

  async updateEvent(
    calendarId: CalendarId,
    eventId: CalendarEventId,
    patch: CalendarEventPatch,
  ): Promise<CalendarEvent> {
    const calendarReference = this.referenceForCalendar(calendarId);
    const reference = this.referenceForEvent(calendarReference, eventId);
    const etag = await this.etagFor(reference);

    try {
      return this.remember(
        calendarReference,
        await this.transport.requestJson<CalendarGatewayEventResource>(
          this.transport.url('/v1/calendar/events', {
            roomId: this.options.roomId,
            target: reference.target,
            calendarId: reference.calendarId,
            eventId: reference.eventId,
          }),
          {
            method: 'PATCH',
            headers: { 'If-Match': etag },
            body: JSON.stringify(patch),
          },
        ),
      );
    } catch (error) {
      if (
        error instanceof CalendarRepositoryError &&
        error.code === 'event-conflict'
      ) {
        reference.etag = undefined;
      }
      throw error;
    }
  }

  async deleteEvent(
    calendarId: CalendarId,
    eventId: CalendarEventId,
  ): Promise<void> {
    const calendarReference = this.referenceForCalendar(calendarId);
    const reference = this.referenceForEvent(calendarReference, eventId);
    const etag = await this.etagFor(reference);

    try {
      await this.transport.requestVoid(
        this.transport.url('/v1/calendar/events', {
          roomId: this.options.roomId,
          target: reference.target,
          calendarId: reference.calendarId,
          eventId: reference.eventId,
        }),
        {
          method: 'DELETE',
          headers: { 'If-Match': etag },
        },
      );
      reference.etag = undefined;
      this.eventReferencesByPublicId.delete(reference.publicEventId);
    } catch (error) {
      if (
        error instanceof CalendarRepositoryError &&
        error.code === 'event-conflict'
      ) {
        reference.etag = undefined;
      }
      throw error;
    }
  }

  private async etagFor(reference: EventReference): Promise<string> {
    if (reference.etag) {
      return reference.etag;
    }

    await this.getEvent(reference.publicCalendarId, reference.publicEventId);
    const refreshedReference = this.eventReferencesByPublicId.get(
      this.publicEventId(reference, reference.eventId),
    );
    if (refreshedReference?.etag) {
      reference.etag = refreshedReference.etag;
    }
    if (!reference.etag) {
      throw new CalendarRepositoryError(
        'request-failed',
        'Calendar gateway event response did not include an ETag',
      );
    }

    return reference.etag;
  }

  private remember(
    calendarReference: CalendarReference,
    resource: CalendarGatewayEventResource,
  ): CalendarEvent {
    if (
      !resource?.event ||
      typeof resource.etag !== 'string' ||
      resource.event.calendarId !== calendarReference.calendarId
    ) {
      throw new CalendarRepositoryError(
        'request-failed',
        'Calendar gateway returned an invalid event resource',
      );
    }

    const publicEventId = this.publicEventId(
      calendarReference,
      resource.event.id,
    );
    const reference: EventReference = {
      ...calendarReference,
      eventId: resource.event.id,
      publicEventId,
      etag: resource.etag,
    };
    const currentReference = this.eventReferencesByPublicId.get(publicEventId);
    if (currentReference) {
      currentReference.etag = resource.etag;
    } else {
      this.eventReferencesByPublicId.set(publicEventId, reference);
    }
    return {
      ...resource.event,
      id: publicEventId,
      calendarId: calendarReference.publicCalendarId,
    };
  }

  private rememberCalendar(
    target: CalendarTarget,
    calendar: Calendar,
  ): Calendar {
    if (!calendar || typeof calendar.id !== 'string' || !calendar.id) {
      throw new CalendarRepositoryError(
        'request-failed',
        'Calendar gateway returned an invalid calendar resource',
      );
    }
    const publicCalendarId = this.publicCalendarId(target, calendar.id);
    this.calendarReferences.set(publicCalendarId, {
      target,
      calendarId: calendar.id,
      publicCalendarId,
    });
    return { ...calendar, id: publicCalendarId };
  }

  private referenceForCalendar(
    publicCalendarId: CalendarId,
  ): CalendarReference {
    const reference = this.calendarReferences.get(publicCalendarId);
    if (reference) {
      return reference;
    }
    if (publicCalendarId.startsWith(PUBLIC_CALENDAR_ID_PREFIX)) {
      throw new CalendarRepositoryError(
        'request-failed',
        'Calendar target is no longer available; reload the calendar',
      );
    }
    return {
      target: 'personal',
      calendarId: publicCalendarId,
      publicCalendarId,
    };
  }

  private referenceForEvent(
    calendarReference: CalendarReference,
    publicEventId: CalendarEventId,
  ): EventReference {
    const reference = this.eventReferencesByPublicId.get(publicEventId);
    if (reference) {
      if (
        reference.target !== calendarReference.target ||
        reference.calendarId !== calendarReference.calendarId
      ) {
        throw new CalendarRepositoryError(
          'request-failed',
          'Event does not belong to the selected calendar target',
        );
      }
      return reference;
    }
    if (publicEventId.startsWith(PUBLIC_EVENT_ID_PREFIX)) {
      throw new CalendarRepositoryError(
        'request-failed',
        'Event target is no longer available; reload the calendar',
      );
    }
    for (const candidate of this.eventReferencesByPublicId.values()) {
      if (
        candidate.target === calendarReference.target &&
        candidate.calendarId === calendarReference.calendarId &&
        candidate.eventId === publicEventId
      ) {
        return candidate;
      }
    }
    return {
      ...calendarReference,
      eventId: publicEventId,
      publicEventId,
    };
  }

  private publicCalendarId(
    target: CalendarTarget,
    calendarId: CalendarId,
  ): CalendarId {
    return `${PUBLIC_CALENDAR_ID_PREFIX}${target}/${encodeURIComponent(calendarId)}`;
  }

  private publicEventId(
    reference: CalendarReference,
    eventId: CalendarEventId,
  ): CalendarEventId {
    return `${PUBLIC_EVENT_ID_PREFIX}${reference.target}/${encodeURIComponent(reference.calendarId)}/${encodeURIComponent(eventId)}`;
  }

  private managedCalendarReference(
    publicCalendarId: CalendarId,
  ): CalendarReference {
    const reference = this.referenceForCalendar(publicCalendarId);
    if (reference.target !== 'personal') {
      throw new CalendarRepositoryError(
        'request-failed',
        'Room calendar collections are managed outside the widget',
      );
    }
    return reference;
  }

  private roomEventReference(
    publicCalendarId: CalendarId,
    publicEventId: CalendarEventId,
  ): EventReference {
    const calendarReference = this.referenceForCalendar(publicCalendarId);
    if (calendarReference.target !== 'room') {
      throw new CalendarRepositoryError(
        'request-failed',
        'Room reminders are available only for the room calendar',
      );
    }
    return this.referenceForEvent(calendarReference, publicEventId);
  }
}

function validateRoomCapabilities(
  value: unknown,
): CalendarRoomCapabilities | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (
    typeof value !== 'object' ||
    !('calendarId' in value) ||
    typeof value.calendarId !== 'string' ||
    value.calendarId.length === 0 ||
    !('canReadEvents' in value) ||
    typeof value.canReadEvents !== 'boolean' ||
    !('canWriteEvents' in value) ||
    typeof value.canWriteEvents !== 'boolean' ||
    !('canManageReminders' in value) ||
    typeof value.canManageReminders !== 'boolean'
  ) {
    throw new CalendarRepositoryError(
      'request-failed',
      'Calendar gateway returned invalid room calendar capabilities',
    );
  }

  return {
    calendarId: value.calendarId,
    canReadEvents: value.canReadEvents,
    canWriteEvents: value.canWriteEvents,
    canManageReminders: value.canManageReminders,
  };
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function isSafeMatrixRoomId(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length < 4 ||
    value.length > 255 ||
    value.trim() !== value ||
    !value.startsWith('!') ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#')
  ) {
    return false;
  }
  const separatorIndex = value.indexOf(':');
  if (separatorIndex === -1) {
    return /^![A-Za-z0-9_-]{43}$/u.test(value);
  }
  if (separatorIndex < 2 || separatorIndex === value.length - 1) {
    return false;
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x061c ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      return false;
    }
  }
  return true;
}

function parseRoomReminderOptions(
  value: unknown,
): CalendarRoomReminderAlarmOption[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !('options' in value) ||
    !Array.isArray(value.options) ||
    value.options.length > 64
  ) {
    throw invalidRoomReminderResponse();
  }

  return value.options.map((candidate) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Object.keys(candidate).some(
        (key) =>
          ![
            'eventUid',
            'recurrenceId',
            'alarmUid',
            'timingType',
            'supported',
            'requiresAllDaySchedule',
            'unavailableReason',
            'relatedTo',
            'trigger',
            'repeat',
          ].includes(key),
      ) ||
      !('eventUid' in candidate) ||
      !isBoundedString(candidate.eventUid, 255) ||
      candidate.eventUid.trim() !== candidate.eventUid ||
      !('recurrenceId' in candidate) ||
      !(
        candidate.recurrenceId === null ||
        isBoundedString(candidate.recurrenceId, 4096)
      ) ||
      !('alarmUid' in candidate) ||
      !isBoundedString(candidate.alarmUid, 255) ||
      !('timingType' in candidate) ||
      !['timed', 'all-day', 'unsupported'].includes(
        String(candidate.timingType),
      ) ||
      !('supported' in candidate) ||
      typeof candidate.supported !== 'boolean' ||
      !('requiresAllDaySchedule' in candidate) ||
      typeof candidate.requiresAllDaySchedule !== 'boolean' ||
      ('unavailableReason' in candidate &&
        candidate.unavailableReason !== undefined &&
        ![
          'unsupported-timezone',
          'unsupported-event-timing',
          'absolute-trigger',
          'unsupported-trigger',
        ].includes(String(candidate.unavailableReason))) ||
      ('relatedTo' in candidate &&
        candidate.relatedTo !== undefined &&
        candidate.relatedTo !== 'start' &&
        candidate.relatedTo !== 'end')
    ) {
      throw invalidRoomReminderResponse();
    }

    const trigger =
      'trigger' in candidate && candidate.trigger !== undefined
        ? parseReminderDuration(candidate.trigger)
        : undefined;
    const relatedTo =
      candidate.relatedTo === 'start' || candidate.relatedTo === 'end'
        ? candidate.relatedTo
        : undefined;
    let repeat: CalendarRoomReminderAlarmOption['repeat'];
    if ('repeat' in candidate && candidate.repeat !== undefined) {
      const rawRepeat = candidate.repeat;
      if (
        !rawRepeat ||
        typeof rawRepeat !== 'object' ||
        !('count' in rawRepeat) ||
        !Number.isSafeInteger(rawRepeat.count) ||
        (rawRepeat.count as number) <= 0 ||
        !('interval' in rawRepeat)
      ) {
        throw invalidRoomReminderResponse();
      }
      const interval = parseReminderDuration(rawRepeat.interval);
      if (
        interval.isNegative ||
        interval.weeks +
          interval.days +
          interval.hours +
          interval.minutes +
          interval.seconds ===
          0
      ) {
        throw invalidRoomReminderResponse();
      }
      repeat = { count: rawRepeat.count as number, interval };
    }

    if (
      (candidate.supported && (!trigger || !relatedTo)) ||
      (candidate.supported && candidate.unavailableReason !== undefined) ||
      (candidate.timingType === 'all-day' &&
        candidate.supported &&
        candidate.requiresAllDaySchedule !== true) ||
      (candidate.timingType === 'timed' &&
        candidate.requiresAllDaySchedule === true) ||
      (!candidate.supported && candidate.unavailableReason === undefined)
    ) {
      throw invalidRoomReminderResponse();
    }

    return {
      eventUid: candidate.eventUid,
      recurrenceId: candidate.recurrenceId as string | null,
      alarmUid: candidate.alarmUid,
      timingType:
        candidate.timingType as CalendarRoomReminderAlarmOption['timingType'],
      supported: candidate.supported,
      requiresAllDaySchedule: candidate.requiresAllDaySchedule,
      ...(candidate.unavailableReason === undefined
        ? {}
        : {
            unavailableReason: candidate.unavailableReason as NonNullable<
              CalendarRoomReminderAlarmOption['unavailableReason']
            >,
          }),
      ...(relatedTo ? { relatedTo } : {}),
      ...(trigger ? { trigger } : {}),
      ...(repeat ? { repeat } : {}),
    };
  });
}

function parseRoomReminderConfigurationPage(value: unknown): {
  items: CalendarRoomReminderConfiguration[];
  nextCursor?: string;
} {
  if (
    !value ||
    typeof value !== 'object' ||
    !('items' in value) ||
    !Array.isArray(value.items) ||
    value.items.length > 100
  ) {
    throw invalidRoomReminderResponse();
  }
  const items = value.items.map(parseRoomReminderConfiguration);
  let nextCursor: string | undefined;
  if ('nextCursor' in value && value.nextCursor !== undefined) {
    if (!isBoundedString(value.nextCursor, 16384)) {
      throw invalidRoomReminderResponse();
    }
    nextCursor = value.nextCursor;
  }
  return { items, ...(nextCursor ? { nextCursor } : {}) };
}

function parseRoomReminderIdentity(
  value: unknown,
): CalendarRoomReminderIdentity {
  if (
    !value ||
    typeof value !== 'object' ||
    !('eventUid' in value) ||
    !isBoundedString(value.eventUid, 255) ||
    value.eventUid.trim() !== value.eventUid ||
    !('recurrenceId' in value) ||
    !(
      value.recurrenceId === null || isBoundedString(value.recurrenceId, 4096)
    ) ||
    !('alarmUid' in value) ||
    !isBoundedString(value.alarmUid, 255)
  ) {
    throw invalidRoomReminderResponse();
  }
  return {
    eventUid: value.eventUid,
    recurrenceId: value.recurrenceId as string | null,
    alarmUid: value.alarmUid,
  };
}

function parseRoomReminderConfiguration(
  value: unknown,
): CalendarRoomReminderConfiguration {
  const identity = parseRoomReminderIdentity(value);
  if (!value || typeof value !== 'object') throw invalidRoomReminderResponse();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) =>
        ![
          'eventUid',
          'recurrenceId',
          'alarmUid',
          'target',
          'allDaySchedule',
          'revision',
        ].includes(key),
    )
  ) {
    throw invalidRoomReminderResponse();
  }
  const target =
    record.target === undefined
      ? { kind: 'room' as const }
      : parseRoomReminderTarget(record.target);
  const allDaySchedule =
    record.allDaySchedule === undefined || record.allDaySchedule === null
      ? null
      : parseAllDayReminderSchedule(record.allDaySchedule);
  const revision = record.revision === undefined ? 1 : record.revision;
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) {
    throw invalidRoomReminderResponse();
  }
  return {
    ...identity,
    target,
    allDaySchedule,
    revision: revision as number,
  };
}

function parseRoomReminderTarget(value: unknown): CalendarRoomReminderTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidRoomReminderResponse();
  }
  const record = value as Record<string, unknown>;
  if (record.kind === 'room' && Object.keys(record).length === 1) {
    return { kind: 'room' };
  }
  if (
    record.kind !== 'users' ||
    Object.keys(record).length !== 2 ||
    !Array.isArray(record.userIds) ||
    record.userIds.length === 0 ||
    record.userIds.length > 50 ||
    record.userIds.some(
      (userId) =>
        typeof userId !== 'string' ||
        userId.length > 255 ||
        !/^@[^:\s?#]+:[^\s?#]+$/.test(userId),
    ) ||
    new Set(record.userIds).size !== record.userIds.length
  ) {
    throw invalidRoomReminderResponse();
  }
  return {
    kind: 'users',
    userIds: [...(record.userIds as string[])].sort(),
  };
}

function parseAllDayReminderSchedule(
  value: unknown,
): CalendarRoomReminderAllDaySchedule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidRoomReminderResponse();
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 3 ||
    !Number.isSafeInteger(record.daysBefore) ||
    (record.daysBefore as number) < 0 ||
    (record.daysBefore as number) > 366 ||
    typeof record.localTime !== 'string' ||
    !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(record.localTime) ||
    typeof record.timezone !== 'string' ||
    record.timezone.length === 0 ||
    record.timezone.length > 64
  ) {
    throw invalidRoomReminderResponse();
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: record.timezone });
  } catch {
    throw invalidRoomReminderResponse();
  }
  return {
    daysBefore: record.daysBefore as number,
    localTime: record.localTime,
    timezone: record.timezone,
  };
}

function parseReminderDuration(
  value: unknown,
): NonNullable<CalendarRoomReminderAlarmOption['trigger']> {
  if (
    !value ||
    typeof value !== 'object' ||
    !('weeks' in value) ||
    !isNonnegativeSafeInteger(value.weeks) ||
    !('days' in value) ||
    !isNonnegativeSafeInteger(value.days) ||
    !('hours' in value) ||
    !isNonnegativeSafeInteger(value.hours) ||
    !('minutes' in value) ||
    !isNonnegativeSafeInteger(value.minutes) ||
    !('seconds' in value) ||
    !isNonnegativeSafeInteger(value.seconds) ||
    !('isNegative' in value) ||
    typeof value.isNegative !== 'boolean'
  ) {
    throw invalidRoomReminderResponse();
  }
  return {
    weeks: value.weeks,
    days: value.days,
    hours: value.hours,
    minutes: value.minutes,
    seconds: value.seconds,
    isNegative: value.isNegative,
  };
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    !containsControlCharacters(value)
  );
}

function containsControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && codePoint <= 0x1f) {
      return true;
    }
    if (codePoint !== undefined && codePoint >= 0x7f && codePoint <= 0x9f) {
      return true;
    }
  }
  return false;
}

function invalidRoomReminderResponse(): CalendarRepositoryError {
  return new CalendarRepositoryError(
    'request-failed',
    'Room reminder settings are unavailable',
  );
}
