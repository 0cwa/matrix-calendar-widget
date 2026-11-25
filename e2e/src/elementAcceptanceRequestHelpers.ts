/* Modified for Matrix Calendar Widget fork, 2026. */
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

import type {
  GatewayEndpointKind,
  GatewayRequestMethod,
  WidgetResourceKind,
} from './elementAcceptanceSupportTypes';

export function classifyGatewayRequest(
  rawUrl: string,
  rawMethod: string,
  gatewayOrigin: string,
):
  | {
      endpoint: GatewayEndpointKind;
      method: GatewayRequestMethod;
    }
  | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== gatewayOrigin) return undefined;

    let endpoint: GatewayEndpointKind;
    if (url.pathname === '/v1/calendar/context') {
      endpoint = 'context';
    } else if (url.pathname === '/v1/calendar/calendars') {
      endpoint = 'calendars';
    } else if (url.pathname === '/v1/calendar/events') {
      endpoint = 'events';
    } else if (url.pathname.startsWith('/v1/calendar/')) {
      endpoint = 'other-calendar';
    } else {
      endpoint = 'other-api';
    }

    const method = classifyGatewayMethod(rawMethod);
    return { endpoint, method };
  } catch {
    return undefined;
  }
}

export function classifyGatewayMethod(rawMethod: string): GatewayRequestMethod {
  const methods: GatewayRequestMethod[] = [
    'GET',
    'POST',
    'PATCH',
    'PUT',
    'DELETE',
    'OPTIONS',
    'HEAD',
  ];
  return methods.includes(rawMethod as GatewayRequestMethod)
    ? (rawMethod as GatewayRequestMethod)
    : 'OTHER';
}

export function classifyWidgetResource(
  rawUrl: string,
  resourceType: string,
  widgetOrigin: string,
): WidgetResourceKind | undefined {
  try {
    if (new URL(rawUrl).origin !== widgetOrigin) return undefined;
    return resourceType === 'document' ||
      resourceType === 'script' ||
      resourceType === 'stylesheet'
      ? resourceType
      : undefined;
  } catch {
    return undefined;
  }
}

export function isOpenIdRequest(
  rawUrl: string,
  homeserverOrigin: string,
): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.origin === homeserverOrigin &&
      url.pathname.endsWith('/openid/request_token')
    );
  } catch {
    return false;
  }
}
