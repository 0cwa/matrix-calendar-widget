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

import CheckOutlinedIcon from '@mui/icons-material/CheckOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { IconButton, Tooltip } from '@mui/material';
import { ReactElement, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

type CopyStatus = 'idle' | 'copied' | 'failed';

export function CopyableTextButton({
  itemLabel,
  text,
}: {
  itemLabel?: string;
  text: string;
}): ReactElement {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CopyStatus>('idle');

  const handleOnClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  }, [text]);

  const handleOnBlur = useCallback(() => setStatus('idle'), []);
  const label =
    status === 'idle'
      ? itemLabel
        ? t('copyableTextButton.copy-item', 'Copy {{item}} to clipboard', {
            item: itemLabel,
          })
        : t('copyableTextButton.copy-to-clipboard', 'Copy to clipboard')
      : status === 'copied'
        ? itemLabel
          ? t(
              'copyableTextButton.copied-item',
              'Copied {{item}} to clipboard',
              { item: itemLabel },
            )
          : t('copyableTextButton.copied', 'Copied to clipboard')
        : itemLabel
          ? t(
              'copyableTextButton.copy-failed-item',
              'Could not copy {{item}} to clipboard',
              { item: itemLabel },
            )
          : t('copyableTextButton.copy-failed', 'Could not copy to clipboard');

  return (
    <>
      <Tooltip title={label}>
        <IconButton
          aria-label={label}
          onBlur={handleOnBlur}
          onClick={() => void handleOnClick()}
        >
          {status === 'copied' ? (
            <CheckOutlinedIcon fontSize="inherit" />
          ) : status === 'failed' ? (
            <ErrorOutlineIcon color="error" fontSize="inherit" />
          ) : (
            <ContentCopyOutlinedIcon fontSize="inherit" />
          )}
        </IconButton>
      </Tooltip>
      <span
        aria-atomic="true"
        aria-live={status === 'failed' ? 'assertive' : 'polite'}
        role={
          status === 'idle'
            ? undefined
            : status === 'failed'
              ? 'alert'
              : 'status'
        }
        style={{
          border: 0,
          clip: 'rect(0, 0, 0, 0)',
          height: 1,
          margin: -1,
          overflow: 'hidden',
          padding: 0,
          position: 'absolute',
          whiteSpace: 'nowrap',
          width: 1,
        }}
      >
        {status === 'idle' ? '' : label}
      </span>
    </>
  );
}
