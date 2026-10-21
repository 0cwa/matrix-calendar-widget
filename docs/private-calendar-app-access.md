# Connect a calendar app (in development)

Private external CalDAV access is under development on a separate source
branch; it is not available on current main and is not ready for deployment.
The backend and widget checks and combined map-plus-token Radicale contract
pass locally at source `867ef236`; actual desktop-app acceptance, real
Matrix-policy integration, and same-database migration coexistence remain
open. See the [branch validation record](./private-calendar-app-access-validation.md).
Keep `MATRIX_CALENDAR_PRIVATE_CLIENTS_ENABLED` disabled.

The intended workflow will let a user create a separate CalDAV credential for
one personal or room calendar. It will not reveal or store the user's Matrix
password. After the feature is released:

1. Open **Calendar app access** beside **Public feed** in the calendar toolbar.
2. Select a calendar and choose **Create app access**.
3. In the calendar app, choose CalDAV and enter the displayed URL, username,
   and app password. Save the app password in the operating system's
   credential manager.
4. Keep the setup details until the calendar app has accepted them. The
   password is shown once and cannot be recovered from the widget.

The current design expires each credential after 90 days. The widget lists its
creation time, expiry, and state. To replace a credential, create a new one,
update the calendar app, then revoke the old one. Revocation blocks future
access; it cannot remove calendar data the app has already downloaded. A lost
one-time password must be replaced, not recovered.

For room calendars, access will continue to follow current room calendar
policy. Use the app-specific password only in the calendar app; never enter a
Matrix password in a CalDAV client.
