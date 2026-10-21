# Connect a calendar app

The widget can create a separate CalDAV app credential for one personal or
room calendar. The credential grants that app access to the selected calendar;
it does not reveal or store your Matrix password.

1. Open **Calendar app access** beside **Public feed** in the calendar toolbar.
2. Select a calendar and choose **Create app access**.
3. In your calendar app, choose CalDAV and enter the displayed URL, username,
   and app password. Save the app password in your operating system's
   credential manager.
4. Keep the setup details until the calendar app has accepted them. The
   password is shown once and cannot be recovered from the widget.

Each entry expires after 90 days. The widget lists its creation time, expiry,
and current state. To replace an entry, create a new one, update the calendar
app, then revoke the old entry. Revocation blocks future access; it cannot
remove calendar data the app has already downloaded. If you lose the one-time
password, create a replacement instead of trying to recover it.

For room calendars, access continues to follow current room calendar policy.
Use the app-specific password only in the calendar app; never enter your Matrix
password in a CalDAV client.
