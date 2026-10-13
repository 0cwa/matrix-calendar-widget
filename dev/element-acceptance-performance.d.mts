export function buildOrdinaryPerformanceSeedEnvironment(
  sourceEnvironment: NodeJS.ProcessEnv,
  startDate: string,
): NodeJS.ProcessEnv;

export function raceCalendarReadyOrIdentityPrompt(
  waitForCalendarEnabled: () => Promise<unknown>,
  waitForIdentityPrompt: () => Promise<unknown>,
): Promise<boolean>;
