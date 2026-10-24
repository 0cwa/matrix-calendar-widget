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

"""Synthetic python-caldav acceptance against the source private DAV gateway."""

from __future__ import annotations

import base64
import http.client
import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

CONTRACT_DIAGNOSTIC_SCHEMA = "private-caldav-contract-diagnostic@1"
CONTRACT_DIAGNOSTIC_PATH = (
    "/task/workspace/private-caldav-contract-diagnostic.json"
)
CONTRACT_PHASES = {
    "setup",
    "caldav_imports",
    "callback_imports",
    "env_port_validation",
    "callback_key_decode",
    "url_parse",
    "ca_context",
    "client_version",
    "callback_security",
    "principal_discovery",
    "calendar_discovery",
    "event_read",
    "etag_read",
    "event_update",
    "stale_etag",
    "event_create",
    "event_delete",
    "mixed_collection",
    "component_scope",
    "credential_isolation",
    "route_isolation",
    "room_discovery",
    "room_power_policy",
    "room_membership_policy",
    "personal_revocation",
    "complete",
}
CONTRACT_ERROR_CLASSES = {
    "setup_failed",
    "module_missing",
    "import_error",
    "invalid_value",
    "missing_environment",
    "tls_setup",
    "other",
    "assertion_failed",
    "operation_failed",
}
CURRENT_CONTRACT_PHASE = "setup"

KNOWN_SETUP_IMPORT_MODULES = {
    "base64",
    "caldav",
    "charset_normalizer",
    "click",
    "dateutil",
    "dns",
    "h11",
    "http",
    "icalendar",
    "icalendar_searcher",
    "json",
    "jh2",
    "lxml",
    "matrix_calendar_radicale_auth",
    "niquests",
    "os",
    "qh3",
    "recurring_ical_events",
    "six",
    "ssl",
    "time",
    "tzdata",
    "urllib",
    "urllib3_future",
    "wassima",
    "x_wr_timezone",
    "yaml",
}


def _write_contract_diagnostic(phase: str, error_class: str) -> None:
    diagnostic_path = os.environ.get(
        "MCW_PRIVATE_CALDAV_CONTRACT_DIAGNOSTIC_FILE", ""
    )
    source_sha = os.environ.get("MCW_PRIVATE_CALDAV_SOURCE_SHA", "")
    if (
        diagnostic_path != CONTRACT_DIAGNOSTIC_PATH
        or phase not in CONTRACT_PHASES
        or error_class not in CONTRACT_ERROR_CLASSES
        or len(source_sha) != 40
        or any(character not in "0123456789abcdef" for character in source_sha)
    ):
        return
    payload = {
        "schema": CONTRACT_DIAGNOSTIC_SCHEMA,
        "status": "failed",
        "source_sha": source_sha,
        "phase": phase,
        "error_class": error_class,
    }
    try:
        descriptor = os.open(
            diagnostic_path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(payload, output, sort_keys=True, separators=(",", ":"))
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
    except OSError:
        pass


def _set_contract_phase(phase: str) -> None:
    global CURRENT_CONTRACT_PHASE
    if phase not in CONTRACT_PHASES:
        raise ValueError("private CalDAV contract phase is invalid")
    CURRENT_CONTRACT_PHASE = phase


def _classify_setup_exception(phase: str, error: Exception) -> str:
    if isinstance(error, ModuleNotFoundError):
        module = error.name
        if (
            isinstance(module, str)
            and module.split(".", 1)[0] in KNOWN_SETUP_IMPORT_MODULES
        ):
            return "module_missing"
        return "other"
    if isinstance(error, ImportError):
        return "import_error"
    if phase == "env_port_validation" and isinstance(error, KeyError):
        return "missing_environment"
    if phase == "ca_context" and isinstance(
        error, (OSError, ssl.SSLError, ValueError)
    ):
        return "tls_setup"
    if isinstance(error, (TypeError, ValueError)):
        return "invalid_value"
    return "other"


def _record_setup_failure(error: Exception) -> None:
    _write_contract_diagnostic(
        CURRENT_CONTRACT_PHASE,
        _classify_setup_exception(CURRENT_CONTRACT_PHASE, error),
    )


_set_contract_phase("caldav_imports")
try:
    import caldav
    from caldav.lib import error as caldav_error
except Exception as error:
    _record_setup_failure(error)
    raise

_set_contract_phase("callback_imports")
try:
    from matrix_calendar_radicale_auth.private_client_callback import (
        AUTH_PATH,
        REQUEST_SIGNATURE_HEADER,
        RESPONSE_SIGNATURE_HEADER,
        _build_opener,
        _request_signature,
        _response_signature,
        PrivateClientCallbackClient,
    )
except Exception as error:
    _record_setup_failure(error)
    raise


_set_contract_phase("env_port_validation")
try:
    RADICALE_PORT = int(os.environ["MCW_PRIVATE_CALDAV_RADICALE_PORT"])
    CONTROL_PORT = int(os.environ["MCW_PRIVATE_CALDAV_CONTROL_PORT"])
    API_ORIGIN = os.environ["MCW_PRIVATE_CALDAV_API_ORIGIN"]
    CERTIFICATE_AUTHORITY = os.environ["MCW_PRIVATE_CALDAV_CA_FILE"]
    PERSONAL_APP_ID = os.environ["MCW_PRIVATE_CALDAV_PERSONAL_APP_ID"]
    PERSONAL_SECRET = os.environ["MCW_PRIVATE_CALDAV_PERSONAL_SECRET"]
    ROOM_APP_ID = os.environ["MCW_PRIVATE_CALDAV_ROOM_APP_ID"]
    ROOM_SECRET = os.environ["MCW_PRIVATE_CALDAV_ROOM_SECRET"]
    CONTROL_KEY = os.environ["MCW_PRIVATE_CALDAV_CONTROL_KEY"]
    CALLBACK_KEY_TEXT = os.environ["RADICALE_PRIVATE_CLIENT_CALLBACK_KEY"]
    DEFER_PERSONAL_REVOKE = (
        os.environ.get("MCW_PRIVATE_CALDAV_NATIVE_PROFILE") == "1"
    )
except Exception as error:
    _record_setup_failure(error)
    raise

_set_contract_phase("callback_key_decode")
try:
    CALLBACK_KEY = base64.urlsafe_b64decode(CALLBACK_KEY_TEXT + "=")
except Exception as error:
    _record_setup_failure(error)
    raise

_set_contract_phase("url_parse")
try:
    API = urllib.parse.urlsplit(API_ORIGIN)
except Exception as error:
    _record_setup_failure(error)
    raise

_set_contract_phase("ca_context")
try:
    TLS_CONTEXT = ssl.create_default_context(
        cafile=CERTIFICATE_AUTHORITY
    )
except Exception as error:
    _record_setup_failure(error)
    raise

EVENT = """BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//Matrix Calendar Widget//Private CalDAV contract//EN\r
BEGIN:VEVENT\r
UID:private-contract-created-event\r
DTSTAMP:20261021T100000Z\r
DTSTART:20261022T090000Z\r
DTEND:20261022T100000Z\r
SUMMARY:Client-created event\r
END:VEVENT\r
END:VCALENDAR\r
""".encode()


def basic(username: str, password: str) -> str:
    value = base64.b64encode(f"{username}:{password}".encode()).decode()
    return f"Basic {value}"


def request_api(
    method: str,
    path: str,
    *,
    body: bytes = b"",
    username: str | None = None,
    password: str | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], bytes]:
    request_headers = dict(headers or {})
    if username is not None and password is not None:
        request_headers["Authorization"] = basic(username, password)
    connection = http.client.HTTPSConnection(
        API.hostname,
        API.port,
        timeout=5,
        context=TLS_CONTEXT,
    )
    try:
        connection.request(method, path, body=body or None, headers=request_headers)
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), response.read(16 * 1024 * 1024)
    finally:
        connection.close()


def request_radicale(
    method: str,
    path: str,
    *,
    body: bytes = b"",
    username: str | None = None,
    password: str | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], bytes]:
    request_headers = dict(headers or {})
    if username is not None and password is not None:
        request_headers["Authorization"] = basic(username, password)
    connection = http.client.HTTPConnection("127.0.0.1", RADICALE_PORT, timeout=5)
    try:
        connection.request(method, path, body=body or None, headers=request_headers)
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), response.read(4 * 1024 * 1024)
    finally:
        connection.close()


def control_request(path: str, body: bytes) -> tuple[int, bytes]:
    connection = http.client.HTTPConnection("127.0.0.1", CONTROL_PORT, timeout=5)
    try:
        connection.request(
            "POST",
            path,
            body=body,
            headers={
                "Content-Type": "application/json",
                "X-Contract-Key": CONTROL_KEY,
            },
        )
        response = connection.getresponse()
        return response.status, response.read(1024)
    finally:
        connection.close()


def set_room_policy(*, member: bool | None = None, manager: bool | None = None) -> None:
    body = json.dumps(
        {key: value for key, value in {"member": member, "manager": manager}.items() if value is not None},
        separators=(",", ":"),
    ).encode()
    status, _ = control_request("/policy", body)
    assert status == 204, ("synthetic policy control", status)


def make_client(collection_url: str, app_id: str, secret: str) -> caldav.DAVClient:
    return caldav.DAVClient(
        url=collection_url,
        username=app_id,
        password=secret,
        auth_type="basic",
        enable_rfc6764=False,
        require_tls=True,
        ssl_verify_cert=CERTIFICATE_AUTHORITY,
        timeout=5,
    )


def test_callback_hostname_and_replay() -> None:
    callback = PrivateClientCallbackClient(
        f"https://127.0.0.1:{API.port}", CALLBACK_KEY
    )
    assert callback.authenticate(PERSONAL_APP_ID, PERSONAL_SECRET) is False, (
        "callback accepted a certificate with the wrong hostname"
    )

    body = json.dumps(
        {"username": PERSONAL_APP_ID, "password": PERSONAL_SECRET},
        separators=(",", ":"),
    ).encode()
    timestamp = str(int(time.time()))
    nonce = base64.urlsafe_b64encode(b"private-replay!!").decode().rstrip("=")
    assert len(base64.urlsafe_b64decode(nonce + "==")) == 16
    signature = _request_signature(
        CALLBACK_KEY, AUTH_PATH, timestamp, nonce, body
    )

    def send_signed_request() -> urllib.request.Request:
        return urllib.request.Request(
            f"{API_ORIGIN}{AUTH_PATH}",
            data=body,
            headers={
                "Accept": "application/octet-stream",
                "Content-Type": "application/octet-stream",
                "X-MCW-Callback-Timestamp": timestamp,
                "X-MCW-Callback-Nonce": nonce,
                REQUEST_SIGNATURE_HEADER: signature,
            },
            method="POST",
        )

    opener = _build_opener()
    with opener.open(send_signed_request(), timeout=5) as response:
        response_body = response.read(16 * 1024 + 1)
        assert response.status == 200
        assert json.loads(response_body) == {"allowed": True}
        assert response.headers.get(RESPONSE_SIGNATURE_HEADER) == _response_signature(
            CALLBACK_KEY, 200, AUTH_PATH, nonce, response_body
        )

    try:
        opener.open(send_signed_request(), timeout=5)
    except urllib.error.HTTPError as error:
        assert error.code == 404, "replayed callback nonce was not rejected"
    else:
        raise AssertionError("replayed callback nonce was accepted")


def _run_contract() -> None:
    _set_contract_phase("client_version")
    assert caldav.__version__ == "3.5.0", ("python-caldav version", caldav.__version__)

    _set_contract_phase("callback_security")
    test_callback_hostname_and_replay()

    personal_url = f"{API_ORIGIN}/{PERSONAL_APP_ID}/calendar/"
    client = make_client(personal_url, PERSONAL_APP_ID, PERSONAL_SECRET)
    _set_contract_phase("principal_discovery")
    principal = client.propfind(
        personal_url, props=["{DAV:}current-user-principal"], depth=0
    )
    assert principal.status == 207 and f"/{PERSONAL_APP_ID}/" in principal.raw

    _set_contract_phase("calendar_discovery")
    calendars = client.get_calendars()
    assert len(calendars) == 1, "discovery exposed a sibling calendar"
    assert str(calendars[0].url).rstrip("/").endswith(
        f"/{PERSONAL_APP_ID}/calendar"
    ), "discovery left the scoped map alias"

    _set_contract_phase("event_read")
    events = calendars[0].get_events()
    assert any("private-contract-event" in event.data for event in events)
    original = calendars[0].get_event_by_uid("private-contract-event")
    original.load()
    stale = calendars[0].get_event_by_uid("private-contract-event")
    stale.load()
    assert "X-COMPANY-OPAQUE;X-KEEP=attribute:keep-this-value" in original.data

    _set_contract_phase("etag_read")
    assert original.etag and not original.etag.startswith("W/"), "expected a strong ETag"

    _set_contract_phase("event_update")
    original.icalendar_component["summary"] = "Edited by independent CalDAV client"
    original.save(precondition="etag", increase_seqno=False)
    original.load()
    assert "X-COMPANY-OPAQUE;X-KEEP=attribute:keep-this-value" in original.data

    _set_contract_phase("stale_etag")
    stale.icalendar_component["summary"] = "Stale edit must fail"
    try:
        stale.save(precondition="etag", increase_seqno=False)
    except caldav_error.ETagMismatchError:
        pass
    else:
        raise AssertionError("stale If-Match update succeeded")

    _set_contract_phase("event_create")
    created = calendars[0].add_event(
        ical=EVENT, no_overwrite=True, increase_seqno=False
    )
    created.load()

    _set_contract_phase("event_delete")
    created.delete(if_match=True)

    _set_contract_phase("mixed_collection")
    mixed_path = f"/{PERSONAL_APP_ID}/calendar/mixed.ics"
    status, _, mixed = request_api(
        "GET",
        mixed_path,
        username=PERSONAL_APP_ID,
        password=PERSONAL_SECRET,
    )
    assert status == 200 and b"BEGIN:VTODO" in mixed
    assert b"SUMMARY:Mixed collection task before guarded writes" in mixed
    status, _, _ = request_api(
        "PUT",
        mixed_path,
        body=EVENT,
        username=PERSONAL_APP_ID,
        password=PERSONAL_SECRET,
        headers={"Content-Type": "text/calendar", "If-Match": "*"},
    )
    assert status == 409, ("client overwrote a mixed resource", status)
    status, _, _ = request_api(
        "DELETE",
        mixed_path,
        username=PERSONAL_APP_ID,
        password=PERSONAL_SECRET,
        headers={"If-Match": "*"},
    )
    assert status == 409, ("client deleted a mixed resource", status)
    owner_openid = "matrix-openid:" + base64.urlsafe_b64encode(
        json.dumps(
            {
                "access_token": "reserved-openid-proof",
                "matrix_server_name": "example.test",
            },
            separators=(",", ":"),
        ).encode()
    ).decode().rstrip("=")
    status, _, unchanged = request_radicale(
        "GET",
        "/alice/personal/mixed.ics",
        username="alice",
        password="matrix-openid:"
        + base64.urlsafe_b64encode(
            json.dumps(
                {
                    "access_token": "contract-owner-proof",
                    "matrix_server_name": "example.test",
                },
                separators=(",", ":"),
            ).encode()
        ).decode().rstrip("="),
    )
    assert (
        status == 200
        and b"BEGIN:VTODO" in unchanged
        and b"SUMMARY:Mixed collection task before guarded writes" in unchanged
    ), "the denied writes changed the existing unsupported resource"

    _set_contract_phase("component_scope")
    status, _, _ = request_api(
        "PUT",
        f"/{ROOM_APP_ID}/calendar/unsupported-task.ics",
        body=b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:out-of-scope\r\nEND:VTODO\r\nEND:VCALENDAR\r\n",
        username=ROOM_APP_ID,
        password=ROOM_SECRET,
        headers={"Content-Type": "text/calendar", "If-None-Match": "*"},
    )
    assert status == 400, ("client added VTODO to a VEVENT-only calendar", status)

    _set_contract_phase("credential_isolation")
    status, _, _ = request_api(
        "GET",
        f"/{ROOM_APP_ID}/calendar/event.ics",
        username=PERSONAL_APP_ID,
        password=PERSONAL_SECRET,
    )
    assert status == 401, "sibling app ID accepted another credential"
    status, _, _ = request_api(
        "GET",
        f"/{PERSONAL_APP_ID}/calendar/event.ics",
        username=ROOM_APP_ID,
        password=ROOM_SECRET,
    )
    assert status == 401, "sibling credential authenticated in another app home"

    # A Matrix/OpenID proof with a reserved-looking localpart must not fall
    # through the synthetic app-ID branch.
    status, _, _ = request_radicale(
        "GET",
        f"/{PERSONAL_APP_ID}/calendar/event.ics",
        username=PERSONAL_APP_ID,
        password=owner_openid,
    )
    assert status == 401, "reserved OpenID identity entered a private client home"

    _set_contract_phase("route_isolation")
    # The exact root namespace is proxied. REST, owner homes, map management,
    # and native-token paths remain outside the external DAV route.
    for method, path in (
        ("PROPFIND", "/api/v1/calendar"),
        ("POST", "/.sharing/v1/map/create"),
        ("GET", "/alice/personal/event.ics"),
        ("MKCALENDAR", f"/{PERSONAL_APP_ID}/calendar/new/")
    ):
        status, _, _ = request_api(
            method,
            path,
            username=PERSONAL_APP_ID,
            password=PERSONAL_SECRET,
            headers={"Content-Type": "application/xml"},
        )
        assert status in {404, 405}, ("non-DAV route crossed the gateway", status)

    _set_contract_phase("room_discovery")
    room_url = f"{API_ORIGIN}/{ROOM_APP_ID}/calendar/"
    room_client = make_client(room_url, ROOM_APP_ID, ROOM_SECRET)
    room_calendars = room_client.get_calendars()
    assert len(room_calendars) == 1
    room_event = room_calendars[0].get_event_by_uid("private-contract-event")
    room_event.load()

    _set_contract_phase("room_power_policy")
    set_room_policy(manager=False)
    status, _, readable = request_api(
        "GET",
        f"/{ROOM_APP_ID}/calendar/event.ics",
        username=ROOM_APP_ID,
        password=ROOM_SECRET,
    )
    assert status == 200 and b"private-contract-event" in readable
    status, _, _ = request_api(
        "PUT",
        f"/{ROOM_APP_ID}/calendar/event.ics",
        body=EVENT,
        username=ROOM_APP_ID,
        password=ROOM_SECRET,
        headers={"Content-Type": "text/calendar", "If-Match": "*"},
    )
    assert status == 403, ("manager-power loss did not make the calendar read-only", status)

    _set_contract_phase("room_membership_policy")
    set_room_policy(manager=True, member=False)
    status, _, _ = request_api(
        "GET",
        f"/{ROOM_APP_ID}/calendar/event.ics",
        username=ROOM_APP_ID,
        password=ROOM_SECRET,
    )
    assert status == 401, ("observed room leave was not denied", status)
    set_room_policy(member=True)
    status, _, _ = request_api(
        "GET",
        f"/{ROOM_APP_ID}/calendar/event.ics",
        username=ROOM_APP_ID,
        password=ROOM_SECRET,
    )
    assert status == 401, "a committed leave tombstone was revived by rejoin"

    _set_contract_phase("personal_revocation")
    if not DEFER_PERSONAL_REVOKE:
        status, _ = control_request("/revoke-personal", b"{}")
        assert status == 204
        status, _, _ = request_api(
            "GET",
            f"/{PERSONAL_APP_ID}/calendar/event.ics",
            username=PERSONAL_APP_ID,
            password=PERSONAL_SECRET,
        )
        assert status == 401, "revoked private credential remained usable"
    else:
        status, _, _ = request_api(
            "GET",
            f"/{PERSONAL_APP_ID}/calendar/event.ics",
            username=PERSONAL_APP_ID,
            password=PERSONAL_SECRET,
        )
        assert status == 200, "personal credential was revoked before Thunderbird"

    result = {
        "status": "passed",
        "radicale": "3.8.0",
        "client": "python-caldav 3.5.0",
        "tls": "trusted CA and hostname; mismatched hostname rejected",
        "callback": "source HMAC response verified; nonce replay denied",
        "discovery": "current-user-principal and scoped calendar listing passed",
        "crud": "read/create/update/conditional stale 412/delete passed",
        "mixed-collection": "VEVENT usable; VTODO resource readable but wildcard PUT and DELETE denied",
        "opaque-property": "unknown X-property preserved",
        "policy": "manager loss read-only; observed leave tombstoned; rejoin denied",
        "isolation": "sibling credential, reserved OpenID, and external sharing paths denied",
    }
    _set_contract_phase("complete")
    if DEFER_PERSONAL_REVOKE:
        result["personal_revoke"] = "deferred to native Thunderbird provider"
    print(json.dumps(result, sort_keys=True))


def main() -> None:
    try:
        _run_contract()
    except AssertionError:
        _write_contract_diagnostic(CURRENT_CONTRACT_PHASE, "assertion_failed")
        raise
    except Exception:
        _write_contract_diagnostic(CURRENT_CONTRACT_PHASE, "operation_failed")
        raise


if __name__ == "__main__":
    main()
