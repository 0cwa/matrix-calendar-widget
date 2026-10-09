export function raceCalendarReadyOrIdentityPrompt(
  waitForCalendarEnabled: () => Promise<unknown>,
  waitForIdentityPrompt: () => Promise<unknown>,
): Promise<boolean>;
