# Free/busy privacy boundary

## Initial product scope

The current product does not expose a separate free/busy or availability
endpoint, response model, or `VFREEBUSY` projection. A time-range event query
still returns event details; it is not a busy-only view. Do not use the event
API as an availability feed or describe its output as free/busy data.

Event content is sensitive. The current iCalendar codec populates gateway
event responses with titles, descriptions, timing, status, transparency,
locations, URLs, categories, and priority. The domain type also has a
recurrence field, but the current codec does not decode recurrence into the
response. Repository security guidance also treats attendee and free/busy
information as sensitive; the current gateway event DTO does not expose an
attendee list.

## Source audit

This is a read-only source audit of repository baseline
`270526bc244b69ab2d6b6ab46584aa3bf98d3a19`. It is not a runtime test and does
not prove deployment behavior.

- `matrix-calendar-server/src/controller/CalendarGatewayController.ts`
  exposes versioned `GET calendar/events` and `GET calendar/event` routes.
  Both use the controller's Matrix authentication and room-membership guards,
  require a room context, and call the `read-events` authorization action
  before CalDAV access.
- `matrix-calendar-server/src/service/MatrixCalendarAuthorization.ts`
  currently allows `read-events` after confirming the user is a joined member
  of that room. This source audit does not establish a room-to-calendar
  binding: that is a separate planned M6 slice. Do not interpret this document
  as proof that every CalDAV calendar is isolated to a Matrix room.
- `matrix-calendar-server/src/caldav/CalDavEventClient.ts` filters resources
  by VEVENT and time range in a bounded CalDAV `calendar-query`, then requests
  `calendar-data` for matching resources; the query does not include a
  component selector that limits the returned `calendar-data` to VEVENT.
  Single-event reads fetch the iCalendar resource. The gateway maps those
  resources to `CalendarGatewayEventDto`, which contains the decoded
  `CalendarEvent` and its ETag.
- `matrix-calendar-server/src/caldav/ICalendarEventCodec.ts` populates that
  decoded event with supported detail fields but does not decode recurrence.
  `packages/calendar/src/model/calendar.ts` defines a recurrence field and
  represents event time ranges. The source audit found no free/busy or
  `VFREEBUSY` route or response model.

## Gate for future availability support

Any free/busy or availability feature needs a separate product and privacy
decision before implementation. That decision must define the room and
calendar scope, who may query it, the permitted time range and resolution, the
disclosure level (for example, busy spans without event details), recurrence
and timezone behavior, and logging, caching, and retention limits. The server
must enforce the approved authorization policy and return only the approved
minimum data. Add focused authorization and projection tests before exposing a
new route or response.
