export type ElementBundleFrame = {
  bundleUrl: string;
  generatedLine: number;
  generatedColumn: number;
};

export type ElementErrorSourcePointer = {
  sourceMapStatus:
    | 'not-eligible'
    | 'not-attempted'
    | 'unavailable'
    | 'invalid'
    | 'unmapped'
    | 'mapped';
  sourceMapResolution:
    | 'not-applicable'
    | 'mapped'
    | 'no-original-position'
    | 'dependency-source'
    | 'unsupported-source'
    | 'invalid-coordinate';
  sourceRefSha256: string | null;
  sourceLine: number | null;
  sourceColumn: number | null;
};

export type ElementSourceMapReadRequest = {
  bundleUrl: string;
  expectedOrigin: string;
  maxBytes: number;
  timeoutMs: number;
};

export type ElementSourceMapReadResult = {
  text: string | null;
  bytesRead: number;
  limitReached: boolean;
};

export type ElementSourceMapResult = {
  bundleUrl: string;
  sourceMapText: string | null;
};

export function extractElementBundleFrames(
  error: unknown,
  elementUrl: string,
): ElementBundleFrame[];

export function readElementErrorSourceMapInPage(
  request: ElementSourceMapReadRequest,
): Promise<ElementSourceMapReadResult>;

export function resolveElementErrorSourcePointer(
  frames: ElementBundleFrame[],
  sourceMaps: ElementSourceMapResult[],
): ElementErrorSourcePointer;
