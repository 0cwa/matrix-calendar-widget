export type DefaultViewMilestoneName =
  | 'widgetOpenElapsedMs'
  | 'roomRangeObservedElapsedMs'
  | 'rowsStableElapsedMs'
  | 'createControlUsableElapsedMs'
  | 'observerSettledElapsedMs';

export type DefaultViewMilestones = {
  widgetOpenElapsedMs: number | null;
  roomRangeObservedElapsedMs: number | null;
  rowsStableElapsedMs: number | null;
  createControlUsableElapsedMs: number | null;
  observerSettledElapsedMs: number | null;
};

export function createDefaultViewMilestoneRecorder(
  enabled: boolean,
  readElapsed: () => number,
  publish: (value: DefaultViewMilestones) => void,
): { mark: (name: DefaultViewMilestoneName) => void } | undefined;
