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
import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  Button,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  MenuList,
  Popover,
  Stack,
  Tooltip,
  Typography,
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
  compact = false,
}: {
  groups: CalendarOption[][];
  notes: string[];
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const buttonId = useId();
  const menuId = useId();
  const notesId = useId();
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
      <Tooltip title={t('calendars.options', 'Calendar options')}>
        {compact ? (
          <IconButton
            aria-label={t('calendars.options', 'Calendar options')}
            aria-controls={open ? menuId : undefined}
            aria-expanded={open}
            aria-haspopup={shownGroups.length ? 'menu' : 'dialog'}
            id={buttonId}
            onClick={() => setOpen(true)}
            ref={buttonRef}
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              width: 40,
              height: 40,
            }}
          >
            <MoreVertIcon />
          </IconButton>
        ) : (
          <Button
            aria-controls={open ? menuId : undefined}
            aria-expanded={open}
            aria-haspopup={shownGroups.length ? 'menu' : 'dialog'}
            endIcon={open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            id={buttonId}
            onClick={() => setOpen(true)}
            ref={buttonRef}
            variant="outlined"
          >
            {t('calendars.options', 'Calendar options')}
          </Button>
        )}
      </Tooltip>
      <Popover
        anchorEl={() => buttonRef.current!}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        onClose={() => setOpen(false)}
        open={open}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        PaperProps={
          shownGroups.length
            ? undefined
            : {
                id: menuId,
                role: 'dialog',
                'aria-labelledby': buttonId,
                'aria-describedby': notes.length > 0 ? notesId : undefined,
                'aria-modal': true,
                tabIndex: -1,
              }
        }
      >
        {shownGroups.length > 0 && (
          <MenuList
            aria-describedby={notes.length > 0 ? notesId : undefined}
            aria-labelledby={buttonId}
            autoFocusItem={open}
            id={menuId}
            onKeyDown={(event) => {
              if (event.key === 'Tab') {
                event.preventDefault();
                setOpen(false);
              }
            }}
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
          </MenuList>
        )}
        {notes.length > 0 && shownGroups.length > 0 && <Divider />}
        {notes.length > 0 && (
          <Stack
            id={notesId}
            spacing={0.75}
            sx={{ color: 'text.secondary', maxWidth: 320, px: 2, py: 1.25 }}
          >
            {notes.map((note) => (
              <Typography
                key={note}
                variant="body2"
                sx={{ overflowWrap: 'anywhere' }}
              >
                {note}
              </Typography>
            ))}
          </Stack>
        )}
      </Popover>
    </>
  );
}
