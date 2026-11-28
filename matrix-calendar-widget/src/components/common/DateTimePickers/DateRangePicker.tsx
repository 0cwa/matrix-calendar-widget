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

import { Box, Button, Stack, SxProps, Typography } from '@mui/material';
import {
  DatePickerSlotsComponentsProps,
  DateView,
  PickersDayProps,
  PickersLayout,
  PickersLayoutProps,
} from '@mui/x-date-pickers';
import { DateTime, Interval } from 'luxon';
import React, {
  ComponentProps,
  Dispatch,
  useCallback,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ButtonDatePicker } from './ButtonDatePicker';
import { HighlightedPickersDay } from './HighlightedPickersDay';
import { longDateFormat, shortMonthDateFormat } from './dateFormat';
import { isReduceAnimations } from './helper';

export type DateRangePickerProps = {
  startDate: string;
  endDate: string;
  onRangeChange: (startDate: string, endDate: string) => void;
  sx?: SxProps;
};

export const DateRangePicker = ({
  startDate,
  endDate,
  onRangeChange,
  sx,
}: DateRangePickerProps) => {
  const { t } = useTranslation();

  const [selection, setSelection] = useState<{
    date: string;
    choosingEnd: boolean;
  }>();
  const [open, setOpen] = useState(false);
  const selectedStartDate = selection?.choosingEnd ? selection.date : undefined;
  const minimumEnd = selectedStartDate
    ? DateTime.fromISO(selectedStartDate)
    : undefined;
  const canChooseToday =
    !minimumEnd || DateTime.local().startOf('day') >= minimumEnd;

  const handleChange = useCallback(() => {
    // The custom day and Today actions both choose a range boundary directly.
  }, []);
  const onOpen = useCallback(() => setOpen(true), []);
  const onClose = useCallback(() => {
    setOpen(false);
    setSelection(undefined);
  }, []);

  const handleDaySelect = useCallback(
    (value: DateTime | null) => {
      if (!value?.isValid) {
        return;
      }
      const day = value.startOf('day');
      if (!selectedStartDate) {
        setSelection({ date: day.toISO(), choosingEnd: true });
        return;
      }
      if (day >= DateTime.fromISO(selectedStartDate)) {
        onRangeChange(selectedStartDate, day.endOf('day').toISO());
        onClose();
      }
    },
    [onClose, onRangeChange, selectedStartDate],
  );

  const handleResetStart = useCallback(() => {
    // Keep the visible month on the day the user just rejected.
    setSelection((current) => current && { ...current, choosingEnd: false });
  }, []);

  return (
    <ButtonDatePicker
      slots={{
        day: Day as React.ElementType<PickersDayProps<DateTime>>,
        layout: RangeStepLayout as React.JSXElementConstructor<
          PickersLayoutProps<DateTime | null, DateTime, DateView>
        >,
      }}
      slotProps={{
        layout: {
          step: selectedStartDate
            ? t(
                'dateRangePicker.chooseEnd',
                'Start: {{date, datetime}}. Now choose an end date.',
                {
                  date: new Date(selectedStartDate),
                  formatParams: { date: longDateFormat },
                },
              )
            : t('dateRangePicker.chooseStart', 'Choose a start date.'),
          onResetStart: selectedStartDate ? handleResetStart : undefined,
        } as object,
        actionBar: ({ wrapperVariant }) => ({
          actions: [
            ...(canChooseToday ? (['today'] as const) : []),
            'cancel',
            ...(wrapperVariant === 'mobile' ? (['accept'] as const) : []),
          ],
          onSetToday: () => handleDaySelect(DateTime.local()),
        }),
        desktopPaper: {
          sx: {
            width: 'min(320px, calc(100vw - 16px))',
            overflowX: 'hidden',
            '& .MuiPickersLayout-root, & .MuiDateCalendar-root': {
              maxWidth: '100%',
            },
          },
        },
        popper: {
          modifiers: [
            {
              name: 'preventOverflow',
              options: { boundary: document.body, padding: 0 },
            },
          ],
          sx: {
            '& .MuiDialogActions-root': {
              p: (theme) => theme.spacing(1),
            },
          },
        },
        field: {
          inputProps: {
            'aria-label': t(
              'dateRangePicker.chooseDate',
              'Choose date range, selected range is {{range, daterange}}',
              {
                range: [new Date(startDate), new Date(endDate)],
                formatParams: {
                  range: longDateFormat,
                },
              },
            ),
          },
        },
        day: {
          selectedStartDate,
          startDate,
          endDate,
          onDaySelect: handleDaySelect,
        } as DatePickerSlotsComponentsProps<DateTime>['day'] & {
          selectedStartDate?: string;
          startDate: string;
          endDate: string;
          onDaySelect: Dispatch<DateTime | null>;
        },
      }}
      closeOnSelect={false}
      minDate={minimumEnd}
      onChange={handleChange}
      onClose={onClose}
      onOpen={onOpen}
      open={open}
      sx={sx}
      reduceAnimations={isReduceAnimations()}
      showDaysOutsideCurrentMonth
      value={DateTime.fromISO(selection?.date ?? startDate)}
      views={['year', 'month', 'day']}
      label={t('dateRangePicker.dateRange', '{{range, daterange}}', {
        range: [new Date(startDate), new Date(endDate)],
        formatParams: {
          range: shortMonthDateFormat,
        },
      })}
    />
  );
};

/**
 * Says which end of the range the next selected day sets. The picker closes
 * after the end date, so there is no third step.
 */
function RangeStepLayout({
  step,
  onResetStart,
  ...props
}: PickersLayoutProps<DateTime | null, DateTime, DateView> & {
  step: string;
  onResetStart?: () => void;
}) {
  const { t } = useTranslation();
  const layout = useRef<HTMLDivElement>(null);
  return (
    <Box ref={layout}>
      <Stack
        alignItems="center"
        direction="row"
        flexWrap="wrap"
        gap={1}
        justifyContent="space-between"
        maxWidth={320}
        width="100%"
        boxSizing="border-box"
        mx="auto"
        px={2}
        pt={1.5}
      >
        <Typography
          fontWeight="bold"
          role="status"
          sx={{ flex: '1 1 auto', minWidth: 0 }}
          variant="body2"
        >
          {step}
        </Typography>
        {onResetStart && (
          <Button
            onClick={() => {
              onResetStart();
              requestAnimationFrame(() => {
                layout.current
                  ?.querySelector<HTMLElement>(
                    '[role="grid"] [role="gridcell"][tabindex="0"]',
                  )
                  ?.focus();
              });
            }}
            size="small"
            sx={{ flexShrink: 0 }}
            variant="text"
          >
            {t('dateRangePicker.changeStart', 'Change start')}
          </Button>
        )}
      </Stack>
      <PickersLayout {...(props as ComponentProps<typeof PickersLayout>)} />
    </Box>
  );
}

function Day(
  props: PickersDayProps<DateTime> & {
    selectedStartDate?: string;
    startDate: string;
    endDate: string;
    onDaySelect: Dispatch<DateTime | null>;
  },
) {
  const { day, selectedStartDate, startDate, endDate, onDaySelect, ...other } =
    props;

  const isFirstDay = DateTime.fromISO(selectedStartDate ?? startDate).hasSame(
    day,
    'day',
  );
  const isLastDay =
    !selectedStartDate && DateTime.fromISO(endDate).hasSame(day, 'day');
  const isBetween =
    !selectedStartDate &&
    Interval.fromDateTimes(
      DateTime.fromISO(startDate),
      DateTime.fromISO(endDate).plus(1),
    ).contains(day);

  return (
    <HighlightedPickersDay
      isBetween={isBetween}
      isFirstDay={isFirstDay}
      isLastDay={isLastDay}
      onDaySelect={onDaySelect}
      {...other}
      day={day}
    />
  );
}
