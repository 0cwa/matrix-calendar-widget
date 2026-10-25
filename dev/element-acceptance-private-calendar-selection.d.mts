import type { Locator, Page } from '@playwright/test';

export type PrivateCalendarSelectionObservation = Readonly<{
  branch: 'unavailable' | 'already-selected' | 'changed';
  clickCompleted: boolean;
  httpStatus: number | null;
}>;

export declare function selectPrivateAcceptanceCalendar(options: {
  page: Page;
  calendarPicker: Locator;
  targetCalendarOption: Locator;
  gatewayUrl: string;
  calendarId: string;
  roomId: string;
  recordObservation: (observation: PrivateCalendarSelectionObservation) => void;
}): Promise<boolean>;
