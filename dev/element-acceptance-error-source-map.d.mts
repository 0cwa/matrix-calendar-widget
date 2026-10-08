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
  sourceMapUnsupportedReason:
    | 'not-applicable'
    | 'source-not-found'
    | 'duplicate-source'
    | 'source-resolution-mismatch'
    | 'unsupported-namespace'
    | 'unsupported-scheme'
    | 'repository-root-prefix'
    | 'relative-path-prefix'
    | 'absolute-path'
    | 'query-or-fragment'
    | 'unsafe-path-segment'
    | 'invalid-path-character'
    | 'unsupported-path-prefix'
    | 'other-unsupported-source';
  sourceMapNamespaceClass:
    | 'not-applicable'
    | 'element-web'
    | 'matrix-react-sdk'
    | 'matrix-widget-api'
    | 'empty'
    | 'other';
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
