/*
 * Copyright 2026 Matrix Calendar Widget contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const PRIVATE_CLIENT_LIST_PATH = '/v1/calendar/private-clients';
const PRIVATE_CLIENT_LIST_TIMEOUT_MS = 30_000;

function roomClientListResponseMatches(
  response,
  { expectedOrigin, calendarId, roomId },
) {
  try {
    const url = new URL(response.url());
    const queryEntries = [...url.searchParams.entries()];
    return (
      url.origin === expectedOrigin &&
      url.pathname === PRIVATE_CLIENT_LIST_PATH &&
      response.request().method() === 'GET' &&
      queryEntries.length === 3 &&
      url.searchParams.get('target') === 'room' &&
      url.searchParams.getAll('target').length === 1 &&
      url.searchParams.get('calendarId') === calendarId &&
      url.searchParams.getAll('calendarId').length === 1 &&
      url.searchParams.get('roomId') === roomId &&
      url.searchParams.getAll('roomId').length === 1
    );
  } catch {
    return false;
  }
}

/**
 * Select the private app access target or close an already-selected picker.
 * The diagnostic callback accepts only the fixed branch/click/status record.
 *
 * @param {{
 *   page: import('@playwright/test').Page,
 *   calendarPicker: import('@playwright/test').Locator,
 *   targetCalendarOption: import('@playwright/test').Locator,
 *   gatewayUrl: string,
 *   calendarId: string,
 *   roomId: string,
 *   recordObservation: (observation: PrivateCalendarSelectionObservation) => void
 * }} options
 * @returns {Promise<boolean>}
 */
export async function selectPrivateAcceptanceCalendar({
  page,
  calendarPicker,
  targetCalendarOption,
  gatewayUrl,
  calendarId,
  roomId,
  recordObservation,
}) {
  const observation = {
    branch: 'unavailable',
    clickCompleted: false,
    httpStatus: null,
  };
  let result = false;
  let operationFailed = false;
  let operationError;

  try {
    const alreadySelected =
      (await targetCalendarOption.getAttribute('aria-selected')) === 'true';
    observation.branch = alreadySelected ? 'already-selected' : 'changed';
    if (alreadySelected) {
      await calendarPicker.press('Escape');
      result = true;
    } else {
      const expectedOrigin = new URL(gatewayUrl).origin;
      const selectedListResponse = page.waitForResponse(
        (response) =>
          roomClientListResponseMatches(response, {
            expectedOrigin,
            calendarId,
            roomId,
          }),
        { timeout: PRIVATE_CLIENT_LIST_TIMEOUT_MS },
      );
      const selectedListResponseOutcome = selectedListResponse.then(
        (response) => ({ response }),
        (error) => ({ error }),
      );
      await targetCalendarOption.click();
      observation.clickCompleted = true;
      const responseOutcome = await selectedListResponseOutcome;
      if (Object.hasOwn(responseOutcome, 'error')) {
        throw responseOutcome.error;
      }
      const response = responseOutcome.response;
      observation.httpStatus = response.status();
      result = observation.httpStatus === 200;
    }
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  let diagnosticFailed = false;
  try {
    recordObservation(Object.freeze({ ...observation }));
  } catch {
    diagnosticFailed = true;
  }

  if (operationFailed) {
    throw operationError;
  }
  if (diagnosticFailed) {
    throw new Error('Private calendar selection diagnostics unavailable');
  }
  return result;
}

/**
 * @typedef {Readonly<{
 *   branch: 'unavailable' | 'already-selected' | 'changed',
 *   clickCompleted: boolean,
 *   httpStatus: number | null
 * }>} PrivateCalendarSelectionObservation
 */
