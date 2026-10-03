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
  CalendarRoomReminderAlarmOption,
  CalendarRoomReminderIdentity,
  CalendarRoomReminderRepository,
} from './CalendarRoomReminderRepository';
import type {
  CalendarEventsWithAvailability,
  CalendarListWithAvailability,
  CalendarRoomCapabilities,
  CalendarTargetAvailabilityRepository,
} from './CalendarTargetAvailabilityRepository';

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
    CalendarRoomReminderRepository
{
  private readonly calendarReferences = new Map<
    CalendarId,
    CalendarReference
  >();
  private readonly eventReferencesByPublicId = new Map<
    CalendarEventId,
    EventReference
  >();
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GatewayCalendarRepositoryOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listCalendars(): Promise<Calendar[]> {
    return (await this.listCalendarsWithAvailability()).calendars;
  }

  async listCalendarsWithAvailability(): Promise<CalendarListWithAvailability> {
    const [personalResult, capabilitiesResult] = await Promise.allSettled([
      this.requestJson<Calendar[]>(
        this.url('/v1/calendar/calendars', {
          roomId: this.options.roomId,
          target: 'personal',
        }),
      ),
      this.getRoomCalendarCapabilities(),
    ]);
    const calendars: Calendar[] = [];
    let partialAvailability = false;
    let canManageCalendarCollections = false;

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
          const roomCalendars = await this.requestJson<Calendar[]>(
            this.url('/v1/calendar/calendars', {
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
      roomCapabilities:
        capabilitiesResult.status === 'fulfilled'
          ? capabilitiesResult.value
          : undefined,
    };
  }

  async getRoomCalendarCapabilities(): Promise<
    CalendarRoomCapabilities | undefined
  > {
    if (this.options.getRoomCalendarCapabilities) {
      return validateRoomCapabilities(
        await this.options.getRoomCalendarCapabilities(),
      );
    }

    const context = await this.requestJson<CalendarGatewayContextResource>(
      this.url('/v1/calendar/context', { roomId: this.options.roomId }),
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

  async listRoomReminderAlarmOptions(
    calendarId: CalendarId,
    eventId: CalendarEventId,
  ): Promise<CalendarRoomReminderAlarmOption[]> {
    const reference = this.roomEventReference(calendarId, eventId);
    const response = await this.requestJson<unknown>(
      this.url(
        `/v1/calendar/rooms/${encodePathSegment(this.options.roomId)}/reminders/options`,
        { eventId: reference.eventId },
      ),
      { cache: 'no-store' },
    );
    return parseRoomReminderOptions(response);
  }

  async listRoomReminderConfigurations(): Promise<
    CalendarRoomReminderIdentity[]
  > {
    const configurations: CalendarRoomReminderIdentity[] = [];
    let cursor: string | undefined;
    const maxPages = 20;
    for (let page = 0; page < maxPages; page += 1) {
      const response = await this.requestJson<unknown>(
        this.url(
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
  ): Promise<CalendarRoomReminderIdentity> {
    const reference = this.roomEventReference(calendarId, eventId);
    const response = await this.requestJson<unknown>(
      this.url(
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
        }),
      },
    );
    return parseRoomReminderIdentity(response);
  }

  async disableRoomReminder(
    identity: CalendarRoomReminderIdentity,
  ): Promise<void> {
    const response = await this.requestJson<unknown>(
      this.url(
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
    return this.requestJson<CalendarDiagnostics>(
      this.url('/v1/calendar/calendars/diagnostics', {
        roomId: this.options.roomId,
        target: 'personal',
      }),
    );
  }

  async createCalendar(name: string): Promise<Calendar> {
    return this.rememberCalendar(
      'personal',
      await this.requestJson<Calendar>(
        this.url('/v1/calendar/calendars', {
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
    await this.requestVoid(
      this.url('/v1/calendar/calendars', {
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
    await this.requestVoid(
      this.url('/v1/calendar/calendars/description', {
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
    await this.requestVoid(
      this.url('/v1/calendar/calendars/color', {
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
      await this.requestVoid(
        this.url('/v1/calendar/calendars', {
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
        return this.requestJson<CalendarGatewayEventListResource>(
          this.url('/v1/calendar/events', {
            roomId: this.options.roomId,
            target: reference.target,
            calendarId: reference.calendarId,
            start: range.start,
            end: range.end,
            timezone: viewerTimezone,
          }),
        ).then((result) => ({ publicCalendarId, reference, result }));
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
      await this.requestJson<CalendarGatewayEventResource>(
        this.url('/v1/calendar/event', {
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
      await this.requestJson<CalendarGatewayEventResource>(
        this.url('/v1/calendar/events', {
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
        await this.requestJson<CalendarGatewayEventResource>(
          this.url('/v1/calendar/events', {
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
      await this.requestVoid(
        this.url('/v1/calendar/events', {
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

  private async requestJson<T>(
    url: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await this.request(url, init);

    try {
      return (await response.json()) as T;
    } catch {
      throw new CalendarRepositoryError(
        'request-failed',
        'Calendar gateway returned invalid JSON',
      );
    }
  }

  private async requestVoid(
    url: string,
    init: RequestInit = {},
  ): Promise<void> {
    await this.request(url, init);
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const authorization = await this.options.getAuthorizationHeader();
    const headers = new Headers(init.headers);

    if (authorization) {
      headers.set('Authorization', authorization);
    }
    if (init.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers,
      });
    } catch (error) {
      throw new CalendarRepositoryError(
        'request-failed',
        error instanceof Error
          ? `Calendar gateway request failed: ${error.message}`
          : 'Calendar gateway request failed',
      );
    }

    if (response.ok) {
      return response;
    }

    if (response.status === 401) {
      throw new CalendarRepositoryError(
        'authentication-required',
        'Calendar gateway authentication is required',
      );
    }

    if (response.status === 409) {
      throw new CalendarRepositoryError(
        'event-conflict',
        'The event changed on the server',
      );
    }

    if (response.status === 400) {
      try {
        const body: unknown = await response.clone().json();
        if (
          body &&
          typeof body === 'object' &&
          'code' in body &&
          body.code === 'unsupported-patch' &&
          'message' in body &&
          typeof body.message === 'string'
        ) {
          throw new CalendarRepositoryError(
            'unsupported-patch',
            body.message.slice(0, 500),
          );
        }
      } catch (error) {
        if (
          error instanceof CalendarRepositoryError &&
          error.code === 'unsupported-patch'
        ) {
          throw error;
        }
      }
    }

    throw new CalendarRepositoryError(
      'request-failed',
      `Calendar gateway request failed with status ${response.status}`,
    );
  }

  private url(path: string, params: Record<string, string>): string {
    const search = new URLSearchParams(params);
    return `${this.options.baseUrl.replace(/\/$/, '')}${path}?${search}`;
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
      !('relatedTo' in candidate) ||
      !(candidate.relatedTo === 'start' || candidate.relatedTo === 'end') ||
      !('trigger' in candidate)
    ) {
      throw invalidRoomReminderResponse();
    }

    const trigger = parseReminderDuration(candidate.trigger);
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

    return {
      eventUid: candidate.eventUid,
      recurrenceId: candidate.recurrenceId as string | null,
      alarmUid: candidate.alarmUid,
      relatedTo: candidate.relatedTo,
      trigger,
      ...(repeat ? { repeat } : {}),
    };
  });
}

function parseRoomReminderConfigurationPage(value: unknown): {
  items: CalendarRoomReminderIdentity[];
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
  const items = value.items.map(parseRoomReminderIdentity);
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

function parseReminderDuration(
  value: unknown,
): CalendarRoomReminderAlarmOption['trigger'] {
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
