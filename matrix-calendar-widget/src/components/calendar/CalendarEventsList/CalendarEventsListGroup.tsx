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

import { Box, Stack } from '@mui/material';
import { unstable_useId as useId } from '@mui/utils';
import { PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionHeadingDivider } from './SectionHeadingDivider';

type CalendarEventsListGroupProps = PropsWithChildren<{
  date: string;
  relativeDay?: 'today' | 'tomorrow';
}>;

export function CalendarEventsListGroup({
  date,
  relativeDay,
  children,
}: CalendarEventsListGroupProps) {
  const titleId = useId();
  const { t } = useTranslation();
  const fullDate = t('meetingList.groupTitle', '{{date, datetime}}', {
    date: new Date(date),
    formatParams: {
      date: {
        weekday: 'long',
        month: 'long',
        year: 'numeric',
        day: 'numeric',
        // The day is a calendar date that parses as UTC midnight.
        timeZone: 'UTC',
      },
    },
  });
  const title =
    relativeDay === 'today'
      ? t('calendarEvents.list.today', 'Today · {{date}}', { date: fullDate })
      : relativeDay === 'tomorrow'
        ? t('calendarEvents.list.tomorrow', 'Tomorrow · {{date}}', {
            date: fullDate,
          })
        : fullDate;

  return (
    <Box
      aria-labelledby={titleId}
      component="li"
      maxWidth={720}
      mx="auto"
      my={0}
      p={0}
      sx={{ listStyleType: 'none' }}
      width="100%"
    >
      <SectionHeadingDivider id={titleId} title={title} />

      <Stack
        aria-labelledby={titleId}
        component="ul"
        m={0}
        mb={1.5}
        mt={0.75}
        px={1}
        py={0}
        spacing={0.75}
      >
        {children}
      </Stack>
    </Box>
  );
}
