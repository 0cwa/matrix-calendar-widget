import { appendDesktopPlaywrightResult } from '../../dev/element-desktop-journey.mjs';

export default class ElementDesktopAcceptanceResultReporter {
  onEnd(result) {
    try {
      appendDesktopPlaywrightResult({
        filePath: process.env.ELEMENT_DESKTOP_JOURNEY_STAGE_FILE,
        runnerTemp: process.env.RUNNER_TEMP,
        sourceSha: process.env.ELEMENT_DESKTOP_SOURCE_SHA,
        status: result?.status,
      });
    } catch {
      // The final summary reports an unknown result when this bounded write fails.
    }
  }
}
