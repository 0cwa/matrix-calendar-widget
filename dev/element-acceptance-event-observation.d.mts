export type CreatedEventTiming = {
  type: 'timed';
  start: { type: 'zoned'; local: string; timezone: string };
  end: { type: 'zoned'; local: string; timezone: string };
};

export type ExpectedRoomRange = {
  start: string;
  end: string;
  timezone: string;
};

export declare function readCreatedEventTiming(
  value: unknown,
): CreatedEventTiming | undefined;

export declare function inspectExpectedEventList(
  value: unknown,
  identity: {
    expectedTitle: string;
    expectedCalendarId: string;
    createdEventId?: string;
  },
): {
  hasEventsArray: boolean;
  eventCountCapped: 0 | 1 | 2 | null;
  titleMatches: boolean | null;
  idMatches: boolean | null;
  calendarMatches: boolean | null;
};

export declare function compareEventTimingWithRoomRange(input: {
  timing: CreatedEventTiming;
  range: ExpectedRoomRange;
}): { comparable: boolean; intersects: boolean };
