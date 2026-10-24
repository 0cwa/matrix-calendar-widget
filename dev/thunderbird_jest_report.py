#!/usr/bin/env python3
"""Read bounded, owned Jest JSON reports without exposing their contents."""

from __future__ import annotations

import json
import os
from pathlib import Path
import stat
from typing import Any


def _unique_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON field")
        result[key] = value
    return result


def read_owned_json_object(path: Path, *, max_bytes: int) -> dict[str, Any]:
    """Read one private regular JSON file, rejecting links and duplicate keys."""
    if type(max_bytes) is not int or max_bytes <= 0:
        raise ValueError("Jest report is invalid")
    descriptor = -1
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
            or metadata.st_size <= 0
            or metadata.st_size > max_bytes
        ):
            raise ValueError
        with os.fdopen(descriptor, "rb", closefd=False) as report:
            data = report.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise ValueError
        value = json.loads(data.decode("utf-8"), object_pairs_hook=_unique_json_object)
    except (OSError, UnicodeDecodeError, ValueError, json.JSONDecodeError):
        raise ValueError("Jest report is invalid") from None
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    if not isinstance(value, dict):
        raise ValueError("Jest report is invalid")
    return value
