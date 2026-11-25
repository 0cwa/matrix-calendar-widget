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

import type { Page } from '@playwright/test';
import {
  classifyGatewayMethod,
  classifyGatewayRequest,
  classifyWidgetResource,
  isOpenIdRequest,
} from './elementAcceptanceRequestHelpers';
import type {
  AcceptanceRuntimeObservation,
  OpenIdProtocolState,
  WidgetDocumentReadyState,
  WidgetPageErrorClass,
} from './elementAcceptanceSupportTypes';
import type { Fixture } from './elementAcceptanceTypes';
import { ElementWebPage } from './pages/elementWebPage';

export function createAcceptanceRuntimeHelpers(
  supportContext: { fixture: Fixture },
  appendRuntimeObservation: (observation: AcceptanceRuntimeObservation) => void,
) {
  async function observeAcceptanceRuntime(
    page: Page,
    {
      gatewayUrl,
      homeserverUrl,
      widgetUrl,
    }: {
      gatewayUrl: string;
      homeserverUrl: string;
      widgetUrl: string;
    },
  ): Promise<AcceptanceRuntimeObservation> {
    const gatewayOrigin = new URL(gatewayUrl).origin;
    const homeserverOrigin = new URL(homeserverUrl).origin;
    const widgetOrigin = new URL(widgetUrl).origin;
    const observerArgs = {
      expectedElementOrigin: new URL(supportContext.fixture.elementUrl).origin,
      expectedWidgetOrigin: widgetOrigin,
      expectedGatewayOrigin: gatewayOrigin,
      expectedRoomId: supportContext.fixture.teamRoomId,
    };
    const installAcceptanceObserver = ({
      expectedElementOrigin,
      expectedWidgetOrigin,
      expectedGatewayOrigin,
      expectedRoomId,
    }: typeof observerArgs) => {
      type WidgetApiState =
        | 'none'
        | 'allowed'
        | 'request'
        | 'blocked'
        | 'other';
      type WidgetParameters = Record<string, string | undefined>;
      type WidgetApiMessage = {
        api?: unknown;
        action?: unknown;
        widgetId?: unknown;
        requestId?: unknown;
        response?: unknown;
        data?: unknown;
      };
      type RequestObservation = {
        count: number;
        sourceMatches: boolean;
        originMatches: boolean;
        widgetIdMatches: boolean;
      };
      type ChildObservation = {
        parametersObserved: boolean;
        gatewayBaseOriginMatches: boolean;
        roomIdMatches: boolean;
        widgetIdParameterPresent: boolean;
        initialResponseCount: number;
        initialResponseState: WidgetApiState;
        initialResponseSourceMatches: boolean;
        initialResponseOriginMatches: boolean;
        initialResponseWidgetIdMatches: boolean;
        followupCount: number;
        followupState: WidgetApiState;
        followupRequestIdMatches: boolean;
        followupSourceMatches: boolean;
        followupOriginMatches: boolean;
        followupWidgetIdMatches: boolean;
      };
      const readParameters = (
        search: string,
        hash: string,
      ): WidgetParameters => {
        const parse = (query: string): WidgetParameters => {
          const params = new URLSearchParams(query);
          const keys = new Set<string>();
          params.forEach((_value, key) => keys.add(key));
          const parsed: WidgetParameters = Object.create(
            null,
          ) as WidgetParameters;
          for (const key of keys) {
            const values = params.getAll(key);
            parsed[key] = values.length === 1 ? values[0] : undefined;
          }
          return parsed;
        };
        const hashQuery = hash.substring(hash.indexOf('?') + 1);
        return { ...parse(search), ...parse(hashQuery) };
      };
      const stateOf = (value: unknown): WidgetApiState =>
        value === 'allowed' || value === 'request' || value === 'blocked'
          ? value
          : 'other';
      const messageOf = (event: MessageEvent): WidgetApiMessage | undefined => {
        if (
          event.data === null ||
          typeof event.data !== 'object' ||
          Array.isArray(event.data)
        ) {
          return undefined;
        }
        return event.data as WidgetApiMessage;
      };
      const updateMatches = (
        observation: RequestObservation,
        matches: {
          source: boolean;
          origin: boolean;
          widgetId: boolean;
        },
      ) => {
        const first = observation.count === 0;
        observation.count = Math.min(observation.count + 1, 2);
        observation.sourceMatches = first
          ? matches.source
          : observation.sourceMatches && matches.source;
        observation.originMatches = first
          ? matches.origin
          : observation.originMatches && matches.origin;
        observation.widgetIdMatches = first
          ? matches.widgetId
          : observation.widgetIdMatches && matches.widgetId;
      };
      const runtimeWindow = window as Window & {
        __matrixCalendarAcceptanceErrors?: {
          count: number;
          lastClass: WidgetPageErrorClass;
        };
        __matrixCalendarAcceptanceWidgetApiParent?: RequestObservation;
        __matrixCalendarAcceptanceWidgetApiChild?: ChildObservation;
      };

      if (window.location.origin === expectedElementOrigin) {
        const requestObservation: RequestObservation = {
          count: 0,
          sourceMatches: false,
          originMatches: false,
          widgetIdMatches: false,
        };
        runtimeWindow.__matrixCalendarAcceptanceWidgetApiParent =
          requestObservation;
        window.addEventListener('message', (event) => {
          const message = messageOf(event);
          if (
            message?.api !== 'fromWidget' ||
            message.action !== 'get_openid' ||
            Object.hasOwn(message, 'response')
          ) {
            return;
          }

          let sourceMatches = false;
          let expectedWidgetId: string | undefined;
          for (const iframe of Array.from(
            document.querySelectorAll('iframe'),
          )) {
            if (iframe.contentWindow !== event.source) continue;
            try {
              const frameUrl = new URL(
                iframe.getAttribute('src') ?? '',
                document.baseURI,
              );
              const parameters = readParameters(frameUrl.search, frameUrl.hash);
              sourceMatches = frameUrl.origin === expectedWidgetOrigin;
              expectedWidgetId = parameters.widgetId;
            } catch {
              sourceMatches = false;
            }
            break;
          }
          updateMatches(requestObservation, {
            source: sourceMatches,
            origin: event.origin === expectedWidgetOrigin,
            widgetId:
              typeof expectedWidgetId === 'string' &&
              message.widgetId === expectedWidgetId,
          });
        });
      }

      if (window.location.origin === expectedWidgetOrigin) {
        const { expectedWidgetId, childObservation } = (() => {
          const parsedParameters = readParameters(
            window.location.search,
            window.location.hash,
          );
          let gatewayBaseOriginMatches = false;
          if (typeof parsedParameters.meetings_bot_base_url === 'string') {
            try {
              gatewayBaseOriginMatches =
                new URL(parsedParameters.meetings_bot_base_url).origin ===
                expectedGatewayOrigin;
            } catch {
              gatewayBaseOriginMatches = false;
            }
          }
          const expectedWidgetId =
            typeof parsedParameters.widgetId === 'string'
              ? parsedParameters.widgetId
              : undefined;
          const childObservation: ChildObservation = {
            parametersObserved: true,
            gatewayBaseOriginMatches,
            roomIdMatches: parsedParameters.matrix_room_id === expectedRoomId,
            widgetIdParameterPresent:
              typeof expectedWidgetId === 'string' &&
              expectedWidgetId.length > 0,
            initialResponseCount: 0,
            initialResponseState: 'none',
            initialResponseSourceMatches: false,
            initialResponseOriginMatches: false,
            initialResponseWidgetIdMatches: false,
            followupCount: 0,
            followupState: 'none',
            followupRequestIdMatches: false,
            followupSourceMatches: false,
            followupOriginMatches: false,
            followupWidgetIdMatches: false,
          };
          return { expectedWidgetId, childObservation };
        })();
        let initialRequestId: string | undefined;
        runtimeWindow.__matrixCalendarAcceptanceWidgetApiChild =
          childObservation;
        window.addEventListener('message', (event) => {
          const message = messageOf(event);
          if (!message) return;
          const commonMatches = {
            source: event.source === window.parent,
            origin: event.origin === expectedElementOrigin,
            widgetId:
              typeof expectedWidgetId === 'string' &&
              message.widgetId === expectedWidgetId,
          };

          if (
            message.api === 'fromWidget' &&
            message.action === 'get_openid' &&
            Object.hasOwn(message, 'response') &&
            message.response !== null &&
            typeof message.response === 'object' &&
            !Array.isArray(message.response)
          ) {
            const first = childObservation.initialResponseCount === 0;
            childObservation.initialResponseCount = Math.min(
              childObservation.initialResponseCount + 1,
              2,
            );
            const response = message.response as { state?: unknown };
            childObservation.initialResponseState = stateOf(response.state);
            childObservation.initialResponseSourceMatches = first
              ? commonMatches.source
              : childObservation.initialResponseSourceMatches &&
                commonMatches.source;
            childObservation.initialResponseOriginMatches = first
              ? commonMatches.origin
              : childObservation.initialResponseOriginMatches &&
                commonMatches.origin;
            childObservation.initialResponseWidgetIdMatches = first
              ? commonMatches.widgetId
              : childObservation.initialResponseWidgetIdMatches &&
                commonMatches.widgetId;
            initialRequestId =
              commonMatches.source &&
              commonMatches.origin &&
              commonMatches.widgetId &&
              typeof message.requestId === 'string'
                ? message.requestId
                : undefined;
            return;
          }

          if (
            message.api !== 'toWidget' ||
            message.action !== 'openid_credentials' ||
            Object.hasOwn(message, 'response') ||
            message.data === null ||
            typeof message.data !== 'object' ||
            Array.isArray(message.data)
          ) {
            return;
          }
          const first = childObservation.followupCount === 0;
          childObservation.followupCount = Math.min(
            childObservation.followupCount + 1,
            2,
          );
          const data = message.data as {
            state?: unknown;
            original_request_id?: unknown;
          };
          childObservation.followupState = stateOf(data.state);
          const requestIdMatches =
            typeof initialRequestId === 'string' &&
            typeof data.original_request_id === 'string' &&
            data.original_request_id === initialRequestId;
          childObservation.followupRequestIdMatches = first
            ? requestIdMatches
            : childObservation.followupRequestIdMatches && requestIdMatches;
          childObservation.followupSourceMatches = first
            ? commonMatches.source
            : childObservation.followupSourceMatches && commonMatches.source;
          childObservation.followupOriginMatches = first
            ? commonMatches.origin
            : childObservation.followupOriginMatches && commonMatches.origin;
          childObservation.followupWidgetIdMatches = first
            ? commonMatches.widgetId
            : childObservation.followupWidgetIdMatches &&
              commonMatches.widgetId;
        });

        const knownErrorClasses = [
          'Error',
          'TypeError',
          'ReferenceError',
          'SyntaxError',
          'RangeError',
          'URIError',
          'EvalError',
          'AggregateError',
        ];
        const errorState = {
          count: 0,
          lastClass: 'NONE' as WidgetPageErrorClass,
        };
        runtimeWindow.__matrixCalendarAcceptanceErrors = errorState;
        const recordPageError = (reason: unknown) => {
          errorState.count = Math.min(errorState.count + 1, 2);
          const name = reason instanceof Error ? reason.name : 'OTHER';
          errorState.lastClass = knownErrorClasses.includes(name)
            ? (name as WidgetPageErrorClass)
            : 'OTHER';
        };
        window.addEventListener('error', (event) => {
          if (event instanceof ErrorEvent) recordPageError(event.error);
        });
        window.addEventListener('unhandledrejection', (event) => {
          recordPageError(event.reason);
        });
      }
    };
    await page.context().addInitScript(installAcceptanceObserver, observerArgs);
    await page.evaluate(installAcceptanceObserver, observerArgs);

    const observation: AcceptanceRuntimeObservation = {
      requestCounts: {
        context: 0,
        calendars: 0,
        events: 0,
        'other-calendar': 0,
        'other-api': 0,
      },
      optionsRequestCount: 0,
      failedRequestCount: 0,
      lastRequestEndpoint: 'none',
      lastRequestMethod: 'NONE',
      lastResponseEndpoint: 'none',
      lastResponseMethod: 'NONE',
      iframeObservationAvailable: false,
      iframeGatewayBaseOriginMatches: false,
      iframeRoomIdMatches: false,
      createEventVisible: false,
      identityContinueVisible: false,
      widgetResourceRequestCounts: {
        document: 0,
        script: 0,
        stylesheet: 0,
      },
      widgetResourceFailureCounts: {
        document: 0,
        script: 0,
        stylesheet: 0,
      },
      widgetResourceLastStatuses: {},
      openIdRequestCount: 0,
      openIdOptionsRequestCount: 0,
      openIdFailedRequestCount: 0,
      openIdLastRequestMethod: 'NONE',
      widgetFrameAvailable: false,
      widgetDocumentReadyState: 'unavailable',
      widgetRootHasChildren: false,
      widgetLoadingVisible: false,
      widgetMissingCapabilitiesVisible: false,
      widgetRegistrationErrorVisible: false,
      widgetOutsideClientVisible: false,
      widgetChildErrorVisible: false,
      widgetPageErrorCount: 0,
      widgetLastPageErrorClass: 'NONE',
      widgetApiParentObserverAvailable: false,
      widgetApiGetOpenIdRequestCount: 0,
      widgetApiRequestSourceMatches: false,
      widgetApiRequestOriginMatches: false,
      widgetApiRequestWidgetIdMatches: false,
      widgetApiInitialResponseCount: 0,
      widgetApiInitialResponseState: 'none',
      widgetApiInitialResponseSourceMatches: false,
      widgetApiInitialResponseOriginMatches: false,
      widgetApiInitialResponseWidgetIdMatches: false,
      widgetApiFollowupCount: 0,
      widgetApiFollowupState: 'none',
      widgetApiFollowupRequestIdMatches: false,
      widgetApiFollowupSourceMatches: false,
      widgetApiFollowupOriginMatches: false,
      widgetApiFollowupWidgetIdMatches: false,
      widgetParametersObserved: false,
      widgetGatewayBaseOriginMatches: false,
      widgetRoomIdMatches: false,
      widgetIdParameterPresent: false,
      calendarEventsLoadingVisible: false,
      calendarEventsLoadErrorVisible: false,
      createEventEnabled: false,
    };

    page.on('request', (request) => {
      const requestDetails = classifyGatewayRequest(
        request.url(),
        request.method(),
        gatewayOrigin,
      );
      if (requestDetails) {
        observation.requestCounts[requestDetails.endpoint] = Math.min(
          observation.requestCounts[requestDetails.endpoint] + 1,
          2,
        );
        observation.lastRequestEndpoint = requestDetails.endpoint;
        observation.lastRequestMethod = requestDetails.method;
        if (requestDetails.method === 'OPTIONS') {
          observation.optionsRequestCount = Math.min(
            observation.optionsRequestCount + 1,
            2,
          );
        }
      }

      const widgetResource = classifyWidgetResource(
        request.url(),
        request.resourceType(),
        widgetOrigin,
      );
      if (widgetResource) {
        observation.widgetResourceRequestCounts[widgetResource] = Math.min(
          observation.widgetResourceRequestCounts[widgetResource] + 1,
          2,
        );
      }

      if (isOpenIdRequest(request.url(), homeserverOrigin)) {
        observation.openIdRequestCount = Math.min(
          observation.openIdRequestCount + 1,
          2,
        );
        observation.openIdLastRequestMethod = classifyGatewayMethod(
          request.method(),
        );
        if (observation.openIdLastRequestMethod === 'OPTIONS') {
          observation.openIdOptionsRequestCount = Math.min(
            observation.openIdOptionsRequestCount + 1,
            2,
          );
        }
      }
    });

    page.on('requestfailed', (request) => {
      const requestDetails = classifyGatewayRequest(
        request.url(),
        request.method(),
        gatewayOrigin,
      );
      if (requestDetails) {
        observation.failedRequestCount = Math.min(
          observation.failedRequestCount + 1,
          2,
        );
      }

      const widgetResource = classifyWidgetResource(
        request.url(),
        request.resourceType(),
        widgetOrigin,
      );
      if (widgetResource) {
        observation.widgetResourceFailureCounts[widgetResource] = Math.min(
          observation.widgetResourceFailureCounts[widgetResource] + 1,
          2,
        );
      }

      if (isOpenIdRequest(request.url(), homeserverOrigin)) {
        observation.openIdFailedRequestCount = Math.min(
          observation.openIdFailedRequestCount + 1,
          2,
        );
      }
    });

    page.on('response', (response) => {
      const responseDetails = classifyGatewayRequest(
        response.url(),
        response.request().method(),
        gatewayOrigin,
      );
      if (responseDetails) {
        observation.lastResponseEndpoint = responseDetails.endpoint;
        observation.lastResponseMethod = responseDetails.method;
        observation.lastResponseStatus = response.status();
      }

      const widgetResource = classifyWidgetResource(
        response.url(),
        response.request().resourceType(),
        widgetOrigin,
      );
      if (widgetResource) {
        observation.widgetResourceLastStatuses[widgetResource] =
          response.status();
        if (response.status() >= 400) {
          observation.widgetResourceFailureCounts[widgetResource] = Math.min(
            observation.widgetResourceFailureCounts[widgetResource] + 1,
            2,
          );
        }
      }

      if (isOpenIdRequest(response.url(), homeserverOrigin)) {
        observation.openIdLastResponseStatus = response.status();
      }
    });

    return observation;
  }

  async function recordWidgetRuntimeObservation(
    page: Page,
    frame: ReturnType<ElementWebPage['widgetByTitle']>,
    observation: AcceptanceRuntimeObservation | undefined,
  ) {
    if (!observation) return;

    try {
      const iframeParameters = await page
        .locator('iframe[title="Matrix Calendar"]')
        .evaluate(
          (iframe, { expectedGatewayOrigin, expectedRoomId }) => {
            const source = iframe.getAttribute('src') ?? '';
            const widgetUrl = new URL(source, window.location.href);
            const parse = (query: string) => {
              const params = new URLSearchParams(query);
              const keys = new Set<string>();
              params.forEach((_value, key) => keys.add(key));
              const parsed: Record<string, string | undefined> = Object.create(
                null,
              ) as Record<string, string | undefined>;
              for (const key of keys) {
                const values = params.getAll(key);
                parsed[key] = values.length === 1 ? values[0] : undefined;
              }
              return parsed;
            };
            const hashQuery = widgetUrl.hash.substring(
              widgetUrl.hash.indexOf('?') + 1,
            );
            const parameters = {
              ...parse(widgetUrl.search),
              ...parse(hashQuery),
            };
            let gatewayOriginMatches = false;
            if (typeof parameters.meetings_bot_base_url === 'string') {
              try {
                gatewayOriginMatches =
                  new URL(parameters.meetings_bot_base_url).origin ===
                  expectedGatewayOrigin;
              } catch {
                gatewayOriginMatches = false;
              }
            }
            return {
              gatewayOriginMatches,
              roomIdMatches: parameters.matrix_room_id === expectedRoomId,
            };
          },
          {
            expectedGatewayOrigin: new URL(supportContext.fixture.gatewayUrl)
              .origin,
            expectedRoomId: supportContext.fixture.teamRoomId,
          },
        );
      observation.iframeObservationAvailable = true;
      observation.iframeGatewayBaseOriginMatches =
        iframeParameters.gatewayOriginMatches;
      observation.iframeRoomIdMatches = iframeParameters.roomIdMatches;
    } catch {
      // The raw iframe URL and any navigation error stay out of the evidence.
    }

    const widgetOrigin = new URL(supportContext.fixture.widgetUrl).origin;
    const widgetFrame = page.frames().find((candidate) => {
      if (candidate === page.mainFrame()) return false;
      try {
        return new URL(candidate.url()).origin === widgetOrigin;
      } catch {
        return false;
      }
    });
    if (widgetFrame) {
      try {
        const documentObservation = await widgetFrame.evaluate(() => {
          const runtimeWindow = window as Window & {
            __matrixCalendarAcceptanceErrors?: {
              count: number;
              lastClass: WidgetPageErrorClass;
            };
            __matrixCalendarAcceptanceWidgetApiChild?: {
              parametersObserved: boolean;
              gatewayBaseOriginMatches: boolean;
              roomIdMatches: boolean;
              widgetIdParameterPresent: boolean;
              initialResponseCount: number;
              initialResponseState: OpenIdProtocolState;
              initialResponseSourceMatches: boolean;
              initialResponseOriginMatches: boolean;
              initialResponseWidgetIdMatches: boolean;
              followupCount: number;
              followupState: OpenIdProtocolState;
              followupRequestIdMatches: boolean;
              followupSourceMatches: boolean;
              followupOriginMatches: boolean;
              followupWidgetIdMatches: boolean;
            };
          };
          const errors = runtimeWindow.__matrixCalendarAcceptanceErrors;
          const widgetApi =
            runtimeWindow.__matrixCalendarAcceptanceWidgetApiChild;
          const readyState = document.readyState;
          const visible = (element: Element | null) => {
            if (!element) return false;
            const style = window.getComputedStyle(element);
            return (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              element.getClientRects().length > 0
            );
          };
          const alertMarkerVisible = (marker: string) =>
            Array.from(document.querySelectorAll('[role="alert"]')).some(
              (alert) => alert.textContent?.includes(marker) && visible(alert),
            );
          const createEventButton = Array.from(
            document.querySelectorAll('button'),
          ).find((button) => button.textContent?.trim() === 'Create event');
          const calendarToolbarPresent = Boolean(createEventButton);
          const calendarEventsLoadingVisible =
            calendarToolbarPresent &&
            Array.from(document.querySelectorAll('[role="progressbar"]')).some(
              (progress) => visible(progress),
            );
          const widgetDocumentReadyState: WidgetDocumentReadyState =
            readyState === 'loading' ||
            readyState === 'interactive' ||
            readyState === 'complete'
              ? readyState
              : 'unavailable';
          return {
            documentReadyState: widgetDocumentReadyState,
            rootHasChildren:
              (document.getElementById('root')?.childElementCount ?? 0) > 0,
            loadingVisible: visible(
              document.querySelector('[role="progressbar"]'),
            ),
            missingCapabilitiesVisible: alertMarkerVisible(
              'Missing capabilities',
            ),
            registrationErrorVisible: alertMarkerVisible(
              'Wrong widget registration',
            ),
            outsideClientVisible: alertMarkerVisible('Only runs as a widget'),
            childErrorVisible: alertMarkerVisible(
              'An error occured inside the widget.',
            ),
            calendarEventsLoadingVisible,
            calendarEventsLoadErrorVisible: alertMarkerVisible(
              'Calendar events could not be loaded.',
            ),
            createEventEnabled: Boolean(
              createEventButton &&
              !createEventButton.hasAttribute('disabled') &&
              createEventButton.getAttribute('aria-disabled') !== 'true',
            ),
            pageErrorCount: Math.min(errors?.count ?? 0, 2),
            lastPageErrorClass: errors?.lastClass ?? 'NONE',
            widgetApi: widgetApi
              ? {
                  parametersObserved: widgetApi.parametersObserved,
                  gatewayBaseOriginMatches: widgetApi.gatewayBaseOriginMatches,
                  roomIdMatches: widgetApi.roomIdMatches,
                  widgetIdParameterPresent: widgetApi.widgetIdParameterPresent,
                  initialResponseCount: widgetApi.initialResponseCount,
                  initialResponseState: widgetApi.initialResponseState,
                  initialResponseSourceMatches:
                    widgetApi.initialResponseSourceMatches,
                  initialResponseOriginMatches:
                    widgetApi.initialResponseOriginMatches,
                  initialResponseWidgetIdMatches:
                    widgetApi.initialResponseWidgetIdMatches,
                  followupCount: widgetApi.followupCount,
                  followupState: widgetApi.followupState,
                  followupRequestIdMatches: widgetApi.followupRequestIdMatches,
                  followupSourceMatches: widgetApi.followupSourceMatches,
                  followupOriginMatches: widgetApi.followupOriginMatches,
                  followupWidgetIdMatches: widgetApi.followupWidgetIdMatches,
                }
              : undefined,
          };
        });
        observation.widgetFrameAvailable = true;
        observation.widgetDocumentReadyState =
          documentObservation.documentReadyState;
        observation.widgetRootHasChildren = documentObservation.rootHasChildren;
        observation.widgetLoadingVisible = documentObservation.loadingVisible;
        observation.widgetMissingCapabilitiesVisible =
          documentObservation.missingCapabilitiesVisible;
        observation.widgetRegistrationErrorVisible =
          documentObservation.registrationErrorVisible;
        observation.widgetOutsideClientVisible =
          documentObservation.outsideClientVisible;
        observation.widgetChildErrorVisible =
          documentObservation.childErrorVisible;
        observation.widgetPageErrorCount = documentObservation.pageErrorCount;
        observation.widgetLastPageErrorClass =
          documentObservation.lastPageErrorClass;
        observation.calendarEventsLoadingVisible =
          documentObservation.calendarEventsLoadingVisible;
        observation.calendarEventsLoadErrorVisible =
          documentObservation.calendarEventsLoadErrorVisible;
        observation.createEventEnabled = documentObservation.createEventEnabled;
        if (documentObservation.widgetApi) {
          observation.widgetParametersObserved =
            documentObservation.widgetApi.parametersObserved;
          observation.widgetGatewayBaseOriginMatches =
            documentObservation.widgetApi.gatewayBaseOriginMatches;
          observation.widgetRoomIdMatches =
            documentObservation.widgetApi.roomIdMatches;
          observation.widgetIdParameterPresent =
            documentObservation.widgetApi.widgetIdParameterPresent;
          observation.widgetApiInitialResponseCount =
            documentObservation.widgetApi.initialResponseCount;
          observation.widgetApiInitialResponseState =
            documentObservation.widgetApi.initialResponseState;
          observation.widgetApiInitialResponseSourceMatches =
            documentObservation.widgetApi.initialResponseSourceMatches;
          observation.widgetApiInitialResponseOriginMatches =
            documentObservation.widgetApi.initialResponseOriginMatches;
          observation.widgetApiInitialResponseWidgetIdMatches =
            documentObservation.widgetApi.initialResponseWidgetIdMatches;
          observation.widgetApiFollowupCount =
            documentObservation.widgetApi.followupCount;
          observation.widgetApiFollowupState =
            documentObservation.widgetApi.followupState;
          observation.widgetApiFollowupRequestIdMatches =
            documentObservation.widgetApi.followupRequestIdMatches;
          observation.widgetApiFollowupSourceMatches =
            documentObservation.widgetApi.followupSourceMatches;
          observation.widgetApiFollowupOriginMatches =
            documentObservation.widgetApi.followupOriginMatches;
          observation.widgetApiFollowupWidgetIdMatches =
            documentObservation.widgetApi.followupWidgetIdMatches;
        }
      } catch {
        // Keep a failed frame read as unavailable without retaining its error.
      }
    }

    try {
      const parentObservation = await page.evaluate(() => {
        const runtimeWindow = window as Window & {
          __matrixCalendarAcceptanceWidgetApiParent?: {
            count: number;
            sourceMatches: boolean;
            originMatches: boolean;
            widgetIdMatches: boolean;
          };
        };
        const request = runtimeWindow.__matrixCalendarAcceptanceWidgetApiParent;
        return request
          ? {
              available: true,
              count: request.count,
              sourceMatches: request.sourceMatches,
              originMatches: request.originMatches,
              widgetIdMatches: request.widgetIdMatches,
            }
          : undefined;
      });
      if (parentObservation) {
        observation.widgetApiParentObserverAvailable =
          parentObservation.available;
        observation.widgetApiGetOpenIdRequestCount = parentObservation.count;
        observation.widgetApiRequestSourceMatches =
          parentObservation.sourceMatches;
        observation.widgetApiRequestOriginMatches =
          parentObservation.originMatches;
        observation.widgetApiRequestWidgetIdMatches =
          parentObservation.widgetIdMatches;
      }
    } catch {
      // Keep a failed parent-window read as unavailable without retaining its error.
    }

    const [createEventVisible, createEventEnabled, identityContinueVisible] =
      await Promise.all([
        frame
          .getByRole('button', { name: 'Create event', exact: true })
          .isVisible()
          .catch(() => false),
        frame
          .getByRole('button', { name: 'Create event', exact: true })
          .isEnabled()
          .catch(() => false),
        page
          .getByRole('dialog')
          .getByRole('button', { name: 'Continue', exact: true })
          .first()
          .isVisible()
          .catch(() => false),
      ]);
    observation.createEventVisible = createEventVisible;
    observation.createEventEnabled = createEventEnabled;
    observation.identityContinueVisible = identityContinueVisible;

    appendRuntimeObservation(observation);
  }

  return { observeAcceptanceRuntime, recordWidgetRuntimeObservation };
}
