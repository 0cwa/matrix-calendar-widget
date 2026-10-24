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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  isCalendarPrivateClientRepository,
  useCalendarRepository,
  type PrivateCalendarClientMetadata,
} from '../../calendar';

type CalendarPrivateClientDialogProps = {
  calendars: Calendar[];
  onClose: () => void;
  onStaleClientCleanupFailed: (details: {
    calendarName: string;
    createdAt: string;
  }) => void;
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
  onStaleClientCleanupFailed,
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
  const operationGeneration = useRef(0);
  const clearOneTimeDetails = useCallback(() => {
    setCreatedClient(undefined);
    setCopiedField(undefined);
  }, []);
  const selectedCalendar = calendars.find(
    (calendar) => calendar.id === calendarId,
  );
  const selectedCalendarContext = selectedCalendar
    ? JSON.stringify({
        id: selectedCalendar.id,
        name: selectedCalendar.name,
        operatorManaged: selectedCalendar.operatorManaged,
        readOnly: selectedCalendar.readOnly,
      })
    : '';

  useLayoutEffect(() => {
    operationGeneration.current += 1;
    setBusy(false);
    setLoading(false);
    setClients(undefined);
    setError(undefined);
    setConfirmationAppId(undefined);
    clearOneTimeDetails();

    return () => {
      operationGeneration.current += 1;
    };
  }, [clearOneTimeDetails, open, repository, selectedCalendarContext]);

  useEffect(() => {
    if (!calendars.some((calendar) => calendar.id === calendarId)) {
      setCalendarId(calendars[0]?.id ?? '');
      clearOneTimeDetails();
    }
  }, [calendarId, calendars, clearOneTimeDetails]);

  useEffect(() => {
    if (!open || !clientRepository) return;
    if (!calendarId || !selectedCalendarContext) {
      setLoading(false);
      return;
    }

    let current = true;
    const generation = operationGeneration.current;
    setLoading(true);
    setClients(undefined);
    setError(undefined);
    setConfirmationAppId(undefined);
    clearOneTimeDetails();
    void clientRepository
      .listPrivateCalendarClients(calendarId)
      .then((result) => {
        if (current && operationGeneration.current === generation) {
          setClients(result);
        }
        return result;
      })
      .catch((caught: unknown) => {
        if (current && operationGeneration.current === generation) {
          setError(
            caught instanceof CalendarRepositoryError &&
              caught.code === 'capability-unavailable'
              ? 'capability-unavailable'
              : 'load',
          );
        }
      })
      .finally(() => {
        if (current && operationGeneration.current === generation) {
          setLoading(false);
        }
      });

    return () => {
      current = false;
    };
  }, [
    calendarId,
    clearOneTimeDetails,
    clientRepository,
    loadAttempt,
    open,
    selectedCalendarContext,
  ]);

  const close = () => {
    operationGeneration.current += 1;
    clearOneTimeDetails();
    setClients(undefined);
    setError(undefined);
    setConfirmationAppId(undefined);
    onClose();
  };

  const selectCalendar = (nextCalendarId: CalendarId) => {
    operationGeneration.current += 1;
    clearOneTimeDetails();
    setClients(undefined);
    setError(undefined);
    setConfirmationAppId(undefined);
    setCalendarId(nextCalendarId);
  };

  const create = async () => {
    if (!clientRepository || !calendarId || busy) return;
    const requestGeneration = operationGeneration.current;
    const requestRepository = clientRepository;
    const requestCalendarId = calendarId;
    const requestCalendarName = selectedCalendar?.name ?? '';
    setBusy(true);
    setError(undefined);
    clearOneTimeDetails();
    try {
      const result =
        await requestRepository.createPrivateCalendarClient(requestCalendarId);
      if (operationGeneration.current !== requestGeneration) {
        try {
          const revoked = await requestRepository.revokePrivateCalendarClient(
            result.client.appId,
          );
          if (
            revoked.appId !== result.client.appId ||
            revoked.state !== 'revoked'
          ) {
            throw new Error('Stale app access cleanup was not confirmed');
          }
        } catch {
          onStaleClientCleanupFailed?.({
            calendarName:
              requestCalendarName ||
              t(
                'calendarPrivateClient.unknownCalendar',
                'the selected calendar',
              ),
            createdAt: formatPrivateClientDate(result.client.createdAt),
          });
        }
        return;
      }
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
      if (operationGeneration.current === requestGeneration) {
        setError(privateClientError(caught, 'create'));
      }
    } finally {
      if (operationGeneration.current === requestGeneration) {
        setBusy(false);
      }
    }
  };

  const revoke = async (appId: string) => {
    if (!clientRepository || busy) return;
    const requestGeneration = operationGeneration.current;
    const requestRepository = clientRepository;
    setBusy(true);
    setError(undefined);
    try {
      const revoked =
        await requestRepository.revokePrivateCalendarClient(appId);
      if (revoked.appId !== appId)
        throw new Error('Unexpected access identity');
      if (operationGeneration.current !== requestGeneration) return;
      setClients((current) =>
        current?.map((client) => (client.appId === appId ? revoked : client)),
      );
      setConfirmationAppId(undefined);
    } catch (caught) {
      if (operationGeneration.current === requestGeneration) {
        setError(privateClientError(caught, 'revoke'));
      }
    } finally {
      if (operationGeneration.current === requestGeneration) {
        setBusy(false);
      }
    }
  };

  const copy = async (field: CopiedCredentialField, value: string) => {
    const requestGeneration = operationGeneration.current;
    try {
      await navigator.clipboard.writeText(value);
      if (operationGeneration.current !== requestGeneration) return;
      setCopiedField(field);
      setError(undefined);
    } catch {
      if (operationGeneration.current !== requestGeneration) return;
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
                const statusLabel = (() => {
                  switch (status) {
                    case 'active':
                      return t('calendarPrivateClient.status.active', 'Active');
                    case 'pending':
                      return t(
                        'calendarPrivateClient.status.pending',
                        'Setting up',
                      );
                    case 'revoked':
                      return t('calendarPrivateClient.status.revoked', 'Revoked');
                    case 'attention':
                      return t(
                        'calendarPrivateClient.status.attention',
                        'Needs attention',
                      );
                  }
                })();
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
                          status: statusLabel,
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

function privateClientStatus(
  client: PrivateCalendarClientMetadata,
): 'active' | 'pending' | 'revoked' | 'attention' {
  if (client.state === 'revoked')
    return 'revoked';
  if (client.state === 'pending') {
    return 'pending';
  }
  if (client.mapState !== 'present') {
    return 'attention';
  }
  return 'active';
}
