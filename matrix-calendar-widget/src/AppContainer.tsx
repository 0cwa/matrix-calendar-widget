/* Modified for Matrix Calendar Widget fork, 2026. */
/*
 * Copyright 2022 Nordeck IT + Consulting GmbH
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

import { CalendarRepository } from '@matrix-calendar-widget/calendar';
import {
  extractRawWidgetParameters,
  WidgetApi,
} from '@matrix-widget-toolkit/api';
import {
  getEnvironment,
  MuiThemeProvider,
  MuiWidgetApiProvider,
} from '@matrix-widget-toolkit/mui';
import { Alert, Box } from '@mui/material';
import { Suspense, useMemo } from 'react';
import App from './App';
import {
  CalendarRepositoryProvider,
  GatewayCalendarRepository,
} from './calendar';
import { resolveCalendarGatewayConfig } from './calendar/resolveCalendarGatewayConfig';
import { LocalizationProvider } from './components/common/LocalizationProvider';
import { PageLoader } from './components/common/PageLoader';

function AppContainer({
  calendarRepository,
  widgetApiPromise,
}: {
  calendarRepository?: CalendarRepository;
  widgetApiPromise: Promise<WidgetApi>;
}) {
  const repository = useMemo(
    () =>
      calendarRepository ?? createDefaultCalendarRepository(widgetApiPromise),
    [calendarRepository, widgetApiPromise],
  );

  if (!repository) {
    return (
      <MuiThemeProvider>
        <Box padding={2}>
          <Alert severity="error">
            Calendar configuration is incomplete. A Matrix room ID and calendar
            API URL are required.
          </Alert>
        </Box>
      </MuiThemeProvider>
    );
  }

  return (
    <MuiThemeProvider>
      <Suspense fallback={<PageLoader />}>
        <LocalizationProvider>
          <MuiWidgetApiProvider
            widgetApiPromise={widgetApiPromise}
            widgetRegistration={{
              name: 'Matrix Calendar',
              // "calendar" suffix to get a custom icon
              type: 'io.github.0cwa.matrix-calendar-widget:calendar',
            }}
          >
            <CalendarRepositoryProvider repository={repository}>
              <App />
            </CalendarRepositoryProvider>
          </MuiWidgetApiProvider>
        </LocalizationProvider>
      </Suspense>
    </MuiThemeProvider>
  );
}

export default AppContainer;

function createDefaultCalendarRepository(
  widgetApiPromise: Promise<WidgetApi>,
): CalendarRepository | undefined {
  const parameters = extractRawWidgetParameters();
  const configuration = resolveCalendarGatewayConfig(
    parameters['meetings_bot_base_url'],
    getEnvironment('REACT_APP_API_BASE_URL'),
    parameters['matrix_room_id'],
  );

  if (!configuration) {
    return undefined;
  }

  return new GatewayCalendarRepository({
    ...configuration,
    getAuthorizationHeader: async () => {
      const widgetApi = await widgetApiPromise;
      const credentials = await widgetApi.requestOpenIDConnectToken();
      if (!credentials) {
        return undefined;
      }

      return `MX-Identity ${btoa(
        JSON.stringify({
          matrix_server_name: credentials.matrix_server_name,
          access_token: credentials.access_token,
        }),
      )}`;
    },
  });
}
