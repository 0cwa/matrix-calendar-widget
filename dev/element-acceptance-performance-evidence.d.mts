export type PerformanceHoverFailureClass =
  | 'timeout'
  | 'not-visible'
  | 'outside-viewport'
  | 'intercepted'
  | 'detached'
  | 'other';

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
};

export const MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT: 512;

export function classifyPerformanceHoverFailure(
  error: unknown,
): PerformanceHoverFailureClass;

export function summarizeDefaultWaitObservation(
  pendingEndpointCounts: Record<PerformanceEndpoint, number>,
  otherOriginCalendarPathCount: number,
): PerformanceDefaultWaitObservation;
