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
  sourceRefSha256: string | null;
  sourceLine: number | null;
  sourceColumn: number | null;
};

export type ElementSourceMapResult = {
  bundleUrl: string;
  sourceMapText: string | null;
};

export function extractElementBundleFrames(
  error: unknown,
  elementUrl: string,
): ElementBundleFrame[];

export function resolveElementErrorSourcePointer(
  frames: ElementBundleFrame[],
  sourceMaps: ElementSourceMapResult[],
): ElementErrorSourcePointer;
