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

"""OpenID-only Radicale authentication for Matrix Calendar Widget."""

from __future__ import annotations

import base64
import binascii
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from typing import Any

from radicale.auth import BaseAuth

MATRIX_OPENID_PREFIX = "matrix-openid:"
HOMESERVER_URL_ENV = "RADICALE_MATRIX_HOMESERVER_URL"
MATRIX_SERVER_NAME_ENV = "RADICALE_MATRIX_SERVER_NAME"
USERINFO_PATH = "/_matrix/federation/v1/openid/userinfo"
REQUEST_TIMEOUT_SECONDS = 5
MAX_CREDENTIAL_LENGTH = 16 * 1024
MAX_ACCESS_TOKEN_LENGTH = 8 * 1024
MAX_USERINFO_RESPONSE_BYTES = 64 * 1024
_BASE64URL_RE = re.compile(r"^[A-Za-z0-9_-]+$")

PLUGIN_CONFIG_SCHEMA: dict[str, dict[str, Any]] = {"auth": {}}


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Prevent an access token in the userinfo query from crossing origins."""

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


def _build_opener() -> urllib.request.OpenerDirector:
    # Do not inherit proxy settings implicitly: userinfo places the short-lived
    # token in a query parameter, so the only destination is the configured
    # homeserver itself.
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        _NoRedirectHandler(),
    )


def _configured_homeserver_url() -> str:
    value = os.environ.get(HOMESERVER_URL_ENV, "")
    try:
        parsed = urllib.parse.urlsplit(value)
        # Accessing .port validates malformed port values.
        _ = parsed.port
    except ValueError as error:
        raise RuntimeError("Radicale OpenID homeserver URL is invalid") from error

    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError("Radicale OpenID homeserver URL is invalid")

    return urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, "", "", "")
    ).rstrip("/")


def _configured_matrix_server_name() -> str:
    value = os.environ.get(MATRIX_SERVER_NAME_ENV, "")
    if (
        not value
        or value != value.strip()
        or any(character.isspace() or character in "/?#" for character in value)
    ):
        raise RuntimeError("Radicale OpenID Matrix server name is invalid")
    return value


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON member")
        result[key] = value
    return result


def _decode_credential(password: str) -> tuple[str, str] | None:
    if (
        not isinstance(password, str)
        or not password.startswith(MATRIX_OPENID_PREFIX)
        or len(password) > MAX_CREDENTIAL_LENGTH
    ):
        return None

    encoded_payload = password[len(MATRIX_OPENID_PREFIX) :]
    if not _BASE64URL_RE.fullmatch(encoded_payload):
        return None

    try:
        padding = "=" * ((4 - len(encoded_payload) % 4) % 4)
        payload_bytes = base64.urlsafe_b64decode(encoded_payload + padding)
        if base64.urlsafe_b64encode(payload_bytes).decode("ascii").rstrip("=") != encoded_payload:
            return None
        payload = json.loads(
            payload_bytes.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_json_keys,
        )
    except (ValueError, UnicodeDecodeError, binascii.Error):
        return None

    if not isinstance(payload, dict) or set(payload) != {
        "access_token",
        "matrix_server_name",
    }:
        return None

    access_token = payload["access_token"]
    matrix_server_name = payload["matrix_server_name"]
    if (
        not isinstance(access_token, str)
        or not access_token
        or len(access_token) > MAX_ACCESS_TOKEN_LENGTH
        or access_token != access_token.strip()
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in access_token)
        or not isinstance(matrix_server_name, str)
        or not matrix_server_name
        or matrix_server_name != matrix_server_name.strip()
        or any(
            character.isspace() or character in "/?#"
            for character in matrix_server_name
        )
    ):
        return None

    return access_token, matrix_server_name


def _parse_matrix_user_id(subject: Any) -> tuple[str, str] | None:
    if not isinstance(subject, str) or not subject.startswith("@"):
        return None

    localpart, separator, server_name = subject[1:].partition(":")
    if (
        not separator
        or not localpart
        or not server_name
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in subject)
    ):
        return None

    return localpart, server_name


def _read_userinfo(
    homeserver_url: str,
    access_token: str,
    opener: urllib.request.OpenerDirector,
) -> dict[str, Any] | None:
    query = urllib.parse.urlencode({"access_token": access_token})
    request = urllib.request.Request(
        f"{homeserver_url}{USERINFO_PATH}?{query}",
        headers={"Accept": "application/json"},
        method="GET",
    )

    try:
        with opener.open(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            if response.getcode() != 200:
                return None
            body = response.read(MAX_USERINFO_RESPONSE_BYTES + 1)
    except (urllib.error.URLError, OSError, TimeoutError, ValueError):
        return None
    except Exception:
        # Keep URL-bearing HTTPError text and unexpected transport details out
        # of Radicale's authentication logs and client-facing errors.
        return None

    if len(body) > MAX_USERINFO_RESPONSE_BYTES:
        return None

    try:
        result = json.loads(
            body.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_json_keys,
        )
    except (ValueError, UnicodeDecodeError):
        return None

    return result if isinstance(result, dict) else None


def _authenticate(
    username: str,
    password: str,
    homeserver_url: str,
    matrix_server_name: str,
    opener: urllib.request.OpenerDirector,
) -> str:
    if (
        not isinstance(username, str)
        or not username
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in username)
    ):
        return ""

    credential = _decode_credential(password)
    if credential is None:
        return ""

    access_token, payload_server_name = credential
    if payload_server_name != matrix_server_name:
        return ""

    userinfo = _read_userinfo(homeserver_url, access_token, opener)
    if userinfo is None:
        return ""

    subject = _parse_matrix_user_id(userinfo.get("sub"))
    if subject is None:
        return ""

    subject_localpart, subject_server_name = subject
    if (
        subject_localpart != username
        or subject_server_name != payload_server_name
        or subject_server_name != matrix_server_name
    ):
        return ""

    return username


class Auth(BaseAuth):
    """Radicale Auth backend that validates only tagged Matrix OpenID proofs."""

    def __init__(self, configuration: Any) -> None:
        homeserver_url = _configured_homeserver_url()
        matrix_server_name = _configured_matrix_server_name()
        super().__init__(configuration.copy(PLUGIN_CONFIG_SCHEMA))
        self._homeserver_url = homeserver_url
        self._matrix_server_name = matrix_server_name
        self._opener = _build_opener()

    def _login(self, login: str, password: str) -> str:
        return _authenticate(
            login,
            password,
            self._homeserver_url,
            self._matrix_server_name,
            self._opener,
        )
