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

import copy
import unittest

from synapse_contract_config import (
    CONTRACT_LOGIN_BURST_COUNT,
    configure_contract_login_limits,
)


class SynapseContractConfigTests(unittest.TestCase):
    def test_raises_only_address_and_account_bursts(self):
        config = {
            "app_service_config_files": ["/data/appservice-calendar-contract.yaml"],
            "rc_login": {
                "address": {"per_second": 0.003, "burst_count": 5.0},
                "account": {"per_second": 0.003, "burst_count": 5.0},
                "failed_attempts": {"per_second": 0.17, "burst_count": 3.0},
            },
        }
        before = copy.deepcopy(config)

        configure_contract_login_limits(config)

        self.assertEqual(
            config["rc_login"]["address"],
            {"per_second": 0.003, "burst_count": CONTRACT_LOGIN_BURST_COUNT},
        )
        self.assertEqual(
            config["rc_login"]["account"],
            {"per_second": 0.003, "burst_count": CONTRACT_LOGIN_BURST_COUNT},
        )
        self.assertEqual(
            config["rc_login"]["failed_attempts"],
            before["rc_login"]["failed_attempts"],
        )
        self.assertEqual(
            config["app_service_config_files"],
            before["app_service_config_files"],
        )

    def test_adds_only_the_two_contract_login_burst_overrides(self):
        config = {}

        configure_contract_login_limits(config)

        self.assertEqual(
            config,
            {
                "rc_login": {
                    "address": {"burst_count": CONTRACT_LOGIN_BURST_COUNT},
                    "account": {"burst_count": CONTRACT_LOGIN_BURST_COUNT},
                }
            },
        )

    def test_rejects_invalid_rc_login_shapes_without_replacing_them(self):
        config = {"rc_login": []}

        with self.assertRaises(TypeError):
            configure_contract_login_limits(config)

        self.assertEqual(config["rc_login"], [])


if __name__ == "__main__":
    unittest.main()
