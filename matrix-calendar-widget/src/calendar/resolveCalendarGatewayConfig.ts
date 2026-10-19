/*
 * Copyright 2026 Matrix Calendar Widget contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export type CalendarGatewayConfig = {
  baseUrl: string;
  roomId: string;
};

/**
 * A missing gateway configuration must never select an ephemeral writable
 * repository in the deployed widget. Tests/demos can still inject their own
 * CalendarRepository through AppContainer.
 */
export function resolveCalendarGatewayConfig(
  widgetBaseUrl: unknown,
  environmentBaseUrl: unknown,
  roomId: unknown,
): CalendarGatewayConfig | undefined {
  const baseUrl = widgetBaseUrl ?? environmentBaseUrl;

  if (
    typeof baseUrl !== 'string' ||
    baseUrl.trim().length === 0 ||
    typeof roomId !== 'string' ||
    roomId.trim().length === 0
  ) {
    return undefined;
  }

  return { baseUrl, roomId };
}
