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

"""Compatibility exports for the dependency-light callback protocol."""

from __future__ import annotations

from matrix_calendar_private_client_callback import (
    AUTH_PATH,
    CALLBACK_KEY_ENV,
    CALLBACK_ORIGIN_ENV,
    CALLBACK_TIMEOUT_SECONDS,
    MAX_CALLBACK_BODY_BYTES,
    REQUEST_SIGNATURE_HEADER,
    RESPONSE_SIGNATURE_HEADER,
    RIGHTS_PATH,
    PrivateClientCallbackClient,
    _NoRedirectHandler,
    _build_opener,
    _reject_duplicate_json_keys,
    _request_signature,
    _response_signature,
    configured_callback_key,
    configured_callback_origin,
)
