/*
 * Copyright 2022 Nordeck IT + Consulting GmbH
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

import { MockedWidgetApi, mockWidgetApi } from '@matrix-widget-toolkit/testing';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createStore } from '../../store';
import { meetingBotApi } from './meetingBotApi';

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let widgetApi: MockedWidgetApi;
afterEach(() => widgetApi.stop());
beforeEach(() => (widgetApi = mockWidgetApi()));

describe('meetingBotApi', () => {
  const expectedAuthHeader =
    'MX-Identity eyJtYXRyaXhfc2VydmVyX25hbWUiOiJtYXRyaXhfc2VydmVyX25hbWUiLCJhY2Nlc3NfdG9rZW4iOiJhY2Nlc3NfdG9rZW4ifQ==';

  beforeEach(() => {
    widgetApi.requestOpenIDConnectToken.mockResolvedValue({
      access_token: 'access_token',
      matrix_server_name: 'matrix_server_name',
    });
  });

  describe('getCalendarGatewayContext', () => {
    const { initiate } = meetingBotApi.endpoints.getCalendarGatewayContext;

    it('returns the server-validated Matrix identity', async () => {
      server.use(
        http.get('http://localhost/v1/calendar/context', ({ request }) => {
          if (request.headers.get('Authorization') !== expectedAuthHeader) {
            return new HttpResponse(null, { status: 401 });
          }

          return HttpResponse.json({ userId: '@alice:example.test' });
        }),
      );

      const store = createStore({ widgetApi });

      await expect(store.dispatch(initiate()).unwrap()).resolves.toEqual({
        userId: '@alice:example.test',
      });
    });

    it('passes a room id for server-side membership checks', async () => {
      server.use(
        http.get('http://localhost/v1/calendar/context', ({ request }) => {
          if (request.headers.get('Authorization') !== expectedAuthHeader) {
            return new HttpResponse(null, { status: 401 });
          }

          if (
            new URL(request.url).searchParams.get('roomId') !==
            '!team:example.test'
          ) {
            return new HttpResponse(null, { status: 400 });
          }

          return HttpResponse.json({
            userId: '@alice:example.test',
            roomId: '!team:example.test',
          });
        }),
      );

      const store = createStore({ widgetApi });

      await expect(
        store.dispatch(initiate({ roomId: '!team:example.test' })).unwrap(),
      ).resolves.toEqual({
        userId: '@alice:example.test',
        roomId: '!team:example.test',
      });
    });

    it('rejects malformed gateway responses', async () => {
      server.use(
        http.get('http://localhost/v1/calendar/context', () =>
          HttpResponse.json({ userId: 7 }),
        ),
      );

      const store = createStore({ widgetApi });

      await expect(store.dispatch(initiate()).unwrap()).rejects.toMatchObject({
        status: 'PARSING_ERROR',
      });
    });

    it('rejects when Matrix OpenID is unavailable', async () => {
      widgetApi.requestOpenIDConnectToken.mockRejectedValue(
        new Error('No token received'),
      );

      const store = createStore({ widgetApi });

      await expect(store.dispatch(initiate()).unwrap()).rejects.toEqual({
        error: expect.stringMatching('No token received'),
        status: 'CUSTOM_ERROR',
      });
    });
  });

  describe('getConfiguration', () => {
    const { initiate } = meetingBotApi.endpoints.getConfiguration;

    it('should handle empty', async () => {
      server.use(
        http.get('http://localhost/v1/config', ({ request }) => {
          if (request.headers.get('Authorization') !== expectedAuthHeader) {
            return new HttpResponse(null, { status: 401 });
          }

          return HttpResponse.json({});
        }),
      );

      const store = createStore({ widgetApi });

      expect(await store.dispatch(initiate()).unwrap()).toEqual({
        jitsi: { dialInEnabled: false },
      });
    });

    it('should handle value', async () => {
      server.use(
        http.get('http://localhost/v1/config', ({ request }) => {
          if (request.headers.get('Authorization') !== expectedAuthHeader) {
            return new HttpResponse(null, { status: 401 });
          }

          return HttpResponse.json({ jitsiDialInEnabled: true });
        }),
      );

      const store = createStore({ widgetApi });

      expect(await store.dispatch(initiate()).unwrap()).toEqual({
        jitsi: { dialInEnabled: true },
      });
    });

    it('should handle OX value', async () => {
      server.use(
        http.get('http://localhost/v1/config', ({ request }) => {
          if (request.headers.get('Authorization') !== expectedAuthHeader) {
            return new HttpResponse(null, { status: 401 });
          }

          return HttpResponse.json({
            jitsiDialInEnabled: true,
            openXchangeMeetingUrlTemplate: '--TEMPLATE--',
          });
        }),
      );

      const store = createStore({ widgetApi });

      expect(await store.dispatch(initiate()).unwrap()).toEqual({
        jitsi: { dialInEnabled: true },
        openXChange: {
          meetingUrlTemplate: '--TEMPLATE--',
        },
      });
    });

    it('should reject invalid values', async () => {
      server.use(
        http.get('http://localhost/v1/config', () => {
          return HttpResponse.json({ jitsiDialInEnabled: 'true' });
        }),
      );

      const store = createStore({ widgetApi });

      await expect(store.dispatch(initiate()).unwrap()).rejects.toMatchObject({
        error: expect.stringMatching(/must be a/),
      });
    });

    it('should reject if token was rejected', async () => {
      widgetApi.requestOpenIDConnectToken.mockRejectedValue(
        new Error('No token received'),
      );

      const store = createStore({ widgetApi });

      await expect(store.dispatch(initiate()).unwrap()).rejects.toEqual({
        error: expect.stringMatching('No token received'),
        status: 'CUSTOM_ERROR',
      });
    });

    it('should reject server error', async () => {
      server.use(
        http.get('http://localhost/v1/config', () => {
          return HttpResponse.json('an error occurred', { status: 500 });
        }),
      );

      const store = createStore({ widgetApi });

      await expect(store.dispatch(initiate()).unwrap()).rejects.toMatchObject({
        status: 500,
        data: 'an error occurred',
      });
    });
  });

  describe('getAvailableWidgets', () => {
    const { initiate } = meetingBotApi.endpoints.getAvailableWidgets;

    it('should handle empty list', async () => {
      server.use(
        http.get('http://localhost/v1/widget/list', ({ request }) => {
          if (request.headers.get('Authorization') !== expectedAuthHeader) {
            return new HttpResponse(null, { status: 401 });
          }

          return HttpResponse.json([]);
        }),
      );

      const store = createStore({ widgetApi });

      expect(await store.dispatch(initiate()).unwrap()).toEqual([]);
    });

    it('should handle list', async () => {
      server.use(
        http.get('http://localhost/v1/widget/list', ({ request }) => {
          if (request.headers.get('Authorization') !== expectedAuthHeader) {
            return new HttpResponse(null, { status: 401 });
          }

          return HttpResponse.json([
            {
              id: 'widget-1',
              name: 'Widget 1',
            },
            {
              id: 'widget-2',
              name: 'Widget 2',
              optional: true,
            },
          ]);
        }),
      );

      const store = createStore({ widgetApi });

      expect(await store.dispatch(initiate()).unwrap()).toEqual([
        {
          id: 'widget-1',
          name: 'Widget 1',
        },
        {
          id: 'widget-2',
          name: 'Widget 2',
          optional: true,
        },
      ]);
    });

    it('should reject invalid values', async () => {
      server.use(
        http.get('http://localhost/v1/widget/list', () => {
          return HttpResponse.json([
            {
              id: 'widget-1',
              name: 815,
            },
          ]);
        }),
      );

      const store = createStore({ widgetApi });

      await expect(store.dispatch(initiate()).unwrap()).rejects.toMatchObject({
        error: expect.stringMatching(/must be a/),
      });
    });

    it('should reject if token was rejected', async () => {
      server.use(
        http.get('http://localhost/v1/widget/list', () => {
          return HttpResponse.json([]);
        }),
      );

      widgetApi.requestOpenIDConnectToken.mockRejectedValue(
        new Error('No token received'),
      );

      const store = createStore({ widgetApi });

      await expect(store.dispatch(initiate()).unwrap()).rejects.toEqual({
        error: expect.stringMatching('No token received'),
        status: 'CUSTOM_ERROR',
      });
    });

    it('should reject server error', async () => {
      server.use(
        http.get('http://localhost/v1/widget/list', () => {
          return HttpResponse.json('an error occurred', { status: 500 });
        }),
      );

      const store = createStore({ widgetApi });

      await expect(store.dispatch(initiate()).unwrap()).rejects.toMatchObject({
        status: 500,
        data: 'an error occurred',
      });
    });
  });

  describe('getMeetingSharingInformation', () => {
    const { initiate } = meetingBotApi.endpoints.getMeetingSharingInformation;

    it('should handle empty', async () => {
      server.use(
        http.get(
          'http://localhost/v1/meeting/!roomId/sharingInformation',
          ({ request }) => {
            if (request.headers.get('Authorization') !== expectedAuthHeader) {
              return new HttpResponse(null, { status: 401 });
            }

            return HttpResponse.json({});
          },
        ),
      );

      const store = createStore({ widgetApi });

      expect(
        await store.dispatch(initiate({ roomId: '!roomId' })).unwrap(),
      ).toEqual({
        jitsi: {},
      });
    });

    it('should handle values', async () => {
      server.use(
        http.get(
          'http://localhost/v1/meeting/!roomId/sharingInformation',
          ({ request }) => {
            if (request.headers.get('Authorization') !== expectedAuthHeader) {
              return new HttpResponse(null, { status: 401 });
            }

            return HttpResponse.json({
              jitsi_dial_in_number: '0123',
              jitsi_pin: 1111,
            });
          },
        ),
      );

      const store = createStore({ widgetApi });

      expect(
        await store.dispatch(initiate({ roomId: '!roomId' })).unwrap(),
      ).toEqual({
        jitsi: {
          dialInNumber: '0123',
          pin: 1111,
        },
      });
    });

    it('should reject invalid values', async () => {
      server.use(
        http.get(
          'http://localhost/v1/meeting/!roomId/sharingInformation',
          () => {
            return HttpResponse.json({
              jitsi_dial_in_number: 123,
              jitsi_pin: '1111',
            });
          },
        ),
      );

      const store = createStore({ widgetApi });

      await expect(
        store.dispatch(initiate({ roomId: '!roomId' })).unwrap(),
      ).rejects.toMatchObject({
        error: expect.stringMatching(/must be a/),
      });
    });

    it('should reject if token was rejected', async () => {
      server.use(
        http.get('http://localhost/v1/meeting/!roomId/sharingInformation', () =>
          HttpResponse.json({}),
        ),
      );

      widgetApi.requestOpenIDConnectToken.mockRejectedValue(
        new Error('No token received'),
      );

      const store = createStore({ widgetApi });

      await expect(
        store.dispatch(initiate({ roomId: '!roomId' })).unwrap(),
      ).rejects.toEqual({
        error: expect.stringMatching('No token received'),
        status: 'CUSTOM_ERROR',
      });
    });

    it('should reject server error', async () => {
      server.use(
        http.get('http://localhost/v1/meeting/!roomId/sharingInformation', () =>
          HttpResponse.json('an error occurred', { status: 500 }),
        ),
      );

      const store = createStore({ widgetApi });

      await expect(
        store.dispatch(initiate({ roomId: '!roomId' })).unwrap(),
      ).rejects.toMatchObject({
        status: 500,
        data: 'an error occurred',
      });
    });
  });
});
