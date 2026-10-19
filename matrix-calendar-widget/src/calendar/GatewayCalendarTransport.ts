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

import { CalendarRepositoryError } from '@matrix-calendar-widget/calendar';

export type GatewayCalendarTransportOptions = {
  baseUrl: string;
  getAuthorizationHeader: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
};

/** Owns gateway URL, authentication-header, and HTTP error handling. */
export class GatewayCalendarTransport {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GatewayCalendarTransportOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  url(path: string, params: Record<string, string>): string {
    const search = new URLSearchParams(params);
    return `${this.options.baseUrl.replace(/\/$/, '')}${path}?${search}`;
  }

  async requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
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

  async requestVoid(url: string, init: RequestInit = {}): Promise<void> {
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
}
