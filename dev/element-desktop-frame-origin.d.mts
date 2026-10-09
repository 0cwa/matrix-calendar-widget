export function hasUniqueWidgetFrameOwnedByElement(input: {
  getFrames: () => unknown[];
  parentFrame: unknown;
  ownerElement: unknown;
  expectedOrigin: string;
  timeoutMs?: number;
}): Promise<boolean>;
