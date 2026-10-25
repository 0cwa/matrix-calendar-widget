export type ReminderAllDayScheduleReadback = Readonly<{
  daysBefore: number;
  localTime: string;
  timezone: string;
}>;

export type ReminderAllDayScheduleReadbackScope = {
  getByRole(
    role: 'spinbutton' | 'textbox',
    options: { name: string },
  ): { inputValue(): Promise<string> };
  getByLabel(label: string): { inputValue(): Promise<string> };
};

export declare function readReminderAllDayScheduleFields(
  details: ReminderAllDayScheduleReadbackScope,
  allDay: boolean,
): Promise<ReminderAllDayScheduleReadback>;
