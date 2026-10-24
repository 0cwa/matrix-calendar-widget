# Copyright 2026 Matrix Calendar Widget contributors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Exercise Thunderbird's native read-only ICS provider against a public feed."""

from __future__ import annotations

import http.client
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import urllib.parse


API_ORIGIN = os.environ.get("MCW_PUBLIC_ICS_API_ORIGIN", "")
PUBLIC_URL = os.environ.get("MCW_PUBLIC_ICS_URL", "")
try:
    CONTROL_PORT = int(os.environ.get("MCW_PUBLIC_ICS_CONTROL_PORT", "0"))
except ValueError:
    CONTROL_PORT = 0
CONTROL_KEY = os.environ.get("MCW_PUBLIC_ICS_CONTROL_KEY", "")
CA_FILE = Path(os.environ.get("MCW_PUBLIC_ICS_CA_FILE", "/nonexistent"))
THUNDERBIRD = Path(
    os.environ.get("MCW_PUBLIC_ICS_NATIVE_THUNDERBIRD_BIN", "/nonexistent")
)
WORKSPACE = Path(os.environ.get("MCW_PUBLIC_ICS_NATIVE_WORKSPACE", "/nonexistent"))
# Marionette launches Thunderbird from this process. Keep the feed capability
# and fixture-control key inside the worker instead of inheriting them into the
# browser process environment.
for _environment_name in tuple(os.environ):
    if _environment_name.startswith("MCW_PUBLIC_ICS_"):
        os.environ.pop(_environment_name, None)
EXPECTED_VERSION = "158.0.1"
EVENT_UID = "public-native-feed-event"
REQUEST_TIMEOUT_SECONDS = 25
CONTROL_REQUEST_TIMEOUT_SECONDS = 5
CERTUTIL_COMMAND_TIMEOUT_SECONDS = 10
CERTUTIL_COMMAND_COUNT = 2
MARIONETTE_STARTUP_TIMEOUT_SECONDS = 85
MARIONETTE_SOCKET_TIMEOUT_SECONDS = 15
MARIONETTE_SCRIPT_TIMEOUT_SECONDS = 10
MARIONETTE_SHUTDOWN_TIMEOUT_SECONDS = 70
CALENDAR_TAB_TIMEOUT_SECONDS = 15
EVENT_OBSERVATION_MAX_SECONDS = 6
MARIONETTE_SETUP_RPC_COUNT = 5
MARIONETTE_PROVIDER_SCRIPT_COUNT = 6
MARIONETTE_QUIT_RPC_COUNT = 2
PUBLIC_RESPONSE_WAIT_COUNT = 3
DIRECT_CONTROL_REQUEST_COUNT = 4
WORKER_CLEANUP_ALLOWANCE_SECONDS = 80

# The pinned Marionette driver's default socket timeout is 360 seconds. Keep
# this worker's individual Marionette calls and scripts bounded instead. The
# parent fixture also applies a whole-worker deadline that includes cleanup.
WORKER_PHASE_BUDGET_SECONDS = (
    CERTUTIL_COMMAND_COUNT * CERTUTIL_COMMAND_TIMEOUT_SECONDS
    + MARIONETTE_STARTUP_TIMEOUT_SECONDS
    + MARIONETTE_SETUP_RPC_COUNT * MARIONETTE_SOCKET_TIMEOUT_SECONDS
    + CALENDAR_TAB_TIMEOUT_SECONDS
    + MARIONETTE_SCRIPT_TIMEOUT_SECONDS
    + MARIONETTE_PROVIDER_SCRIPT_COUNT * MARIONETTE_SCRIPT_TIMEOUT_SECONDS
    + PUBLIC_RESPONSE_WAIT_COUNT
    * (REQUEST_TIMEOUT_SECONDS + CONTROL_REQUEST_TIMEOUT_SECONDS)
    + DIRECT_CONTROL_REQUEST_COUNT * CONTROL_REQUEST_TIMEOUT_SECONDS
    + MARIONETTE_SHUTDOWN_TIMEOUT_SECONDS
    + MARIONETTE_QUIT_RPC_COUNT * MARIONETTE_SOCKET_TIMEOUT_SECONDS
    + WORKER_CLEANUP_ALLOWANCE_SECONDS
)

RESULT_SCHEMA = "thunderbird-public-ics-qualification@1"
RESULT_FIELDS = {
    "calendarTab",
    "providerTypeICS",
    "readOnlyCalendar",
    "storedCredentialsAbsent",
    "initialFeedObserved",
    "canonicalEventObserved",
    "explicitRefreshObserved",
    "revokedRefreshObserved",
    "revokedResponseNotFound",
    "exactGatewayRoute",
    "gatewayAuthorizationAbsent",
}
FAILURE_STAGES = {
    "input_preflight",
    "profile_setup",
    "application_startup",
    "calendar_tab",
    "provider_setup",
    "initial_refresh",
    "event_observation",
    "explicit_refresh",
    "unpublish",
    "revoked_refresh",
    "cleanup",
    "complete",
}
FAILURE_CLASSES = {
    "invalid_input",
    "input_missing",
    "trust_setup_failed",
    "startup_failed",
    "version_mismatch",
    "calendar_tab_unavailable",
    "provider_unavailable",
    "invalid_public_url",
    "calendar_setup_failed",
    "calendar_not_read_only",
    "calendar_not_registered",
    "refresh_failed",
    "stored_credentials_present",
    "public_route_not_observed",
    "canonical_event_not_observed",
    "unpublish_failed",
    "revoked_route_not_observed",
    "cleanup_failed",
    "qualification_predicate_failed",
    "unexpected_error",
}

TABMAIL_OBSERVATION = """
const tabmail = document.getElementById("tabmail");
const calendarModeRegistered = Boolean(
  tabmail && tabmail.tabModes && "calendar" in tabmail.tabModes
);
const calendarTabOpenBeforeAction = Boolean(
  tabmail && Array.isArray(tabmail.tabInfo) &&
    tabmail.tabInfo.some(info => info.mode && info.mode.name === "calendar")
);
let calendarTabOpenError = false;
if (tabmail && calendarModeRegistered && !calendarTabOpenBeforeAction) {
  try {
    tabmail.openTab("calendar");
  } catch (_error) {
    calendarTabOpenError = true;
  }
}
return Boolean(tabmail && calendarModeRegistered && !calendarTabOpenError);
"""

CALENDAR_TAB_OPEN = """
const tabmail = document.getElementById("tabmail");
return Boolean(tabmail && Array.isArray(tabmail.tabInfo) &&
  tabmail.tabInfo.some(info => info.mode && info.mode.name === "calendar"));
"""

STORED_CREDENTIALS_ABSENT = """
return typeof Services !== "undefined" && Services.logins &&
  Services.logins.getAllLogins().length === 0;
"""

# Verified against Mozilla's THUNDERBIRD_158_0_1_RELEASE source: the manager
# creates this provider with `createCalendar("ics", uri)` and registration
# triggers refresh. The ICS provider also exposes `refresh()` and `getItem()`.
CREATE_PUBLIC_ICS = r"""
const done = arguments[arguments.length - 1];
const [url, expectedOrigin] = arguments.slice(0, -1);
(async () => {
  try {
    if (typeof cal === "undefined" || !cal.manager ||
        typeof cal.manager.createCalendar !== "function" ||
        typeof cal.manager.registerCalendar !== "function") {
      return { ok: false, failure: "provider_unavailable" };
    }
    if (typeof Services === "undefined" || !Services.logins ||
        Services.logins.getAllLogins().length !== 0) {
      return { ok: false, failure: "stored_credentials_present" };
    }
    const parsed = new URL(url);
    if (parsed.origin !== expectedOrigin || parsed.username || parsed.password ||
        parsed.search || parsed.hash ||
        !/^\/v1\/public-calendar-feeds\/[A-Za-z0-9_.-]+$/u.test(parsed.pathname)) {
      return { ok: false, failure: "invalid_public_url" };
    }
    const calendar = cal.manager.createCalendar(
      "ics",
      Services.io.newURI(url)
    );
    if (!calendar || calendar.type !== "ics") {
      return { ok: false, failure: "provider_unavailable" };
    }
    calendar.name = "Public feed contract";
    calendar.readOnly = true;
    if (calendar.readOnly !== true) {
      return { ok: false, failure: "calendar_not_read_only" };
    }
    cal.manager.registerCalendar(calendar);
    const registered = cal.manager.getCalendarById(calendar.id);
    if (!registered || registered.type !== "ics" || !registered.readOnly) {
      return { ok: false, failure: "calendar_not_registered" };
    }
    window.__mcwPublicIcsCalendar = registered;
    return {
      ok: true,
      providerTypeICS: true,
      readOnlyCalendar: true,
      storedCredentialsAbsent: true,
    };
  } catch (_error) {
    return { ok: false, failure: "calendar_setup_failed" };
  }
})().then(done, () => done({ ok: false, failure: "calendar_setup_failed" }));
"""

REFRESH_PUBLIC_ICS = r"""
const done = arguments[arguments.length - 1];
try {
  const calendar = window.__mcwPublicIcsCalendar;
  if (!calendar || calendar.type !== "ics" || typeof calendar.refresh !== "function") {
    done({ ok: false, failure: "provider_unavailable" });
  } else {
    calendar.refresh();
    done({ ok: true });
  }
} catch (_error) {
  done({ ok: false, failure: "refresh_failed" });
}
"""

EVENT_PRESENT = r"""
const done = arguments[arguments.length - 1];
(async () => {
  const calendar = window.__mcwPublicIcsCalendar;
  if (!calendar) {
    return false;
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const item = await calendar.getItem(arguments[0]);
      if (item && item.isEvent && item.isEvent()) {
        return true;
      }
    } catch (_error) {
      return false;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
})().then(done, () => done(false));
"""


class ContractFailure(RuntimeError):
    def __init__(self, stage: str, error_class: str):
        super().__init__(error_class)
        self.stage = stage
        self.error_class = error_class


def _is_local_https_origin(value: str) -> bool:
    try:
        parsed = urllib.parse.urlsplit(value)
        port = parsed.port
    except ValueError:
        return False
    return (
        parsed.scheme == "https"
        and parsed.hostname == "localhost"
        and port is not None
        and 1 <= port <= 65535
        and parsed.username is None
        and parsed.password is None
        and parsed.path == ""
        and parsed.query == ""
        and parsed.fragment == ""
    )


def _valid_inputs() -> bool:
    try:
        api = urllib.parse.urlsplit(API_ORIGIN)
        public = urllib.parse.urlsplit(PUBLIC_URL)
        api_port = api.port
    except ValueError:
        return False
    return (
        _is_local_https_origin(API_ORIGIN)
        and public.scheme == "https"
        and public.hostname == "localhost"
        and public.port == api_port
        and public.username is None
        and public.password is None
        and public.query == ""
        and public.fragment == ""
        and re.fullmatch(r"/v1/public-calendar-feeds/[A-Za-z0-9_.-]+", public.path)
        is not None
        and 1 <= CONTROL_PORT <= 65535
        and re.fullmatch(r"[A-Za-z0-9_-]{32,128}", CONTROL_KEY) is not None
        and CA_FILE.is_file()
        and THUNDERBIRD.is_file()
        and WORKSPACE == Path("/task/workspace")
    )


def _run_certutil(profile: Path) -> None:
    commands = (
        ["certutil", "-N", "-d", f"sql:{profile}", "--empty-password"],
        [
            "certutil",
            "-A",
            "-d",
            f"sql:{profile}",
            "-n",
            "mcw-public-feed-contract-ca",
            "-t",
            "C,,",
            "-i",
            str(CA_FILE),
        ],
    )
    for command in commands:
        try:
            result = subprocess.run(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=CERTUTIL_COMMAND_TIMEOUT_SECONDS,
            )
        except (OSError, subprocess.SubprocessError):
            raise ContractFailure("profile_setup", "trust_setup_failed") from None
        if result.returncode != 0:
            raise ContractFailure("profile_setup", "trust_setup_failed")


def _control_request(method: str, path: str, body: bytes = b"") -> tuple[int, bytes]:
    connection = http.client.HTTPConnection(
        "127.0.0.1", CONTROL_PORT, timeout=CONTROL_REQUEST_TIMEOUT_SECONDS
    )
    try:
        headers = {"X-Contract-Key": CONTROL_KEY}
        if body:
            headers["Content-Type"] = "application/json"
        connection.request(method, path, body=body or None, headers=headers)
        response = connection.getresponse()
        return response.status, response.read(4096)
    except (OSError, http.client.HTTPException):
        raise ContractFailure(
            "public_route_not_observed", "public_route_not_observed"
        ) from None
    finally:
        connection.close()


def _state() -> dict[str, int]:
    status, body = _control_request("GET", "/public-feed-state")
    fields = {
        "requestCount",
        "exactRouteCount",
        "authorizationAbsentCount",
        "status200Count",
        "status404Count",
    }
    try:
        value = json.loads(body)
    except json.JSONDecodeError:
        raise ContractFailure(
            "public_route_not_observed", "public_route_not_observed"
        ) from None
    if (
        status != 200
        or not isinstance(value, dict)
        or set(value) != fields
        or any(type(value[name]) is not int or value[name] < 0 for name in fields)
    ):
        raise ContractFailure("public_route_not_observed", "public_route_not_observed")
    return value


def _assert_anonymous_exact_route(value: dict[str, int]) -> None:
    if (
        value["exactRouteCount"] != value["requestCount"]
        or value["authorizationAbsentCount"] != value["requestCount"]
    ):
        raise ContractFailure("complete", "qualification_predicate_failed")


def _wait_for_public_response(
    previous: dict[str, int], status_key: str, stage: str
) -> dict[str, int]:
    deadline = time.monotonic() + REQUEST_TIMEOUT_SECONDS
    while True:
        value = _state()
        _assert_anonymous_exact_route(value)
        if (
            value["requestCount"] > previous["requestCount"]
            and value[status_key] > previous[status_key]
        ):
            return value
        if time.monotonic() >= deadline:
            error_class = (
                "revoked_route_not_observed"
                if status_key == "status404Count"
                else "public_route_not_observed"
            )
            raise ContractFailure(stage, error_class)
        time.sleep(0.1)


def _run_script(marionette: object, script: str, args: list[object]) -> object:
    try:
        return marionette.execute_async_script(script, script_args=args)
    except Exception:
        raise ContractFailure("provider_setup", "provider_unavailable") from None


def _wait_for_calendar_tab(marionette: object) -> None:
    deadline = time.monotonic() + CALENDAR_TAB_TIMEOUT_SECONDS
    while True:
        try:
            opened = marionette.execute_script(CALENDAR_TAB_OPEN)
        except Exception:
            raise ContractFailure("calendar_tab", "calendar_tab_unavailable") from None
        if opened is True:
            return
        if time.monotonic() >= deadline:
            raise ContractFailure("calendar_tab", "calendar_tab_unavailable")
        time.sleep(0.25)


def run() -> dict[str, object]:
    from marionette_driver.marionette import Marionette

    if not _valid_inputs():
        raise ContractFailure("input_preflight", "invalid_input")
    profile_seed = Path(
        tempfile.mkdtemp(prefix="mcw-public-feed-profile-seed-", dir=WORKSPACE)
    )
    os.chmod(profile_seed, 0o700)
    marionette = None
    profile_path: Path | None = None
    gecko_log_path: Path | None = None
    try:
        _run_certutil(profile_seed)
        log_descriptor, log_name = tempfile.mkstemp(
            prefix="mcw-public-feed-gecko-", suffix=".log", dir=WORKSPACE
        )
        os.fchmod(log_descriptor, 0o600)
        os.close(log_descriptor)
        gecko_log_path = Path(log_name)
        prefs = {
            "app.update.enabled": False,
            "app.update.auto": False,
            "app.update.autoInstallEnabled": False,
            "toolkit.telemetry.enabled": False,
            "datareporting.healthreport.uploadEnabled": False,
            "datareporting.usage.uploadEnabled": False,
            "datareporting.policy.dataSubmissionEnabled": False,
            "mail.shell.checkDefaultClient": False,
            "startup.homepage_welcome_url": "about:blank",
            "startup.homepage_welcome_url.additional": "",
            "signon.rememberSignons": False,
        }
        marionette = Marionette(
            bin=str(THUNDERBIRD),
            app="thunderbird",
            workspace=str(WORKSPACE),
            gecko_log=str(gecko_log_path),
            app_args=["--calendar", "--headless"],
            prefs=prefs,
            headless=False,
            socket_timeout=MARIONETTE_SOCKET_TIMEOUT_SECONDS,
            startup_timeout=MARIONETTE_STARTUP_TIMEOUT_SECONDS,
            profile=str(profile_seed),
        )
        profile_path = Path(marionette.profile_path).resolve(strict=True)
        profile_path.relative_to(WORKSPACE.resolve(strict=True))
        capabilities = marionette.start_session()
        marionette.timeout.script = MARIONETTE_SCRIPT_TIMEOUT_SECONDS
        marionette.shutdown_timeout = MARIONETTE_SHUTDOWN_TIMEOUT_SECONDS
        if capabilities.get("browserVersion") != EXPECTED_VERSION:
            raise ContractFailure("application_startup", "version_mismatch")
        marionette.set_context(marionette.CONTEXT_CHROME)
        if marionette.get_window_type() != "mail:3pane":
            raise ContractFailure("application_startup", "startup_failed")
        try:
            tab_ready = marionette.execute_script(TABMAIL_OBSERVATION)
        except Exception:
            raise ContractFailure("calendar_tab", "calendar_tab_unavailable") from None
        if tab_ready is not True:
            raise ContractFailure("calendar_tab", "calendar_tab_unavailable")
        _wait_for_calendar_tab(marionette)

        opened = _run_script(marionette, CREATE_PUBLIC_ICS, [PUBLIC_URL, API_ORIGIN])
        if not isinstance(opened, dict) or opened.get("ok") is not True:
            failure = (
                opened.get("failure")
                if isinstance(opened, dict)
                else "provider_unavailable"
            )
            if failure == "stored_credentials_present":
                raise ContractFailure("provider_setup", "stored_credentials_present")
            raise ContractFailure("provider_setup", "provider_unavailable")

        before_initial_refresh = _state()
        refreshed = _run_script(marionette, REFRESH_PUBLIC_ICS, [])
        if not isinstance(refreshed, dict) or refreshed.get("ok") is not True:
            raise ContractFailure("initial_refresh", "provider_unavailable")
        initial = _wait_for_public_response(
            before_initial_refresh, "status200Count", "initial_refresh"
        )
        event_seen = _run_script(marionette, EVENT_PRESENT, [EVENT_UID])
        if event_seen is not True:
            raise ContractFailure("event_observation", "canonical_event_not_observed")

        before_explicit_refresh = _state()
        refreshed = _run_script(marionette, REFRESH_PUBLIC_ICS, [])
        if not isinstance(refreshed, dict) or refreshed.get("ok") is not True:
            raise ContractFailure("explicit_refresh", "provider_unavailable")
        after_explicit_refresh = _wait_for_public_response(
            before_explicit_refresh, "status200Count", "explicit_refresh"
        )
        try:
            credentials_absent_after_refresh = marionette.execute_script(
                STORED_CREDENTIALS_ABSENT
            )
        except Exception:
            raise ContractFailure("explicit_refresh", "provider_unavailable") from None
        if credentials_absent_after_refresh is not True:
            raise ContractFailure("explicit_refresh", "stored_credentials_present")

        status, _ = _control_request("POST", "/public-feed-unpublish", b"{}")
        if status != 204:
            raise ContractFailure("unpublish", "unpublish_failed")
        before_revoked_refresh = _state()
        refreshed = _run_script(marionette, REFRESH_PUBLIC_ICS, [])
        if not isinstance(refreshed, dict) or refreshed.get("ok") is not True:
            raise ContractFailure("revoked_refresh", "provider_unavailable")
        revoked = _wait_for_public_response(
            before_revoked_refresh, "status404Count", "revoked_refresh"
        )
        _assert_anonymous_exact_route(revoked)

        result: dict[str, object] = {
            "schema": RESULT_SCHEMA,
            "status": "passed",
            "appVersion": EXPECTED_VERSION,
            "calendarTab": True,
            "providerTypeICS": opened.get("providerTypeICS") is True,
            "readOnlyCalendar": opened.get("readOnlyCalendar") is True,
            "storedCredentialsAbsent": (
                opened.get("storedCredentialsAbsent") is True
                and credentials_absent_after_refresh is True
            ),
            "initialFeedObserved": initial["status200Count"]
            > before_initial_refresh["status200Count"],
            "canonicalEventObserved": True,
            "explicitRefreshObserved": after_explicit_refresh["requestCount"]
            > initial["requestCount"],
            "revokedRefreshObserved": revoked["requestCount"]
            > before_revoked_refresh["requestCount"],
            "revokedResponseNotFound": revoked["status404Count"]
            > before_revoked_refresh["status404Count"],
            "exactGatewayRoute": revoked["exactRouteCount"] == revoked["requestCount"],
            "gatewayAuthorizationAbsent": revoked["authorizationAbsentCount"]
            == revoked["requestCount"],
            "gatewayGetCount": revoked["requestCount"],
            "exactRouteCount": revoked["exactRouteCount"],
            "authorizationAbsentCount": revoked["authorizationAbsentCount"],
            "http200Count": revoked["status200Count"],
            "http404Count": revoked["status404Count"],
        }
        if not all(result.get(field) is True for field in RESULT_FIELDS):
            raise ContractFailure("complete", "qualification_predicate_failed")
        return result
    finally:
        cleanup_failed = False
        if marionette is not None:
            try:
                if marionette.session is not None:
                    marionette.quit(in_app=True)
            except Exception:
                cleanup_failed = True
            try:
                marionette.cleanup()
            except Exception:
                cleanup_failed = True
        for path in (profile_path, profile_seed, gecko_log_path):
            if path is None:
                continue
            try:
                path.relative_to(WORKSPACE.resolve(strict=True))
                if path.is_dir():
                    shutil.rmtree(path)
                elif path.exists():
                    path.unlink()
            except Exception:
                cleanup_failed = True
        if cleanup_failed:
            raise ContractFailure("cleanup", "cleanup_failed") from None


def main() -> int:
    try:
        result = run()
    except ContractFailure as error:
        result = {
            "schema": RESULT_SCHEMA,
            "status": "failed",
            "failure_stage": error.stage,
            "failure_class": error.error_class,
        }
    except Exception:
        result = {
            "schema": RESULT_SCHEMA,
            "status": "failed",
            "failure_stage": "complete",
            "failure_class": "unexpected_error",
        }
    if result.get("status") == "passed" and (
        result.get("schema") != RESULT_SCHEMA
        or result.get("appVersion") != EXPECTED_VERSION
        or set(result)
        != RESULT_FIELDS
        | {
            "schema",
            "status",
            "appVersion",
            "gatewayGetCount",
            "exactRouteCount",
            "authorizationAbsentCount",
            "http200Count",
            "http404Count",
        }
        or any(type(result.get(field)) is not bool for field in RESULT_FIELDS)
        or any(
            type(result.get(field)) is not int or not 0 <= result[field] <= 100
            for field in (
                "gatewayGetCount",
                "exactRouteCount",
                "authorizationAbsentCount",
                "http200Count",
                "http404Count",
            )
        )
    ):
        result = {
            "schema": RESULT_SCHEMA,
            "status": "failed",
            "failure_stage": "complete",
            "failure_class": "qualification_predicate_failed",
        }
    if result.get("status") != "passed" and (
        result.get("schema") != RESULT_SCHEMA
        or set(result) != {"schema", "status", "failure_stage", "failure_class"}
        or result.get("failure_stage") not in FAILURE_STAGES
        or result.get("failure_class") not in FAILURE_CLASSES
    ):
        result = {
            "schema": RESULT_SCHEMA,
            "status": "failed",
            "failure_stage": "complete",
            "failure_class": "unexpected_error",
        }
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0 if result.get("status") == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
