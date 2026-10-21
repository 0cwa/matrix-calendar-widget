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

"""Composite Radicale rights: owner_only for Matrix principals, fresh callback for app IDs."""

from __future__ import annotations

import re
from typing import Any

from radicale import pathutils
from radicale.rights import BaseRights
from radicale.rights.owner_only import Rights as OwnerOnlyRights

from .private_client_callback import PrivateClientCallbackClient

_APP_ID_PREFIX = "mcwpc~"
_APP_ID_PATTERN = re.compile(r"^mcwpc~[a-f0-9]{48}$")
_ALLOWED_PRIVATE_RIGHTS = {"", "R", "r", "rw"}


class Rights(BaseRights):
    """Do not route synthetic app IDs through owner_only's namespace rules."""

    def __init__(self, configuration: Any) -> None:
        super().__init__(configuration)
        self._owner_only = OwnerOnlyRights(configuration)
        self._private_client_callback = PrivateClientCallbackClient.from_environment()

    def authorization(self, user: str, path: str) -> str:
        if not isinstance(user, str) or not user.startswith(_APP_ID_PREFIX):
            return self._owner_only.authorization(user, path)
        if not _APP_ID_PATTERN.fullmatch(user) or not isinstance(path, str):
            return ""
        rights = self._private_client_callback.rights(user, path)
        return rights if rights in _ALLOWED_PRIVATE_RIGHTS else ""
