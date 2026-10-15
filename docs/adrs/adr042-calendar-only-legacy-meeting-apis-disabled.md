# ADR042: Disable legacy meeting APIs for the calendar pilot

- Status: Accepted
- Date: 2026-10-15
- Supersedes: the initial HTTP-only scope for this decision
- Preserves: ADR006, ADR010, ADR014, ADR015, ADR024, ADR030, and ADR041

## Context

The calendar product uses the authenticated calendar gateway and the bounded
`!calendar` bot fallback. The inherited `MeetingController` also registers
HTTP create, update, close, and sharing-information routes plus Matrix RPC
handlers for legacy meeting events. The HTTP membership guard reads only a
room ID from the request path or query; the create route accepts
`parent_room_id` in its JSON body and the service reaches bot-backed Matrix
room creation without that guard checking the body value.

The Matrix RPC handlers remain registered in Nest, but the calendar-only pilot
does not use the old meeting event contract. Preserving their service behavior
would leave a path from a legacy room event to room creation and other Matrix
writes. The controller guard can close both transports before a handler or
service call while retaining implementation code for rollback and later
retirement under #277.

The old `!meeting setup` command also asks the bot to write widget and layout
state into a separate original room. Its welcome-room marker is mutable room
state: `createPrivateRoom()` uses the Matrix SDK's `trusted_private_chat`
preset, whose contract gives invitees the creator's power. Therefore the
marker's `userId` cannot prove which user authorized a setup request. The new
calendar widget and `!calendar` fallback do not depend on this command.

Two other legacy paths can create private Matrix rooms outside the meeting
controller. The welcome workflow creates a private help room after an invite to
a non-direct room, and the RPC exception filter can create an error room when
event processing fails. Both paths already have environment gates. For the
calendar-only pilot, `ENABLE_WELCOME_WORKFLOW` and
`ENABLE_PRIVATE_ROOM_ERROR_SENDING` default to `false`; operators can explicitly
opt into those legacy behaviors. The existing autojoin mixin continues to join
ordinary bot invites while the welcome workflow is disabled.

## Decision

1. Deny every HTTP request handled by `MeetingController` with a generic 404.
   The HTTP guard runs before authentication, membership lookup, controller
   methods, meeting services, or Matrix writes.
2. Deny every RPC execution context for `MeetingController`. The class-level
   guard returns false before any inherited meeting event handler can invoke a
   service. Keep the controller implementation and event decorators for
   rollback and later retirement, but these meeting events are unreachable in
   the pilot.
3. If the legacy `!meeting` command gate is explicitly enabled, recognize
   `!meeting setup` only to return a localized disabled-command response. With
   the default-off gate, legacy commands are ignored. Do not call
   `WelcomeWorkflowService.handleAddWidgetCommand`; the mutable welcome-room
   marker is not a sound authorization source. Remove setup from legacy help.
   Preserve `!calendar` and its existing gates.
4. Keep `MatrixRoomMembershipGuard` unchanged for other controllers. Do not add
   new runtime feature flags or alter Matrix identity, room bindings, OpenID,
   CalDAV, reminder, or calendar command contracts.
5. Treat the old HTTP and Matrix meeting APIs and the widget-setup command as
   incompatible with the calendar-only pilot. Issue #277 owns later removal of
   the old controllers and services after the pilot gate.
6. Default the existing welcome-workflow and RPC private-error-room gates to
   `false`. Preserve their explicit environment opt-ins for compatibility, and
   preserve ordinary bot invite joins through the existing autojoin mixin.

## Consequences

- `/v1/meeting/create`, `/v1/meeting/update`, `/v1/meeting/close`, and
  `/v1/meeting/:roomId/sharingInformation` return 404 before membership lookup
  or meeting-service calls, including create requests with a body-only parent
  room ID.
- Every legacy Matrix meeting RPC handler is stopped before its service can
  create a room, update meeting state, or send Matrix events.
- With the legacy command workflow explicitly enabled, `!meeting setup`
  produces a localized disabled response without invoking the legacy widget-write
  service. With the default-off gate, legacy commands are ignored. Help no longer
  advertises setup.
- Legacy welcome-help-room creation and RPC private-error-room creation are off
  by default. Setting their existing environment variables to `true` opts into
  those behaviors; ordinary bot invite joins and `!calendar` remain available.
- The Matrix controller guard does not establish a permission model for the
  retained legacy implementation; it makes those entry points unavailable in
  the pilot.
- Calendar gateway routes, reminder endpoints, and `!calendar` keep their
  existing behavior and authorization sequence.

## Validation

The controller contract exercises legacy HTTP create, update, close, and
sharing-information requests and proves each returns 404 before membership or
meeting-service calls. It also passes every registered legacy RPC handler
through Nest's guard consumer and proves the guard denies dispatch before any
meeting-service call. The command contract proves `!meeting setup` returns the
disabled response without calling the service and that help no longer lists
the command. Calendar gateway and `!calendar` tests cover the supported paths.

Configuration, exception-filter, welcome-workflow, and autojoin tests cover the default-off room-creation paths and the preserved ordinary invite join.
