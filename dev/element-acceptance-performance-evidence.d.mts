export type PerformanceHoverFailureClass =
  | 'timeout'
  | 'not-visible'
  | 'outside-viewport'
  | 'intercepted'
  | 'detached'
  | 'other';

export function classifyPerformanceHoverFailure(
  error: unknown,
): PerformanceHoverFailureClass;
