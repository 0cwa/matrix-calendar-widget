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

import {
  CalendarRepositoryError,
  type Calendar,
  type CalendarId,
} from '@matrix-calendar-widget/calendar';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarPublicFeedPublication,
  isCalendarPublicFeedRepository,
  useCalendarRepository,
} from '../../calendar';

type CalendarPublicFeedDialogProps = {
  calendars: Calendar[];
  onClose: () => void;
  open: boolean;
};

export function CalendarPublicFeedDialog({
  calendars,
  onClose,
  open,
}: CalendarPublicFeedDialogProps) {
  const { t } = useTranslation();
  const repository = useCalendarRepository();
  const feedRepository = isCalendarPublicFeedRepository(repository)
    ? repository
    : undefined;
  const [calendarId, setCalendarId] = useState<CalendarId | ''>(
    calendars[0]?.id ?? '',
  );
  const [publication, setPublication] =
    useState<CalendarPublicFeedPublication>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const selectedCalendar = calendars.find(
    (calendar) => calendar.id === calendarId,
  );
  const supportedComponents = selectedCalendar?.supportedComponents;
  const advertisesAdditionalComponents =
    supportedComponents !== undefined &&
    (!supportedComponents.includes('VEVENT') ||
      supportedComponents.some((component) => component !== 'VEVENT'));

  useEffect(() => {
    if (!calendars.some((calendar) => calendar.id === calendarId)) {
      setCalendarId(calendars[0]?.id ?? '');
    }
  }, [calendarId, calendars]);

  useEffect(() => {
    if (!open || !feedRepository || !calendarId) return;

    let current = true;
    setLoading(true);
    setPublication(undefined);
    setError(undefined);
    setCopied(false);
    setConfirmed(false);
    void feedRepository
      .getPublicCalendarFeedPublication(calendarId)
      .then((result) => {
        if (current) setPublication(result);
        return result;
      })
      .catch(() => {
        if (current) {
          setPublication(undefined);
          setError(
            t(
              'calendarPublicFeed.loadFailed',
              'Could not load public feed settings. Check your connection and your permission to manage this calendar, then try again.',
            ),
          );
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [calendarId, feedRepository, loadAttempt, open, t]);

  const publish = async () => {
    if (!feedRepository || !calendarId || !confirmed) return;
    setBusy(true);
    setError(undefined);
    try {
      setPublication(
        await feedRepository.publishPublicCalendarFeed(calendarId, true),
      );
      setConfirmed(false);
    } catch (error) {
      setError(
        error instanceof CalendarRepositoryError &&
          error.code === 'unsupported-calendar-components'
          ? t(
              'calendarPublicFeed.unsupportedComponents',
              'This calendar contains components other than events. Public feeds require a VEVENT-only calendar, so the server refused to publish it.',
            )
          : t(
              'calendarPublicFeed.publishFailed',
              'Could not publish this calendar. Check your permissions and try again.',
            ),
      );
    } finally {
      setBusy(false);
    }
  };

  const unpublish = async () => {
    if (!feedRepository || !calendarId) return;
    setBusy(true);
    setError(undefined);
    try {
      setPublication(
        await feedRepository.unpublishPublicCalendarFeed(calendarId),
      );
      setConfirmed(false);
      setCopied(false);
    } catch {
      setError(
        t(
          'calendarPublicFeed.unpublishFailed',
          'Could not unpublish this calendar. Check your permissions and try again.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async () => {
    if (!publication?.url) return;
    try {
      await navigator.clipboard.writeText(publication.url);
      setCopied(true);
    } catch {
      setError(
        t(
          'calendarPublicFeed.copyFailed',
          'Copy failed. Select and copy the feed URL above.',
        ),
      );
    }
  };

  const subscribeUrl = publication?.url?.replace(/^https?:/u, 'webcal:');

  return (
    <Dialog
      fullWidth
      maxWidth="sm"
      onClose={busy ? undefined : onClose}
      open={open}
    >
      <DialogTitle>
        {t('calendarPublicFeed.title', 'Public calendar feed')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <FormControl fullWidth>
            <InputLabel id="public-feed-calendar-label">
              {t('calendarPublicFeed.calendar', 'Calendar')}
            </InputLabel>
            <Select
              disabled={loading || busy}
              label={t('calendarPublicFeed.calendar', 'Calendar')}
              labelId="public-feed-calendar-label"
              onChange={(event) => {
                setConfirmed(false);
                setError(undefined);
                setCopied(false);
                setCalendarId(event.target.value as CalendarId);
              }}
              value={calendarId}
            >
              {calendars.map((calendar) => (
                <MenuItem key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Alert severity="warning">
            {t(
              'calendarPublicFeed.publicWarning',
              'Anyone with the link can read every event in this calendar. The feed is not limited to Matrix room members. Unpublishing blocks future requests but cannot retract copies already downloaded.',
            )}
          </Alert>

          {advertisesAdditionalComponents && (
            <Alert severity="info">
              {t(
                'calendarPublicFeed.additionalComponents',
                'This calendar reports component types beyond VEVENT, such as tasks or journal entries, or does not advertise VEVENT support. Public feeds require VEVENT-only content; the server checks the feed before publishing and on every read.',
              )}
            </Alert>
          )}

          {error && <Alert severity="error">{error}</Alert>}
          {error && !publication && !loading && (
            <Button
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
              variant="outlined"
            >
              {t('calendarPublicFeed.retry', 'Try again')}
            </Button>
          )}
          {loading && (
            <Typography aria-live="polite" role="status">
              {t('calendarPublicFeed.loading', 'Loading feed settings…')}
            </Typography>
          )}

          {!loading && publication && !publication.enabled && (
            <Alert severity="info">
              {t(
                'calendarPublicFeed.disabled',
                'Public feeds are not enabled by this server.',
              )}
            </Alert>
          )}

          {!loading && publication?.published && publication.url && (
            <Stack spacing={1}>
              <TextField
                fullWidth
                inputProps={{
                  readOnly: true,
                  'aria-label': t('calendarPublicFeed.url', 'Public feed URL'),
                }}
                label={t('calendarPublicFeed.url', 'Public feed URL')}
                value={publication.url}
              />
              <Stack direction="row" flexWrap="wrap" gap={1}>
                <Button disabled={busy} onClick={copyUrl} variant="outlined">
                  {copied
                    ? t('calendarPublicFeed.copied', 'Copied')
                    : t('calendarPublicFeed.copy', 'Copy URL')}
                </Button>
                <Button
                  component="a"
                  href={subscribeUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                  variant="outlined"
                >
                  {t(
                    'calendarPublicFeed.subscribe',
                    'Subscribe in a calendar app',
                  )}
                </Button>
                <Button
                  color="error"
                  disabled={busy}
                  onClick={() => void unpublish()}
                  variant="outlined"
                >
                  {t('calendarPublicFeed.unpublish', 'Unpublish')}
                </Button>
              </Stack>
            </Stack>
          )}

          {!loading && publication?.published && !publication.url && (
            <Stack spacing={1}>
              <Alert severity="warning">
                {t(
                  'calendarPublicFeed.urlUnavailable',
                  'This calendar is published, but the server cannot provide its public URL. Unpublish it here or ask the server administrator to restore feed configuration.',
                )}
              </Alert>
              <Button
                color="error"
                disabled={busy}
                onClick={() => void unpublish()}
                variant="outlined"
              >
                {t('calendarPublicFeed.unpublish', 'Unpublish')}
              </Button>
            </Stack>
          )}

          {!loading &&
            publication &&
            !publication.published &&
            publication.enabled && (
              <FormControlLabel
                control={
                  <Checkbox
                    disabled={busy}
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                }
                label={t(
                  'calendarPublicFeed.confirm',
                  'I understand that anyone with the link can read this calendar.',
                )}
              />
            )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          {t('common.close', 'Close')}
        </Button>
        {!loading &&
          publication &&
          !publication.published &&
          publication.enabled && (
            <Button
              disabled={!confirmed || busy || loading || !calendarId}
              onClick={() => void publish()}
              variant="contained"
            >
              {t('calendarPublicFeed.publish', 'Publish feed')}
            </Button>
          )}
      </DialogActions>
    </Dialog>
  );
}
