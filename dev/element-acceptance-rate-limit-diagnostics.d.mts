export type RoomRangeResponseCategory =
  | 'gateway-too-many-requests'
  | 'matrix-m-limit-exceeded'
  | 'other'
  | 'unknown';

export declare function parseRateLimitDiagnosticLogLine(
  line: string,
): Record<string, unknown> | null;

export declare function captureRateLimitDiagnosticLogLines(
  lines: AsyncIterable<string>,
  write: (line: string) => void,
): Promise<void>;

export declare function classifyRoomRangeResponse(
  status: number | null,
  body: unknown,
): RoomRangeResponseCategory;
