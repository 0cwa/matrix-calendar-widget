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

import hashlib
import hmac
import importlib.util
import io
import json
import ssl
import subprocess
import sys
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

from matrix_calendar_private_client_callback import (
    AUTH_PATH,
    CALLBACK_TIMEOUT_SECONDS,
    CALLBACK_KEY_ENV,
    CALLBACK_ORIGIN_ENV,
    PrivateClientCallbackClient,
    _request_signature,
    _build_opener,
    _response_signature,
    configured_callback_key,
    configured_callback_origin,
)


APP_ID = "mcwpc~0123456789abcdef0123456789abcdef0123456789abcdef"
SECRET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq"
KEY = bytes(range(32))


class FakeResponse:
    def __init__(self, body: bytes, signature: str, status: int = 200) -> None:
        self.body = body
        self.status = status
        self.headers = {
            "X-MCW-Callback-Response-Signature": signature,
            "Content-Type": "application/octet-stream",
        }

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def getcode(self) -> int:
        return self.status

    def read(self, limit: int) -> bytes:
        return self.body[:limit]


class FakeOpener:
    def __init__(self, result: FakeResponse | Exception) -> None:
        self.result = result
        self.requests: list[tuple[object, int]] = []

    def open(self, request: object, timeout: int) -> FakeResponse:
        self.requests.append((request, timeout))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class PrivateClientCallbackTests(unittest.TestCase):
    def test_callback_module_imports_without_radicale_installed(self) -> None:
        source = Path(__file__).parents[1] / "src"
        program = """
import importlib.util
import sys
sys.path.insert(0, sys.argv[1])
assert importlib.util.find_spec("radicale") is None
import matrix_calendar_private_client_callback
assert not any(
    name == "radicale" or name.startswith("radicale.")
    for name in sys.modules
)
assert matrix_calendar_private_client_callback.AUTH_PATH.endswith("/auth")
"""
        result = subprocess.run(
            [sys.executable, "-S", "-c", program, str(source)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10,
            check=False,
        )
        self.assertEqual(result.returncode, 0)

    def test_package_callback_submodule_reexports_dependency_light_symbols(self) -> None:
        if importlib.util.find_spec("radicale") is None:
            self.skipTest("Radicale is needed to import its compatibility package")
        from matrix_calendar_radicale_auth.private_client_callback import (
            PrivateClientCallbackClient as CompatibilityClient,
            _request_signature as compatibility_request_signature,
        )

        self.assertIs(CompatibilityClient, PrivateClientCallbackClient)
        self.assertIs(compatibility_request_signature, _request_signature)

    def test_request_is_signed_and_response_is_authenticated(self) -> None:
        nonce_bytes = b"n" * 16
        nonce = "bm5ubm5ubm5ubm5ubm5ubg"
        body = json.dumps(
            {"allowed": True}, separators=(",", ":")
        ).encode("utf-8")
        opener = FakeOpener(
            FakeResponse(body, _response_signature(KEY, 200, AUTH_PATH, nonce, body))
        )
        client = PrivateClientCallbackClient(
            "https://policy.example.test",
            KEY,
            opener=opener,
            now=lambda: 1_792_590_000,
            nonce_bytes=lambda size: nonce_bytes if size == 16 else b"",
        )

        self.assertTrue(client.authenticate(APP_ID, SECRET))
        request, timeout = opener.requests[0]
        self.assertEqual(request.full_url, f"https://policy.example.test{AUTH_PATH}")  # type: ignore[attr-defined]
        self.assertEqual(request.get_method(), "POST")  # type: ignore[attr-defined]
        self.assertEqual(request.get_header("Content-type"), "application/octet-stream")  # type: ignore[attr-defined]
        self.assertEqual(request.get_header("X-mcw-callback-timestamp"), "1792590000")  # type: ignore[attr-defined]
        self.assertEqual(request.get_header("X-mcw-callback-nonce"), nonce)  # type: ignore[attr-defined]
        self.assertEqual(timeout, CALLBACK_TIMEOUT_SECONDS)
        request_body = request.data  # type: ignore[attr-defined]
        body_hash = hashlib.sha256(request_body).hexdigest()
        message = (
            f"mcw-private-callback-v1\nPOST\n{AUTH_PATH}\n1792590000\n"
            f"{nonce}\n{body_hash}"
        ).encode("ascii")
        expected = hmac.new(KEY, message, hashlib.sha256).hexdigest()
        self.assertEqual(
            request.get_header("X-mcw-callback-signature"), expected  # type: ignore[attr-defined]
        )
        self.assertEqual(json.loads(request_body), {"username": APP_ID, "password": SECRET})

    def test_invalid_response_hmac_and_redirect_fail_closed(self) -> None:
        body = b'{"allowed":true}'
        bad_hmac = FakeOpener(FakeResponse(body, "0" * 64))
        bad_redirect = FakeOpener(
            urllib.error.HTTPError(
                "https://policy.example.test/private",
                302,
                "Found",
                {"Location": "https://elsewhere.invalid/"},
                io.BytesIO(b""),
            )
        )

        for opener in (bad_hmac, bad_redirect):
            with self.subTest(opener=type(opener).__name__):
                client = PrivateClientCallbackClient(
                    "https://policy.example.test", KEY, opener=opener
                )
                self.assertFalse(client.authenticate(APP_ID, SECRET))

    def test_callback_configuration_requires_https_and_a_32_byte_key(self) -> None:
        encoded_key = __import__("base64").urlsafe_b64encode(KEY).decode().rstrip("=")
        with patch.dict(
            "os.environ",
            {
                CALLBACK_ORIGIN_ENV: "http://policy.example.test",
                CALLBACK_KEY_ENV: encoded_key,
            },
        ):
            with self.assertRaisesRegex(RuntimeError, "origin is invalid"):
                configured_callback_origin()

        with patch.dict(
            "os.environ",
            {
                CALLBACK_ORIGIN_ENV: "https://policy.example.test",
                CALLBACK_KEY_ENV: "short",
            },
        ):
            self.assertEqual(configured_callback_origin(), "https://policy.example.test")
            with self.assertRaisesRegex(RuntimeError, "key is invalid"):
                configured_callback_key()

    def test_opener_disables_proxy_and_keeps_verified_tls(self) -> None:
        build_opener = urllib.request.build_opener
        with patch.object(urllib.request, "build_opener", wraps=build_opener) as build:
            opener = _build_opener()
        proxy = next(
            handler
            for handler in build.call_args.args
            if isinstance(handler, urllib.request.ProxyHandler)
        )
        https = next(
            handler
            for handler in opener.handlers
            if type(handler).__name__ == "HTTPSHandler"
        )

        self.assertEqual(proxy.proxies, {})
        self.assertFalse(
            any(isinstance(handler, urllib.request.ProxyHandler) for handler in opener.handlers)
        )
        self.assertEqual(https._context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(https._context.check_hostname)


if __name__ == "__main__":
    unittest.main()
