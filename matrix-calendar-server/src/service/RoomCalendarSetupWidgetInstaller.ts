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

import type { MatrixClient } from 'matrix-bot-sdk';
import { isDeepStrictEqual } from 'node:util';
import type { WidgetClient } from '../client/WidgetClient';
import type { RoomCalendarBinding } from '../model/IRoomCalendarBinding';
import type { IWidgetContent } from '../model/IWidgetContent';
import { StateEventName } from '../model/StateEventName';
import { WidgetType } from '../model/WidgetType';
import type {
  RoomCalendarSetupWidgetPort,
  RoomCalendarSetupWidgetPreflightOutcome,
} from './RoomCalendarSetupPorts';

const CALENDAR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const MAX_WIDGET_ID_LENGTH = 255;
const ROOM_ID_PARAMETER = 'matrix_room_id';
const GATEWAY_URL_PARAMETER = 'meetings_bot_base_url';
const WIDGET_ID_PARAMETER = 'matrix_widget_id';
const WIDGET_ID_MACRO = '$matrix_widget_id';
const ROOM_ID_MACRO = '$matrix_room_id';
const CREDENTIAL_PARAMETER_NAME_PATTERNS = [
  /(?:^|[^a-z0-9])token(?:$|[^a-z0-9])/u,
  /(?:^|[^a-z0-9])(?:auth|authorization)(?:$|[^a-z0-9])/u,
  /(?:^|[^a-z0-9])(?:password|passwd|pwd)(?:$|[^a-z0-9])/u,
  /(?:^|[^a-z0-9])secret(?:$|[^a-z0-9])/u,
  /(?:^|[^a-z0-9])(?:api|access|private)[_-]?key(?:$|[^a-z0-9])/u,
  /(?:^|[^a-z0-9])cookie(?:$|[^a-z0-9])/u,
  /(?:^|[^a-z0-9])session(?:[_-]?id)?(?:$|[^a-z0-9])/u,
  /(?:^|[^a-z0-9])bearer(?:[_-]?token)?(?:$|[^a-z0-9])/u,
  /(?:^|[^a-z0-9])credentials?(?:$|[^a-z0-9])/u,
];

/** The old pilot app used this generic widget kind for its calendar entry. */
export const SUPPORTED_LEGACY_CALENDAR_WIDGET_TYPE = 'custom';
const SUPPORTED_LEGACY_MATRIX_CUSTOM_WIDGET_TYPE = 'm.custom';

export type RoomCalendarSetupWidgetMatrixPort = Pick<
  MatrixClient,
  'getRoomState' | 'sendStateEvent' | 'getUserId'
>;

export type RoomCalendarSetupWidgetContentPort = Pick<
  WidgetClient,
  'getMeetingWidgetEventContentAsync'
>;

type WidgetStateEvent = Record<string, unknown> & {
  state_key: string;
};

type WidgetParameter = {
  name: string;
  value: string;
  rawPair: string;
};

type ExistingWidgetState = {
  events: WidgetStateEvent[];
  botUserId: string;
};

/**
 * Adds only the calendar widget state entry; shared Element layout state is
 * untouched. Existing trusted calendar entries are preserved in place.
 */
export class RoomCalendarSetupWidgetInstaller implements RoomCalendarSetupWidgetPort {
  private readonly configuredLocation: URL | undefined;
  private readonly configuredUrlHasCredentials: boolean;
  private readonly newWidgetUrl: string | undefined;
  private readonly configuredGatewayUrl: URL | undefined;

  constructor(
    private readonly matrixClient: RoomCalendarSetupWidgetMatrixPort,
    private readonly widgetClient: RoomCalendarSetupWidgetContentPort,
    configuredWidgetUrl: string,
  ) {
    this.configuredLocation = parseSafeHttpUrl(configuredWidgetUrl);
    this.configuredUrlHasCredentials =
      hasCredentialMaterialInWidgetUrl(configuredWidgetUrl);
    this.newWidgetUrl = buildNewWidgetUrl(
      configuredWidgetUrl,
      this.configuredLocation,
    );
    this.configuredGatewayUrl = getConfiguredGatewayUrl(
      this.configuredLocation,
    );
  }

  /**
   * Checks room state and URL configuration before registry or CalDAV work.
   * An exact existing pilot widget can be reused even if a future install URL
   * is incomplete, because its complete trusted payload remains untouched.
   */
  async preflight(
    roomId: string,
    calendarId?: string,
  ): Promise<RoomCalendarSetupWidgetPreflightOutcome> {
    if (!this.configuredLocation || this.configuredUrlHasCredentials) {
      return 'unavailable';
    }
    if (calendarId !== undefined && !CALENDAR_ID_PATTERN.test(calendarId)) {
      return 'unavailable';
    }

    let existing: ExistingWidgetState | undefined;
    try {
      existing = await this.readExistingWidgetState(roomId);
    } catch {
      return 'unavailable';
    }
    if (!existing) return 'unavailable';

    const state = this.inspectExistingWidgets(
      existing.events,
      roomId,
      existing.botUserId,
      calendarId ? `calendar-widget-${calendarId}` : undefined,
    );
    if (state === 'matched') return 'ready';
    if (state === 'conflict') return 'conflict';
    return this.newWidgetUrl ? 'ready' : 'unavailable';
  }

  async install(
    binding: RoomCalendarBinding,
  ): Promise<'installed' | 'already-present' | 'conflict' | 'unavailable'> {
    if (
      !this.configuredLocation ||
      this.configuredUrlHasCredentials ||
      !CALENDAR_ID_PATTERN.test(binding.calendarId)
    ) {
      return 'unavailable';
    }

    const stateKey = `calendar-widget-${binding.calendarId}`;
    const existing = await this.readExistingWidgetState(binding.roomId);
    if (!existing) return 'unavailable';

    const state = this.inspectExistingWidgets(
      existing.events,
      binding.roomId,
      existing.botUserId,
      stateKey,
    );
    if (state === 'matched') return 'already-present';
    if (state === 'conflict') return 'conflict';
    if (!this.newWidgetUrl) return 'unavailable';

    const content =
      await this.widgetClient.getMeetingWidgetEventContentAsync(stateKey);
    if (!isRecord(content)) {
      throw new Error('Calendar widget content is unavailable');
    }

    const eventContent: IWidgetContent = {
      ...(content as unknown as IWidgetContent),
      id: stateKey,
      type: WidgetType.MEETINGS,
      url: this.newWidgetUrl,
    };

    // WidgetClient may upload an avatar while building the payload. Recheck
    // the stable key after that work so a concurrent state write is preserved.
    const latest = await this.readExistingWidgetState(binding.roomId);
    if (!latest) return 'unavailable';
    const latestState = this.inspectExistingWidgets(
      latest.events,
      binding.roomId,
      latest.botUserId,
      stateKey,
    );
    if (latestState === 'matched') return 'already-present';
    if (latestState === 'conflict') return 'conflict';

    await this.matrixClient.sendStateEvent(
      binding.roomId,
      StateEventName.IM_VECTOR_MODULAR_WIDGETS_EVENT,
      stateKey,
      eventContent,
    );

    const written = await this.readExistingWidgetState(binding.roomId);
    if (!written) return 'unavailable';
    const writtenEvent = written.events.find(
      (event) => event.state_key === stateKey,
    );
    if (!writtenEvent) return 'unavailable';
    if (
      writtenEvent.sender !== written.botUserId ||
      !isDeepStrictEqual(writtenEvent.content, eventContent)
    ) {
      return 'conflict';
    }
    return 'installed';
  }

  private async readExistingWidgetState(
    roomId: string,
  ): Promise<ExistingWidgetState | undefined> {
    const [roomState, botUserId] = await Promise.all([
      this.matrixClient.getRoomState(roomId),
      this.matrixClient.getUserId(),
    ]);
    if (
      !Array.isArray(roomState) ||
      typeof botUserId !== 'string' ||
      !botUserId.startsWith('@')
    ) {
      return undefined;
    }

    const events = roomState.filter(
      (event): event is WidgetStateEvent =>
        isRecord(event) &&
        event.type === StateEventName.IM_VECTOR_MODULAR_WIDGETS_EVENT &&
        typeof event.state_key === 'string' &&
        event.state_key.length > 0,
    );
    return { events, botUserId };
  }

  private inspectExistingWidgets(
    events: readonly WidgetStateEvent[],
    roomId: string,
    botUserId: string,
    requestedStateKey?: string,
  ): 'matched' | 'conflict' | 'absent' {
    if (requestedStateKey) {
      const keyEvent = events.find(
        (event) => event.state_key === requestedStateKey,
      );
      if (keyEvent) {
        return this.isExistingCalendarWidget(keyEvent, roomId, botUserId)
          ? 'matched'
          : 'conflict';
      }
    }

    const matches = events.filter((event) =>
      this.isExistingCalendarWidget(event, roomId, botUserId),
    );
    if (matches.length === 1) return 'matched';
    if (matches.length > 1) return 'conflict';

    // A same-endpoint widget that fails any identity, kind, or room check may
    // be an existing calendar entry with altered parameters. Never add a
    // second widget beside that uncertain lookalike.
    if (events.some((event) => this.hasConfiguredOriginAndPath(event))) {
      return 'conflict';
    }
    return 'absent';
  }

  private isExistingCalendarWidget(
    event: WidgetStateEvent,
    roomId: string,
    botUserId: string,
  ): boolean {
    if (!isRecord(event.content)) return false;
    const content = event.content;
    if (
      content.type !== WidgetType.MEETINGS &&
      content.type !== SUPPORTED_LEGACY_CALENDAR_WIDGET_TYPE &&
      content.type !== SUPPORTED_LEGACY_MATRIX_CUSTOM_WIDGET_TYPE
    ) {
      return false;
    }

    if (!hasValidWidgetIdBinding(content, event.state_key)) return false;
    if (
      content.type !== WidgetType.MEETINGS &&
      (event.sender !== botUserId || content.creator !== botUserId)
    ) {
      return false;
    }

    const url = parseSafeHttpUrl(content.url);
    if (!url || !this.matchesConfiguredOriginAndPath(url)) return false;

    const parameters = parseWidgetParameters(url);
    if (!parameters) return false;
    if (hasCredentialBearingParameters(parameters)) return false;
    if (
      hasParameter(parameters, 'widgetId') ||
      hasParameter(parameters, 'parentUrl')
    ) {
      return false;
    }

    const roomParameters = getParameters(parameters, ROOM_ID_PARAMETER);
    if (
      roomParameters.length !== 1 ||
      !isSupportedRoomIdValue(roomParameters[0], roomId)
    ) {
      return false;
    }

    const widgetIdParameters = getParameters(parameters, WIDGET_ID_PARAMETER);
    if (
      widgetIdParameters.length > 1 ||
      (widgetIdParameters.length === 1 &&
        !isSupportedWidgetIdValue(widgetIdParameters[0], event.state_key))
    ) {
      return false;
    }

    const gatewayParameters = getParameters(parameters, GATEWAY_URL_PARAMETER);
    if (gatewayParameters.length !== 1) return false;
    const gatewayUrl = parseSafeGatewayUrl(gatewayParameters[0].value);
    if (!gatewayUrl || !isSafeForWidgetOrigin(gatewayUrl, url)) {
      return false;
    }
    if (
      this.configuredGatewayUrl &&
      !sameBackendUrl(gatewayUrl, this.configuredGatewayUrl)
    ) {
      return false;
    }

    return true;
  }

  private hasConfiguredOriginAndPath(event: WidgetStateEvent): boolean {
    if (!isRecord(event.content) || typeof event.content.url !== 'string') {
      return false;
    }
    try {
      // Inspect an unsafe URL only far enough to recognize a same-endpoint
      // lookalike. The strict matcher below still rejects credentials and
      // unsupported schemes before any entry can be reused.
      return this.matchesConfiguredOriginAndPath(new URL(event.content.url));
    } catch {
      return false;
    }
  }

  private matchesConfiguredOriginAndPath(url: URL | undefined): boolean {
    return Boolean(
      url &&
      this.configuredLocation &&
      url.origin === this.configuredLocation.origin &&
      url.pathname === this.configuredLocation.pathname,
    );
  }
}

function buildNewWidgetUrl(
  configuredUrl: string,
  configuredLocation: URL | undefined,
): string | undefined {
  if (!configuredLocation) return undefined;
  const parameters = parseWidgetParameters(configuredLocation);
  if (!parameters) return undefined;
  if (hasCredentialBearingParameters(parameters)) return undefined;

  if (
    hasParameter(parameters, 'widgetId') ||
    hasParameter(parameters, 'parentUrl')
  ) {
    return undefined;
  }

  const gatewayParameters = getParameters(parameters, GATEWAY_URL_PARAMETER);
  if (gatewayParameters.length !== 1) {
    return undefined;
  }
  const gatewayUrl = parseSafeGatewayUrl(gatewayParameters[0].value);
  if (!gatewayUrl || !isSafeForWidgetOrigin(gatewayUrl, configuredLocation)) {
    return undefined;
  }

  const roomParameters = getParameters(parameters, ROOM_ID_PARAMETER);
  if (roomParameters.length > 1) return undefined;
  if (
    roomParameters.length === 1 &&
    !isCanonicalMacroParameter(
      roomParameters[0],
      ROOM_ID_PARAMETER,
      ROOM_ID_MACRO,
    )
  ) {
    return undefined;
  }

  const widgetIdParameters = getParameters(parameters, WIDGET_ID_PARAMETER);
  if (
    widgetIdParameters.length > 1 ||
    (widgetIdParameters.length === 1 &&
      !isCanonicalMacroParameter(
        widgetIdParameters[0],
        WIDGET_ID_PARAMETER,
        WIDGET_ID_MACRO,
      ))
  ) {
    return undefined;
  }

  return roomParameters.length === 1
    ? configuredUrl
    : appendWidgetParameter(
        configuredUrl,
        `${ROOM_ID_PARAMETER}=${ROOM_ID_MACRO}`,
      );
}

function appendWidgetParameter(url: string, parameter: string): string {
  const fragmentIndex = url.indexOf('#');
  const beforeFragment =
    fragmentIndex === -1 ? url : url.slice(0, fragmentIndex);
  const fragment = fragmentIndex === -1 ? '' : url.slice(fragmentIndex);

  if (fragment.includes('?')) {
    const separator =
      fragment.endsWith('?') || fragment.endsWith('&') ? '' : '&';
    return `${beforeFragment}${fragment}${separator}${parameter}`;
  }

  const queryIndex = beforeFragment.indexOf('?');
  if (queryIndex === -1) return `${beforeFragment}?${parameter}${fragment}`;
  const separator =
    beforeFragment.endsWith('?') || beforeFragment.endsWith('&') ? '' : '&';
  return `${beforeFragment}${separator}${parameter}${fragment}`;
}

function parseWidgetParameters(url: URL): WidgetParameter[] | undefined {
  const rawSources = [url.search.slice(1), getFragmentQuery(url.hash)];
  const parameters: WidgetParameter[] = [];
  for (const source of rawSources) {
    if (source.length === 0) continue;
    for (const rawPair of source.split('&')) {
      if (rawPair.length === 0) continue;
      const separator = rawPair.indexOf('=');
      const rawName = separator === -1 ? rawPair : rawPair.slice(0, separator);
      const rawValue = separator === -1 ? '' : rawPair.slice(separator + 1);
      let name: string;
      let value: string;
      try {
        name = decodeURIComponent(rawName.replace(/\+/gu, ' '));
        value = decodeURIComponent(rawValue.replace(/\+/gu, ' '));
      } catch {
        return undefined;
      }
      parameters.push({ name, value, rawPair });
    }
  }
  return parameters;
}

function hasCredentialMaterialInWidgetUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.username.length > 0 || url.password.length > 0) return true;
  const parameters = parseWidgetParameters(url);
  if (!parameters) return false;
  if (hasCredentialBearingParameters(parameters)) return true;

  return getParameters(parameters, GATEWAY_URL_PARAMETER).some((parameter) =>
    hasCredentialMaterialInBackendUrl(parameter.value),
  );
}

function hasCredentialMaterialInBackendUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.username.length > 0 || url.password.length > 0) return true;
  const parameters = parseWidgetParameters(url);
  return parameters ? hasCredentialBearingParameters(parameters) : false;
}

function hasCredentialBearingParameters(
  parameters: readonly WidgetParameter[],
): boolean {
  return parameters.some((parameter) =>
    isCredentialBearingParameterName(parameter.name),
  );
}

function isCredentialBearingParameterName(name: string): boolean {
  const caseInsensitiveName = name.toLowerCase();
  const camelCaseName = name
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .toLowerCase();
  return CREDENTIAL_PARAMETER_NAME_PATTERNS.some(
    (pattern) =>
      pattern.test(caseInsensitiveName) || pattern.test(camelCaseName),
  );
}

function getFragmentQuery(hash: string): string {
  const queryIndex = hash.indexOf('?');
  if (queryIndex !== -1) return hash.slice(queryIndex + 1);
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  return fragment.includes('=') ? fragment : '';
}

function getParameters(
  parameters: readonly WidgetParameter[],
  name: string,
): WidgetParameter[] {
  return parameters.filter((parameter) => parameter.name === name);
}

function hasParameter(
  parameters: readonly WidgetParameter[],
  name: string,
): boolean {
  return getParameters(parameters, name).length > 0;
}

function isCanonicalMacroParameter(
  parameter: WidgetParameter,
  name: string,
  macro: string,
): boolean {
  return parameter.value === macro && parameter.rawPair === `${name}=${macro}`;
}

function isSupportedRoomIdValue(
  parameter: WidgetParameter,
  roomId: string,
): boolean {
  return (
    parameter.value === roomId ||
    isCanonicalMacroParameter(parameter, ROOM_ID_PARAMETER, ROOM_ID_MACRO)
  );
}

function isSupportedWidgetIdValue(
  parameter: WidgetParameter,
  stateKey: string,
): boolean {
  return (
    parameter.value === stateKey ||
    isCanonicalMacroParameter(parameter, WIDGET_ID_PARAMETER, WIDGET_ID_MACRO)
  );
}

function hasValidWidgetIdBinding(
  content: Record<string, unknown>,
  stateKey: string,
): boolean {
  if (stateKey.length > MAX_WIDGET_ID_LENGTH) return false;
  if (content.id === undefined) return true;
  return content.id === stateKey;
}

function getConfiguredGatewayUrl(
  configuredLocation: URL | undefined,
): URL | undefined {
  if (!configuredLocation) return undefined;
  const parameters = parseWidgetParameters(configuredLocation);
  if (!parameters) return undefined;
  const gatewayParameters = getParameters(parameters, GATEWAY_URL_PARAMETER);
  return gatewayParameters.length === 1
    ? parseSafeGatewayUrl(gatewayParameters[0].value)
    : undefined;
}

function parseSafeHttpUrl(value: unknown): URL | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

function parseSafeGatewayUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string') return undefined;
  const url = parseSafeHttpUrl(value);
  if (
    !url ||
    value !== value.trim() ||
    value.includes('$') ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    return undefined;
  }
  return url;
}

function isSafeForWidgetOrigin(gatewayUrl: URL, widgetUrl: URL): boolean {
  return widgetUrl.protocol !== 'https:' || gatewayUrl.protocol === 'https:';
}

function sameBackendUrl(left: URL, right: URL): boolean {
  return (
    left.origin === right.origin &&
    left.pathname.replace(/\/$/u, '') === right.pathname.replace(/\/$/u, '')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
