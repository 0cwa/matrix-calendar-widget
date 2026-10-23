# Matrix Calendar Widget

A team calendar for Matrix rooms, with a widget for Element and calendar data stored in Radicale through CalDAV. Create and edit events, manage calendars, and share a room calendar without giving the widget your Matrix password. A `!calendar` bot provides a fallback for clients without widgets.

**Pre-alpha.** The controlled pilot targets Element Web and Desktop. The implementation is usable for development, but target deployment and recovery acceptance remain incomplete. See [project status](./docs/STATUS.md) for implemented features and [release evidence](./docs/RELEASE.md) for the exact source that has been qualified.

## Screenshots

These are captures of the actual widget calendar components using **fictional example events**, not a connected Matrix room or a live CalDAV installation. Dates are fixed to October 2026 so future captures are comparable. Each screenshot combines the **same view in light and dark mode**, split diagonally from bottom-left to top-right (light in the upper-left, dark in the lower-right).

<table>
  <tr>
    <td width="50%" align="center"><a href="https://raw.githubusercontent.com/0cwa/matrix-calendar-widget/readme-gallery/images/month-desktop.png"><img src="https://raw.githubusercontent.com/0cwa/matrix-calendar-widget/readme-gallery/images/month-desktop.png" alt="Month view of a project team calendar with example events" width="520" /></a><br /><strong>Month view</strong></td>
    <td width="50%" align="center"><a href="https://raw.githubusercontent.com/0cwa/matrix-calendar-widget/readme-gallery/images/event-details.png"><img src="https://raw.githubusercontent.com/0cwa/matrix-calendar-widget/readme-gallery/images/event-details.png" alt="Calendar event details with time, description and location" width="520" /></a><br /><strong>Event details</strong></td>
  </tr>
  <tr>
    <td width="50%" align="center"><a href="https://raw.githubusercontent.com/0cwa/matrix-calendar-widget/readme-gallery/images/mobile-list.png"><img src="https://raw.githubusercontent.com/0cwa/matrix-calendar-widget/readme-gallery/images/mobile-list.png" alt="List of calendar events in a narrow widget" width="520" /></a><br /><strong>Narrow list view</strong></td>
    <td width="50%" align="center"><a href="https://raw.githubusercontent.com/0cwa/matrix-calendar-widget/readme-gallery/images/mobile-create.png"><img src="https://raw.githubusercontent.com/0cwa/matrix-calendar-widget/readme-gallery/images/mobile-create.png" alt="Create event dialog on a narrow screen" width="520" /></a><br /><strong>Create event</strong></td>
  </tr>
</table>

To refresh the images after UI changes, open [Refresh README gallery](https://github.com/0cwa/matrix-calendar-widget/actions/workflows/readme-gallery.yml) under GitHub Actions and select **Run workflow** on `main`. The workflow renders sanitized demo data and updates the dedicated [`readme-gallery` image branch](https://github.com/0cwa/matrix-calendar-widget/tree/readme-gallery); no deployment, credentials, or PR is needed. These screenshots show the browser fixture, not Element integration or production acceptance.

## Start here

| I want to…                                 | Read                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Use a calendar in my Matrix room           | [User guide](./docs/user-guide.md) and [room setup / bot commands](./docs/bot-calendar.md)             |
| Run the code and make a first contribution | [Development guide](./docs/DEVELOPMENT.md) and [contributing](./CONTRIBUTING.md)                       |
| Understand how the code fits together      | [Architecture](./docs/ARCHITECTURE.md) and [data model](./docs/data-model.md)                          |
| Configure or operate an installation       | [Deployment guide](./docs/deployment-docker.md) and [configuration reference](./docs/configuration.md) |
| Find supported features and upcoming work  | [Current status](./docs/STATUS.md) and [roadmap](./docs/ROADMAP.md)                                    |
| Browse all documentation                   | [Documentation index](./docs/README.md)                                                                |

## What it does

- **View and edit events** in list, day, work-week, week, and month views, including timed and all-day events, timezones, and a supported subset of recurring events.
- **Manage event calendars:** create, rename, set description and color, choose visible calendars, and safely delete supported calendars. Existing mixed collections retain their non-event data.
- **Connect calendars to Matrix rooms** with server-enforced membership and permissions. Operators can enable a moderator-led `!calendar setup` flow.
- **Configure room reminders** for supported alarms in unencrypted rooms. Reminder configuration, delivery, event writes, and room setup are independently enabled by the operator.
- **Publish an optional public subscription feed** for an event-only calendar. Anyone with the link can read its events; unpublishing stops future reads. Public subscriptions are read-only.
- **Use bot commands** to list, inspect, create, and delete events when the widget is unavailable.

Supported edits preserve unrecognized iCalendar data and use ETags to detect concurrent changes. The widget displays a bounded projection of the source calendar: unsupported recurrence or timezone forms may be absent from the view, so it is not a complete export.

Private external CalDAV editing, arbitrary recurrence authoring, attendee/email workflows, and mobile-client certification remain outside the current supported scope. Selected-member and all-day Matrix reminder delivery is being developed separately; it is not included in the documented `main` baseline. See [feature status and limits](./docs/STATUS.md#implemented-on-main).

## Run locally

Use **Node.js 22.12 or newer** and the pinned **Yarn Classic 1.22.22**. CI uses Node 22.

```bash
git clone https://github.com/0cwa/matrix-calendar-widget.git
cd matrix-calendar-widget
corepack enable
yarn install --frozen-lockfile
yarn dev
```

This starts the Vite development server. The application needs a Matrix widget host and a configured calendar gateway for real calendars; opening the URL alone does not create a working backend. The [development guide](./docs/DEVELOPMENT.md) explains configuration, focused tests, and the [local Synapse/Radicale stack](./dev/README.md). If your Node installation does not provide Corepack, install Yarn Classic 1.22.22 before running the commands.

## Repository map

| Directory                                                    | Responsibility                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [Widget](./matrix-calendar-widget/README.md)                 | React/TypeScript widget and calendar UI                                 |
| [Server](./matrix-calendar-server/README.md)                 | NestJS gateway, Matrix authorization, CalDAV access, bot, and reminders |
| [Calendar package](./packages/calendar/README.md)            | Calendar domain, repository interfaces, iCalendar and recurrence logic  |
| [Timezone package](./packages/ical-timezones/README.md)      | Bundled timezone data and provenance                                    |
| [Radicale auth](./radicale-auth/README.md)                   | Project-owned Radicale OpenID authentication module                     |
| [Local services](./dev/README.md) and [E2E](./e2e/README.md) | Local services, integration contracts, and browser acceptance           |
| [Documentation](./docs/README.md)                            | User, developer, operator, and design documentation                     |

Radicale is the source of truth for calendar objects. PostgreSQL holds separate application state such as reminder delivery and optional room bindings. Matrix provides identity and room policy. The [architecture guide](./docs/ARCHITECTURE.md) explains those boundaries and the remaining inherited server code.

## Contributing

Start with a small change, follow the [contribution guide](./CONTRIBUTING.md), and run the checks relevant to it. Bug reports should include reproduction steps and synthetic calendar examples with private data removed. Report security issues using the [security policy](./SECURITY.md).

## Origin and license

This project is a hard fork of Nordeck's NeoDateFix / `matrix-meetings`. We retain its attribution and reuse its Matrix integration, calendar UI, and testing foundations while making CalDAV canonical. See [upstream provenance and sync policy](./docs/UPSTREAM.md).

Licensed under [Apache-2.0](./LICENSE). Retain the applicable [NOTICE](./NOTICE), copyright, and attribution when reusing inherited code.
