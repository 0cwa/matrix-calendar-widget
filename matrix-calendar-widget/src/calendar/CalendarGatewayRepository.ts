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
import { extractRawWidgetParameters, WidgetApi } from '@matrix-widget-toolkit/api';
import { getEnvironment } from '@matrix-widget-toolkit/mui';

type CalendarGatewayEventResponse = {
  event: CalendarEvent;
  etag: string;
};

export type CalendarGatewayRepositoryOptions = {
  widgetApiPromise: Promise<WidgetApi>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export class CalendarGatewayRepository implements CalendarRepository {
  private readonly etags = new Map<string, string>();
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string | undefined;

  constructor(private readonly options: CalendarGatewayRepositoryOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? defaultGatewayBaseUrl();
  }

  async listCalendars(): Promise<Calendar[]> {
    const roomId = await this.roomId();
    const response = await this.request<unknown[]>('/v1/calendar/calendars', {
      params: { roomId },
    });

    return response.map(asCalendar);
  }

  async listEvents(
    calendarIds: CalendarId[],
    range: CalendarTimeRange,
  ): Promise<CalendarEvent[]> {
    if (calendarIds.length === 0) {
      return [];
    }

    const roomId = await this.roomId();
    const responses = await Promise.all(
      calendarIds.map((calendarId) =>
        this.request<unknown[]>('/v1/calendar/events', {
          params: {
            roomId,
            calendarId,
            start: range.start,
            end: range.end,
          },
        }),
      ),
    );

    return responses.flatMap((items) =>
      items.map((item) => {
        const envelope = asEventResponse(item);
        this.rememberEtag(envelope);
        return envelope.event;
      }),
    );
  }

  async getEvent(
    calendarId: CalendarId,
    eventId: CalendarEventId,
  ): Promise<CalendarEvent> {
    const roomId = await this.roomId();
    const envelope = asEventResponse(
      await this.request('/v1/calendar/event', {
        params: { roomId, calendarId, eventId },
      }),
    );

    this.rememberEtag(envelope);
    return envelope.event;
  }

  async createEvent(
    calendarId: CalendarId,
    input: CalendarEventInput,
  ): Promise<CalendarEvent> {
    const roomId = await this.roomId();
    const envelope = asEventResponse(
      await this.request('/v1/calendar/events', {
        method: 'POST',
        params: { roomId, calendarId },
        body: input,
      }),
    );

    this.rememberEtag(envelope);
    return envelope.event;
  }

  async updateEvent(
    calendarId: CalendarId,
    eventId: CalendarEventId,
    patch: CalendarEventPatch,
  ): Promise<CalendarEvent> {
    const roomId = await this.roomId();
    const etag = await this.etagFor(calendarId, eventId);

    try {
      const envelope = asEventResponse(
        await this.request('/v1/calendar/events', {
          method: 'PATCH',
          params: { roomId, calendarId, eventId },
          headers: { 'If-Match': etag },
          body: patch,
        }),
      );

      this.rememberEtag(envelope);
      return envelope.event;
    } catch (error) {
      if (
        error instanceof CalendarRepositoryError &&
        error.code === 'etag-conflict'
      ) {
        this.etags.delete(eventKey(calendarId, eventId));
      }
      throw error;
    }
  }

  async deleteEvent(
    calendarId: CalendarId,
    eventId: CalendarEventId,
  ): Promise<void> {
    const roomId = await this.roomId();
    const etag = await this.etagFor(calendarId, eventId);

    try {
      await this.request('/v1/calendar/events', {
        method: 'DELETE',
        params: { roomId, calendarId, eventId },
        headers: { 'If-Match': etag },
      });
      this.etags.delete(eventKey(calendarId, eventId));
    } catch (error) {
      if (
        error instanceof CalendarRepositoryError &&
        error.code === 'etag-conflict'
      ) {
        this.etags.delete(eventKey(calendarId, eventId));
      }
      throw error;
    }
  }

  private async etagFor(
    calendarId: CalendarId,
    eventId: CalendarEventId,
  ): Promise<string> {
    const key = eventKey(calendarId, eventId);
    const cached = this.etags.get(key);
    if (cached) {
      return cached;
    }

    await this.getEvent(calendarId, eventId);
    const refreshed = this.etags.get(key);
    if (!refreshed) {
      throw new CalendarRepositoryError(
        'gateway-request-failed',
        'Calendar gateway did not return an ETag for the event',
      );
    }

    return refreshed;
  }

  private rememberEtag(response: CalendarGatewayEventResponse): void {
    this.etags.set(
      eventKey(response.event.calendarId, response.event.id),
      response.etag,
    );
  }

  private async roomId(): Promise<string> {
    const widgetApi = await this.options.widgetApiPromise;
    const roomId = widgetApi.widgetParameters.roomId;

    if (!roomId) {
      throw new CalendarRepositoryError(
        'gateway-request-failed',
        'Matrix room context is required for calendar access',
      );
    }

    return roomId;
  }

  private async request<T = unknown>(
    path: string,
    options: {
      method?: 'DELETE' | 'GET' | 'PATCH' | 'POST';
      params?: Record<string, string>;
      headers?: Record<string, string>;
      body?: unknown;
    } = {},
  ): Promise<T> {
    const widgetApi = await this.options.widgetApiPromise;
    const credentials = await widgetApi.requestOpenIDConnectToken();

    if (!credentials) {
      throw new CalendarRepositoryError(
        'gateway-auth-failed',
        'Matrix OpenID credentials are required for calendar access',
      );
    }

    const url = gatewayUrl(this.baseUrl, path, options.params);
    const headers = new Headers(options.headers);
    headers.set(
      'Authorization',
      `MX-Identity ${btoa(
        JSON.stringify({
          matrix_server_name: credentials.matrix_server_name,
          access_token: credentials.access_token,
        }),
      )}`,
    );

    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method ?? 'GET',
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      throw new CalendarRepositoryError(
        'gateway-request-failed',
        error instanceof Error ? error.message : 'Calendar gateway request failed',
      );
    }

    if (!response.ok) {
      const problem = await responseProblem(response);
      if (
        response.status === 409 &&
        problem?.code === 'etag-conflict'
      ) {
        throw new CalendarRepositoryError(
          'etag-conflict',
          problem.message ?? 'The event changed on the server',
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new CalendarRepositoryError(
          'gateway-auth-failed',
          problem?.message ?? 'Calendar gateway authorization failed',
        );
      }

      if (response.status === 404) {
        throw new CalendarRepositoryError(
          'event-not-found',
          problem?.message ?? 'Calendar resource was not found',
        );
      }

      throw new CalendarRepositoryError(
        'gateway-request-failed',
        problem?.message ??
          `Calendar gateway request failed with status ${response.status}`,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}

function defaultGatewayBaseUrl(): string | undefined {
  const raw =
    extractRawWidgetParameters()['meetings_bot_base_url'] ??
    getEnvironment('REACT_APP_API_BASE_URL');

  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function gatewayUrl(
  baseUrl: string | undefined,
  path: string,
  params: Record<string, string> | undefined,
): string {
  const query = new URLSearchParams(params);
  const relative = `${path}${query.size > 0 ? `?${query.toString()}` : ''}`;

  if (!baseUrl) {
    return relative;
  }

  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(relative.replace(/^\//, ''), base).toString();
}

function eventKey(calendarId: CalendarId, eventId: CalendarEventId): string {
  return `${calendarId}\n${eventId}`;
}

function asCalendar(value: unknown): Calendar {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    throw new CalendarRepositoryError(
      'gateway-request-failed',
      'Calendar gateway returned an invalid calendar',
    );
  }

  return {
    id: value.id,
    name: value.name,
    color: typeof value.color === 'string' ? value.color : undefined,
    timezone: typeof value.timezone === 'string' ? value.timezone : undefined,
    readOnly: typeof value.readOnly === 'boolean' ? value.readOnly : undefined,
  };
}

function asEventResponse(value: unknown): CalendarGatewayEventResponse {
  if (
    !isRecord(value) ||
    !isRecord(value.event) ||
    typeof value.etag !== 'string' ||
    typeof value.event.id !== 'string' ||
    typeof value.event.calendarId !== 'string' ||
    typeof value.event.uid !== 'string' ||
    typeof value.event.title !== 'string'
  ) {
    throw new CalendarRepositoryError(
      'gateway-request-failed',
      'Calendar gateway returned an invalid event response',
    );
  }

  return value as CalendarGatewayEventResponse;
}

async function responseProblem(
  response: Response,
): Promise<{ code?: string; message?: string } | undefined> {
  try {
    const value = (await response.json()) as unknown;
    if (!isRecord(value)) {
      return undefined;
    }

    const nested = isRecord(value.message) ? value.message : value;
    return {
      code: typeof nested.code === 'string' ? nested.code : undefined,
      message:
        typeof nested.message === 'string'
          ? nested.message
          : typeof value.message === 'string'
            ? value.message
            : undefined,
    };
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
