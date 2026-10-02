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

"""Apply py-vobject's isolated PERIOD serializer change to the base image.

The code change follows py-vobject commit
952210e1d1c3a6f17dac1c29c3be24bf3be9bc3f. The pinned Radicale base image's
vobject distribution and version are preserved; only its serializer source is
patched.
"""

from importlib.metadata import version
from pathlib import Path

import vobject.icalendar


base_version = version("vobject")
source_path = Path(vobject.icalendar.__file__)
source = source_path.read_text(encoding="utf-8")
old = """                for val in obj.value:
                    if tzid is None and type(val) == datetime.datetime:
"""
new = """                for val in obj.value:
                    if obj.value_param == "PERIOD":
                        if type(val[0]) is datetime.datetime and type(val[1]) is datetime.timedelta:
                            transformed.append(periodToString(val))
                            continue
                        elif type(val[0]) is datetime.datetime and type(val[1]) is datetime.datetime:
                            transformed.append(dateTimeToString(val[0]) + '/' + dateTimeToString(val[1]))
                            continue
                    if tzid is None and type(val) == datetime.datetime:
"""

if source.count(new) == 1:
    raise SystemExit(0)

required_helpers = ("periodToString(", "dateTimeToString(")
if (
    source.count(old) != 1
    or "# Fixme: handle PERIOD case" not in source
    or any(helper not in source for helper in required_helpers)
):
    raise RuntimeError(
        "the inherited vobject serializer does not match the supported source shape"
    )

source_path.write_text(source.replace(old, new, 1), encoding="utf-8")
if version("vobject") != base_version:
    raise RuntimeError("the PERIOD serializer patch changed the vobject version")
