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

"""Small Synapse configuration adjustments for the isolated dev contract stack."""

CONTRACT_LOGIN_BURST_COUNT = 20.0


def configure_contract_login_limits(config):
    """Allow the dev contract's sequential logins without relaxing failed-login limits."""
    if not isinstance(config, dict):
        raise TypeError("Synapse configuration must be a mapping")

    login_limits = config.setdefault("rc_login", {})
    if not isinstance(login_limits, dict):
        raise TypeError("Synapse rc_login configuration must be a mapping")

    for scope in ("address", "account"):
        scope_limits = login_limits.setdefault(scope, {})
        if not isinstance(scope_limits, dict):
            raise TypeError(f"Synapse rc_login.{scope} must be a mapping")
        scope_limits["burst_count"] = CONTRACT_LOGIN_BURST_COUNT
