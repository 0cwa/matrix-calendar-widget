export type PerformanceHoverFailureClass =
  | 'timeout'
  | 'not-visible'
  | 'outside-viewport'
  | 'intercepted'
  | 'detached'
  | 'other';

export type PerformancePageErrorClass =
  | 'none'
  | 'error'
  | 'type-error'
  | 'reference-error'
  | 'syntax-error'
  | 'range-error'
  | 'uri-error'
  | 'eval-error'
  | 'other';

export type PerformancePageErrorSubtype =
  | 'error'
  | 'type-error'
  | 'reference-error'
  | 'syntax-error'
  | 'range-error'
  | 'uri-error'
  | 'eval-error'
  | 'aggregate-error'
  | 'dom-exception'
  | 'named-error'
  | 'non-error'
  | 'unavailable';

export type PerformancePageErrorSource =
  | 'widget'
  | 'element'
  | 'ambiguous'
  | 'unclassified';

export type PerformancePageErrorClassification = {
  errorClass: Exclude<PerformancePageErrorClass, 'none'>;
  errorSubtype: PerformancePageErrorSubtype;
  errorSource: PerformancePageErrorSource;
  stackAvailable: boolean;
  sourceScanTruncated: boolean;
};

export type PerformanceEndpoint =
  | 'context'
  | 'calendars'
  | 'events'
  | 'openid'
  | 'other-calendar'
  | 'other-api';

export type PerformanceDefaultWaitObservation = {
  pendingByEndpoint: Record<PerformanceEndpoint, number>;
  pendingOverflowByEndpoint: Record<PerformanceEndpoint, boolean>;
  otherOriginCalendarPathCount: number;
  otherOriginCalendarPathOverflow: boolean;
  widgetConfiguration: PerformanceWidgetConfigurationObservation;
  createControl: PerformanceCreateControlObservation;
  completedByEndpoint: Record<
    'context' | 'calendars' | 'events' | 'openid',
    PerformanceCompletedEndpointObservation
  >;
  completedApiRowsOverflow: boolean;
};

export type PerformanceWidgetConfigurationObservation = {
  available: boolean;
  gatewayBaseParameterPresent: boolean | null;
  gatewayBaseValuePresent: boolean | null;
  gatewayBaseOriginMatches: boolean | null;
  roomIdParameterPresent: boolean | null;
  roomIdValuePresent: boolean | null;
  roomIdMatches: boolean | null;
  repositoryConfig:
    | 'explicit-gateway-parameters'
    | 'in-memory-forced'
    | 'build-config-fallback-possible'
    | 'unavailable';
};

export type PerformanceCreateControlObservation = {
  available: boolean;
  count: 0 | 1 | 2 | null;
  visible: boolean | null;
  enabled: boolean | null;
};

export type PerformanceCompletedEndpointObservation = {
  count: number;
  success: number;
  clientError: number;
  serverError: number;
  otherStatus: number;
  requestFailed: number;
  decoded: number;
  decodeFailed: number;
};

export type PerformanceDefaultWaitFailureSnapshot = {
  widgetConfiguration: PerformanceWidgetConfigurationObservation;
  createControl: PerformanceCreateControlObservation;
  completedApiRows: Array<{
    endpoint: 'context' | 'calendars' | 'events' | 'openid';
    status: number;
    decoded: boolean;
  }>;
  completedApiRowsOverflow: boolean;
};

export const MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT: 512;

export function classifyPerformancePageError(
  error: unknown,
  fixtureUrls: { elementUrl: string; widgetUrl: string },
): PerformancePageErrorClassification;

export function classifyPerformanceHoverFailure(
  error: unknown,
): PerformanceHoverFailureClass;

export function summarizeDefaultWaitObservation(
  pendingEndpointCounts: Record<PerformanceEndpoint, number>,
  otherOriginCalendarPathCount: number,
  failureSnapshot?: PerformanceDefaultWaitFailureSnapshot,
): PerformanceDefaultWaitObservation;
