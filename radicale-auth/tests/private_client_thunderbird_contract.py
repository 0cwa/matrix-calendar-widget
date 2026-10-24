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

"""Exercise Thunderbird's native CalDAV provider against the private fixture."""

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


API_ORIGIN = os.environ["MCW_PRIVATE_CALDAV_API_ORIGIN"]
CONTROL_PORT = int(os.environ["MCW_PRIVATE_CALDAV_CONTROL_PORT"])
CONTROL_KEY = os.environ["MCW_PRIVATE_CALDAV_CONTROL_KEY"]
PERSONAL_APP_ID = os.environ["MCW_PRIVATE_CALDAV_PERSONAL_APP_ID"]
PERSONAL_SECRET = os.environ["MCW_PRIVATE_CALDAV_PERSONAL_SECRET"]
CA_FILE = Path(os.environ["MCW_PRIVATE_CALDAV_CA_FILE"])
THUNDERBIRD = Path(os.environ["MCW_PRIVATE_CALDAV_NATIVE_THUNDERBIRD_BIN"])
WORKSPACE = Path(os.environ["MCW_PRIVATE_CALDAV_NATIVE_WORKSPACE"])
EXPECTED_VERSION = "158.0.1"
EVENT_UID = "private-contract-event"
CREATED_UID = "native-created-contract-event"
EDITED_SUMMARY = "Edited by native Thunderbird CalDAV provider"
CREATED_SUMMARY = "Created by native Thunderbird CalDAV provider"
REVOKED_SUMMARY = "This post-revoke edit must not reach Radicale"
OPAQUE_PROPERTY = "X-COMPANY-OPAQUE"
COUNTER_TIMEOUT_SECONDS = 20
NATIVE_MARIONETTE_FAILURE_STAGES = {
    "marionette_import",
    "profile_setup",
    "marionette_constructor",
    "profile_validation",
    "session_creation",
    "application_version",
    "chrome_context",
    "main_window",
    "calendar_tab_observation",
    "calendar_tab_open",
    "provider_discovery",
    "provider_refresh",
    "provider_edit",
    "provider_create",
    "provider_delete",
    "post_revoke_provider_request",
}
MARIONETTE_EXCEPTION_CLASSES = {
    "TimeoutException": "session_error",
    "ScriptTimeoutException": "script_timeout",
    "JavascriptException": "script_error",
    "MarionetteException": "session_error",
    "InvalidSessionIdException": "session_error",
    "NoSuchWindowException": "session_error",
    "SessionNotCreatedException": "session_error",
}

TABMAIL_OBSERVATION = """
const tabmail = document.getElementById("tabmail");
const calendarModeRegistered = Boolean(
  tabmail && tabmail.tabModes && 'calendar' in tabmail.tabModes
);
const calendarTabOpenBeforeAction = Boolean(
  tabmail && Array.isArray(tabmail.tabInfo) &&
    tabmail.tabInfo.some(info => info.mode && info.mode.name === "calendar")
);
let calendarTabOpenAttempted = false;
let calendarTabOpenError = false;
if (tabmail && calendarModeRegistered && !calendarTabOpenBeforeAction) {
  calendarTabOpenAttempted = true;
  try {
    tabmail.openTab('calendar');
  } catch (_error) {
    calendarTabOpenError = true;
  }
}
return {
  tabmailPresent: Boolean(tabmail),
  calendarModeRegistered,
  calendarTabOpenBeforeAction,
  calendarTabOpenAttempted,
  calendarTabOpenError,
};
"""

CALENDAR_TAB_OPEN = """
const tabmail = document.getElementById("tabmail");
return Boolean(tabmail && Array.isArray(tabmail.tabInfo) &&
  tabmail.tabInfo.some(info => info.mode && info.mode.name === "calendar"));
"""

DISCOVER_CALENDAR = r"""
const done = arguments[arguments.length - 1];
const [username, password, location, expectedOrigin, expectedPath] = arguments.slice(0, -1);
(async () => {
  try {
    if (typeof cal === "undefined" || !cal.provider || !cal.provider.caldav ||
        typeof cal.provider.caldav.detectCalendars !== "function") {
      return { ok: false, failure: "provider_unavailable" };
    }
    const discovered = await cal.provider.caldav.detectCalendars(
      username, password, location, true
    );
    let candidates = [];
    if (Array.isArray(discovered)) {
      candidates = discovered;
    } else if (discovered && Array.isArray(discovered.calendars)) {
      candidates = discovered.calendars;
    } else if (discovered && discovered.calendars instanceof Map) {
      candidates = Array.from(discovered.calendars.values());
    } else if (discovered && discovered.calendar) {
      candidates = [discovered.calendar];
    }
    const calendars = candidates.map(value => value && (value.calendar || value)).filter(
      value => value && value.type === "caldav"
    );
    if (calendars.length !== 1) {
      return { ok: false, failure: "discovery_cardinality" };
    }
    const calendar = calendars[0];
    const uri = calendar.uri && (calendar.uri.spec || String(calendar.uri));
    if (typeof uri !== "string") {
      return { ok: false, failure: "calendar_uri_missing" };
    }
    const parsed = new URL(uri);
    if (parsed.origin !== expectedOrigin || parsed.pathname !== expectedPath ||
        parsed.search !== "" || parsed.hash !== "") {
      return { ok: false, failure: "calendar_scope_mismatch" };
    }
    if (!calendar.id || !cal.manager) {
      return { ok: false, failure: "calendar_registration_data_missing" };
    }
    if (!cal.manager.getCalendarById(calendar.id)) {
      cal.manager.registerCalendar(calendar);
    }
    const registered = cal.manager.getCalendarById(calendar.id);
    if (!registered || registered.type !== "caldav") {
      return { ok: false, failure: "calendar_not_registered" };
    }
    registered.enabled = true;
    window.__mcwPrivateCalDavCalendar = registered;
    return {
      ok: true,
      providerDiscovery: true,
      calendarType: registered.type,
      calendarUriScope: true,
      calendarRegistered: true,
    };
  } catch (error) {
    return {
      ok: false,
      failure: error && error.name === "NS_ERROR_ABORT" ? "request_aborted" : "discovery_failed",
    };
  }
})().then(done, () => done({ ok: false, failure: "discovery_failed" }));
"""

REFRESH_CALENDAR = r"""
const done = arguments[arguments.length - 1];
try {
  const calendar = window.__mcwPrivateCalDavCalendar;
  if (!calendar || typeof calendar.refresh !== "function") {
    done({ ok: false, failure: "calendar_unavailable" });
  } else {
    calendar.refresh();
    done({ ok: true });
  }
} catch (_error) {
  done({ ok: false, failure: "refresh_failed" });
}
"""

EDIT_EVENT = r"""
const done = arguments[arguments.length - 1];
(async () => {
  try {
    const calendar = window.__mcwPrivateCalDavCalendar;
    const item = await calendar.getItem(arguments[0]);
    if (!item || !item.isEvent || !item.isEvent()) {
      return { ok: false, failure: "event_not_loaded" };
    }
    const ical = item.icalString || "";
    if (!ical.includes(arguments[1]) || !ical.includes(arguments[2])) {
      return { ok: false, failure: "unknown_property_not_loaded" };
    }
    const edited = item.clone();
    edited.title = arguments[3];
    await calendar.modifyItem(edited, item);
    return { ok: true, unknownPropertyLoaded: true };
  } catch (_error) {
    return { ok: false, failure: "event_edit_failed" };
  }
})().then(done, () => done({ ok: false, failure: "event_edit_failed" }));
"""

CREATE_EVENT = r"""
const done = arguments[arguments.length - 1];
(async () => {
  try {
    const calendar = window.__mcwPrivateCalDavCalendar;
    const source = await calendar.getItem(arguments[0]);
    if (!source) {
      return { ok: false, failure: "event_not_loaded" };
    }
    const created = source.clone();
    created.id = arguments[1];
    created.title = arguments[2];
    created.calendar = calendar;
    await calendar.addItem(created);
    return { ok: true };
  } catch (_error) {
    return { ok: false, failure: "event_create_failed" };
  }
})().then(done, () => done({ ok: false, failure: "event_create_failed" }));
"""

DELETE_EVENT = r"""
const done = arguments[arguments.length - 1];
(async () => {
  try {
    const calendar = window.__mcwPrivateCalDavCalendar;
    const item = await calendar.getItem(arguments[0]);
    if (!item) {
      return { ok: false, failure: "created_event_not_loaded" };
    }
    await calendar.deleteItem(item);
    return { ok: true };
  } catch (_error) {
    return { ok: false, failure: "event_delete_failed" };
  }
})().then(done, () => done({ ok: false, failure: "event_delete_failed" }));
"""

POST_REVOKE_EDIT = r"""
const done = arguments[arguments.length - 1];
(async () => {
  try {
    const calendar = window.__mcwPrivateCalDavCalendar;
    const item = await calendar.getItem(arguments[0]);
    if (!item) {
      return { ok: false, failure: "event_not_loaded" };
    }
    const edited = item.clone();
    edited.title = arguments[1];
    try {
      await calendar.modifyItem(edited, item);
      return { ok: false, requestRejected: false };
    } catch (_error) {
      return { ok: true, requestRejected: true };
    }
  } catch (_error) {
    return { ok: false, failure: "revoke_probe_failed" };
  }
})().then(done, () => done({ ok: false, failure: "revoke_probe_failed" }));
"""


class ContractFailure(RuntimeError):
    def __init__(self, stage: str, error_class: str = "contract_assertion"):
        super().__init__(error_class)
        self.stage = stage
        self.error_class = error_class


def _marionette_error_class(error: Exception) -> str:
    # Only fixed categories escape; exception text and arbitrary type names do not.
    class_name = type(error).__name__
    known_class = MARIONETTE_EXCEPTION_CLASSES.get(class_name)
    if known_class is not None:
        return known_class
    if isinstance(error, (ConnectionError, OSError, TimeoutError)):
        return "session_error"
    return "other"


def _marionette_failure(stage: str, error: Exception) -> ContractFailure:
    if stage not in NATIVE_MARIONETTE_FAILURE_STAGES:
        return ContractFailure("internal", "unexpected_error")
    return ContractFailure(stage, _marionette_error_class(error))


def _control_request(
    method: str, path: str, body: bytes = b""
) -> tuple[int, bytes]:
    connection = http.client.HTTPConnection("127.0.0.1", CONTROL_PORT, timeout=5)
    try:
        headers = {"X-Contract-Key": CONTROL_KEY}
        if body:
            headers["Content-Type"] = "application/json"
        connection.request(method, path, body=body or None, headers=headers)
        response = connection.getresponse()
        return response.status, response.read(2048)
    finally:
        connection.close()


def _state() -> dict[str, object]:
    status, body = _control_request("GET", "/native-state")
    if status != 200:
        raise ContractFailure("control_state")
    try:
        value = json.loads(body)
    except json.JSONDecodeError:
        raise ContractFailure("control_state") from None
    if (
        not isinstance(value, dict)
        or set(value) != {"callbackCount", "personalAuthDenyCount", "personalState"}
        or type(value.get("callbackCount")) is not int
        or type(value.get("personalAuthDenyCount")) is not int
        or value["callbackCount"] < 0
        or value["personalAuthDenyCount"] < 0
        or value["personalAuthDenyCount"] > value["callbackCount"]
        or value.get("personalState") not in {"active", "revoked"}
    ):
        raise ContractFailure("control_state")
    return value


def _control_post(path: str) -> None:
    status, _ = _control_request("POST", path, b"{}")
    if status != 204:
        raise ContractFailure("canonical_verification")


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


def _wait_for_callback(previous: int) -> dict[str, object]:
    deadline = time.monotonic() + COUNTER_TIMEOUT_SECONDS
    while True:
        state = _state()
        if int(state["callbackCount"]) > previous:
            return state
        if time.monotonic() >= deadline:
            raise ContractFailure("provider_network_request", "callback_not_observed")
        time.sleep(0.1)


def _run_certutil(profile: Path) -> None:
    for command in (
        ["certutil", "-N", "-d", f"sql:{profile}", "--empty-password"],
        [
            "certutil",
            "-A",
            "-d",
            f"sql:{profile}",
            "-n",
            "mcw-private-client-contract-ca",
            "-t",
            "C,,",
            "-i",
            str(CA_FILE),
        ],
    ):
        try:
            result = subprocess.run(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=10,
            )
        except (OSError, subprocess.SubprocessError):
            raise ContractFailure("profile_ca_import", "profile_setup_failed") from None
        if result.returncode != 0:
            raise ContractFailure("profile_ca_import", "profile_setup_failed")


def _async_script(
    marionette: object,
    script: str,
    args: list[object],
    stage: str,
) -> dict[str, object]:
    try:
        result = marionette.execute_async_script(script, script_args=args)
    except Exception as error:
        raise _marionette_failure(stage, error) from None
    if not isinstance(result, dict) or type(result.get("ok")) is not bool:
        raise ContractFailure(stage, "invalid_provider_result")
    return result


def _assert_ok(result: dict[str, object], stage: str) -> None:
    if result.get("ok") is not True:
        failure = result.get("failure")
        if isinstance(failure, str) and re.fullmatch(r"[a-z_]{1,64}", failure):
            raise ContractFailure(stage, failure)
        raise ContractFailure(stage)


def _ensure_calendar_tab(marionette: object) -> dict[str, bool]:
    try:
        observed = marionette.execute_script(TABMAIL_OBSERVATION)
    except Exception as error:
        raise _marionette_failure("calendar_tab_observation", error) from None
    expected = {
        "tabmailPresent",
        "calendarModeRegistered",
        "calendarTabOpenBeforeAction",
        "calendarTabOpenAttempted",
        "calendarTabOpenError",
    }
    if (
        not isinstance(observed, dict)
        or set(observed) != expected
        or any(type(value) is not bool for value in observed.values())
        or not observed["tabmailPresent"]
        or not observed["calendarModeRegistered"]
        or observed["calendarTabOpenError"]
    ):
        raise ContractFailure("calendar_tab_observation", "calendar_mode_unavailable")
    deadline = time.monotonic() + 15
    while True:
        try:
            opened = marionette.execute_script(CALENDAR_TAB_OPEN)
        except Exception as error:
            raise _marionette_failure("calendar_tab_open", error) from None
        if opened is True:
            return observed
        if time.monotonic() >= deadline:
            raise ContractFailure("calendar_tab_open", "calendar_tab_not_open")
        time.sleep(0.25)


def run() -> dict[str, object]:
    try:
        from marionette_driver.marionette import Marionette
    except Exception as error:
        raise _marionette_failure("marionette_import", error) from None

    if not CA_FILE.is_file() or not THUNDERBIRD.is_file():
        raise ContractFailure("worker_setup", "input_missing")
    if WORKSPACE != Path("/task/workspace"):
        raise ContractFailure("worker_setup", "invalid_workspace")
    try:
        THUNDERBIRD.resolve(strict=True).relative_to(Path("/task/app").resolve())
    except (OSError, ValueError):
        raise ContractFailure("worker_setup", "invalid_binary") from None
    if not re.fullmatch(r"mcwpc~[a-f0-9]{48}", PERSONAL_APP_ID):
        raise ContractFailure("worker_setup", "invalid_app_id")
    if not _is_local_https_origin(API_ORIGIN):
        raise ContractFailure("worker_setup", "invalid_origin")

    try:
        workspace = WORKSPACE.resolve(strict=True)
    except Exception as error:
        raise _marionette_failure("profile_validation", error) from None
    try:
        profile_seed = Path(
            tempfile.mkdtemp(prefix="mcw-private-profile-seed-", dir=workspace)
        )
        os.chmod(profile_seed, 0o700)
    except Exception as error:
        raise _marionette_failure("profile_setup", error) from None
    marionette = None
    profile_path: Path | None = None
    result: dict[str, object] = {
        "status": "failed",
        "calendarTab": False,
        "providerDiscovery": False,
        "calendarScope": False,
        "refreshNetworkRequest": False,
        "canonicalEditRoundtrip": False,
        "unknownPropertyPreserved": False,
        "canonicalCreateRoundtrip": False,
        "canonicalDeleteRoundtrip": False,
        "freshRevokeDenied": False,
        "callbackAdvancedAfterRevoke": False,
        "revokedState": False,
        "authDeniedAfterRevoke": False,
    }
    try:
        _run_certutil(profile_seed)
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
            "signon.rememberSignons": True,
        }
        try:
            marionette = Marionette(
                bin=str(THUNDERBIRD),
                app="thunderbird",
                workspace=str(workspace),
                gecko_log=str(workspace / "private-caldav-gecko.log"),
                app_args=["--calendar", "--headless"],
                prefs=prefs,
                headless=False,
                startup_timeout=85,
                profile=str(profile_seed),
            )
        except Exception as error:
            raise _marionette_failure("marionette_constructor", error) from None
        try:
            profile_path = Path(marionette.profile_path).resolve(strict=True)
            profile_path.relative_to(workspace)
        except Exception as error:
            raise _marionette_failure("profile_validation", error) from None
        try:
            capabilities = marionette.start_session()
        except Exception as error:
            raise _marionette_failure("session_creation", error) from None
        try:
            browser_version = capabilities.get("browserVersion")
        except Exception as error:
            raise _marionette_failure("session_creation", error) from None
        if browser_version != EXPECTED_VERSION:
            raise ContractFailure("application_version", "version_mismatch")
        try:
            marionette.set_context(marionette.CONTEXT_CHROME)
        except Exception as error:
            raise _marionette_failure("chrome_context", error) from None
        try:
            window_type = marionette.get_window_type()
        except Exception as error:
            raise _marionette_failure("main_window", error) from None
        if window_type != "mail:3pane":
            raise ContractFailure("main_window", "main_window_missing")

        _ensure_calendar_tab(marionette)
        result["calendarTab"] = True
        location = f"{API_ORIGIN}/{PERSONAL_APP_ID}/calendar/"
        expected_path = f"/{PERSONAL_APP_ID}/calendar/"
        discovered = _async_script(
            marionette,
            DISCOVER_CALENDAR,
            [PERSONAL_APP_ID, PERSONAL_SECRET, location, API_ORIGIN, expected_path],
            "provider_discovery",
        )
        _assert_ok(discovered, "provider_discovery")
        result["providerDiscovery"] = discovered.get("providerDiscovery") is True
        result["calendarScope"] = discovered.get("calendarUriScope") is True
        if not result["providerDiscovery"] or not result["calendarScope"]:
            raise ContractFailure("provider_discovery", "provider_discovery_failed")

        before_refresh = _state()
        refresh = _async_script(
            marionette, REFRESH_CALENDAR, [], "provider_refresh"
        )
        _assert_ok(refresh, "provider_refresh")
        _wait_for_callback(int(before_refresh["callbackCount"]))
        result["refreshNetworkRequest"] = True

        edit = _async_script(
            marionette,
            EDIT_EVENT,
            [EVENT_UID, OPAQUE_PROPERTY, "keep-this-value", EDITED_SUMMARY],
            "provider_edit",
        )
        _assert_ok(edit, "provider_edit")
        _control_post("/native-verify-edited")
        result["canonicalEditRoundtrip"] = True
        result["unknownPropertyPreserved"] = edit.get("unknownPropertyLoaded") is True

        before_create = _state()
        create = _async_script(
            marionette,
            CREATE_EVENT,
            [EVENT_UID, CREATED_UID, CREATED_SUMMARY],
            "provider_create",
        )
        _assert_ok(create, "provider_create")
        _wait_for_callback(int(before_create["callbackCount"]))
        _control_post("/native-verify-created")
        result["canonicalCreateRoundtrip"] = True

        before_delete = _state()
        delete = _async_script(
            marionette, DELETE_EVENT, [CREATED_UID], "provider_delete"
        )
        _assert_ok(delete, "provider_delete")
        _wait_for_callback(int(before_delete["callbackCount"]))
        _control_post("/native-verify-deleted")
        result["canonicalDeleteRoundtrip"] = True

        before_revoke = _state()
        if before_revoke.get("personalState") != "active":
            raise ContractFailure("revoke_setup", "personal_client_not_active")
        status, _ = _control_request("POST", "/revoke-personal", b"{}")
        if status != 204:
            raise ContractFailure("revoke_setup", "revoke_failed")
        revoked = _state()
        if revoked.get("personalState") != "revoked":
            raise ContractFailure("revoke_setup", "revoked_state_missing")
        result["revokedState"] = True

        post_revoke = _async_script(
            marionette,
            POST_REVOKE_EDIT,
            [EVENT_UID, REVOKED_SUMMARY],
            "post_revoke_provider_request",
        )
        _assert_ok(post_revoke, "post_revoke_provider_request")
        after_revoke = _wait_for_callback(int(revoked["callbackCount"]))
        result["callbackAdvancedAfterRevoke"] = True
        result["freshRevokeDenied"] = post_revoke.get("requestRejected") is True
        if not result["freshRevokeDenied"]:
            raise ContractFailure("post_revoke_provider_request", "revoked_write_accepted")
        if after_revoke.get("personalState") != "revoked":
            raise ContractFailure("post_revoke_provider_request", "revoked_state_lost")
        result["authDeniedAfterRevoke"] = (
            int(after_revoke["personalAuthDenyCount"])
            > int(revoked["personalAuthDenyCount"])
        )
        if not result["authDeniedAfterRevoke"]:
            raise ContractFailure("post_revoke_provider_request", "auth_denial_not_observed")
        _control_post("/native-verify-revoked")
        if not all(
            value is True
            for key, value in result.items()
            if key != "status"
        ):
            raise ContractFailure("complete", "qualification_predicate_failed")
        result["status"] = "passed"
        return result
    finally:
        try:
            if marionette is not None:
                if marionette.session is not None:
                    marionette.quit(in_app=True)
                marionette.cleanup()
            if profile_path is not None:
                profile_path.relative_to(workspace)
                if profile_path.exists():
                    shutil.rmtree(profile_path)
            shutil.rmtree(profile_seed)
        except Exception:
            raise ContractFailure("cleanup", "cleanup_failed") from None


def main() -> int:
    try:
        result = run()
    except ContractFailure as error:
        result = {
            "status": "failed",
            "failure_stage": error.stage,
            "failure_class": error.error_class,
        }
    except Exception:
        result = {
            "status": "failed",
            "failure_stage": "internal",
            "failure_class": "unexpected_error",
        }
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0 if result.get("status") == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
