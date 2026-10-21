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

"""Redact native public-feed bearer paths from Radicale diagnostics."""

from __future__ import annotations

import logging
import re
import traceback

from radicale.log import logger

_TOKEN_PATH = re.compile(r"(?i)(/\.token/v1/)[^/?\s'\"<>]+")
_ENCODED_TOKEN_STORAGE_PATH = re.compile(
    r"(?i)(%2f\.token%2fv1%2f)[^/%\s'\"<>]+(%2f)"
)
_REDACTED = r"\1[REDACTED]"


class PublicFeedTokenPathFilter(logging.Filter):
    """Keep Radicale diagnostics useful without recording feed credentials."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            message = "Radicale log message was redacted after formatting failed"
        record.msg = _redact_token_paths(message)
        record.args = ()

        if record.exc_info is not None:
            try:
                exception_text = "".join(traceback.format_exception(*record.exc_info))
            except Exception:
                exception_text = "Radicale exception details were redacted"
            record.exc_text = _redact_token_paths(exception_text)
            record.exc_info = None
        elif record.exc_text:
            record.exc_text = _redact_token_paths(record.exc_text)
        return True


def _redact_token_paths(value: str) -> str:
    return _ENCODED_TOKEN_STORAGE_PATH.sub(
        r"\1[REDACTED]\2", _TOKEN_PATH.sub(_REDACTED, value)
    )


def install_public_feed_token_path_filter() -> None:
    """Install exactly one filter on Radicale's shared application logger."""
    if not any(isinstance(value, PublicFeedTokenPathFilter) for value in logger.filters):
        logger.addFilter(PublicFeedTokenPathFilter())
