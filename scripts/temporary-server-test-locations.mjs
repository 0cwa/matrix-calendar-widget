#!/usr/bin/env node

// Copyright 2026 Matrix Calendar Widget contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGETS = Object.freeze({
  'alarm-server': Object.freeze({
    runner: 'jest',
    suites: Object.freeze([
      Object.freeze({ runnerPath: "src/caldav/BoundedDavResponse.test.ts", reportPath: "matrix-calendar-server/src/caldav/BoundedDavResponse.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/CalDavDiscoveryClient.test.ts", reportPath: "matrix-calendar-server/src/caldav/CalDavDiscoveryClient.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/CalDavDiscoveryTransport.test.ts", reportPath: "matrix-calendar-server/src/caldav/CalDavDiscoveryTransport.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/CalDavEventClient.test.ts", reportPath: "matrix-calendar-server/src/caldav/CalDavEventClient.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/ICalendarDeletionSafety.test.ts", reportPath: "matrix-calendar-server/src/caldav/ICalendarDeletionSafety.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/ICalendarEventCodec.periodReplacement.test.ts", reportPath: "matrix-calendar-server/src/caldav/ICalendarEventCodec.periodReplacement.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/ICalendarEventCodec.test.ts", reportPath: "matrix-calendar-server/src/caldav/ICalendarEventCodec.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/ICalendarEventCodecConference.test.ts", reportPath: "matrix-calendar-server/src/caldav/ICalendarEventCodecConference.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/ICalendarEventCodecMonthlyOrdinalByDay.test.ts", reportPath: "matrix-calendar-server/src/caldav/ICalendarEventCodecMonthlyOrdinalByDay.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/ICalendarEventCodecWeeklyByDay.test.ts", reportPath: "matrix-calendar-server/src/caldav/ICalendarEventCodecWeeklyByDay.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/ICalendarTimezoneProjectionSafety.test.ts", reportPath: "matrix-calendar-server/src/caldav/ICalendarTimezoneProjectionSafety.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/MatrixOpenIdCalDavCredentialProvider.test.ts", reportPath: "matrix-calendar-server/src/caldav/MatrixOpenIdCalDavCredentialProvider.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/readCalendarLinks.test.ts", reportPath: "matrix-calendar-server/src/caldav/readCalendarLinks.test.ts" }),
      Object.freeze({ runnerPath: "src/client/MatrixClientAdapter.test.ts", reportPath: "matrix-calendar-server/src/client/MatrixClientAdapter.test.ts" }),
      Object.freeze({ runnerPath: "src/client/MeetingClient.test.ts", reportPath: "matrix-calendar-server/src/client/MeetingClient.test.ts" }),
      Object.freeze({ runnerPath: "src/configuration.test.ts", reportPath: "matrix-calendar-server/src/configuration.test.ts" }),
      Object.freeze({ runnerPath: "src/controller/CalendarGatewayController.test.ts", reportPath: "matrix-calendar-server/src/controller/CalendarGatewayController.test.ts" }),
      Object.freeze({ runnerPath: "src/controller/RoomCalendarTarget.test.ts", reportPath: "matrix-calendar-server/src/controller/RoomCalendarTarget.test.ts" }),
      Object.freeze({ runnerPath: "src/controller/RoomReminderAlarmOptionsController.test.ts", reportPath: "matrix-calendar-server/src/controller/RoomReminderAlarmOptionsController.test.ts" }),
      Object.freeze({ runnerPath: "src/controller/RoomReminderConfigurationController.test.ts", reportPath: "matrix-calendar-server/src/controller/RoomReminderConfigurationController.test.ts" }),
      Object.freeze({ runnerPath: "src/controller/WidgetController.test.ts", reportPath: "matrix-calendar-server/src/controller/WidgetController.test.ts" }),
      Object.freeze({ runnerPath: "src/dto/CalendarEntryDto.test.ts", reportPath: "matrix-calendar-server/src/dto/CalendarEntryDto.test.ts" }),
      Object.freeze({ runnerPath: "src/dto/MeetingCreateDto.test.ts", reportPath: "matrix-calendar-server/src/dto/MeetingCreateDto.test.ts" }),
      Object.freeze({ runnerPath: "src/dto/MeetingUpdateDetailsDto.test.ts", reportPath: "matrix-calendar-server/src/dto/MeetingUpdateDetailsDto.test.ts" }),
      Object.freeze({ runnerPath: "src/dto/ParticipantDto.test.ts", reportPath: "matrix-calendar-server/src/dto/ParticipantDto.test.ts" }),
      Object.freeze({ runnerPath: "src/http/RequestBodyLimits.test.ts", reportPath: "matrix-calendar-server/src/http/RequestBodyLimits.test.ts" }),
      Object.freeze({ runnerPath: "src/model/ExternalData.test.ts", reportPath: "matrix-calendar-server/src/model/ExternalData.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/CanonicalReminderIdentityResolver.test.ts", reportPath: "matrix-calendar-server/src/reminder/CanonicalReminderIdentityResolver.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/CanonicalRoomReminderSchedulerSource.test.ts", reportPath: "matrix-calendar-server/src/reminder/CanonicalRoomReminderSchedulerSource.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/MatrixAppServiceReminderTransport.test.ts", reportPath: "matrix-calendar-server/src/reminder/MatrixAppServiceReminderTransport.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/PostgresRoomReminderStore.integration.test.ts", reportPath: "matrix-calendar-server/src/reminder/PostgresRoomReminderStore.integration.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/PostgresRoomReminderStore.test.ts", reportPath: "matrix-calendar-server/src/reminder/PostgresRoomReminderStore.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/ReminderConfigurationSourceValidator.test.ts", reportPath: "matrix-calendar-server/src/reminder/ReminderConfigurationSourceValidator.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/ReminderTrigger.test.ts", reportPath: "matrix-calendar-server/src/reminder/ReminderTrigger.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/RoomMentionMessage.test.ts", reportPath: "matrix-calendar-server/src/reminder/RoomMentionMessage.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/RoomMentionPolicy.test.ts", reportPath: "matrix-calendar-server/src/reminder/RoomMentionPolicy.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/RoomReminderAlarmOptionsService.test.ts", reportPath: "matrix-calendar-server/src/reminder/RoomReminderAlarmOptionsService.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/RoomReminderConfigurationContract.test.ts", reportPath: "matrix-calendar-server/src/reminder/RoomReminderConfigurationContract.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/RoomReminderConfigurationService.test.ts", reportPath: "matrix-calendar-server/src/reminder/RoomReminderConfigurationService.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/RoomReminderModuleProviders.test.ts", reportPath: "matrix-calendar-server/src/reminder/RoomReminderModuleProviders.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/RoomReminderScheduler.test.ts", reportPath: "matrix-calendar-server/src/reminder/RoomReminderScheduler.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/RoomReminderSchedulerRuntime.test.ts", reportPath: "matrix-calendar-server/src/reminder/RoomReminderSchedulerRuntime.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/RoomReminderStore.test.ts", reportPath: "matrix-calendar-server/src/reminder/RoomReminderStore.test.ts" }),
      Object.freeze({ runnerPath: "src/service/CalendarCommandFormatter.test.ts", reportPath: "matrix-calendar-server/src/service/CalendarCommandFormatter.test.ts" }),
      Object.freeze({ runnerPath: "src/service/CalendarCommandParser.test.ts", reportPath: "matrix-calendar-server/src/service/CalendarCommandParser.test.ts" }),
      Object.freeze({ runnerPath: "src/service/CalendarCommandService.test.ts", reportPath: "matrix-calendar-server/src/service/CalendarCommandService.test.ts" }),
      Object.freeze({ runnerPath: "src/service/CalendarCommandTrafficLimiter.test.ts", reportPath: "matrix-calendar-server/src/service/CalendarCommandTrafficLimiter.test.ts" }),
      Object.freeze({ runnerPath: "src/service/CommandContext.test.ts", reportPath: "matrix-calendar-server/src/service/CommandContext.test.ts" }),
      Object.freeze({ runnerPath: "src/service/MatrixCalendarAuthorization.test.ts", reportPath: "matrix-calendar-server/src/service/MatrixCalendarAuthorization.test.ts" }),
      Object.freeze({ runnerPath: "src/service/RoomCalendarBindingResolver.test.ts", reportPath: "matrix-calendar-server/src/service/RoomCalendarBindingResolver.test.ts" }),
      Object.freeze({ runnerPath: "src/service/RoomCalendarCalDavAccess.test.ts", reportPath: "matrix-calendar-server/src/service/RoomCalendarCalDavAccess.test.ts" }),
      Object.freeze({ runnerPath: "src/service/RoomCalendarEventAuditService.test.ts", reportPath: "matrix-calendar-server/src/service/RoomCalendarEventAuditService.test.ts" }),
      Object.freeze({ runnerPath: "src/service/RoomCalendarEventOperations.test.ts", reportPath: "matrix-calendar-server/src/service/RoomCalendarEventOperations.test.ts" }),
      Object.freeze({ runnerPath: "src/util/format.test.ts", reportPath: "matrix-calendar-server/src/util/format.test.ts" }),
      Object.freeze({ runnerPath: "src/util/getForceDeletionTime.test.ts", reportPath: "matrix-calendar-server/src/util/getForceDeletionTime.test.ts" }),
      Object.freeze({ runnerPath: "src/util/migrateMeetingTime.test.ts", reportPath: "matrix-calendar-server/src/util/migrateMeetingTime.test.ts" }),
      Object.freeze({ runnerPath: "src/validator/IsIncompatibleWithSibling.test.ts", reportPath: "matrix-calendar-server/src/validator/IsIncompatibleWithSibling.test.ts" }),
      Object.freeze({ runnerPath: "src/validator/IsOptionalIfSiblingIsUndefined.test.ts", reportPath: "matrix-calendar-server/src/validator/IsOptionalIfSiblingIsUndefined.test.ts" }),
      Object.freeze({ runnerPath: "src/validator/isMatrixRoomId.test.ts", reportPath: "matrix-calendar-server/src/validator/isMatrixRoomId.test.ts" }),
      Object.freeze({ runnerPath: "test/ArrayOps.test.ts", reportPath: "matrix-calendar-server/test/ArrayOps.test.ts" }),
      Object.freeze({ runnerPath: "test/CalendarGatewayMembershipGuard.test.ts", reportPath: "matrix-calendar-server/test/CalendarGatewayMembershipGuard.test.ts" }),
      Object.freeze({ runnerPath: "test/CommandService.test.ts", reportPath: "matrix-calendar-server/test/CommandService.test.ts" }),
      Object.freeze({ runnerPath: "test/EventContentParams.test.ts", reportPath: "matrix-calendar-server/test/EventContentParams.test.ts" }),
      Object.freeze({ runnerPath: "test/EventContentRenderer.test.ts", reportPath: "matrix-calendar-server/test/EventContentRenderer.test.ts" }),
      Object.freeze({ runnerPath: "test/EventTypeHelper.test.ts", reportPath: "matrix-calendar-server/test/EventTypeHelper.test.ts" }),
      Object.freeze({ runnerPath: "test/GuestMemberService.test.ts", reportPath: "matrix-calendar-server/test/GuestMemberService.test.ts" }),
      Object.freeze({ runnerPath: "test/MatrixServer.test.ts", reportPath: "matrix-calendar-server/test/MatrixServer.test.ts" }),
      Object.freeze({ runnerPath: "test/MeetingService.test.ts", reportPath: "matrix-calendar-server/test/MeetingService.test.ts" }),
      Object.freeze({ runnerPath: "test/RoomMatrixEventsReader.test.ts", reportPath: "matrix-calendar-server/test/RoomMatrixEventsReader.test.ts" }),
      Object.freeze({ runnerPath: "test/RoomMessageService.test.ts", reportPath: "matrix-calendar-server/test/RoomMessageService.test.ts" }),
      Object.freeze({ runnerPath: "test/StubMatrixClient.test.ts", reportPath: "matrix-calendar-server/test/StubMatrixClient.test.ts" }),
      Object.freeze({ runnerPath: "test/WelcomeWorkflowService.test.ts", reportPath: "matrix-calendar-server/test/WelcomeWorkflowService.test.ts" }),
      Object.freeze({ runnerPath: "test/WidgetLayoutConfigReader.test.ts", reportPath: "matrix-calendar-server/test/WidgetLayoutConfigReader.test.ts" }),
      Object.freeze({ runnerPath: "test/WidgetLayoutService.test.ts", reportPath: "matrix-calendar-server/test/WidgetLayoutService.test.ts" }),
      Object.freeze({ runnerPath: "test/decorator/ParamExtractor.test.ts", reportPath: "matrix-calendar-server/test/decorator/ParamExtractor.test.ts" }),
      Object.freeze({ runnerPath: "test/integration/CalDavDiscoveryContract.test.ts", reportPath: "matrix-calendar-server/test/integration/CalDavDiscoveryContract.test.ts" }),
      Object.freeze({ runnerPath: "test/integration/CalDavEventRoundTripContract.test.ts", reportPath: "matrix-calendar-server/test/integration/CalDavEventRoundTripContract.test.ts" }),
      Object.freeze({ runnerPath: "test/integration/CalendarDiagnosticsContract.test.ts", reportPath: "matrix-calendar-server/test/integration/CalendarDiagnosticsContract.test.ts" }),
      Object.freeze({ runnerPath: "test/integration/PersonalOpenIdRadicaleContract.test.ts", reportPath: "matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts" }),
      Object.freeze({ runnerPath: "test/integration/RoomAppServiceRadicaleContract.test.ts", reportPath: "matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts" }),
      Object.freeze({ runnerPath: "test/integration/RoomReminderDeliveryContract.test.ts", reportPath: "matrix-calendar-server/test/integration/RoomReminderDeliveryContract.test.ts" }),
      Object.freeze({ runnerPath: "test/middleware/CalendarGatewayRateLimitMiddleware.test.ts", reportPath: "matrix-calendar-server/test/middleware/CalendarGatewayRateLimitMiddleware.test.ts" }),
      Object.freeze({ runnerPath: "test/middleware/MatrixAuthMiddleware.test.ts", reportPath: "matrix-calendar-server/test/middleware/MatrixAuthMiddleware.test.ts" }),
      Object.freeze({ runnerPath: "test/util/IMeetingChanges.test.ts", reportPath: "matrix-calendar-server/test/util/IMeetingChanges.test.ts" }),
      Object.freeze({ runnerPath: "test/util/MatrixApplicationServiceFixtureUser.test.ts", reportPath: "matrix-calendar-server/test/util/MatrixApplicationServiceFixtureUser.test.ts" }),
      Object.freeze({ runnerPath: "test/util/TemplateHelper.test.ts", reportPath: "matrix-calendar-server/test/util/TemplateHelper.test.ts" }),
      Object.freeze({ runnerPath: "test/util/extractOxRrule.test.ts", reportPath: "matrix-calendar-server/test/util/extractOxRrule.test.ts" }),
    ]),
  }),
  'attachment-server': Object.freeze({
    runner: 'jest',
    suites: Object.freeze([
      Object.freeze({ runnerPath: "src/caldav/BoundedDavResponse.test.ts", reportPath: "matrix-calendar-server/src/caldav/BoundedDavResponse.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/CalDavDiscoveryClient.test.ts", reportPath: "matrix-calendar-server/src/caldav/CalDavDiscoveryClient.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/CalDavDiscoveryTransport.test.ts", reportPath: "matrix-calendar-server/src/caldav/CalDavDiscoveryTransport.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/CalDavEventClient.test.ts", reportPath: "matrix-calendar-server/src/caldav/CalDavEventClient.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/ICalendarDeletionSafety.test.ts", reportPath: "matrix-calendar-server/src/caldav/ICalendarDeletionSafety.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/ICalendarEventCodec.periodReplacement.test.ts", reportPath: "matrix-calendar-server/src/caldav/ICalendarEventCodec.periodReplacement.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/ICalendarEventCodec.test.ts", reportPath: "matrix-calendar-server/src/caldav/ICalendarEventCodec.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/ICalendarEventCodecAttachment.test.ts", reportPath: "matrix-calendar-server/src/caldav/ICalendarEventCodecAttachment.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/ICalendarEventCodecConference.test.ts", reportPath: "matrix-calendar-server/src/caldav/ICalendarEventCodecConference.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/ICalendarEventCodecMonthlyOrdinalByDay.test.ts", reportPath: "matrix-calendar-server/src/caldav/ICalendarEventCodecMonthlyOrdinalByDay.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/ICalendarEventCodecWeeklyByDay.test.ts", reportPath: "matrix-calendar-server/src/caldav/ICalendarEventCodecWeeklyByDay.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/ICalendarTimezoneProjectionSafety.test.ts", reportPath: "matrix-calendar-server/src/caldav/ICalendarTimezoneProjectionSafety.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/MatrixOpenIdCalDavCredentialProvider.test.ts", reportPath: "matrix-calendar-server/src/caldav/MatrixOpenIdCalDavCredentialProvider.test.ts" }),
      Object.freeze({ runnerPath: "src/caldav/readCalendarLinks.test.ts", reportPath: "matrix-calendar-server/src/caldav/readCalendarLinks.test.ts" }),
      Object.freeze({ runnerPath: "src/client/MatrixClientAdapter.test.ts", reportPath: "matrix-calendar-server/src/client/MatrixClientAdapter.test.ts" }),
      Object.freeze({ runnerPath: "src/client/MeetingClient.test.ts", reportPath: "matrix-calendar-server/src/client/MeetingClient.test.ts" }),
      Object.freeze({ runnerPath: "src/configuration.test.ts", reportPath: "matrix-calendar-server/src/configuration.test.ts" }),
      Object.freeze({ runnerPath: "src/controller/CalendarGatewayController.test.ts", reportPath: "matrix-calendar-server/src/controller/CalendarGatewayController.test.ts" }),
      Object.freeze({ runnerPath: "src/controller/RoomCalendarTarget.test.ts", reportPath: "matrix-calendar-server/src/controller/RoomCalendarTarget.test.ts" }),
      Object.freeze({ runnerPath: "src/controller/RoomReminderAlarmOptionsController.test.ts", reportPath: "matrix-calendar-server/src/controller/RoomReminderAlarmOptionsController.test.ts" }),
      Object.freeze({ runnerPath: "src/controller/RoomReminderConfigurationController.test.ts", reportPath: "matrix-calendar-server/src/controller/RoomReminderConfigurationController.test.ts" }),
      Object.freeze({ runnerPath: "src/controller/WidgetController.test.ts", reportPath: "matrix-calendar-server/src/controller/WidgetController.test.ts" }),
      Object.freeze({ runnerPath: "src/dto/CalendarEntryDto.test.ts", reportPath: "matrix-calendar-server/src/dto/CalendarEntryDto.test.ts" }),
      Object.freeze({ runnerPath: "src/dto/MeetingCreateDto.test.ts", reportPath: "matrix-calendar-server/src/dto/MeetingCreateDto.test.ts" }),
      Object.freeze({ runnerPath: "src/dto/MeetingUpdateDetailsDto.test.ts", reportPath: "matrix-calendar-server/src/dto/MeetingUpdateDetailsDto.test.ts" }),
      Object.freeze({ runnerPath: "src/dto/ParticipantDto.test.ts", reportPath: "matrix-calendar-server/src/dto/ParticipantDto.test.ts" }),
      Object.freeze({ runnerPath: "src/http/RequestBodyLimits.test.ts", reportPath: "matrix-calendar-server/src/http/RequestBodyLimits.test.ts" }),
      Object.freeze({ runnerPath: "src/model/ExternalData.test.ts", reportPath: "matrix-calendar-server/src/model/ExternalData.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/CanonicalReminderIdentityResolver.test.ts", reportPath: "matrix-calendar-server/src/reminder/CanonicalReminderIdentityResolver.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/CanonicalRoomReminderSchedulerSource.test.ts", reportPath: "matrix-calendar-server/src/reminder/CanonicalRoomReminderSchedulerSource.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/MatrixAppServiceReminderTransport.test.ts", reportPath: "matrix-calendar-server/src/reminder/MatrixAppServiceReminderTransport.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/PostgresRoomReminderStore.integration.test.ts", reportPath: "matrix-calendar-server/src/reminder/PostgresRoomReminderStore.integration.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/PostgresRoomReminderStore.test.ts", reportPath: "matrix-calendar-server/src/reminder/PostgresRoomReminderStore.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/ReminderConfigurationSourceValidator.test.ts", reportPath: "matrix-calendar-server/src/reminder/ReminderConfigurationSourceValidator.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/ReminderTrigger.test.ts", reportPath: "matrix-calendar-server/src/reminder/ReminderTrigger.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/RoomMentionMessage.test.ts", reportPath: "matrix-calendar-server/src/reminder/RoomMentionMessage.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/RoomMentionPolicy.test.ts", reportPath: "matrix-calendar-server/src/reminder/RoomMentionPolicy.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/RoomReminderAlarmOptionsService.test.ts", reportPath: "matrix-calendar-server/src/reminder/RoomReminderAlarmOptionsService.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/RoomReminderConfigurationContract.test.ts", reportPath: "matrix-calendar-server/src/reminder/RoomReminderConfigurationContract.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/RoomReminderConfigurationService.test.ts", reportPath: "matrix-calendar-server/src/reminder/RoomReminderConfigurationService.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/RoomReminderModuleProviders.test.ts", reportPath: "matrix-calendar-server/src/reminder/RoomReminderModuleProviders.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/RoomReminderScheduler.test.ts", reportPath: "matrix-calendar-server/src/reminder/RoomReminderScheduler.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/RoomReminderSchedulerRuntime.test.ts", reportPath: "matrix-calendar-server/src/reminder/RoomReminderSchedulerRuntime.test.ts" }),
      Object.freeze({ runnerPath: "src/reminder/RoomReminderStore.test.ts", reportPath: "matrix-calendar-server/src/reminder/RoomReminderStore.test.ts" }),
      Object.freeze({ runnerPath: "src/service/CalendarCommandFormatter.test.ts", reportPath: "matrix-calendar-server/src/service/CalendarCommandFormatter.test.ts" }),
      Object.freeze({ runnerPath: "src/service/CalendarCommandParser.test.ts", reportPath: "matrix-calendar-server/src/service/CalendarCommandParser.test.ts" }),
      Object.freeze({ runnerPath: "src/service/CalendarCommandService.test.ts", reportPath: "matrix-calendar-server/src/service/CalendarCommandService.test.ts" }),
      Object.freeze({ runnerPath: "src/service/CalendarCommandTrafficLimiter.test.ts", reportPath: "matrix-calendar-server/src/service/CalendarCommandTrafficLimiter.test.ts" }),
      Object.freeze({ runnerPath: "src/service/CommandContext.test.ts", reportPath: "matrix-calendar-server/src/service/CommandContext.test.ts" }),
      Object.freeze({ runnerPath: "src/service/MatrixCalendarAuthorization.test.ts", reportPath: "matrix-calendar-server/src/service/MatrixCalendarAuthorization.test.ts" }),
      Object.freeze({ runnerPath: "src/service/RoomCalendarBindingResolver.test.ts", reportPath: "matrix-calendar-server/src/service/RoomCalendarBindingResolver.test.ts" }),
      Object.freeze({ runnerPath: "src/service/RoomCalendarCalDavAccess.test.ts", reportPath: "matrix-calendar-server/src/service/RoomCalendarCalDavAccess.test.ts" }),
      Object.freeze({ runnerPath: "src/service/RoomCalendarEventAuditService.test.ts", reportPath: "matrix-calendar-server/src/service/RoomCalendarEventAuditService.test.ts" }),
      Object.freeze({ runnerPath: "src/service/RoomCalendarEventOperations.test.ts", reportPath: "matrix-calendar-server/src/service/RoomCalendarEventOperations.test.ts" }),
      Object.freeze({ runnerPath: "src/util/format.test.ts", reportPath: "matrix-calendar-server/src/util/format.test.ts" }),
      Object.freeze({ runnerPath: "src/util/getForceDeletionTime.test.ts", reportPath: "matrix-calendar-server/src/util/getForceDeletionTime.test.ts" }),
      Object.freeze({ runnerPath: "src/util/migrateMeetingTime.test.ts", reportPath: "matrix-calendar-server/src/util/migrateMeetingTime.test.ts" }),
      Object.freeze({ runnerPath: "src/validator/IsIncompatibleWithSibling.test.ts", reportPath: "matrix-calendar-server/src/validator/IsIncompatibleWithSibling.test.ts" }),
      Object.freeze({ runnerPath: "src/validator/IsOptionalIfSiblingIsUndefined.test.ts", reportPath: "matrix-calendar-server/src/validator/IsOptionalIfSiblingIsUndefined.test.ts" }),
      Object.freeze({ runnerPath: "src/validator/isMatrixRoomId.test.ts", reportPath: "matrix-calendar-server/src/validator/isMatrixRoomId.test.ts" }),
      Object.freeze({ runnerPath: "test/ArrayOps.test.ts", reportPath: "matrix-calendar-server/test/ArrayOps.test.ts" }),
      Object.freeze({ runnerPath: "test/CalendarGatewayMembershipGuard.test.ts", reportPath: "matrix-calendar-server/test/CalendarGatewayMembershipGuard.test.ts" }),
      Object.freeze({ runnerPath: "test/CommandService.test.ts", reportPath: "matrix-calendar-server/test/CommandService.test.ts" }),
      Object.freeze({ runnerPath: "test/EventContentParams.test.ts", reportPath: "matrix-calendar-server/test/EventContentParams.test.ts" }),
      Object.freeze({ runnerPath: "test/EventContentRenderer.test.ts", reportPath: "matrix-calendar-server/test/EventContentRenderer.test.ts" }),
      Object.freeze({ runnerPath: "test/EventTypeHelper.test.ts", reportPath: "matrix-calendar-server/test/EventTypeHelper.test.ts" }),
      Object.freeze({ runnerPath: "test/GuestMemberService.test.ts", reportPath: "matrix-calendar-server/test/GuestMemberService.test.ts" }),
      Object.freeze({ runnerPath: "test/MatrixServer.test.ts", reportPath: "matrix-calendar-server/test/MatrixServer.test.ts" }),
      Object.freeze({ runnerPath: "test/MeetingService.test.ts", reportPath: "matrix-calendar-server/test/MeetingService.test.ts" }),
      Object.freeze({ runnerPath: "test/RoomMatrixEventsReader.test.ts", reportPath: "matrix-calendar-server/test/RoomMatrixEventsReader.test.ts" }),
      Object.freeze({ runnerPath: "test/RoomMessageService.test.ts", reportPath: "matrix-calendar-server/test/RoomMessageService.test.ts" }),
      Object.freeze({ runnerPath: "test/StubMatrixClient.test.ts", reportPath: "matrix-calendar-server/test/StubMatrixClient.test.ts" }),
      Object.freeze({ runnerPath: "test/WelcomeWorkflowService.test.ts", reportPath: "matrix-calendar-server/test/WelcomeWorkflowService.test.ts" }),
      Object.freeze({ runnerPath: "test/WidgetLayoutConfigReader.test.ts", reportPath: "matrix-calendar-server/test/WidgetLayoutConfigReader.test.ts" }),
      Object.freeze({ runnerPath: "test/WidgetLayoutService.test.ts", reportPath: "matrix-calendar-server/test/WidgetLayoutService.test.ts" }),
      Object.freeze({ runnerPath: "test/decorator/ParamExtractor.test.ts", reportPath: "matrix-calendar-server/test/decorator/ParamExtractor.test.ts" }),
      Object.freeze({ runnerPath: "test/integration/CalDavDiscoveryContract.test.ts", reportPath: "matrix-calendar-server/test/integration/CalDavDiscoveryContract.test.ts" }),
      Object.freeze({ runnerPath: "test/integration/CalDavEventRoundTripContract.test.ts", reportPath: "matrix-calendar-server/test/integration/CalDavEventRoundTripContract.test.ts" }),
      Object.freeze({ runnerPath: "test/integration/CalendarDiagnosticsContract.test.ts", reportPath: "matrix-calendar-server/test/integration/CalendarDiagnosticsContract.test.ts" }),
      Object.freeze({ runnerPath: "test/integration/PersonalOpenIdRadicaleContract.test.ts", reportPath: "matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts" }),
      Object.freeze({ runnerPath: "test/integration/RoomAppServiceRadicaleContract.test.ts", reportPath: "matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts" }),
      Object.freeze({ runnerPath: "test/integration/RoomReminderDeliveryContract.test.ts", reportPath: "matrix-calendar-server/test/integration/RoomReminderDeliveryContract.test.ts" }),
      Object.freeze({ runnerPath: "test/middleware/CalendarGatewayRateLimitMiddleware.test.ts", reportPath: "matrix-calendar-server/test/middleware/CalendarGatewayRateLimitMiddleware.test.ts" }),
      Object.freeze({ runnerPath: "test/middleware/MatrixAuthMiddleware.test.ts", reportPath: "matrix-calendar-server/test/middleware/MatrixAuthMiddleware.test.ts" }),
      Object.freeze({ runnerPath: "test/util/IMeetingChanges.test.ts", reportPath: "matrix-calendar-server/test/util/IMeetingChanges.test.ts" }),
      Object.freeze({ runnerPath: "test/util/MatrixApplicationServiceFixtureUser.test.ts", reportPath: "matrix-calendar-server/test/util/MatrixApplicationServiceFixtureUser.test.ts" }),
      Object.freeze({ runnerPath: "test/util/TemplateHelper.test.ts", reportPath: "matrix-calendar-server/test/util/TemplateHelper.test.ts" }),
      Object.freeze({ runnerPath: "test/util/extractOxRrule.test.ts", reportPath: "matrix-calendar-server/test/util/extractOxRrule.test.ts" }),
    ]),
  }),
  'attachment-widget': Object.freeze({
    runner: 'vitest',
    suites: Object.freeze([
      Object.freeze({ runnerPath: "src/calendar/calendarEventForm.test.ts", reportPath: "matrix-calendar-widget/src/calendar/calendarEventForm.test.ts" }),
      Object.freeze({ runnerPath: "src/components/calendar/CalendarEventEditorDialog.test.tsx", reportPath: "matrix-calendar-widget/src/components/calendar/CalendarEventEditorDialog.test.tsx" }),
    ]),
  }),
  'text-widget': Object.freeze({
    runner: 'vitest',
    suites: Object.freeze([
      Object.freeze({ runnerPath: "src/calendar/calendarEventForm.test.ts", reportPath: "matrix-calendar-widget/src/calendar/calendarEventForm.test.ts" }),
      Object.freeze({ runnerPath: "src/components/calendar/CalendarEventEditorDialog.test.tsx", reportPath: "matrix-calendar-widget/src/components/calendar/CalendarEventEditorDialog.test.tsx" }),
    ]),
  }),
});

const SOURCE_PATH_PREFIXES = Object.freeze({
  jest: Object.freeze([
    'matrix-calendar-server/src/',
    'matrix-calendar-server/test/',
    'packages/calendar/src/',
    'packages/ical-timezones/src/',
  ]),
  vitest: Object.freeze([
    'matrix-calendar-widget/src/',
    'packages/calendar/src/',
    'packages/ical-timezones/src/',
  ]),
});
const MAX_REPORT_BYTES = 20 * 1024 * 1024;
const MAX_AGGREGATE_ASSERTIONS = 25_000;
const MAX_DIAGNOSTIC_STRINGS = 256;
const MAX_DIAGNOSTIC_STRING_LENGTH = 250_000;
const MAX_REPORTED_LOCATIONS = 40;
const MAX_REPORTED_FAILED_TEST_LOCATIONS = 40;
const MAX_REPORTED_TYPESCRIPT_CODES = 20;
const UNAVAILABLE_REPORT_SHAPE = 'diagnostic-unavailable code=report-shape';

function canonicalPathFromReport(value, allowedSuites) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replaceAll('\\', '/');

  for (const suite of allowedSuites) {
    const path = suite.reportPath;
    const workspaceRelative = path.replace(/^[^/]+\//, '');
    if (
      normalized === path ||
      normalized.endsWith('/' + path) ||
      normalized === workspaceRelative ||
      normalized.endsWith('/' + workspaceRelative)
    ) {
      return path;
    }
  }

  return undefined;
}

function addBoundedMessage(messages, value) {
  if (typeof value !== 'string') return true;
  if (
    messages.length >= MAX_DIAGNOSTIC_STRINGS ||
    value.length > MAX_DIAGNOSTIC_STRING_LENGTH
  ) {
    return false;
  }
  messages.push(value);
  return true;
}

function collectFailureMessages(testResult, messages, runner) {
  if (!addBoundedMessage(messages, testResult.failureMessage)) return false;
  if (runner === 'vitest' && !addBoundedMessage(messages, testResult.message)) return false;
  if (Array.isArray(testResult.failureMessages)) {
    for (const message of testResult.failureMessages) {
      if (!addBoundedMessage(messages, message)) return false;
    }
  }
  const executionError = testResult.testExecError;
  if (executionError !== undefined) {
    if (!executionError || typeof executionError !== 'object') return false;
    if (!addBoundedMessage(messages, executionError.message)) return false;
    if (!addBoundedMessage(messages, executionError.stack)) return false;
    if (Array.isArray(executionError.failureMessages)) {
      for (const message of executionError.failureMessages) {
        if (!addBoundedMessage(messages, message)) return false;
      }
    }
  }
  if (!Array.isArray(testResult.assertionResults)) return false;
  for (const assertion of testResult.assertionResults) {
    if (!assertion || typeof assertion !== 'object') return false;
    if (assertion.status !== 'failed') continue;
    if (assertion.failureMessages !== undefined) {
      if (!Array.isArray(assertion.failureMessages)) return false;
      for (const message of assertion.failureMessages) {
        if (!addBoundedMessage(messages, message)) return false;
      }
    }
  }
  return true;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
}

function canonicalSourcePath(value, runner) {
  let normalized = value.replaceAll('\\', '/');
  normalized = normalized.replace(/^(?:\.\.\/)+(?=packages\/)/, '');
  if (normalized.startsWith('src/')) {
    normalized = (runner === 'jest' ? 'matrix-calendar-server/' : 'matrix-calendar-widget/') + normalized;
  } else if (normalized.startsWith('test/') && runner === 'jest') {
    normalized = 'matrix-calendar-server/' + normalized;
  }
  if (normalized.split('/').some((segment) => segment === '.' || segment === '..')) return undefined;
  if (!SOURCE_PATH_PREFIXES[runner]?.some((prefix) => normalized.startsWith(prefix))) return undefined;
  if (!/\.(?:ts|tsx)$/.test(normalized)) return undefined;
  return normalized;
}

function extractApprovedDiagnostics(messages, runner) {
  const locations = new Set();
  const typescriptCodes = new Set();
  const sourceLocationPattern = /(?:^|\/)((?:(?:\.\.\/)*)(?:matrix-calendar-server\/(?:src|test)|matrix-calendar-widget\/src|packages\/(?:calendar|ical-timezones)\/src|src|test)\/[A-Za-z0-9_.\/-]+\.(?:ts|tsx)):(\d+)(?::\d+)?(?=\D|$)/g;

  for (const message of messages) {
    for (const match of message.matchAll(/\bTS\d{3,5}\b/g)) typescriptCodes.add(match[0]);
    const normalized = message.replaceAll('\\', '/');
    for (const match of normalized.matchAll(sourceLocationPattern)) {
      const path = canonicalSourcePath(match[1], runner);
      const line = Number(match[2]);
      if (path && Number.isSafeInteger(line) && line > 0) locations.add(path + ':' + line);
    }
  }
  return {
    locations: [...locations].sort().slice(0, MAX_REPORTED_LOCATIONS),
    typescriptCodes: [...typescriptCodes].sort().slice(0, MAX_REPORTED_TYPESCRIPT_CODES),
  };
}

function summarizeReport(candidate, report, testExitCode) {
  const target = TARGETS[candidate];
  const targetPaths = target && target.suites;
  if (
    !targetPaths ||
    !Number.isInteger(testExitCode) ||
    testExitCode < 0 ||
    testExitCode > 255 ||
    !report ||
    typeof report !== 'object' ||
    !Array.isArray(report.testResults) ||
    report.testResults.length === 0 ||
    report.testResults.length > targetPaths.length
  ) return [UNAVAILABLE_REPORT_SHAPE];

  const allowedSuites = targetPaths;
  const suitePaths = [];
  const failedTestLocations = new Set();
  const messages = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let failedSuites = 0;
  let aggregateAssertions = 0;

  for (const testResult of report.testResults) {
    if (!testResult || typeof testResult !== 'object') return [UNAVAILABLE_REPORT_SHAPE];
    const suitePath = canonicalPathFromReport(testResult.name, allowedSuites);
    if (!suitePath || suitePaths.includes(suitePath)) return ['diagnostic-unavailable code=unapproved-suite'];
    suitePaths.push(suitePath);
    if (!Array.isArray(testResult.assertionResults)) return [UNAVAILABLE_REPORT_SHAPE];
    aggregateAssertions += testResult.assertionResults.length;
    if (aggregateAssertions > MAX_AGGREGATE_ASSERTIONS || !collectFailureMessages(testResult, messages, target.runner)) {
      return [UNAVAILABLE_REPORT_SHAPE];
    }

    let suiteAssertionFailures = 0;
    for (const assertion of testResult.assertionResults) {
      switch (assertion.status) {
        case 'passed': passed += 1; break;
        case 'failed': {
          failed += 1;
          suiteAssertionFailures += 1;
          const line = assertion.location && assertion.location.line;
          if (Number.isSafeInteger(line) && line > 0 &&
              (failedTestLocations.size < MAX_REPORTED_FAILED_TEST_LOCATIONS || failedTestLocations.has(suitePath + ':' + line))) {
            failedTestLocations.add(suitePath + ':' + line);
          }
          break;
        }
        case 'pending':
        case 'todo':
        case 'disabled':
        case 'skipped': skipped += 1; break;
        default: return [UNAVAILABLE_REPORT_SHAPE];
      }
    }

    if (testResult.status === 'failed') {
      failedSuites += 1;
      if (suiteAssertionFailures === 0) {
        failed += 1;
        if (failedTestLocations.size < MAX_REPORTED_FAILED_TEST_LOCATIONS) failedTestLocations.add(suitePath);
      }
    } else if (testResult.status !== 'passed' && testResult.status !== 'pending' && testResult.status !== 'skipped') {
      return [UNAVAILABLE_REPORT_SHAPE];
    }
  }

  const diagnostics = extractApprovedDiagnostics(messages, target.runner);
  const lines = [
    'approved suites: ' + suitePaths.sort().join(', '),
    'tests: passed=' + passed + ' failed=' + failed + ' skipped=' + skipped + '; failed-suites=' + failedSuites,
  ];
  if (failedTestLocations.size > 0) {
    lines.push('failed test source locations:');
    for (const location of [...failedTestLocations].sort()) lines.push('- ' + location);
  }
  if (diagnostics.locations.length > 0) {
    lines.push('approved source frames:');
    for (const location of diagnostics.locations) lines.push('- ' + location);
  }
  if (diagnostics.typescriptCodes.length > 0) lines.push('TypeScript codes: ' + diagnostics.typescriptCodes.join(', '));
  return lines;
}

function runSelfTests() {
  const candidate = 'alarm-server';
  const suitePath =
    '/runner/work/project/project/matrix-calendar-server/src/caldav/ICalendarEventCodec.test.ts';
  const sentinel = 'PRIVATE_TITLE_MESSAGE_ASSERTION_VALUE_CREDENTIAL';
  const report = {
    testResults: [
      {
        name: suitePath,
        status: 'failed',
        assertionResults: [
          {
            title: sentinel,
            fullName: sentinel,
            status: 'failed',
            location: { line: 123, column: 9 },
            failureMessages: [
              sentinel +
                '\n    at /runner/work/project/project/matrix-calendar-widget/matrix-calendar-server/src/caldav/ICalendarEventCodec.ts:456:8\nerror TS2339: ' +
                sentinel,
            ],
          },
        ],
        failureMessage: sentinel,
        testExecError: { message: sentinel, stack: sentinel },
      },
    ],
  };
  const output = summarizeReport(candidate, report, 1).join('\n');
  assert.match(
    output,
    /matrix-calendar-server\/src\/caldav\/ICalendarEventCodec\.test\.ts:123/,
  );
  assert.match(
    output,
    /matrix-calendar-server\/src\/caldav\/ICalendarEventCodec\.ts:456/,
  );
  assert.match(output, /TypeScript codes: TS2339/);
  assert.equal(output.includes(sentinel), false);
  assert.equal(output.includes('title:'), false);
  assert.equal(output.includes('stack'), false);
  assert.equal(output.includes('expected'), false);

  assert.deepEqual(
    summarizeReport('alarm-server', { testResults: {} }, 1),
    [UNAVAILABLE_REPORT_SHAPE],
  );
  assert.deepEqual(
    summarizeReport(
      'alarm-server',
      {
        testResults: [
          {
            name: '/private/attacker/secret-suite.test.ts',
            status: 'failed',
            assertionResults: [],
          },
        ],
      },
      1,
    ),
    ['diagnostic-unavailable code=unapproved-suite'],
  );

  const oversizedAssertions = summarizeReport(
    candidate,
    {
      testResults: [
        {
          name: suitePath,
          status: 'passed',
          assertionResults: Array.from(
            { length: MAX_AGGREGATE_ASSERTIONS + 1 },
            () => ({
              status: 'passed',
              failureMessages: [],
            }),
          ),
        },
      ],
    },
    0,
  );
  assert.deepEqual(oversizedAssertions, [UNAVAILABLE_REPORT_SHAPE]);

  const manyFailedAssertions = summarizeReport(
    candidate,
    {
      testResults: [
        {
          name: suitePath,
          status: 'failed',
          assertionResults: Array.from(
            { length: MAX_REPORTED_FAILED_TEST_LOCATIONS + 1 },
            (_, index) => ({
              status: 'failed',
              location: { line: index + 1 },
              failureMessages: [],
            }),
          ),
        },
      ],
    },
    1,
  ).join('\n');
  assert.equal(
    (
      manyFailedAssertions.match(
        /matrix-calendar-server\/src\/caldav\/ICalendarEventCodec\.test\.ts:\d+/g,
      ) || []
    ).length,
    MAX_REPORTED_FAILED_TEST_LOCATIONS,
  );

  const passing = summarizeReport(
    candidate,
    {
      testResults: [
        {
          name: suitePath,
          status: 'passed',
          assertionResults: [
            {
              title: sentinel,
              fullName: sentinel,
              status: 'passed',
              failureMessages: [],
            },
          ],
        },
      ],
    },
    0,
  ).join('\n');
  assert.equal(passing.includes(sentinel), false);
  assert.match(passing, /tests: passed=1 failed=0 skipped=0/);

  const widgetSuitePath =
    '/runner/work/project/project/matrix-calendar-widget/src/components/calendar/CalendarEventEditorDialog.test.tsx';
  const widgetSentinel = 'PRIVATE_VITEST_TITLE_MESSAGE_META_ASSERTION_VALUE';
  const vitestReport = {
    testResults: [
      {
        name: widgetSuitePath,
        status: 'failed',
        message:
          widgetSentinel +
          '\n    at /runner/work/project/project/matrix-calendar-widget/src/components/calendar/CalendarEventEditorDialog.tsx:456:8\nerror TS2345: ' +
          widgetSentinel,
        meta: { privateValue: widgetSentinel },
        assertionResults: [
          {
            title: widgetSentinel,
            fullName: widgetSentinel,
            status: 'failed',
            location: { line: 321, column: 7 },
            failureMessages: [widgetSentinel],
          },
        ],
      },
    ],
  };
  const vitestOutput = summarizeReport('attachment-widget', vitestReport, 1).join('\n');
  assert.equal(
    vitestOutput.includes('matrix-calendar-widget/src/components/calendar/CalendarEventEditorDialog.test.tsx:321'),
    true,
  );
  assert.equal(
    vitestOutput.includes('matrix-calendar-widget/src/components/calendar/CalendarEventEditorDialog.tsx:456'),
    true,
  );
  assert.equal(vitestOutput.includes('TypeScript codes: TS2345'), true);
  assert.equal(vitestOutput.includes(widgetSentinel), false);
  assert.equal(vitestOutput.includes('fullName:'), false);
  assert.equal(vitestOutput.includes('meta:'), false);

  const skippedOutput = summarizeReport(
    'text-widget',
    {
      testResults: [
        {
          name: '/runner/work/project/project/matrix-calendar-widget/src/calendar/calendarEventForm.test.ts',
          status: 'skipped',
          assertionResults: [{ status: 'skipped', failureMessages: [] }],
        },
      ],
    },
    0,
  ).join('\n');
  assert.match(skippedOutput, /tests: passed=0 failed=0 skipped=1/);

}

function main(argv) {
  const command = argv[0];
  const candidate = argv[1];
  const reportPath = argv[2];
  const exitCodeText = argv[3];

  if (command === 'self-test') {
    runSelfTests();
    process.stdout.write('safe-test-locator-self-test passed\n');
    return;
  }

  if (command === 'paths') {
    const target = TARGETS[candidate];
    if (!target) {
      process.stdout.write('diagnostic-unavailable code=target-map\n');
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      target.suites.map(({ runnerPath }) => runnerPath).join('\n') + '\n',
    );
    return;
  }

  if (command === 'summarize') {
    const testExitCode = /^(0|[1-9][0-9]{0,2})$/.test(exitCodeText || '')
      ? Number(exitCodeText)
      : Number.NaN;
    if (!TARGETS[candidate] || !reportPath) {
      process.stdout.write('diagnostic-unavailable code=invocation\n');
      process.exitCode = 1;
      return;
    }

    let report;
    try {
      const reportStats = statSync(reportPath);
      if (!reportStats.isFile() || reportStats.size > MAX_REPORT_BYTES) {
        throw new Error('report-size-limit');
      }
      report = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch {
      process.stdout.write(UNAVAILABLE_REPORT_SHAPE + '\n');
      process.exitCode = 1;
      return;
    }

    const lines = summarizeReport(candidate, report, testExitCode);
    process.stdout.write(lines.join('\n') + '\n');
    if (lines.length === 1 && lines[0].startsWith('diagnostic-unavailable')) {
      process.exitCode = 1;
    }
    return;
  }

  process.stdout.write('diagnostic-unavailable code=invocation\n');
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    main(process.argv.slice(2));
  } catch {
    process.stdout.write(UNAVAILABLE_REPORT_SHAPE + '\n');
    process.exitCode = 1;
  }
}
