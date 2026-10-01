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

from __future__ import annotations

import base64
import io
import json
import logging
import unittest
import urllib.error
import urllib.parse
from unittest.mock import patch

from radicale.auth import AuthContext

from matrix_calendar_radicale_auth import (
    Auth,
    HOMESERVER_URL_ENV,
    MATRIX_OPENID_PREFIX,
    MATRIX_SERVER_NAME_ENV,
    REQUEST_TIMEOUT_SECONDS,
    USERINFO_PATH,
    _NoRedirectHandler,
    _authenticate,
)

HOMESERVER_URL = "http://synapse:8008"
MATRIX_SERVER_NAME = "localhost"
TOKEN = "sentinel-openid-access-token"


class FakeResponse:
    def __init__(self, body: bytes, status: int = 200) -> None:
        self.body = body
        self.status = status

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def getcode(self) -> int:
        return self.status

    def read(self, limit: int) -> bytes:
        return self.body[:limit]


class FakeOpener:
    def __init__(self, outcome: object | Exception) -> None:
        self.outcome = outcome
        self.requests: list[tuple[object, int]] = []

    def open(self, request: object, timeout: int) -> FakeResponse:
        self.requests.append((request, timeout))
        if isinstance(self.outcome, Exception):
            raise self.outcome
        assert isinstance(self.outcome, FakeResponse)
        return self.outcome


class FakeConfiguration:
    def __init__(self, cache_logins: bool = True) -> None:
        self.values = {
            "auth": {
                "type": "matrix_calendar_radicale_auth",
                "lc_username": False,
                "uc_username": False,
                "strip_domain": False,
                "urldecode_username": False,
                "delay": 0.0,
                "cache_logins": cache_logins,
            }
        }

    def copy(self, schema: object = None) -> FakeConfiguration:
        return self

    def get(self, section: str, key: str) -> object:
        return self.values[section][key]


def encode_credential(
    access_token: str = TOKEN,
    matrix_server_name: str = MATRIX_SERVER_NAME,
) -> str:
    payload = json.dumps(
        {
            "access_token": access_token,
            "matrix_server_name": matrix_server_name,
        },
        separators=(",", ":"),
    ).encode("utf-8")
    return MATRIX_OPENID_PREFIX + base64.urlsafe_b64encode(payload).decode().rstrip("=")


def userinfo_response(subject: str = "@alice:localhost") -> FakeResponse:
    return FakeResponse(json.dumps({"sub": subject}).encode("utf-8"))


def make_auth(opener: object, *, cache_logins: bool = True) -> Auth:
    # Patch only the HTTP factory so tests exercise BaseAuth's real
    # dispatch/cache behavior while controlling the network result.
    module = __import__(Auth.__module__, fromlist=["_build_opener"])
    with patch.dict(
        "os.environ",
        {
            HOMESERVER_URL_ENV: HOMESERVER_URL,
            MATRIX_SERVER_NAME_ENV: MATRIX_SERVER_NAME,
        },
    ), patch.object(module, "_build_opener", return_value=opener):
        return Auth(FakeConfiguration(cache_logins=cache_logins))


class AuthValidationTests(unittest.TestCase):
    def authenticate(
        self,
        opener: FakeOpener,
        *,
        username: str = "alice",
        password: str | None = None,
        server_name: str = MATRIX_SERVER_NAME,
    ) -> str:
        return _authenticate(
            username,
            encode_credential() if password is None else password,
            HOMESERVER_URL,
            server_name,
            opener,  # type: ignore[arg-type]
        )

    def test_accepts_a_valid_openid_subject_and_uses_fixed_userinfo_endpoint(self) -> None:
        opener = FakeOpener(userinfo_response())

        self.assertEqual(self.authenticate(opener), "alice")
        self.assertEqual(len(opener.requests), 1)
        request, timeout = opener.requests[0]
        parsed_url = urllib.parse.urlsplit(request.full_url)  # type: ignore[attr-defined]
        self.assertEqual(parsed_url.scheme, "http")
        self.assertEqual(parsed_url.netloc, "synapse:8008")
        self.assertEqual(parsed_url.path, USERINFO_PATH)
        self.assertEqual(
            urllib.parse.parse_qs(parsed_url.query), {"access_token": [TOKEN]}
        )
        self.assertEqual(timeout, REQUEST_TIMEOUT_SECONDS)
        self.assertEqual(request.get_method(), "GET")  # type: ignore[attr-defined]
        self.assertIsNone(request.get_header("Authorization"))  # type: ignore[attr-defined]

    def test_rejects_untagged_password_before_any_homeserver_request(self) -> None:
        opener = FakeOpener(userinfo_response())

        self.assertEqual(
            self.authenticate(opener, password="ordinary-password"), ""
        )
        self.assertEqual(opener.requests, [])

    def test_rejects_empty_or_malformed_tagged_credentials_before_request(self) -> None:
        malformed = [
            MATRIX_OPENID_PREFIX,
            MATRIX_OPENID_PREFIX + "%%%",
            MATRIX_OPENID_PREFIX + "a",
            MATRIX_OPENID_PREFIX + "e30=",  # padding is not canonical ADR009 form
            MATRIX_OPENID_PREFIX + base64.urlsafe_b64encode(b"not-json").decode().rstrip("="),
            MATRIX_OPENID_PREFIX
            + base64.urlsafe_b64encode(
                b'{"access_token":"one","access_token":"two","matrix_server_name":"localhost"}'
            ).decode().rstrip("="),
            MATRIX_OPENID_PREFIX
            + base64.urlsafe_b64encode(
                b'{"access_token":"token","matrix_server_name":"localhost","extra":1}'
            ).decode().rstrip("="),
        ]
        for credential in malformed:
            with self.subTest(credential_shape=len(credential)):
                opener = FakeOpener(userinfo_response())
                self.assertEqual(self.authenticate(opener, password=credential), "")
                self.assertEqual(opener.requests, [])

    def test_rejects_wrong_payload_server_before_request(self) -> None:
        opener = FakeOpener(userinfo_response())

        self.assertEqual(
            self.authenticate(
                opener,
                password=encode_credential(matrix_server_name="elsewhere.test"),
            ),
            "",
        )
        self.assertEqual(opener.requests, [])

    def test_rejects_wrong_user(self) -> None:
        opener = FakeOpener(userinfo_response("@mallory:localhost"))

        self.assertEqual(self.authenticate(opener), "")
        self.assertEqual(len(opener.requests), 1)

    def test_rejects_wrong_subject_server(self) -> None:
        opener = FakeOpener(userinfo_response("@alice:elsewhere.test"))

        self.assertEqual(self.authenticate(opener), "")
        self.assertEqual(len(opener.requests), 1)

    def test_rejects_malformed_userinfo_subject(self) -> None:
        for subject in (None, 12, "alice:localhost", "@:localhost", "@alice:"):
            with self.subTest(subject_type=type(subject).__name__):
                opener = FakeOpener(
                    FakeResponse(json.dumps({"sub": subject}).encode("utf-8"))
                )
                self.assertEqual(self.authenticate(opener), "")

    def test_expired_and_unknown_tokens_fail_closed(self) -> None:
        for label, status in (("expired", 401), ("unknown", 403)):
            with self.subTest(token_state=label):
                error = urllib.error.HTTPError(
                    f"{HOMESERVER_URL}{USERINFO_PATH}?access_token={TOKEN}",
                    status,
                    "Rejected",
                    {},
                    io.BytesIO(b"{}"),
                )
                opener = FakeOpener(error)
                self.assertEqual(self.authenticate(opener), "")
                self.assertEqual(len(opener.requests), 1)

    def test_homeserver_error_timeout_and_invalid_json_fail_closed(self) -> None:
        outcomes: list[object | Exception] = [
            urllib.error.HTTPError("http://synapse.invalid/", 500, "Error", {}, None),
            urllib.error.URLError("sentinel transport failure"),
            FakeResponse(b"not-json"),
            FakeResponse(b'{"sub":"@alice:localhost","sub":"@mallory:localhost"}'),
            FakeResponse(b"x" * (64 * 1024 + 1)),
        ]
        for outcome in outcomes:
            with self.subTest(outcome=type(outcome).__name__):
                opener = FakeOpener(outcome)
                self.assertEqual(self.authenticate(opener), "")

    def test_rejects_empty_and_oversized_access_tokens_before_request(self) -> None:
        for token in ("", "x" * (8 * 1024 + 1), "token\nwith-control"):
            with self.subTest(token_length=len(token)):
                opener = FakeOpener(userinfo_response())
                self.assertEqual(
                    self.authenticate(opener, password=encode_credential(token)), ""
                )
                self.assertEqual(opener.requests, [])

    def test_configured_server_name_must_match_payload_and_subject(self) -> None:
        opener = FakeOpener(userinfo_response())

        self.assertEqual(
            self.authenticate(opener, server_name="other.test"), ""
        )
        self.assertEqual(opener.requests, [])

    def test_authentication_logs_do_not_contain_tokens_or_credentials(self) -> None:
        opener = FakeOpener(
            urllib.error.HTTPError(
                f"{HOMESERVER_URL}{USERINFO_PATH}?access_token={TOKEN}",
                401,
                "Rejected",
                {},
                io.BytesIO(b"{}"),
            )
        )
        log_output = io.StringIO()
        handler = logging.StreamHandler(log_output)
        root_logger = logging.getLogger()
        root_logger.addHandler(handler)
        try:
            self.assertEqual(self.authenticate(opener), "")
        finally:
            root_logger.removeHandler(handler)
            handler.close()

        self.assertNotIn(TOKEN, log_output.getvalue())
        self.assertNotIn(encode_credential(), log_output.getvalue())


class RadicaleBaseAuthTests(unittest.TestCase):
    def test_repeated_proofs_are_verified_each_time_even_if_cache_is_requested(self) -> None:
        opener = FakeOpener(userinfo_response())
        auth = make_auth(opener, cache_logins=True)
        proof = encode_credential()

        self.assertFalse(auth._cache_logins)
        self.assertEqual(auth.login("alice", proof, AuthContext())[0], "alice")
        self.assertEqual(auth.login("alice", proof, AuthContext())[0], "alice")
        self.assertEqual(len(opener.requests), 2)

    def test_configuration_requires_a_fixed_homeserver_and_server_name(self) -> None:
        module = __import__(Auth.__module__, fromlist=["_build_opener"])
        with patch.dict(
            "os.environ",
            {
                HOMESERVER_URL_ENV: "https://user:pass@synapse.example",
                MATRIX_SERVER_NAME_ENV: MATRIX_SERVER_NAME,
            },
        ):
            with self.assertRaisesRegex(RuntimeError, "URL is invalid"):
                Auth(FakeConfiguration())

        for server_name in ("", " localhost", "localhost/path"):
            with self.subTest(server_name=server_name):
                with patch.dict(
                    "os.environ",
                    {
                        HOMESERVER_URL_ENV: HOMESERVER_URL,
                        MATRIX_SERVER_NAME_ENV: server_name,
                    },
                ), patch.object(module, "_build_opener", return_value=FakeOpener(userinfo_response())):
                    with self.assertRaisesRegex(RuntimeError, "server name is invalid"):
                        Auth(FakeConfiguration())

    def test_redirect_response_fails_closed_without_a_second_request(self) -> None:
        redirect = urllib.error.HTTPError(
            f"{HOMESERVER_URL}{USERINFO_PATH}?access_token={TOKEN}",
            302,
            "Found",
            {"Location": "https://attacker.invalid/capture"},
            io.BytesIO(b""),
        )
        opener = FakeOpener(redirect)

        self.assertEqual(
            _authenticate(
                "alice",
                encode_credential(),
                HOMESERVER_URL,
                MATRIX_SERVER_NAME,
                opener,  # type: ignore[arg-type]
            ),
            "",
        )
        self.assertEqual(len(opener.requests), 1)

    def test_redirect_handler_refuses_redirects(self) -> None:
        handler = _NoRedirectHandler()
        self.assertIsNone(
            handler.redirect_request(
                None, None, 302, "Found", {}, "https://elsewhere.invalid/"
            )
        )


if __name__ == "__main__":
    unittest.main()
