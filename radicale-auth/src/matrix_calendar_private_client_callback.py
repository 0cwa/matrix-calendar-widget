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

"""Fixed-path, mutually authenticated private-client policy callback."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from typing import Any

CALLBACK_ORIGIN_ENV = "RADICALE_PRIVATE_CLIENT_CALLBACK_ORIGIN"
CALLBACK_KEY_ENV = "RADICALE_PRIVATE_CLIENT_CALLBACK_KEY"
CALLBACK_TIMEOUT_SECONDS = 5
MAX_CALLBACK_BODY_BYTES = 16 * 1024
AUTH_PATH = "/v1/private-calendar-client-callback/auth"
RIGHTS_PATH = "/v1/private-calendar-client-callback/rights"
REQUEST_SIGNATURE_HEADER = "X-MCW-Callback-Signature"
RESPONSE_SIGNATURE_HEADER = "X-MCW-Callback-Response-Signature"


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        request: urllib.request.Request,
        file_pointer: Any,
        code: int,
        message: str,
        headers: Any,
        new_url: str,
    ) -> None:
        return None


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON member")
        result[key] = value
    return result


def configured_callback_origin() -> str | None:
    value = os.environ.get(CALLBACK_ORIGIN_ENV, "")
    if not value:
        return None
    try:
        parsed = urllib.parse.urlsplit(value)
        _ = parsed.port
    except ValueError as error:
        raise RuntimeError("Private-client callback origin is invalid") from error
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or value != value.strip()
    ):
        raise RuntimeError("Private-client callback origin is invalid")
    return urllib.parse.urlunsplit(("https", parsed.netloc, "", "", ""))


def configured_callback_key() -> bytes | None:
    value = os.environ.get(CALLBACK_KEY_ENV, "")
    if not value:
        return None
    if len(value) != 43 or any(character not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-" for character in value):
        raise RuntimeError("Private-client callback key is invalid")
    try:
        key = base64.urlsafe_b64decode(value + "=")
    except Exception as error:
        raise RuntimeError("Private-client callback key is invalid") from error
    if len(key) != 32 or base64.urlsafe_b64encode(key).decode("ascii").rstrip("=") != value:
        raise RuntimeError("Private-client callback key is invalid")
    return key


def _build_opener() -> urllib.request.OpenerDirector:
    # Never inherit proxy settings. The endpoint is fixed and its TLS chain and
    # hostname are checked by the platform's default verified SSL context.
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        urllib.request.HTTPSHandler(context=ssl.create_default_context()),
        _NoRedirectHandler(),
    )


class PrivateClientCallbackClient:
    def __init__(
        self,
        origin: str | None,
        key: bytes | None,
        opener: Any | None = None,
        now: Callable[[], float] = time.time,
        nonce_bytes: Callable[[int], bytes] = secrets.token_bytes,
    ) -> None:
        self._origin = origin
        self._key = key
        self._opener = opener if opener is not None else _build_opener()
        self._now = now
        self._nonce_bytes = nonce_bytes

    @classmethod
    def from_environment(cls) -> PrivateClientCallbackClient:
        return cls(configured_callback_origin(), configured_callback_key())

    def authenticate(self, username: str, password: str) -> bool:
        result = self._request(AUTH_PATH, {"username": username, "password": password})
        return isinstance(result, dict) and set(result) == {"allowed"} and result["allowed"] is True

    def rights(self, username: str, path: str) -> str:
        result = self._request(RIGHTS_PATH, {"username": username, "path": path})
        if not isinstance(result, dict) or set(result) != {"rights"}:
            return ""
        rights = result["rights"]
        if rights not in {"", "R", "r", "rw", "RWdD"}:
            return ""
        return rights

    def _request(self, path: str, payload: dict[str, str]) -> dict[str, Any] | None:
        if not self._origin or self._key is None or len(self._key) != 32:
            return None
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        if len(body) > MAX_CALLBACK_BODY_BYTES:
            return None
        nonce_raw = self._nonce_bytes(16)
        if len(nonce_raw) != 16:
            return None
        nonce = base64.urlsafe_b64encode(nonce_raw).decode("ascii").rstrip("=")
        timestamp = str(int(self._now()))
        signature = _request_signature(self._key, path, timestamp, nonce, body)
        request = urllib.request.Request(
            f"{self._origin}{path}",
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
        try:
            with self._opener.open(request, timeout=CALLBACK_TIMEOUT_SECONDS) as response:
                if response.getcode() != 200:
                    return None
                response_body = response.read(MAX_CALLBACK_BODY_BYTES + 1)
                if len(response_body) > MAX_CALLBACK_BODY_BYTES:
                    return None
                response_signature = response.headers.get(RESPONSE_SIGNATURE_HEADER, "")
                expected = _response_signature(self._key, 200, path, nonce, response_body)
                if not hmac.compare_digest(response_signature, expected):
                    return None
        except (urllib.error.URLError, OSError, TimeoutError, ValueError):
            return None
        except Exception:
            # Keep callback URLs, app credentials and response bodies out of logs.
            return None

        try:
            result = json.loads(
                response_body.decode("utf-8"),
                object_pairs_hook=_reject_duplicate_json_keys,
            )
        except (ValueError, UnicodeDecodeError):
            return None
        return result if isinstance(result, dict) else None


def _request_signature(key: bytes, path: str, timestamp: str, nonce: str, body: bytes) -> str:
    body_hash = hashlib.sha256(body).hexdigest()
    message = f"mcw-private-callback-v1\nPOST\n{path}\n{timestamp}\n{nonce}\n{body_hash}".encode("ascii")
    return hmac.new(key, message, hashlib.sha256).hexdigest()


def _response_signature(key: bytes, status: int, path: str, nonce: str, body: bytes) -> str:
    body_hash = hashlib.sha256(body).hexdigest()
    message = f"mcw-private-callback-response-v1\n{status}\n{path}\n{nonce}\n{body_hash}".encode("ascii")
    return hmac.new(key, message, hashlib.sha256).hexdigest()
