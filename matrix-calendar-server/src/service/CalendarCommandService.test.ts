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
} from '@matrix-calendar-widget/calendar';
import { createAppConfig } from '../../test/util/MockUtils';
import { IMatrixOpenIdCredential } from '../model/IMatrixOpenIdCredential';
import {
  CalendarCommandErrorKey,
  CalendarCommandEventAccess,
  CalendarCommandEventOperationsPort,
  CalendarCommandService,
  CalendarCommandTranslation,
} from './CalendarCommandService';
import { RoomCalendarTarget } from './RoomCalendarCalDavAccess';

const ROOM_ID = '!room:example.org';
const SENDER_ID = '@alice:example.org';
const CALENDAR_ID = 'team-calendar';
const COLLECTION_URL = 'https://calendar.example.com/bot/team-calendar/';
const EVENT_HREF = `${COLLECTION_URL}event.ics`;
const ETAG = '"revision-1"';

const servicePrincipal = {
  userId: '@calendar-bot:example.org',
  calendarUrl: COLLECTION_URL,
  credential: {
    accessToken: 'private-openid-credential',
    matrixServerName: 'example.org',
  } satisfies IMatrixOpenIdCredential,
};

function makeEvent(
  id = EVENT_HREF,
  title = 'Planning',
  start = '2026-10-05T10:00:00',
  end = '2026-10-05T11:00:00',
  description?: string,
): CalendarEvent {
  return {
    id,
    calendarId: CALENDAR_ID,
    uid: 'private-event-uid@example.org',
    title,
    description,
    timing: {
      type: 'timed',
      start: { type: 'zoned', local: start, timezone: 'UTC' },
      end: { type: 'zoned', local: end, timezone: 'UTC' },
    },
  };
}

function safeTranslator(
  errors: Partial<Record<CalendarCommandErrorKey, string>> = {},
): CalendarCommandTranslation {
  return (key, parameters) => {
    if (key.startsWith('calendarCommandErrors.')) {
      const errorKey = key.slice(
        'calendarCommandErrors.'.length,
      ) as CalendarCommandErrorKey;
      return errors[errorKey] ?? key;
    }
    if (key === 'calendarCommandReplies.eventCreated') {
      return `Created event ${String(parameters?.resourceId)}.`;
    }
    if (key === 'calendarCommandReplies.eventDeleted') {
      return `Deleted event ${String(parameters?.resourceId)}.`;
    }
    const labels: Record<string, string> = {
      'calendarCommandReplies.upcoming': 'Upcoming events:',
      'calendarCommandReplies.noUpcoming': 'No upcoming events.',
      'calendarCommandReplies.upcomingPartial':
        'Some events could not be shown. Review the calendar widget for complete results.',
      'calendarCommandReplies.eventDetails': 'Calendar event:',
      'calendarCommandReplies.idLabel': 'Resource ID',
      'calendarCommandReplies.titleLabel': 'Title',
      'calendarCommandReplies.whenLabel': 'When',
      'calendarCommandReplies.descriptionLabel': 'Description',
      'calendarCommandReplies.untitled': '(untitled)',
      'calendarCommandReplies.timeUnavailable': 'Time unavailable',
    };
    return labels[key] ?? key;
  };
}

function singleEventResource(): string {
  return `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:private-event-uid@example.org
DTSTAMP:20261003T120000Z
DTSTART:20261005T100000Z
DTEND:20261005T110000Z
SUMMARY:Planning
END:VEVENT
END:VCALENDAR`;
}

describe('CalendarCommandService', () => {
  let isAllowed: jest.Mock<Promise<boolean>, [CalendarAuthorizationRequest]>;
  let authorization: CalendarAuthorization;
  let authorizationFactory: {
    forRoom: jest.Mock<CalendarAuthorization, [string, string]>;
  };
  let forAuthorizedTarget: jest.Mock<
    Promise<typeof servicePrincipal>,
    [RoomCalendarTarget, 'read' | 'write']
  >;
  let access: CalendarCommandEventAccess;
  let operations: jest.Mocked<CalendarCommandEventOperationsPort>;
  let order: string[];
  let service: CalendarCommandService;

  const baseConfig = {
    ...createAppConfig(),
    room_calendar_access_enabled: true,
    room_calendar_event_writes_enabled: true,
    room_calendar_bindings: [{ roomId: ROOM_ID, calendarId: CALENDAR_ID }],
  };

  const createService = (
    config: typeof baseConfig = baseConfig,
  ): CalendarCommandService =>
    new CalendarCommandService(
      config,
      authorizationFactory,
      { forAuthorizedTarget },
      operations,
    );

  beforeEach(() => {
    order = [];
    isAllowed = jest.fn().mockResolvedValue(true);
    authorization = { isAllowed };
    authorizationFactory = {
      forRoom: jest.fn((sender, roomId) => {
        expect(sender).toBe(SENDER_ID);
        expect(roomId).toBe(ROOM_ID);
        return authorization;
      }),
    };
    forAuthorizedTarget = jest.fn(async (target, mode) => {
      order.push(`proof:${mode}`);
      expect(target).toEqual({
        roomId: ROOM_ID,
        calendarId: CALENDAR_ID,
        principal: { kind: 'service' },
      });
      return servicePrincipal;
    });
    access = {
      target: {
        roomId: ROOM_ID,
        calendarId: CALENDAR_ID,
        principal: { kind: 'service' },
      },
      servicePrincipal,
    };
    operations = {
      getEvent: jest.fn().mockResolvedValue({ event: makeEvent(), etag: ETAG }),
      getEventResource: jest.fn().mockResolvedValue({
        event: makeEvent(),
        etag: ETAG,
        icalendar: singleEventResource(),
      }),
      listEvents: jest.fn().mockResolvedValue([]),
      createEvent: jest
        .fn()
        .mockImplementation(
          async (
            _access: CalendarCommandEventAccess,
            input: CalendarEventInput,
          ) => {
            order.push('caldav:create');
            return {
              event: makeEvent(
                `${COLLECTION_URL}${encodeURIComponent(input.uid)}.ics`,
                input.title,
              ),
              etag: ETAG,
            };
          },
        ),
      deleteEvent: jest.fn().mockImplementation(async () => {
        order.push('caldav:delete');
      }),
    };
    service = createService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('denies a nonmember before appservice proof or CalDAV access', async () => {
    isAllowed.mockResolvedValue(false);

    const result = await service.execute(
      ROOM_ID,
      SENDER_ID,
      'upcoming',
      safeTranslator(),
    );

    expect(result).toBe('calendarCommandErrors.notAllowed');
    expect(authorizationFactory.forRoom).toHaveBeenCalledWith(
      SENDER_ID,
      ROOM_ID,
    );
    expect(forAuthorizedTarget).not.toHaveBeenCalled();
    expect(operations.listEvents).not.toHaveBeenCalled();
    expect(operations.getEvent).not.toHaveBeenCalled();
  });

  test('keeps room reads disabled before membership, proof, and CalDAV work', async () => {
    service = createService({
      ...baseConfig,
      room_calendar_access_enabled: false,
    });

    const result = await service.execute(
      ROOM_ID,
      SENDER_ID,
      'upcoming',
      safeTranslator(),
    );

    expect(result).toBe('calendarCommandErrors.disabled');
    expect(authorizationFactory.forRoom).not.toHaveBeenCalled();
    expect(forAuthorizedTarget).not.toHaveBeenCalled();
    expect(operations.listEvents).not.toHaveBeenCalled();
  });

  test('rejects a DST gap as fixed syntax guidance before any authorization or I/O', async () => {
    const result = await service.execute(
      ROOM_ID,
      SENDER_ID,
      'create 2026-03-08T02:30 2026-03-08T03:30 "Planning" --tz America/New_York',
      safeTranslator({ badSyntax: 'Use !calendar help.' }),
    );

    expect(result).toBe('Use !calendar help.');
    expect(authorizationFactory.forRoom).not.toHaveBeenCalled();
    expect(forAuthorizedTarget).not.toHaveBeenCalled();
    expect(operations.createEvent).not.toHaveBeenCalled();
  });

  test('requires both the global read gate and independent write gate before create', async () => {
    service = createService({
      ...baseConfig,
      room_calendar_event_writes_enabled: false,
    });

    const result = await service.execute(
      ROOM_ID,
      SENDER_ID,
      'create 2026-10-05T10:00 2026-10-05T11:00 "Planning"',
      safeTranslator(),
    );

    expect(result).toBe('calendarCommandErrors.writesDisabled');
    expect(authorizationFactory.forRoom).not.toHaveBeenCalled();
    expect(forAuthorizedTarget).not.toHaveBeenCalled();
    expect(operations.createEvent).not.toHaveBeenCalled();
  });

  test('resolves the binding and authorizes before requesting appservice proof for reads', async () => {
    const result = await service.execute(
      ROOM_ID,
      SENDER_ID,
      'upcoming',
      safeTranslator(),
    );

    expect(result).toBe('No upcoming events.');
    expect(isAllowed).toHaveBeenCalledWith({
      action: 'read-events',
      calendarId: CALENDAR_ID,
    });
    expect(forAuthorizedTarget).toHaveBeenCalledWith(access.target, 'read');
    expect(operations.listEvents).toHaveBeenCalledWith(
      access,
      expect.objectContaining({
        start: expect.any(String),
        end: expect.any(String),
      }),
    );
  });

  test('sorts upcoming occurrences, applies the requested count, and bounds the range to 30 days', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-04T12:00:00.000Z'));
    operations.listEvents.mockResolvedValue([
      {
        event: makeEvent(
          `${COLLECTION_URL}later.ics`,
          'Later',
          '2026-10-05T14:00:00',
          '2026-10-05T15:00:00',
        ),
        etag: ETAG,
      },
      {
        event: makeEvent(
          `${COLLECTION_URL}earlier.ics`,
          'Earlier',
          '2026-10-05T13:00:00',
          '2026-10-05T13:30:00',
        ),
        etag: ETAG,
      },
    ]);

    const result = await service.execute(
      ROOM_ID,
      SENDER_ID,
      'upcoming 1',
      safeTranslator(),
    );

    expect(result).toContain(
      'earlier.ics — 2026-10-05 13:00 – 13:30 — Earlier',
    );
    expect(result).not.toContain('later.ics');
    const range = operations.listEvents.mock.calls[0][1];
    expect(Date.parse(range.end) - Date.parse(range.start)).toBe(
      30 * 24 * 60 * 60 * 1000,
    );
  });

  test('sorts DATE events at viewer-local midnight alongside UTC timed events', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-04T12:00:00.000Z'));
    const timedEvent: CalendarEvent = {
      ...makeEvent(
        `${COLLECTION_URL}timed.ics`,
        'Timed event',
        '2026-10-05T00:30',
        '2026-10-05T01:30',
      ),
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-05T00:30',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-10-05T01:30',
          timezone: 'Europe/Stockholm',
        },
      },
    };
    const allDayEvent: CalendarEvent = {
      ...makeEvent(`${COLLECTION_URL}date.ics`, 'All day event'),
      timing: {
        type: 'all-day',
        startDate: '2026-10-05',
        endDate: '2026-10-06',
      },
    };
    operations.listEvents.mockResolvedValue([
      { event: timedEvent, etag: ETAG },
      { event: allDayEvent, etag: ETAG },
    ]);

    const result = await service.execute(
      ROOM_ID,
      SENDER_ID,
      'upcoming 1 --tz Europe/Stockholm',
      safeTranslator(),
    );

    expect(result).toContain('date.ics — 2026-10-05 — All day event');
    expect(result).not.toContain('timed.ics');
  });

  test('warns with generic text when projection diagnostics hide all events', async () => {
    operations.listEvents.mockResolvedValue([
      {
        event: {
          ...makeEvent(`${COLLECTION_URL}hidden.ics`, 'Private title'),
          unsupportedTimezone: true,
        },
        etag: ETAG,
      },
    ]);

    const result = await service.execute(
      ROOM_ID,
      SENDER_ID,
      'upcoming',
      safeTranslator(),
    );

    expect(result).toBe(
      'Some events could not be shown. Review the calendar widget for complete results.',
    );
    expect(result).not.toContain('No upcoming events');
    expect(result).not.toContain('Private title');
    expect(result).not.toContain('hidden.ics');
  });

  test('adds a generic warning beside safe upcoming events when some entries are unavailable', async () => {
    operations.listEvents.mockResolvedValue([
      {
        event: makeEvent(`${COLLECTION_URL}visible.ics`, 'Visible event'),
        etag: ETAG,
      },
      {
        event: {
          ...makeEvent(`${COLLECTION_URL}hidden.ics`, 'Private title'),
          unsupportedTimezone: true,
        },
        etag: ETAG,
      },
    ]);

    const result = await service.execute(
      ROOM_ID,
      SENDER_ID,
      'upcoming',
      safeTranslator(),
    );

    expect(result).toContain('visible.ics');
    expect(result).toContain(
      'Some events could not be shown. Review the calendar widget for complete results.',
    );
    expect(result).not.toContain('Private title');
    expect(result).not.toContain('hidden.ics');
  });

  test('warns with generic text instead of claiming no events when resource IDs are opaque', async () => {
    operations.listEvents.mockResolvedValue([
      {
        event: makeEvent(
          'https://calendar.example.com/bot/other/hidden-resource.ics',
          'Private title',
        ),
        etag: ETAG,
      },
    ]);

    const result = await service.execute(
      ROOM_ID,
      SENDER_ID,
      'upcoming',
      safeTranslator(),
    );

    expect(result).toBe(
      'Some events could not be shown. Review the calendar widget for complete results.',
    );
    expect(result).not.toContain('No upcoming events');
    expect(result).not.toContain('Private title');
    expect(result).not.toContain('hidden-resource');
    expect(result).not.toContain('calendar.example.com');
  });

  test('shows a safe event summary without href, UID, ETag, or HTML formatting', async () => {
    operations.getEvent.mockResolvedValue({
      event: makeEvent(
        EVENT_HREF,
        '<script>private</script>\nPlanning',
        undefined,
        undefined,
        'line one\nline two\u202e',
      ),
      etag: '"private-etag"',
    });

    const result = await service.execute(
      ROOM_ID,
      SENDER_ID,
      'event event.ics',
      safeTranslator(),
    );

    expect(result).toContain('Resource ID: event.ics');
    expect(result).toContain('Title: <script>private</script> Planning');
    expect(result).toContain('Description: line one line two');
    expect(result).not.toContain('calendar.example.com');
    expect(result).not.toContain('private-event-uid');
    expect(result).not.toContain('private-etag');
    expect(result).not.toContain('\u202e');
  });

  test('creates one VEVENT with a server UUID after room write authorization', async () => {
    order = [];
    const originalAuthorize = isAllowed.getMockImplementation();
    isAllowed.mockImplementation(async (request) => {
      order.push(`auth:${request.action}`);
      return originalAuthorize?.(request) ?? true;
    });
    const result = await service.execute(
      ROOM_ID,
      SENDER_ID,
      'create 2026-10-05T10:00 2026-10-05T11:00 "Planning" --description "Agenda" --tz Europe/Stockholm',
      safeTranslator(),
    );

    const [passedAccess, input] = operations.createEvent.mock.calls[0];
    expect(result).toBe(`Created event ${input.uid}.ics.`);
    expect(input).toMatchObject({
      title: 'Planning',
      description: 'Agenda',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-05T10:00',
          timezone: 'Europe/Stockholm',
        },
      },
    });
    expect(input.uid).toMatch(/^[0-9a-f-]{36}$/i);
    expect(passedAccess.target).toEqual(access.target);
    expect(isAllowed).toHaveBeenCalledWith({
      action: 'create-event',
      calendarId: CALENDAR_ID,
    });
    expect(forAuthorizedTarget).toHaveBeenCalledWith(access.target, 'write');
    expect(order).toEqual([
      'auth:create-event',
      'proof:write',
      'caldav:create',
    ]);
    expect(result).not.toContain('private-openid-credential');
    expect(result).not.toContain(COLLECTION_URL);
  });

  test('checks event resource safety and carries the current ETag into whole-series deletion', async () => {
    order = [];
    isAllowed.mockImplementation(async (request) => {
      order.push(`auth:${request.action}`);
      return true;
    });
    operations.getEventResource.mockImplementation(async () => {
      order.push('caldav:get');
      return {
        event: makeEvent(),
        etag: ETAG,
        icalendar: singleEventResource(),
      };
    });

    const result = await service.execute(
      ROOM_ID,
      SENDER_ID,
      'delete event.ics',
      safeTranslator(),
    );

    expect(result).toBe('Deleted event event.ics.');
    expect(isAllowed).toHaveBeenCalledWith({
      action: 'delete-event',
      calendarId: CALENDAR_ID,
      eventId: 'event.ics',
    });
    expect(forAuthorizedTarget).toHaveBeenCalledWith(access.target, 'write');
    expect(operations.getEventResource).toHaveBeenCalledWith(
      access,
      EVENT_HREF,
    );
    expect(operations.deleteEvent).toHaveBeenCalledWith(
      access,
      EVENT_HREF,
      ETAG,
    );
    expect(order).toEqual([
      'auth:delete-event',
      'proof:write',
      'caldav:get',
      'caldav:delete',
    ]);
    expect(result).not.toContain('private-event-uid');
    expect(result).not.toContain('revision-1');
    expect(result).not.toContain(COLLECTION_URL);
  });

  test('does not delete a mixed-component resource', async () => {
    operations.getEventResource.mockResolvedValue({
      event: makeEvent(),
      etag: ETAG,
      icalendar: singleEventResource().replace(
        'END:VCALENDAR',
        'BEGIN:VTODO\nUID:task@example.org\nEND:VTODO\nEND:VCALENDAR',
      ),
    });

    const result = await service.execute(
      ROOM_ID,
      SENDER_ID,
      'delete event.ics',
      safeTranslator(),
    );

    expect(result).toBe('calendarCommandErrors.unsafe');
    expect(operations.deleteEvent).not.toHaveBeenCalled();
  });

  test('maps a stale ETag to fixed localized conflict text', async () => {
    operations.deleteEvent.mockRejectedValue({ code: 'etag-conflict' });

    const result = await service.execute(
      ROOM_ID,
      SENDER_ID,
      'delete event.ics',
      safeTranslator({ conflict: 'The event changed; retry.' }),
    );

    expect(result).toBe('The event changed; retry.');
  });

  test('returns a fixed error without exposing operation error details', async () => {
    operations.listEvents.mockRejectedValue(
      new Error('matrix-openid:secret calendar.example.com private ICS'),
    );

    const result = await service.execute(
      ROOM_ID,
      SENDER_ID,
      'upcoming',
      safeTranslator({
        failed: 'The calendar command could not be completed.',
      }),
    );

    expect(result).toBe('The calendar command could not be completed.');
    expect(result).not.toContain('matrix-openid:secret');
    expect(result).not.toContain('calendar.example.com');
    expect(result).not.toContain('private ICS');
  });
});
