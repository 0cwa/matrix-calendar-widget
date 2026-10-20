export type DesktopViewportSize = {
  width: number;
  height: number;
};

export declare function resolveDesktopViewportSize(
  configuredViewport: DesktopViewportSize | null,
  browserViewport: DesktopViewportSize | null,
): DesktopViewportSize | null;
