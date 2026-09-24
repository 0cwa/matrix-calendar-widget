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
  CalendarEventId,
  CalendarEventInput,
  CalendarEventPatch,
  CalendarId,
  CalendarRepository,
  CalendarRepositoryError,
  CalendarTimeRange,
} from '@matrix-calendar-widget/calendar';

type CalendarGatewayEventResource = {
  event: CalendarEvent;
  etag: string;
};

export type GatewayCalendarRepositoryOptions = {
  baseUrl: string;
  roomId: string;
  getAuthorizationHeader: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
};

export class GatewayCalendarRepository implements CalendarRepository {
  private readonly etags = new Map<CalendarEventId, string>();
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GatewayCalendarRepositoryOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listCalendars(): Promise<Calendar[]> {
    return this.requestJson<Calendar[]>(
      this.url('/v1/calendar/calendars', {
        roomId: this.options.roomId,
      }),
    );
  }

  async listEvents(
    calendarIds: CalendarId[],
    range: CalendarTimeRange,
  ): Promise<CalendarEvent[]> {
    const resources = await Promise.all(
      calendarIds.map((calendarId) =>
        this.requestJson<CalendarGatewayEventResource[]>(
          this.url('/v1/calendar/events', {
            roomId: this.options.roomId,
            calendarId,
            start: range.start,
            end: range.end,
          }),
        ),
      ),
    );

    return resources.flat().map((resource) => this.remember(resource));
  }

  async getEvent(
    calendarId: CalendarId,
    eventId: CalendarEventId,
  ): Promise<CalendarEvent> {
    return this.remember(
      await this.requestJson<CalendarGatewayEventResource>(
        this.url('/v1/calendar/event', {
          roomId: this.options.roomId,
          calendarId,
          eventId,
        }),
      ),
    );
  }

  async createEvent(
    calendarId: CalendarId,
    input: CalendarEventInput,
  ): Promise<CalendarEvent> {
    return this.remember(
      await this.requestJson<CalendarGatewayEventResource>(
        this.url('/v1/calendar/events', {
          roomId: this.options.roomId,
          calendarId,
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
    const etag = await this.etagFor(calendarId, eventId);

    try {
      return this.remember(
        await this.requestJson<CalendarGatewayEventResource>(
          this.url('/v1/calendar/events', {
            roomId: this.options.roomId,
            calendarId,
            eventId,
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
        this.etags.delete(eventId);
      }
      throw error;
    }
  }

  async deleteEvent(
    calendarId: CalendarId,
    eventId: CalendarEventId,
  ): Promise<void> {
    const etag = await this.etagFor(calendarId, eventId);

    try {
      await this.requestVoid(
        this.url('/v1/calendar/events', {
          roomId: this.options.roomId,
          calendarId,
          eventId,
        }),
        {
          method: 'DELETE',
          headers: { 'If-Match': etag },
        },
      );
      this.etags.delete(eventId);
    } catch (error) {
      if (
        error instanceof CalendarRepositoryError &&
        error.code === 'event-conflict'
      ) {
        this.etags.delete(eventId);
      }
      throw error;
    }
  }

  private async etagFor(
    calendarId: CalendarId,
    eventId: CalendarEventId,
  ): Promise<string> {
    const cached = this.etags.get(eventId);
    if (cached) {
      return cached;
    }

    await this.getEvent(calendarId, eventId);
    const fetched = this.etags.get(eventId);
    if (!fetched) {
      throw new CalendarRepositoryError(
        'request-failed',
        'Calendar gateway event response did not include an ETag',
      );
    }

    return fetched;
  }

  private remember(resource: CalendarGatewayEventResource): CalendarEvent {
    if (!resource?.event || typeof resource.etag !== 'string') {
      throw new CalendarRepositoryError(
        'request-failed',
        'Calendar gateway returned an invalid event resource',
      );
    }

    this.etags.set(resource.event.id, resource.etag);
    return resource.event;
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
