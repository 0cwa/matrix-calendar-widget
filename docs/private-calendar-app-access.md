# Connect a private calendar app

Private external CalDAV access is in development, disabled by default, and not
deployed. Use these steps only if the operator confirms that the installed
build is qualified and this feature has been enabled. The branch validation
record describes local checks and remaining acceptance gates; it is not a
deployment qualification. See the [validation record](./private-calendar-app-access-validation.md).

The widget lets a user create a separate CalDAV credential for one personal or
room calendar. It does not reveal or store the user's Matrix password. When
the feature is available in your installation:

1. Open **Calendar app access** beside **Public feed** in the calendar toolbar.
2. Select a calendar and choose **Create app access**.
3. In the calendar app, choose CalDAV and enter the displayed URL, username,
   and app password. Save the app password in the operating system's
   credential manager.
4. Save the setup details in the calendar app's credential manager. The
   password is shown once and cannot be recovered from the widget.

Each credential expires after 90 days. The widget lists its
creation time, expiry, and state. To replace a credential, create a new one,
update the calendar app, then revoke the old one. Revocation blocks future
access; it cannot remove calendar data the app has already downloaded. A lost
one-time password must be replaced, not recovered.

For room calendars, access will continue to follow current room calendar
policy. Use the app-specific password only in the calendar app; never enter a
Matrix password in a CalDAV client.
