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
  CalendarEventInput,
  CalendarEventPatch,
  CalendarTimeRange,
  isCalendarTimezoneSupported,
  projectCalendarEventOccurrences,
  type CalendarEventListDiagnosticReason,
} from '@matrix-calendar-widget/calendar';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IAppConfiguration } from '../IAppConfiguration';
import { ModuleProviderToken } from '../ModuleProviderToken';
import {
  CalDavEventClient,
  CalDavEventResource,
  ICalendarEventCodec,
  MatrixOpenIdCalDavCredentialProviderFactory,
} from '../caldav';
import { isSafeSingleVeventSeries } from '../caldav/ICalendarDeletionSafety';
import { CalendarGatewayEventDto } from '../dto/CalendarGatewayEventDto';
import { CalendarGatewayEventListDto } from '../dto/CalendarGatewayEventListDto';
import { IMatrixOpenIdCredential } from '../model/IMatrixOpenIdCredential';
import { IUserContext } from '../model/IUserContext';
import { calendarResourceIdFromHref } from './CalendarCommandParser';
import { updateCalendarEventConditionally } from './CalendarEventUpdateOperation';
import { GatewayAccessService } from './GatewayAccessService';
import { MatrixCalendarAuthorizationFactory } from './MatrixCalendarAuthorization';
import {
  RoomCalendarCalDavAccess,
  RoomCalendarTarget,
} from './RoomCalendarCalDavAccess';
import {
  RoomCalendarEventAuditAction,
  RoomCalendarEventAuditContext,
  RoomCalendarEventAuditService,
} from './RoomCalendarEventAuditService';
import { RoomCalendarEventOperations } from './RoomCalendarEventOperations';

import { runCalDav } from '../controller/runGatewayCalDav';
@Injectable()
export class GatewayEventService {
  constructor(
    @Inject(ModuleProviderToken.APP_CONFIGURATION)
    private readonly appConfig: IAppConfiguration,
    private readonly authorizationFactory: MatrixCalendarAuthorizationFactory,
    private readonly credentialProviderFactory: MatrixOpenIdCalDavCredentialProviderFactory,
    @Inject(ModuleProviderToken.ROOM_CALENDAR_CALDAV_ACCESS)
    private readonly roomCalendarCalDavAccess: RoomCalendarCalDavAccess,
    private readonly gatewayAccessService: GatewayAccessService,
    @Optional()
    @Inject(RoomCalendarEventOperations)
    private readonly roomCalendarEventOperations: RoomCalendarEventOperations = new RoomCalendarEventOperations(),
    @Optional()
    @Inject(RoomCalendarEventAuditService)
    private readonly roomCalendarEventAuditService?: RoomCalendarEventAuditService,
  ) {}
  async listEvents(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    roomId?: string,
    calendarId?: string,
    start?: string,
    end?: string,
    timezone?: string,
    target?: string,
  ): Promise<CalendarGatewayEventListDto> {
    if (this.isRoomTarget(target)) {
      const viewerTimezone = this.requireQuery(timezone, 'timezone');
      if (!isCalendarTimezoneSupported(viewerTimezone)) {
        throw new BadRequestException({
          code: 'unsupported-timezone',
          message: 'timezone must be a supported IANA time zone',
        });
      }
      const range: CalendarTimeRange = {
        start: this.requireQuery(start, 'start'),
        end: this.requireQuery(end, 'end'),
      };
      const roomTarget =
        await this.gatewayAccessService.authorizeRoomCalendarTarget(
          userContext,
          roomId,
          calendarId,
          { action: 'read-events', calendarId: calendarId ?? '' },
        );

      return runCalDav(async () => {
        const principal =
          await this.roomCalendarCalDavAccess.forAuthorizedTarget(
            roomTarget,
            'read',
          );
        return this.listCalendarEvents(
          this.eventClientForPrincipal(principal.userId, principal.credential),
          principal.calendarUrl,
          roomTarget.calendarId,
          range,
          viewerTimezone,
        );
      });
    }

    const requestedCalendarId = this.requireQuery(calendarId, 'calendarId');
    const viewerTimezone = this.requireQuery(timezone, 'timezone');
    if (!isCalendarTimezoneSupported(viewerTimezone)) {
      throw new BadRequestException({
        code: 'unsupported-timezone',
        message: 'timezone must be a supported IANA time zone',
      });
    }
    const scope =
      await this.gatewayAccessService.authorizePersonalCalendarRequest(
        userContext,
        roomId,
        requestedCalendarId,
        {
          action: 'read-events',
          calendarId: requestedCalendarId,
        },
      );
    const range: CalendarTimeRange = {
      start: this.requireQuery(start, 'start'),
      end: this.requireQuery(end, 'end'),
    };

    return runCalDav(() =>
      this.listCalendarEvents(
        this.eventClient(userContext, openIdCredential),
        scope.calendarId,
        scope.calendarId,
        range,
        viewerTimezone,
      ),
    );
  }

  async getEvent(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    roomId?: string,
    calendarId?: string,
    eventId?: string,
    target?: string,
  ): Promise<CalendarGatewayEventDto> {
    if (this.isRoomTarget(target)) {
      const roomTarget =
        await this.gatewayAccessService.authorizeRoomCalendarTarget(
          userContext,
          roomId,
          calendarId,
          { action: 'read-events', calendarId: calendarId ?? '' },
        );
      const requiredEventId = this.requireQuery(eventId, 'eventId');
      const principal = await this.roomCalendarCalDavAccess.forAuthorizedTarget(
        roomTarget,
        'read',
      );
      const result = await runCalDav(() =>
        this.roomCalendarEventOperations.getEvent(
          { target: roomTarget, servicePrincipal: principal },
          requiredEventId,
        ),
      );
      return new CalendarGatewayEventDto(result.event, result.etag);
    }

    const requestedCalendarId = this.requireQuery(calendarId, 'calendarId');
    const scope =
      await this.gatewayAccessService.authorizePersonalCalendarRequest(
        userContext,
        roomId,
        requestedCalendarId,
        {
          action: 'read-events',
          calendarId: requestedCalendarId,
        },
      );
    const normalizedEventId = this.normalizeEventUrl(
      this.requireQuery(eventId, 'eventId'),
      scope.calendarId,
    );

    return runCalDav(async () => {
      const client = this.eventClient(userContext, openIdCredential);
      const resource = await client.getEvent(normalizedEventId);
      return this.eventDto(
        new ICalendarEventCodec(),
        scope.calendarId,
        resource,
      );
    });
  }

  async createEvent(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    input: CalendarEventInput,
    roomId?: string,
    calendarId?: string,
    target?: string,
  ): Promise<CalendarGatewayEventDto> {
    if (this.isRoomTarget(target)) {
      const roomTarget =
        await this.gatewayAccessService.authorizeRoomCalendarTarget(
          userContext,
          roomId,
          calendarId,
          { action: 'create-event', calendarId: calendarId ?? '' },
        );
      if (
        !input ||
        typeof input.uid !== 'string' ||
        !isSafeRoomCalendarEventUid(input.uid)
      ) {
        throw new BadRequestException('event uid is required');
      }
      const principal = await this.roomCalendarCalDavAccess.forAuthorizedTarget(
        roomTarget,
        'write',
      );
      const result = await runCalDav(() =>
        this.roomCalendarEventOperations.createEvent(
          { target: roomTarget, servicePrincipal: principal },
          input,
        ),
      );
      await this.recordRoomCalendarAction(
        userContext,
        roomTarget,
        principal.calendarUrl,
        result.event.id,
        'created',
        result.event.title,
      );
      return new CalendarGatewayEventDto(result.event, result.etag);
    }

    const requestedCalendarId = this.requireQuery(calendarId, 'calendarId');
    const scope =
      await this.gatewayAccessService.authorizePersonalCalendarRequest(
        userContext,
        roomId,
        requestedCalendarId,
        {
          action: 'create-event',
          calendarId: requestedCalendarId,
        },
      );

    if (!input || typeof input.uid !== 'string' || input.uid.length === 0) {
      throw new BadRequestException('event uid is required');
    }

    const eventId = new URL(
      `${encodeURIComponent(input.uid)}.ics`,
      this.asCollectionUrl(scope.calendarId),
    ).toString();

    return runCalDav(async () => {
      const client = this.eventClient(userContext, openIdCredential);
      const codec = new ICalendarEventCodec();
      const encoded = codec.create(scope.calendarId, eventId, input);
      await client.createEvent(eventId, encoded.icalendar);
      return this.eventDto(
        codec,
        scope.calendarId,
        await client.getEvent(eventId),
      );
    });
  }

  async updateEvent(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    patch: CalendarEventPatch,
    ifMatch?: string,
    roomId?: string,
    calendarId?: string,
    eventId?: string,
    target?: string,
  ): Promise<CalendarGatewayEventDto> {
    if (this.isRoomTarget(target)) {
      const roomTarget =
        await this.gatewayAccessService.authorizeRoomCalendarTarget(
          userContext,
          roomId,
          calendarId,
          {
            action: 'update-event',
            calendarId: calendarId ?? '',
            eventId: eventId ?? '',
          },
        );
      const requiredEventId = this.requireQuery(eventId, 'eventId');
      const expectedEtag = this.requireQuery(ifMatch, 'If-Match');
      const principal = await this.roomCalendarCalDavAccess.forAuthorizedTarget(
        roomTarget,
        'write',
      );
      const result = await runCalDav(() =>
        this.roomCalendarEventOperations.updateEvent(
          { target: roomTarget, servicePrincipal: principal },
          requiredEventId,
          expectedEtag,
          patch ?? {},
        ),
      );
      if (!result.noOp) {
        await this.recordRoomCalendarAction(
          userContext,
          roomTarget,
          principal.calendarUrl,
          result.event.id,
          'updated',
          result.event.title,
        );
      }
      return new CalendarGatewayEventDto(result.event, result.etag);
    }

    const requestedCalendarId = this.requireQuery(calendarId, 'calendarId');
    const normalizedCalendarId = this.normalizeRadicaleUrl(
      requestedCalendarId,
      'calendarId',
    );
    const normalizedEventId = this.normalizeEventUrl(
      this.requireQuery(eventId, 'eventId'),
      normalizedCalendarId,
    );
    const scope =
      await this.gatewayAccessService.authorizePersonalCalendarRequest(
        userContext,
        roomId,
        normalizedCalendarId,
        {
          action: 'update-event',
          calendarId: normalizedCalendarId,
          eventId: normalizedEventId,
        },
      );
    const etag = this.requireQuery(ifMatch, 'If-Match');
    if (!isConcreteStrongEtag(etag)) {
      throw new BadRequestException({
        code: 'invalid-event-etag',
        message: 'If-Match must contain one strong ETag',
      });
    }

    return runCalDav(async () => {
      const client = this.eventClient(userContext, openIdCredential);
      const codec = new ICalendarEventCodec();
      const result = await updateCalendarEventConditionally({
        client,
        calendarId: scope.calendarId,
        resourceUrl: normalizedEventId,
        expectedEtag: etag,
        patch: patch ?? {},
        maxResponseBytes: this.appConfig.caldav_max_event_response_bytes,
      });
      return this.eventDto(codec, scope.calendarId, result.resource);
    });
  }

  async deleteEvent(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    ifMatch?: string,
    roomId?: string,
    calendarId?: string,
    eventId?: string,
    target?: string,
  ): Promise<void> {
    if (this.isRoomTarget(target)) {
      const roomTarget =
        await this.gatewayAccessService.authorizeRoomCalendarTarget(
          userContext,
          roomId,
          calendarId,
          {
            action: 'delete-event',
            calendarId: calendarId ?? '',
            eventId: eventId ?? '',
          },
        );
      const requiredEventId = this.requireQuery(eventId, 'eventId');
      const expectedEtag = this.requireQuery(ifMatch, 'If-Match');
      const principal = await this.roomCalendarCalDavAccess.forAuthorizedTarget(
        roomTarget,
        'write',
      );
      await runCalDav(() =>
        this.roomCalendarEventOperations.deleteEvent(
          { target: roomTarget, servicePrincipal: principal },
          requiredEventId,
          expectedEtag,
        ),
      );
      await this.recordRoomCalendarAction(
        userContext,
        roomTarget,
        principal.calendarUrl,
        requiredEventId,
        'deleted',
      );
      return;
    }

    const requestedCalendarId = this.requireQuery(calendarId, 'calendarId');
    const normalizedCalendarId = this.normalizeRadicaleUrl(
      requestedCalendarId,
      'calendarId',
    );
    const normalizedEventId = this.normalizeEventUrl(
      this.requireQuery(eventId, 'eventId'),
      normalizedCalendarId,
    );
    await this.gatewayAccessService.authorizePersonalCalendarRequest(
      userContext,
      roomId,
      normalizedCalendarId,
      {
        action: 'delete-event',
        calendarId: normalizedCalendarId,
        eventId: normalizedEventId,
      },
    );
    const etag = this.requireQuery(ifMatch, 'If-Match');
    if (!isConcreteStrongEtag(etag)) {
      throw new BadRequestException({
        code: 'invalid-event-etag',
        message: 'If-Match must contain one strong ETag',
      });
    }

    await runCalDav(async () => {
      const client = this.eventClient(userContext, openIdCredential);
      const current = await client.getEvent(normalizedEventId);
      if (current.etag !== etag) {
        throw new ConflictException({
          code: 'etag-conflict',
          message: 'Calendar event changed; reload before retrying',
        });
      }
      if (!isSafeSingleVeventSeries(current.icalendar)) {
        throw new ConflictException({
          code: 'unsafe-event-resource',
          message: 'Calendar event contains data that cannot be safely deleted',
        });
      }
      await client.deleteEvent(normalizedEventId, etag);
    });
  }

  private isRoomTarget(target: string | undefined): boolean {
    if (target === undefined || target === 'personal') {
      return false;
    }
    if (target === 'room') {
      return true;
    }

    throw new BadRequestException({
      code: 'invalid-calendar-target',
      message: 'target must be personal or room',
    });
  }

  private async recordRoomCalendarAction(
    userContext: IUserContext,
    target: RoomCalendarTarget,
    collectionHref: string,
    eventHref: string,
    action: RoomCalendarEventAuditAction,
    title?: string,
  ): Promise<void> {
    const auditService = this.roomCalendarEventAuditService;
    if (!auditService) {
      return;
    }

    const resourceId = calendarResourceIdFromHref(eventHref, collectionHref);
    if (!resourceId) {
      return;
    }

    const context: RoomCalendarEventAuditContext = {
      roomId: target.roomId,
      calendarId: target.calendarId,
      actorUserId: userContext.userId,
      action,
      resourceId,
      ...(title === undefined ? {} : { title }),
    };
    try {
      await auditService.record(context);
    } catch {
      // CalDAV already committed. Matrix audit delivery is best effort.
    }
  }

  private eventClient(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
  ): CalDavEventClient {
    return new CalDavEventClient(
      this.credentialProviderFactory.forRequest(userContext, openIdCredential),
      fetch,
      this.appConfig.caldav_max_event_response_bytes,
    );
  }

  private eventClientForPrincipal(
    userId: string,
    openIdCredential: IMatrixOpenIdCredential,
  ): CalDavEventClient {
    return new CalDavEventClient(
      this.credentialProviderFactory.forPrincipal(userId, openIdCredential),
      fetch,
      this.appConfig.caldav_max_event_response_bytes,
    );
  }

  private async listCalendarEvents(
    client: CalDavEventClient,
    collectionUrl: string,
    logicalCalendarId: string,
    range: CalendarTimeRange,
    viewerTimezone: string,
  ): Promise<CalendarGatewayEventListDto> {
    const codec = new ICalendarEventCodec();
    const resources = await client.listEvents(collectionUrl, range);
    const parsedResources = resources.map((resource) => {
      const parsed = codec.parse(
        logicalCalendarId,
        resource.href,
        resource.icalendar,
      );
      return { resource, parsed, event: parsed.event };
    });
    const rangeUnsupportedResources = parsedResources.filter(
      ({ event }) => event.unsupportedRecurrence === 'range-this-and-future',
    );
    const projectionUnsupportedResources = parsedResources.filter(
      ({ parsed }) => parsed.listProjectionDiagnostic !== undefined,
    );
    const projectableResources = parsedResources.filter(
      ({ event, parsed }) =>
        event.unsupportedRecurrence !== 'range-this-and-future' &&
        parsed.listProjectionDiagnostic === undefined,
    );
    const projection = projectCalendarEventOccurrences(
      projectableResources.map(({ event }) => event),
      range,
      viewerTimezone,
    );
    const inRangeResourceIds = new Set(
      projection.occurrences.map(({ sourceEvent }) => sourceEvent.id),
    );
    const diagnosticCounts = new Map<
      CalendarEventListDiagnosticReason,
      number
    >();
    const addDiagnostic = (reason: CalendarEventListDiagnosticReason) => {
      diagnosticCounts.set(reason, (diagnosticCounts.get(reason) ?? 0) + 1);
    };

    if (rangeUnsupportedResources.length > 0) {
      diagnosticCounts.set(
        'range-this-and-future',
        rangeUnsupportedResources.length,
      );
    }
    if (projectionUnsupportedResources.length > 0) {
      diagnosticCounts.set(
        'unsupported-recurrence',
        projectionUnsupportedResources.length,
      );
    }
    for (const diagnostic of projection.diagnostics) {
      addDiagnostic(diagnostic.reason);
    }

    return new CalendarGatewayEventListDto(
      parsedResources
        .filter(({ event }) => inRangeResourceIds.has(event.id))
        .map(
          ({ resource, event }) =>
            new CalendarGatewayEventDto(event, resource.etag),
        ),
      [...diagnosticCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([reason, count]) => ({ reason, count })),
    );
  }

  private eventDto(
    codec: ICalendarEventCodec,
    calendarId: string,
    resource: CalDavEventResource,
  ): CalendarGatewayEventDto {
    return new CalendarGatewayEventDto(
      codec.parse(calendarId, resource.href, resource.icalendar).event,
      resource.etag,
    );
  }

  private requireRadicaleBaseUrl(): string {
    if (!this.appConfig.radicale_url) {
      throw new ServiceUnavailableException({
        code: 'radicale-not-configured',
        message: 'RADICALE_URL is required for calendar discovery',
      });
    }

    return new URL(this.appConfig.radicale_url).toString();
  }

  private normalizeRadicaleUrl(value: string, field: string): string {
    const base = new URL(this.requireRadicaleBaseUrl());
    let target: URL;

    try {
      target = new URL(value);
    } catch {
      throw new BadRequestException(`${field} must be an absolute URL`);
    }

    const basePath = base.pathname.endsWith('/')
      ? base.pathname
      : `${base.pathname}/`;

    if (
      target.username ||
      target.password ||
      target.origin !== base.origin ||
      !target.pathname.startsWith(basePath)
    ) {
      throw new BadRequestException(
        `${field} must be within the configured Radicale service`,
      );
    }

    return target.toString();
  }

  private normalizeEventUrl(value: string, calendarId: string): string {
    const eventUrl = new URL(this.normalizeRadicaleUrl(value, 'eventId'));
    const calendarUrl = new URL(this.asCollectionUrl(calendarId));

    if (!eventUrl.pathname.startsWith(calendarUrl.pathname)) {
      throw new BadRequestException(
        'eventId must be within the selected calendar',
      );
    }

    return eventUrl.toString();
  }

  private asCollectionUrl(calendarId: string): string {
    const url = new URL(calendarId);
    if (!url.pathname.endsWith('/')) {
      url.pathname = `${url.pathname}/`;
    }
    return url.toString();
  }

  private requireQuery(value: string | undefined, name: string): string {
    if (!value) {
      throw new BadRequestException(`${name} is required`);
    }
    return value;
  }
}

function isSafeRoomCalendarEventUid(value: string): boolean {
  if (
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > 251 ||
    /%[0-9a-f]{2}/i.test(value) ||
    containsSlashOrControlCharacters(value)
  ) {
    return false;
  }

  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
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

function isConcreteStrongEtag(value: string): boolean {
  return value.trim() === value && /^"[\x21\x23-\x7e]*"$/.test(value);
}
