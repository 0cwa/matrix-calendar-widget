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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isCalendarPrivateClientRepository,
  useCalendarRepository,
  type PrivateCalendarClientMetadata,
} from '../../calendar';

type CalendarPrivateClientDialogProps = {
  calendars: Calendar[];
  onClose: () => void;
  open: boolean;
};

type PrivateClientError =
  | 'capability-unavailable'
  | 'capacity'
  | 'load'
  | 'create'
  | 'revoke'
  | 'copy';

type CopiedCredentialField = 'url' | 'username' | 'password';

export function CalendarPrivateClientDialog({
  calendars,
  onClose,
  open,
}: CalendarPrivateClientDialogProps) {
  const { t } = useTranslation();
  const repository = useCalendarRepository();
  const clientRepository = isCalendarPrivateClientRepository(repository)
    ? repository
    : undefined;
  const [calendarId, setCalendarId] = useState<CalendarId | ''>(
    calendars[0]?.id ?? '',
  );
  const [clients, setClients] =
    useState<readonly PrivateCalendarClientMetadata[]>();
  const [createdClient, setCreatedClient] = useState<{
    calendarUrl: string;
    username: string;
    password: string;
  }>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PrivateClientError>();
  const [confirmationAppId, setConfirmationAppId] = useState<string>();
  const [copiedField, setCopiedField] = useState<CopiedCredentialField>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const clearOneTimeDetails = useCallback(() => {
    setCreatedClient(undefined);
    setCopiedField(undefined);
  }, []);
  const selectedCalendar = calendars.find(
    (calendar) => calendar.id === calendarId,
  );

  useEffect(() => {
    if (!calendars.some((calendar) => calendar.id === calendarId)) {
      setCalendarId(calendars[0]?.id ?? '');
      clearOneTimeDetails();
    }
  }, [calendarId, calendars, clearOneTimeDetails]);

  useEffect(() => {
    if (!open || !clientRepository || !calendarId) return;

    let current = true;
    setLoading(true);
    setClients(undefined);
    setError(undefined);
    setConfirmationAppId(undefined);
    clearOneTimeDetails();
    void clientRepository
      .listPrivateCalendarClients(calendarId)
      .then((result) => {
        if (current) setClients(result);
        return result;
      })
      .catch((caught: unknown) => {
        if (current) {
          setError(
            caught instanceof CalendarRepositoryError &&
              caught.code === 'capability-unavailable'
              ? 'capability-unavailable'
              : 'load',
          );
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [calendarId, clearOneTimeDetails, clientRepository, loadAttempt, open]);

  const close = () => {
    clearOneTimeDetails();
    setClients(undefined);
    setError(undefined);
    setConfirmationAppId(undefined);
    onClose();
  };

  const selectCalendar = (nextCalendarId: CalendarId) => {
    clearOneTimeDetails();
    setClients(undefined);
    setError(undefined);
    setConfirmationAppId(undefined);
    setCalendarId(nextCalendarId);
  };

  const create = async () => {
    if (!clientRepository || !calendarId || busy) return;
    setBusy(true);
    setError(undefined);
    clearOneTimeDetails();
    try {
      const result =
        await clientRepository.createPrivateCalendarClient(calendarId);
      setClients((current) =>
        current
          ? [
              result.client,
              ...current.filter((item) => item.appId !== result.client.appId),
            ]
          : [result.client],
      );
      setCreatedClient({
        calendarUrl: result.calendarUrl,
        username: result.client.appId,
        password: result.secret,
      });
    } catch (caught) {
      setError(privateClientError(caught, 'create'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (appId: string) => {
    if (!clientRepository || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const revoked = await clientRepository.revokePrivateCalendarClient(appId);
      if (revoked.appId !== appId)
        throw new Error('Unexpected access identity');
      setClients((current) =>
        current?.map((client) => (client.appId === appId ? revoked : client)),
      );
      setConfirmationAppId(undefined);
    } catch (caught) {
      setError(privateClientError(caught, 'revoke'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (field: CopiedCredentialField, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setError(undefined);
    } catch {
      setCopiedField(undefined);
      setError('copy');
    }
  };

  return (
    <Dialog
      fullWidth
      maxWidth="sm"
      onClose={busy ? undefined : close}
      open={open}
    >
      <DialogTitle>
        {t('calendarPrivateClient.title', 'Calendar app access')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography color="text.secondary" variant="body2">
            {t(
              'calendarPrivateClient.intro',
              'Create app-specific access for a calendar app to read and edit this calendar.',
            )}
          </Typography>

          <FormControl fullWidth>
            <InputLabel id="private-client-calendar-label">
              {t('calendarPrivateClient.calendar', 'Calendar')}
            </InputLabel>
            <Select
              disabled={loading || busy || calendars.length === 0}
              label={t('calendarPrivateClient.calendar', 'Calendar')}
              labelId="private-client-calendar-label"
              onChange={(event) =>
                selectCalendar(event.target.value as CalendarId)
              }
              value={calendarId}
            >
              {calendars.map((calendar) => (
                <MenuItem key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </MenuItem>
              ))}
            </Select>
            <FormHelperText>
              {t(
                'calendarPrivateClient.calendarHelp',
                'Each app access entry works with one calendar.',
              )}
            </FormHelperText>
          </FormControl>

          {error && (
            <Alert
              severity={error === 'capability-unavailable' ? 'info' : 'error'}
            >
              {privateClientErrorMessage(t, error)}
            </Alert>
          )}

          {loading && (
            <Typography aria-live="polite" role="status">
              {t('calendarPrivateClient.loading', 'Loading app access…')}
            </Typography>
          )}

          {error === 'load' && !loading && (
            <Button
              disabled={busy}
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
              variant="outlined"
            >
              {t('calendarPrivateClient.retry', 'Try again')}
            </Button>
          )}

          {createdClient && (
            <Stack spacing={1.5}>
              <Typography component="h2" variant="subtitle1">
                {t('calendarPrivateClient.createdTitle', 'Access created')}
              </Typography>
              <Alert severity="warning">
                {t(
                  'calendarPrivateClient.oneTimeWarning',
                  'Save these app-specific details now. The password is shown only once. Store it in your calendar app’s credential manager; never use your Matrix password.',
                )}
              </Alert>
              <Typography color="text.secondary" variant="body2">
                {t(
                  'calendarPrivateClient.setupHelp',
                  'In your calendar app, choose CalDAV and enter the URL, username, and password below. Access expires after 90 days.',
                )}
              </Typography>
              <CredentialField
                copied={copiedField === 'url'}
                copyLabel={t('calendarPrivateClient.copyUrl', 'Copy URL')}
                label={t('calendarPrivateClient.url', 'CalDAV URL')}
                onCopy={() => void copy('url', createdClient.calendarUrl)}
                value={createdClient.calendarUrl}
              />
              <CredentialField
                copied={copiedField === 'username'}
                copyLabel={t(
                  'calendarPrivateClient.copyUsername',
                  'Copy username',
                )}
                label={t('calendarPrivateClient.username', 'Username')}
                onCopy={() => void copy('username', createdClient.username)}
                value={createdClient.username}
              />
              <CredentialField
                copied={copiedField === 'password'}
                copyLabel={t(
                  'calendarPrivateClient.copyPassword',
                  'Copy password',
                )}
                label={t('calendarPrivateClient.password', 'App password')}
                onCopy={() => void copy('password', createdClient.password)}
                value={createdClient.password}
              />
              <Button
                onClick={clearOneTimeDetails}
                variant="outlined"
                sx={{ alignSelf: 'flex-start' }}
              >
                {t(
                  'calendarPrivateClient.hideSetupDetails',
                  'Hide setup details',
                )}
              </Button>
            </Stack>
          )}

          {!loading && clients?.length === 0 && !createdClient && !error && (
            <Alert severity="info">
              {t(
                'calendarPrivateClient.empty',
                'No calendar app access has been created for this calendar.',
              )}
            </Alert>
          )}

          {!loading && clients && (
            <Stack spacing={1}>
              {clients.map((client) => {
                const confirming = confirmationAppId === client.appId;
                const status = privateClientStatus(client);
                return (
                  <Paper key={client.appId} variant="outlined" sx={{ p: 1.5 }}>
                    <Stack spacing={1}>
                      <Typography component="h3" variant="subtitle2">
                        {t('calendarPrivateClient.createdLabel', {
                          date: formatPrivateClientDate(client.createdAt),
                          defaultValue: 'Access created {{date}}',
                        })}
                      </Typography>
                      <Typography color="text.secondary" variant="body2">
                        {t('calendarPrivateClient.expiresLabel', {
                          date: formatPrivateClientDate(client.expiresAt),
                          defaultValue: 'Expires {{date}}',
                        })}
                      </Typography>
                      <Typography color="text.secondary" variant="body2">
                        {t('calendarPrivateClient.statusLabel', {
                          status: t(
                            `calendarPrivateClient.status.${status.key}`,
                            status.fallback,
                          ),
                          defaultValue: 'Status: {{status}}',
                        })}
                      </Typography>
                      {confirming ? (
                        <Alert severity="warning">
                          <Stack spacing={1}>
                            <Typography variant="body2">
                              {t('calendarPrivateClient.revokeConfirm', {
                                date: formatPrivateClientDate(client.createdAt),
                                calendar: selectedCalendar?.name ?? '',
                                defaultValue:
                                  'Revoke access created {{date}} for “{{calendar}}”? This app will stop receiving future changes. Copies already downloaded to the app cannot be removed.',
                              })}
                            </Typography>
                            <Stack direction="row" flexWrap="wrap" gap={1}>
                              <Button
                                disabled={busy}
                                onClick={() => setConfirmationAppId(undefined)}
                                size="small"
                              >
                                {t('common.cancel', 'Cancel')}
                              </Button>
                              <Button
                                color="error"
                                disabled={busy}
                                onClick={() => void revoke(client.appId)}
                                size="small"
                                variant="contained"
                              >
                                {t(
                                  'calendarPrivateClient.confirmRevoke',
                                  'Revoke access',
                                )}
                              </Button>
                            </Stack>
                          </Stack>
                        </Alert>
                      ) : (
                        client.state !== 'revoked' && (
                          <Button
                            color="error"
                            disabled={busy}
                            onClick={() => {
                              setError(undefined);
                              setConfirmationAppId(client.appId);
                            }}
                            size="small"
                            sx={{ alignSelf: 'flex-start' }}
                            variant="outlined"
                          >
                            {t('calendarPrivateClient.revoke', 'Revoke')}
                          </Button>
                        )
                      )}
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={close}>
          {t('common.close', 'Close')}
        </Button>
        {!loading &&
          clients !== undefined &&
          error !== 'capability-unavailable' &&
          error !== 'capacity' &&
          !createdClient &&
          !confirmationAppId &&
          selectedCalendar && (
            <Button
              disabled={busy}
              onClick={() => void create()}
              variant="contained"
            >
              {busy
                ? t('calendarPrivateClient.creating', 'Creating app access…')
                : t('calendarPrivateClient.create', 'Create app access')}
            </Button>
          )}
      </DialogActions>
    </Dialog>
  );
}

function CredentialField({
  copied,
  copyLabel,
  label,
  onCopy,
  value,
}: {
  copied: boolean;
  copyLabel: string;
  label: string;
  onCopy: () => void;
  value: string;
}) {
  const { t } = useTranslation();
  return (
    <Stack spacing={0.75}>
      <TextField
        autoComplete="off"
        fullWidth
        inputProps={{
          autoCapitalize: 'none',
          autoCorrect: 'off',
          readOnly: true,
          spellCheck: false,
        }}
        label={label}
        value={value}
      />
      <Button
        onClick={onCopy}
        size="small"
        sx={{ alignSelf: 'flex-start' }}
        variant="outlined"
      >
        {copied ? t('calendarPrivateClient.copied', 'Copied') : copyLabel}
      </Button>
    </Stack>
  );
}

function privateClientError(
  error: unknown,
  fallback: 'create' | 'revoke',
): PrivateClientError {
  if (!(error instanceof CalendarRepositoryError)) return fallback;
  if (error.code === 'capability-unavailable') return 'capability-unavailable';
  if (error.code === 'private-client-capacity-reached') return 'capacity';
  return fallback;
}

function privateClientErrorMessage(
  t: TFunction,
  error: PrivateClientError,
): string {
  switch (error) {
    case 'capability-unavailable':
      return t(
        'calendarPrivateClient.unavailable',
        'Calendar app access is not available on this server.',
      );
    case 'capacity':
      return t(
        'calendarPrivateClient.capacity',
        'This calendar has reached its app access limit. Revoke an unused entry and try again.',
      );
    case 'load':
      return t(
        'calendarPrivateClient.loadFailed',
        'Could not load calendar app access. Check your connection and permissions, then try again.',
      );
    case 'create':
      return t(
        'calendarPrivateClient.createFailed',
        'Could not create app access. Check your permissions and try again.',
      );
    case 'revoke':
      return t(
        'calendarPrivateClient.revokeFailed',
        'Could not revoke app access. Check your permissions and try again.',
      );
    case 'copy':
      return t(
        'calendarPrivateClient.copyFailed',
        'Copy failed. Select and copy the value above.',
      );
  }
}

function formatPrivateClientDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function privateClientStatus(client: PrivateCalendarClientMetadata): {
  key: 'active' | 'pending' | 'revoked' | 'attention';
  fallback: string;
} {
  if (client.state === 'revoked')
    return { key: 'revoked', fallback: 'Revoked' };
  if (client.state === 'pending') {
    return { key: 'pending', fallback: 'Setting up' };
  }
  if (client.mapState !== 'present') {
    return { key: 'attention', fallback: 'Needs attention' };
  }
  return { key: 'active', fallback: 'Active' };
}
