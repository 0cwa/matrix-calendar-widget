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

import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Button,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from '@mui/material';
import { unstable_useId as useId } from '@mui/utils';
import { ReactElement, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';

export type CalendarOption = {
  label: string;
  icon: ReactElement;
  destructive?: boolean;
  onSelect: () => void;
};

/**
 * The occasional calendar actions behind one labelled button. Groups are
 * separated by dividers. Notes explain why actions are missing.
 */
export function CalendarOptionsMenu({
  groups,
  notes,
}: {
  groups: CalendarOption[][];
  notes: string[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const buttonId = useId();
  const menuId = useId();
  const shownGroups = groups.filter((group) => group.length > 0);

  const select = (option: CalendarOption) => {
    // Close first and return focus to the button, so that the dialog opened by
    // the option gives focus back to it and not to a removed menu item.
    flushSync(() => setOpen(false));
    buttonRef.current?.focus();
    option.onSelect();
  };

  return (
    <>
      <Button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        endIcon={open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        id={buttonId}
        onClick={() => setOpen(true)}
        ref={buttonRef}
        variant="outlined"
      >
        {t('calendars.options', 'Calendar options')}
      </Button>
      <Menu
        MenuListProps={{ 'aria-labelledby': buttonId }}
        anchorEl={() => buttonRef.current!}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        id={menuId}
        onClose={() => setOpen(false)}
        open={open}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
      >
        {shownGroups.flatMap((group, index) => [
          ...(index > 0
            ? [<Divider component="li" key={`divider-${index}`} />]
            : []),
          ...group.map((option) => (
            <MenuItem
              key={option.label}
              onClick={() => select(option)}
              sx={{
                color: option.destructive ? 'error.main' : undefined,
                whiteSpace: 'normal',
              }}
            >
              <ListItemIcon sx={{ color: 'inherit' }}>
                {option.icon}
              </ListItemIcon>
              <ListItemText>{option.label}</ListItemText>
            </MenuItem>
          )),
        ])}
        {notes.length > 0 && shownGroups.length > 0 && (
          <Divider component="li" />
        )}
        {notes.map((note) => (
          <MenuItem
            aria-disabled="true"
            disableRipple
            key={note}
            sx={{
              color: 'text.secondary',
              cursor: 'default',
              maxWidth: 320,
              typography: 'body2',
              whiteSpace: 'normal',
            }}
          >
            {note}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
