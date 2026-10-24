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

import caldav
from caldav.lib import error as caldav_error

from matrix_calendar_radicale_auth.private_client_callback import (
    AUTH_PATH,
    REQUEST_SIGNATURE_HEADER,
    RESPONSE_SIGNATURE_HEADER,
    _build_opener,
    _request_signature,
    _response_signature,
    PrivateClientCallbackClient,
)


RADICALE_PORT = int(os.environ["MCW_PRIVATE_CALDAV_RADICALE_PORT"])
CONTROL_PORT = int(os.environ["MCW_PRIVATE_CALDAV_CONTROL_PORT"])
API_ORIGIN = os.environ["MCW_PRIVATE_CALDAV_API_ORIGIN"]
CERTIFICATE_AUTHORITY = os.environ["MCW_PRIVATE_CALDAV_CA_FILE"]
PERSONAL_APP_ID = os.environ["MCW_PRIVATE_CALDAV_PERSONAL_APP_ID"]
PERSONAL_SECRET = os.environ["MCW_PRIVATE_CALDAV_PERSONAL_SECRET"]
ROOM_APP_ID = os.environ["MCW_PRIVATE_CALDAV_ROOM_APP_ID"]
ROOM_SECRET = os.environ["MCW_PRIVATE_CALDAV_ROOM_SECRET"]
CONTROL_KEY = os.environ["MCW_PRIVATE_CALDAV_CONTROL_KEY"]
CALLBACK_KEY = base64.urlsafe_b64decode(
    os.environ["RADICALE_PRIVATE_CLIENT_CALLBACK_KEY"] + "="
)
API = urllib.parse.urlsplit(API_ORIGIN)
TLS_CONTEXT = ssl.create_default_context(cafile=CERTIFICATE_AUTHORITY)

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


def main() -> None:
    assert caldav.__version__ == "3.5.0", ("python-caldav version", caldav.__version__)
    test_callback_hostname_and_replay()

    personal_url = f"{API_ORIGIN}/{PERSONAL_APP_ID}/calendar/"
    client = make_client(personal_url, PERSONAL_APP_ID, PERSONAL_SECRET)
    principal = client.propfind(
        personal_url, props=["{DAV:}current-user-principal"], depth=0
    )
    assert principal.status == 207 and f"/{PERSONAL_APP_ID}/" in principal.raw
    calendars = client.get_calendars()
    assert len(calendars) == 1, "discovery exposed a sibling calendar"
    assert str(calendars[0].url).rstrip("/").endswith(
        f"/{PERSONAL_APP_ID}/calendar"
    ), "discovery left the scoped map alias"

    events = calendars[0].get_events()
    assert any("private-contract-event" in event.data for event in events)
    original = calendars[0].get_event_by_uid("private-contract-event")
    original.load()
    stale = calendars[0].get_event_by_uid("private-contract-event")
    stale.load()
    assert "X-COMPANY-OPAQUE;X-KEEP=attribute:keep-this-value" in original.data
    assert original.etag and not original.etag.startswith("W/"), "expected a strong ETag"
    original.icalendar_component["summary"] = "Edited by independent CalDAV client"
    original.save(precondition="etag", increase_seqno=False)
    original.load()
    assert "X-COMPANY-OPAQUE;X-KEEP=attribute:keep-this-value" in original.data

    stale.icalendar_component["summary"] = "Stale edit must fail"
    try:
        stale.save(precondition="etag", increase_seqno=False)
    except caldav_error.ETagMismatchError:
        pass
    else:
        raise AssertionError("stale If-Match update succeeded")

    created = calendars[0].add_event(
        ical=EVENT, no_overwrite=True, increase_seqno=False
    )
    created.load()
    created.delete(if_match=True)

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
    status, _, _ = request_api(
        "PUT",
        f"/{ROOM_APP_ID}/calendar/unsupported-task.ics",
        body=b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:out-of-scope\r\nEND:VTODO\r\nEND:VCALENDAR\r\n",
        username=ROOM_APP_ID,
        password=ROOM_SECRET,
        headers={"Content-Type": "text/calendar", "If-None-Match": "*"},
    )
    assert status == 400, ("client added VTODO to a VEVENT-only calendar", status)

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

    room_url = f"{API_ORIGIN}/{ROOM_APP_ID}/calendar/"
    room_client = make_client(room_url, ROOM_APP_ID, ROOM_SECRET)
    room_calendars = room_client.get_calendars()
    assert len(room_calendars) == 1
    room_event = room_calendars[0].get_event_by_uid("private-contract-event")
    room_event.load()

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

    status, _ = control_request("/revoke-personal", b"{}")
    assert status == 204
    status, _, _ = request_api(
        "GET",
        f"/{PERSONAL_APP_ID}/calendar/event.ics",
        username=PERSONAL_APP_ID,
        password=PERSONAL_SECRET,
    )
    assert status == 401, "revoked private credential remained usable"

    print(
        json.dumps(
            {
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
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
