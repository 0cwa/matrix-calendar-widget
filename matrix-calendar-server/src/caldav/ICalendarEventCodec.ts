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
  CalendarEvent,
  CalendarEventAlarmPatch,
  CalendarEventAttachmentInput,
  CalendarEventAttachmentPatch,
  CalendarEventAttachmentValidationError,
  CalendarEventConferenceInput,
  CalendarEventConferencePatch,
  CalendarEventConferenceValidationError,
  MAX_CALENDAR_EVENT_AUTHORABLE_ATTACHMENTS,
  CalendarEventDateTime,
  CalendarEventDisplayAlarm,
  CalendarEventDisplayAlarmInput,
  CalendarEventDuration,
  CalendarEventFollowingTimingWrite,
  CalendarEventId,
  CalendarEventInput,
  CalendarEventPatch,
  CalendarEventRecurrence,
  CalendarEventRecurrenceDate,
  CalendarEventRecurrenceOverride,
  CalendarEventRecurrenceTiming,
  CalendarEventRecurrenceWrite,
  CalendarEventRevision,
  CalendarEventStatus,
  CalendarEventTimedDateTime,
  CalendarEventTiming,
  CalendarEventTransparency,
  CalendarId,
  boundCalendarEventExternalLinkLabel,
  calendarEventFollowingTimingOverrides,
  calendarEventRecurrenceIdentity,
  calendarEventTimedDateTimeToDateTime,
  calendarLocalDateTimeToUnixMillis,
  canonicalizeCalendarExternalUrl,
  isCalendarEventAlarmRemoval,
  isCalendarTimezoneSupported,
  isSupportedCalendarEventOccurrenceExclusion,
  normalizeCalendarEventConferenceInput,
  normalizeCalendarEventConferencePatch,
  normalizeCalendarEventAttachmentInput,
  normalizeCalendarEventAttachmentPatch,
  parseSupportedCalendarEventRecurrenceRule,
  validateCalendarEventInputConference,
  validateCalendarEventPatchConference,
  validateCalendarEventInputAttachment,
  validateCalendarEventPatchAttachment,
} from '@matrix-calendar-widget/calendar';
import { randomUUID } from 'crypto';
import ICAL from 'ical.js';
import { DateTime } from 'luxon';
import { hasUnsupportedTimezoneRules } from './ICalendarTimezoneProjectionSafety';
import { readCalendarLinks } from './readCalendarLinks';

type RevisionPropertyState<T> =
  | { kind: 'missing' }
  | { kind: 'valid'; value: T }
  | { kind: 'invalid' };

type ICalendarContentLine = {
  value: string;
  physicalLines: string[];
};

type RawRevisionProperty = ICalendarContentLine & {
  name: 'dtstamp' | 'created' | 'last-modified' | 'sequence';
};

type RawVeventProperty = {
  name: string;
  header: string;
  value: string;
  physicalLines: string[];
};

type SupportedConferenceValue = {
  url: string;
  label?: string;
};

type ConferenceSourceState = {
  present: boolean;
  editable?: SupportedConferenceValue;
};

type SupportedAttachmentValue = {
  url: string;
  propertyIndex: number;
};

type AttachmentSourceState = {
  editable: SupportedAttachmentValue[];
  opaqueUriUrls: string[];
  unsupported: boolean;
};

type AttachmentPatchPlan = {
  noOp: boolean;
  nextProperties: ICalendarContentLine[];
  sourcePropertyIndex?: number;
};

const systemClock = (): Date => new Date();
// RFC 5545 INTEGER is a signed 32-bit value; SEQUENCE uses its nonnegative range.
const MAX_ICALENDAR_SEQUENCE = 2_147_483_647;
/** Fixed cap for finite suffix materialization before cloning or transport. */
export const MAX_FOLLOWING_RESOURCE_BYTES = 4 * 1024 * 1024;

export type EncodedICalendarEvent = {
  event: CalendarEvent;
  icalendar: string;
};

export type OccurrenceTimingOverrideWrite = {
  recurrenceId: CalendarEventDateTime;
  timing: CalendarEventRecurrenceTiming;
};

export type OccurrenceTimingOverrideResult = {
  /** A detached clone; callers attach it only after all preflights succeed. */
  component: ICAL.Component;
  action: 'created' | 'updated';
  /** Raw source lines needed to retain opaque metadata after serialization. */
  sourceRevisionProperties: RawRevisionProperty[];
  revisionUpdated: boolean;
  noOp: boolean;
};

export type ICalendarEventCodecErrorCode =
  | 'invalid-calendar'
  | 'missing-event'
  | 'missing-uid'
  | 'missing-timing'
  | 'invalid-timing'
  | 'event-too-large'
  | 'unsupported-patch';

export class ICalendarEventCodecError extends Error {
  constructor(
    public readonly code: ICalendarEventCodecErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ICalendarEventCodecError';
  }
}

export class ParsedICalendarEvent {
  constructor(
    private readonly calendar: ICAL.Component,
    public readonly event: CalendarEvent,
    /** Internal marker for count-only list diagnostics, not event payloads. */
    public readonly listProjectionDiagnostic?: 'unsupported-recurrence',
    private readonly clock: () => Date = systemClock,
    private readonly sourceRevisionProperties?: RawRevisionProperty[],
    private readonly sourceICalendar: string = calendar.toString(),
  ) {}

  applyPatch(patch: CalendarEventPatch): EncodedICalendarEvent {
    let conferencePatch: CalendarEventConferencePatch | undefined;
    let attachmentPatch: CalendarEventAttachmentPatch | undefined;
    try {
      validateCalendarEventPatchConference(patch);
      validateCalendarEventPatchAttachment(patch);
      if (hasOwn(patch, 'conference')) {
        conferencePatch = normalizeCalendarEventConferencePatch(
          patch.conference,
        );
      }
      if (hasOwn(patch, 'attachment')) {
        attachmentPatch = normalizeCalendarEventAttachmentPatch(
          patch.attachment,
        );
      }
    } catch (error) {
      if (error instanceof CalendarEventConferenceValidationError) {
        throw unsupportedConferencePatch();
      }
      if (error instanceof CalendarEventAttachmentValidationError) {
        throw unsupportedAttachmentPatch();
      }
      throw error;
    }
    if (conferencePatch && this.event.unsupportedConference) {
      throw unsupportedConferencePatch();
    }
    const sourceConferencePropertiesByEvent = rawVeventConferenceProperties(
      this.sourceICalendar,
    );
    const sourceAttachmentPropertiesByEvent = rawVeventAttachmentProperties(
      this.sourceICalendar,
    );
    const sourceMasterEvent = findMasterEvent(this.calendar, this.event.uid);
    const sourceMasterIndex = sourceMasterEvent
      ? this.calendar.getAllSubcomponents('vevent').indexOf(sourceMasterEvent)
      : -1;
    const sourceConferenceProperties =
      sourceConferencePropertiesByEvent[sourceMasterIndex] ?? [];
    const sourceAttachmentProperties =
      sourceAttachmentPropertiesByEvent[sourceMasterIndex] ?? [];
    const sourceConferenceState = conferencePatch
      ? sourceMasterEvent
        ? readConferenceSourceState(
            sourceMasterEvent,
            sourceConferenceProperties,
          )
        : undefined
      : undefined;
    const conferenceWriteIsNoOp = Boolean(
      conferencePatch &&
      sourceConferenceState &&
      conferencePatchIsNoOp(conferencePatch, sourceConferenceState),
    );
    const sourceAttachmentState = sourceMasterEvent
      ? readAttachmentSourceState(sourceMasterEvent, sourceAttachmentProperties)
      : undefined;
    const ambiguousAttachmentSource = sourceMasterEvent
      ? hasAmbiguousAttachmentSource(
          this.calendar,
          this.event.uid,
          sourceMasterEvent,
          sourceAttachmentPropertiesByEvent,
        )
      : true;
    if (
      attachmentPatch &&
      (this.event.unsupportedAttachment ||
        ambiguousAttachmentSource ||
        sourceAttachmentState?.unsupported)
    ) {
      throw unsupportedAttachmentPatch();
    }
    const attachmentWritePlan =
      attachmentPatch && sourceMasterEvent && sourceAttachmentState
        ? planAttachmentPatch(
            sourceAttachmentProperties,
            sourceAttachmentState,
            attachmentPatch,
          )
        : undefined;
    if (attachmentPatch && !attachmentWritePlan) {
      throw unsupportedAttachmentPatch();
    }
    const attachmentWriteIsNoOp = Boolean(
      attachmentPatch && attachmentWritePlan?.noOp,
    );
    if (
      Object.keys(patch).length === 1 &&
      ((conferencePatch && conferenceWriteIsNoOp) ||
        (attachmentPatch && attachmentWriteIsNoOp))
    ) {
      return { event: this.event, icalendar: this.sourceICalendar };
    }
    if (this.event.unsupportedTimezone && hasOwn(patch, 'timing')) {
      throw new ICalendarEventCodecError(
        'unsupported-patch',
        'Timing edits are not supported for events with unsupported timezone rules',
      );
    }
    const hasRecurrencePatch = hasOwn(patch, 'recurrence');
    const hasAlarmPatch = hasOwn(patch, 'alarm');
    if (hasAlarmPatch && this.event.unsupportedAlarm) {
      throw unsupportedAlarmPatch();
    }
    if (hasAlarmPatch && !isCalendarEventAlarmRemoval(patch.alarm)) {
      validateDisplayAlarm(patch.alarm);
    }
    const recurrenceWrite = hasRecurrencePatch
      ? recurrenceWriteFromUnknown(patch.recurrence)
      : undefined;
    if (
      hasOwn(patch, 'timing') &&
      patch.timing &&
      !(recurrenceWrite && 'rrule' in recurrenceWrite) &&
      typeof this.event.recurrence?.rrule === 'string'
    ) {
      let hasSupportedMonthlyOrdinal = false;
      try {
        hasSupportedMonthlyOrdinal =
          parseSupportedCalendarEventRecurrenceRule(
            this.event.recurrence.rrule,
            timingStartAsDateTime(this.event.timing),
          )?.weekdayOrdinal !== undefined;
      } catch {
        // Preserve timing edits for recurrence rules outside the editor's
        // authoring subset; the RRULE remains opaque and unchanged.
      }
      if (hasSupportedMonthlyOrdinal) {
        validateRecurrenceRule(
          this.event.recurrence.rrule,
          timingStartAsDateTime(patch.timing),
        );
      }
    }
    if (recurrenceWrite && 'occurrence' in recurrenceWrite) {
      if (Object.keys(patch).some((key) => key !== 'recurrence')) {
        throw unsupportedOccurrenceTimingPatch();
      }
      return this.applyOccurrencePatch(
        recurrenceWrite.occurrence as OccurrenceTimingOverrideWrite & {
          viewerTimezone: string;
        },
      );
    }
    if (recurrenceWrite && 'following' in recurrenceWrite) {
      if (Object.keys(patch).some((key) => key !== 'recurrence')) {
        throw unsupportedFollowingTimingPatch();
      }
      return this.applyFollowingPatch(recurrenceWrite.following);
    }
    if (hasRecurrencePatch) {
      if (recurrenceWrite && 'exdate' in recurrenceWrite) {
        assertOccurrenceExdateCanBeEdited(
          this.event,
          recurrenceWrite.exdate.recurrenceId,
          this.listProjectionDiagnostic,
        );
      } else if (recurrenceWrite && 'rdate' in recurrenceWrite) {
        if (recurrenceWrite.rdate.action === 'remove-period') {
          assertPeriodRdateCanBeRemoved(
            this.event,
            recurrenceWrite.rdate.value,
            this.listProjectionDiagnostic,
          );
        } else if (recurrenceWrite.rdate.action === 'add-period') {
          assertPeriodRdateCanBeAdded(
            this.event,
            recurrenceWrite.rdate.value,
            this.listProjectionDiagnostic,
          );
        } else if (recurrenceWrite.rdate.action === 'replace-period') {
          assertPeriodRdateCanBeReplaced(
            this.event,
            recurrenceWrite.rdate.value,
            recurrenceWrite.rdate.replacement,
            this.listProjectionDiagnostic,
          );
        } else {
          assertPointRdateCanBeEdited(
            this.event,
            recurrenceWrite.rdate.value,
            this.listProjectionDiagnostic,
          );
        }
      } else {
        if (this.listProjectionDiagnostic === 'unsupported-recurrence') {
          throw unsupportedRecurrencePatch();
        }
        assertSimpleRecurrenceCanBeEdited(this.event);
        const nextRule = recurrenceWrite?.rrule;
        if (nextRule !== undefined) {
          validateRecurrenceRule(
            nextRule,
            timingStartAsDateTime(patch.timing ?? this.event.timing),
          );
        }
      }
    }

    const calendar = ICAL.Component.fromString(this.calendar.toString());
    const vevent = findMasterEvent(calendar, this.event.uid);
    if (!vevent) {
      throw new ICalendarEventCodecError(
        'missing-event',
        'Parsed iCalendar no longer contains the target VEVENT',
      );
    }
    if (
      hasAlarmPatch &&
      (this.event.unsupportedAlarm ||
        readResourceAlarm(calendar, vevent).unsupported)
    ) {
      throw unsupportedAlarmPatch();
    }
    const eventSourceBeforePatch = vevent.toString();
    let periodReplacementIsNoOp = false;

    if (hasOwn(patch, 'title')) {
      setTextProperty(vevent, 'summary', patch.title ?? '');
    }
    if (hasOwn(patch, 'description')) {
      setOptionalProperty(vevent, 'description', patch.description);
    }
    if (hasOwn(patch, 'timing') && patch.timing) {
      setTiming(vevent, patch.timing);
    }
    if (hasOwn(patch, 'status')) {
      setOptionalProperty(vevent, 'status', patch.status?.toUpperCase());
    }
    if (hasOwn(patch, 'transparency')) {
      setOptionalProperty(
        vevent,
        'transp',
        patch.transparency === undefined
          ? undefined
          : patch.transparency === 'transparent'
            ? 'TRANSPARENT'
            : 'OPAQUE',
      );
    }
    if (hasOwn(patch, 'location')) {
      setOptionalProperty(vevent, 'location', patch.location);
    }
    if (hasOwn(patch, 'url')) {
      setOptionalProperty(vevent, 'url', patch.url);
    }
    if (hasOwn(patch, 'categories')) {
      setCategories(vevent, patch.categories);
    }
    if (hasOwn(patch, 'priority')) {
      setOptionalProperty(vevent, 'priority', patch.priority);
    }
    if (conferencePatch && !conferenceWriteIsNoOp) {
      setConferenceProperty(vevent, conferencePatch);
    }
    if (attachmentPatch && !attachmentWritePlan?.noOp) {
      setAttachmentProperty(
        vevent,
        attachmentPatch,
        attachmentWritePlan?.sourcePropertyIndex,
      );
    }
    if (hasRecurrencePatch) {
      if (recurrenceWrite && 'exdate' in recurrenceWrite) {
        applyOccurrenceExdate(vevent, recurrenceWrite.exdate);
      } else if (recurrenceWrite && 'rdate' in recurrenceWrite) {
        if (recurrenceWrite.rdate.action === 'remove-period') {
          assertRdatePropertiesCanBeEdited(vevent, this.event);
          applyPeriodRdate(vevent, recurrenceWrite.rdate.value);
        } else if (recurrenceWrite.rdate.action === 'add-period') {
          assertRdatePropertiesCanBeEdited(vevent, this.event);
          applyPeriodRdate(vevent, recurrenceWrite.rdate.value, calendar);
        } else if (recurrenceWrite.rdate.action === 'replace-period') {
          assertRdatePropertiesCanBeEdited(vevent, this.event);
          periodReplacementIsNoOp = !applyPeriodRdateReplacement(
            vevent,
            recurrenceWrite.rdate.value,
            recurrenceWrite.rdate.replacement,
          );
        } else {
          assertRdatePropertiesCanBeEdited(vevent, this.event);
          applyPointRdate(calendar, vevent, recurrenceWrite.rdate, this.event);
        }
        if (hasUnsupportedTimezoneRules(calendar, this.event.uid)) {
          throw unsupportedRecurrencePatch();
        }
      } else {
        setRecurrenceRule(vevent, recurrenceWrite?.rrule);
      }
    }
    const writtenAlarmUid = hasAlarmPatch
      ? setDisplayAlarm(
          calendar,
          vevent,
          patch.alarm,
          patch.title ?? this.event.title,
        )
      : undefined;

    if (
      periodReplacementIsNoOp &&
      Object.keys(patch).length === 1 &&
      hasRecurrencePatch
    ) {
      return { event: this.event, icalendar: this.sourceICalendar };
    }

    const veventContentChanged = vevent.toString() !== eventSourceBeforePatch;
    const revisionUpdated =
      veventContentChanged &&
      updateRevisionMetadata(
        vevent,
        this.clock(),
        this.sourceRevisionProperties,
      );

    // The editor submits its ordinary fields together with a conference
    // change. If that conference operation and every VEVENT field are
    // unchanged, return the original bytes so the gateway can honor the
    // current ETag without a needless CalDAV PUT. The semantic comparison is
    // against ical.js's parsed form above; returning the source also retains
    // original property ordering and folding.
    const hasExplicitLinkPatch = Boolean(conferencePatch || attachmentPatch);
    const explicitLinkPatchesAreNoOp =
      (!conferencePatch || conferenceWriteIsNoOp) &&
      (!attachmentPatch || attachmentWriteIsNoOp);
    if (
      hasExplicitLinkPatch &&
      explicitLinkPatchesAreNoOp &&
      !veventContentChanged &&
      !hasAlarmPatch
    ) {
      return { event: this.event, icalendar: this.sourceICalendar };
    }

    const recurrence = hasRecurrencePatch
      ? recurrenceWrite && 'exdate' in recurrenceWrite
        ? readRecurrence(calendar, vevent, this.event.uid)
        : recurrenceWrite && 'rdate' in recurrenceWrite
          ? readRecurrence(calendar, vevent, this.event.uid)
          : recurrenceWrite?.rrule
            ? { rrule: canonicalizeRecurrenceRule(recurrenceWrite.rrule) }
            : undefined
      : this.event.recurrence;

    const updatedAttachmentState =
      attachmentPatch && attachmentWritePlan
        ? readAttachmentSourceState(
            vevent,
            attachmentWritePlan.nextProperties,
          )
        : undefined;
    const attachmentProjection = updatedAttachmentState
      ? updatedAttachmentState.editable
          .filter(
            ({ url }) =>
              !updatedAttachmentState.opaqueUriUrls.includes(url),
          )
          .map(({ url }) => ({ url }))
      : undefined;
    const {
      alarm: alarmPatch,
      conference: _conferencePatch,
      attachment: _attachmentPatch,
      ...eventPatch
    } = patch;
    const event: CalendarEvent = {
      ...this.event,
      ...eventPatch,
      title: patch.title ?? this.event.title,
      timing: patch.timing ?? this.event.timing,
      externalLinks: readCalendarLinks(vevent),
      ...(attachmentPatch ? { attachments: attachmentProjection } : {}),
      recurrence,
      revision: revisionUpdated
        ? readUpdatedCalendarEventRevision(
            vevent,
            this.sourceRevisionProperties,
          )
        : this.event.revision,
    };
    if (conferencePatch) {
      delete event.unsupportedConference;
    }
    if (attachmentPatch) {
      delete event.unsupportedAttachment;
    }
    if (hasAlarmPatch) {
      if (isCalendarEventAlarmRemoval(alarmPatch)) {
        delete event.alarm;
      } else {
        event.alarm = {
          ...(alarmPatch as CalendarEventDisplayAlarmInput),
          uid: writtenAlarmUid,
        };
      }
      delete event.unsupportedAlarm;
    }

    const preservedRevisionProperties = restoreRevisionProperties(
      calendar.toString(),
      this.sourceRevisionProperties,
      revisionUpdated
        ? ['created']
        : ['dtstamp', 'created', 'last-modified', 'sequence'],
    );

    const conferenceOutputProperties =
      conferencePatch && !conferenceWriteIsNoOp
        ? rawConferencePropertiesAfterPatch(
            sourceConferenceProperties,
            conferencePatch,
          )
        : sourceConferenceProperties;
    const conferencePropertiesByOutputEvent =
      sourceConferencePropertiesByEvent.map((properties) => [...properties]);
    const forceConferenceReplacement = new Set<number>();
    if (conferencePatch && !conferenceWriteIsNoOp && sourceMasterIndex >= 0) {
      conferencePropertiesByOutputEvent[sourceMasterIndex] =
        conferenceOutputProperties;
      if (conferencePatch.action === 'remove') {
        forceConferenceReplacement.add(sourceMasterIndex);
      }
    }
    const attachmentPropertiesByOutputEvent =
      sourceAttachmentPropertiesByEvent.map((properties) => [...properties]);
    const forceAttachmentReplacement = new Set<number>();
    if (
      attachmentPatch &&
      !attachmentWriteIsNoOp &&
      attachmentWritePlan &&
      sourceMasterIndex >= 0
    ) {
      attachmentPropertiesByOutputEvent[sourceMasterIndex] =
        attachmentWritePlan.nextProperties;
      if (
        attachmentPatch.action === 'remove' &&
        attachmentWritePlan.nextProperties.length === 0
      ) {
        forceAttachmentReplacement.add(sourceMasterIndex);
      }
    }
    const withRawConference = restoreVeventConferenceProperties(
      preservedRevisionProperties,
      conferencePropertiesByOutputEvent,
      forceConferenceReplacement,
    );
    return {
      event,
      icalendar: restoreVeventAttachmentProperties(
        withRawConference,
        attachmentPropertiesByOutputEvent,
        forceAttachmentReplacement,
      ),
    };
  }

  private applyOccurrencePatch(
    operation: OccurrenceTimingOverrideWrite & { viewerTimezone: string },
  ): EncodedICalendarEvent {
    const result = applyOccurrenceTimingOverride(
      this.calendar,
      this.event,
      operation,
      {
        source: this.sourceICalendar,
        now: this.clock(),
        viewerTimezone: operation.viewerTimezone,
        listProjectionDiagnostic: this.listProjectionDiagnostic,
      },
    );
    if (result.noOp) {
      return { event: this.event, icalendar: this.sourceICalendar };
    }
    const calendar = ICAL.Component.fromString(this.calendar.toString());
    const targetIdentity = calendarEventRecurrenceIdentity(
      operation.recurrenceId,
    );
    const components = calendar.getAllSubcomponents();
    const sourceRevisionPropertiesByEvent = readVeventRevisionProperties(
      this.sourceICalendar,
    );
    const originalEvents = calendar.getAllSubcomponents('vevent');
    const sourceConferencePropertiesByEvent = rawVeventConferenceProperties(
      this.sourceICalendar,
    );
    const sourceAttachmentPropertiesByEvent = rawVeventAttachmentProperties(
      this.sourceICalendar,
    );
    const sourceMasterEvent = findMasterEvent(calendar, this.event.uid);
    const sourceMasterIndex = sourceMasterEvent
      ? originalEvents.indexOf(sourceMasterEvent)
      : -1;
    if (
      !sourceRevisionPropertiesByEvent ||
      sourceRevisionPropertiesByEvent.length !== originalEvents.length ||
      sourceConferencePropertiesByEvent.length !== originalEvents.length ||
      sourceAttachmentPropertiesByEvent.length !== originalEvents.length ||
      sourceMasterIndex < 0
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    const outputComponents: ICAL.Component[] = [];
    const outputRevisionProperties: RawRevisionProperty[][] = [];
    const outputConferenceProperties: ICalendarContentLine[][] = [];
    const outputAttachmentProperties: ICalendarContentLine[][] = [];
    let originalEventIndex = 0;
    let targetEventIndex: number | undefined;
    let replaced = false;

    for (const component of components) {
      if (component.name !== 'vevent') {
        outputComponents.push(component);
        continue;
      }
      const isTargetOverride =
        textValue(component.getFirstPropertyValue('uid')) === this.event.uid &&
        component.getAllProperties('recurrence-id').length === 1 &&
        calendarEventRecurrenceIdentity(
          readDateTimeProperty(component.getFirstProperty('recurrence-id')!),
        ) === targetIdentity;
      if (isTargetOverride) {
        targetEventIndex = outputRevisionProperties.length;
        outputComponents.push(result.component);
        outputRevisionProperties.push(result.sourceRevisionProperties);
        outputConferenceProperties.push(
          sourceConferencePropertiesByEvent[originalEventIndex],
        );
        outputAttachmentProperties.push(
          sourceAttachmentPropertiesByEvent[originalEventIndex],
        );
        replaced = true;
      } else {
        outputComponents.push(component);
        outputRevisionProperties.push(
          sourceRevisionPropertiesByEvent[originalEventIndex],
        );
        outputConferenceProperties.push(
          sourceConferencePropertiesByEvent[originalEventIndex],
        );
        outputAttachmentProperties.push(
          sourceAttachmentPropertiesByEvent[originalEventIndex],
        );
      }
      originalEventIndex += 1;
    }
    if (!replaced) {
      targetEventIndex = outputRevisionProperties.length;
      outputComponents.push(result.component);
      outputRevisionProperties.push(result.sourceRevisionProperties);
      outputConferenceProperties.push(
        sourceConferencePropertiesByEvent[sourceMasterIndex],
      );
      outputAttachmentProperties.push(
        sourceAttachmentPropertiesByEvent[sourceMasterIndex],
      );
    }
    calendar.removeAllSubcomponents();
    for (const component of outputComponents) {
      calendar.addSubcomponent(component);
    }

    const master = findMasterEvent(calendar, this.event.uid);
    if (!master) {
      throw new ICalendarEventCodecError(
        'missing-event',
        'Parsed iCalendar no longer contains the target VEVENT',
      );
    }
    let icalendar = calendar.toString();
    const allRevisionProperties: Array<RawRevisionProperty['name']> = [
      'dtstamp',
      'created',
      'last-modified',
      'sequence',
    ];
    for (const [
      index,
      sourceProperties,
    ] of outputRevisionProperties.entries()) {
      const names =
        index === targetEventIndex && result.revisionUpdated
          ? ['created' as const]
          : allRevisionProperties;
      icalendar = restoreRevisionProperties(
        icalendar,
        sourceProperties,
        names,
        index,
      );
    }
    icalendar = restoreVeventConferenceProperties(
      icalendar,
      outputConferenceProperties,
    );
    icalendar = restoreVeventAttachmentProperties(
      icalendar,
      outputAttachmentProperties,
    );

    return {
      event: {
        ...this.event,
        recurrence: readRecurrence(calendar, master, this.event.uid),
      },
      icalendar,
    };
  }

  private applyFollowingPatch(
    operation: CalendarEventFollowingTimingWrite,
  ): EncodedICalendarEvent {
    if (
      !this.event.uid ||
      this.event.status === 'cancelled' ||
      this.event.unsupportedTimezone ||
      this.event.unsupportedRecurrence ||
      this.event.unsupportedAlarm ||
      this.event.alarm ||
      this.listProjectionDiagnostic ||
      !isCalendarTimezoneSupported(operation.viewerTimezone)
    ) {
      throw unsupportedFollowingTimingPatch();
    }

    const calendar = ICAL.Component.fromString(this.sourceICalendar);
    if (calendar.name !== 'vcalendar') {
      throw unsupportedFollowingTimingPatch();
    }
    const events = calendar.getAllSubcomponents('vevent');
    const rawEventProperties = readRawVeventProperties(this.sourceICalendar);
    const sourceConferencePropertiesByEvent = rawVeventConferenceProperties(
      this.sourceICalendar,
    );
    const sourceAttachmentPropertiesByEvent = rawVeventAttachmentProperties(
      this.sourceICalendar,
    );
    const rawRevisionProperties = readVeventRevisionProperties(
      this.sourceICalendar,
    );
    if (
      !rawEventProperties ||
      rawEventProperties.length !== events.length ||
      sourceConferencePropertiesByEvent.length !== events.length ||
      sourceAttachmentPropertiesByEvent.length !== events.length ||
      !rawRevisionProperties ||
      rawRevisionProperties.length !== events.length ||
      hasUnsupportedTimezoneRules(calendar, this.event.uid)
    ) {
      throw unsupportedFollowingTimingPatch();
    }

    const matching: Array<{ component: ICAL.Component; index: number }> = [];
    for (const [index, component] of events.entries()) {
      const uidProperties = component.getAllProperties('uid');
      const uidValues = uidProperties.map((property) =>
        textValue(property.getFirstValue()),
      );
      if (!uidValues.includes(this.event.uid)) {
        continue;
      }
      if (
        uidProperties.length !== 1 ||
        uidValues[0] !== this.event.uid ||
        rawEventProperties[index].filter((property) => property.name === 'uid')
          .length !== 1
      ) {
        throw unsupportedFollowingTimingPatch();
      }
      validateRawOccurrenceTimingProperties(
        rawEventProperties[index],
        component,
      );
      assertFollowingRawTimingParameters(rawEventProperties[index]);
      matching.push({ component, index });
    }

    const masters = matching.filter(
      ({ component }) =>
        component.getAllProperties('recurrence-id').length === 0,
    );
    if (masters.length !== 1) {
      throw unsupportedFollowingTimingPatch();
    }
    const { component: master, index: masterIndex } = masters[0];
    const rawMasterProperties = rawEventProperties[masterIndex];
    assertFollowingMasterStatus(master, rawMasterProperties);
    const rawRules = rawMasterProperties.filter(
      (property) => property.name === 'rrule',
    );
    if (
      master.getAllProperties('rrule').length !== 1 ||
      rawRules.length !== 1 ||
      contentLineParameters(rawRules[0].header).length > 0 ||
      master.hasProperty('rdate') ||
      master.hasProperty('exdate') ||
      master.hasProperty('exrule') ||
      master.getAllSubcomponents('valarm').length > 0
    ) {
      throw unsupportedFollowingTimingPatch();
    }

    const sameUidOverrides = matching.filter(
      ({ component }) => component !== master,
    );
    const seenIdentities = new Set<string>();
    for (const { component } of sameUidOverrides) {
      const recurrenceIds = component.getAllProperties('recurrence-id');
      if (
        recurrenceIds.length !== 1 ||
        component.hasProperty('rrule') ||
        component.hasProperty('rdate') ||
        component.hasProperty('exdate') ||
        component.hasProperty('exrule') ||
        component.getAllSubcomponents('valarm').length > 0
      ) {
        throw unsupportedFollowingTimingPatch();
      }
      const property = recurrenceIds[0];
      if (
        property.getValues().length !== 1 ||
        (property.getFirstParameter('range') !== null &&
          property.getFirstParameter('range') !== undefined)
      ) {
        throw unsupportedFollowingTimingPatch();
      }
      let identity: string;
      try {
        identity = calendarEventRecurrenceIdentity(
          readDateTimeProperty(property),
        );
      } catch {
        throw unsupportedFollowingTimingPatch();
      }
      if (seenIdentities.has(identity)) {
        throw unsupportedFollowingTimingPatch();
      }
      seenIdentities.add(identity);
      if (
        followingComponentShape(component) !== followingComponentShape(master)
      ) {
        throw unsupportedFollowingTimingPatch();
      }
    }

    let plan: ReturnType<typeof calendarEventFollowingTimingOverrides>;
    try {
      plan = calendarEventFollowingTimingOverrides(this.event, operation);
    } catch {
      throw unsupportedFollowingTimingPatch();
    }
    if (sameUidOverrides.length > 0) {
      if (plan.noOp) {
        return { event: this.event, icalendar: this.sourceICalendar };
      }
      throw unsupportedFollowingTimingPatch();
    }
    if (plan.noOp) {
      return { event: this.event, icalendar: this.sourceICalendar };
    }

    const masterRawBytes = rawVeventByteLength(
      this.sourceICalendar,
      masterIndex,
    );
    if (
      masterRawBytes === undefined ||
      Buffer.byteLength(this.sourceICalendar, 'utf8') +
        plan.suffix.length * (masterRawBytes + 1_024) >
        MAX_FOLLOWING_RESOURCE_BYTES
    ) {
      throw followingResourceTooLarge();
    }
    const now = this.clock();
    if (!Number.isFinite(now.getTime())) {
      throw unsupportedFollowingTimingPatch();
    }
    const masterRevision = rawRevisionProperties[masterIndex];
    const detached: ICAL.Component[] = [];
    for (const override of plan.suffix) {
      if (!override.timing || override.timing.type !== 'end') {
        throw unsupportedFollowingTimingPatch();
      }
      const component = ICAL.Component.fromString(master.toString());
      component.removeAllProperties('rrule');
      component.removeAllProperties('rdate');
      component.removeAllProperties('exdate');
      component.removeAllProperties('exrule');
      component.removeAllProperties('recurrence-id');
      const recurrenceIdProperty = new ICAL.Property('recurrence-id');
      const recurrenceId = recurrenceIdAsIcalTime(override.recurrenceId);
      recurrenceIdProperty.setValue(recurrenceId.value);
      if (recurrenceId.timezone) {
        recurrenceIdProperty.setParameter('tzid', recurrenceId.timezone);
      }
      component.addProperty(recurrenceIdProperty);
      setOccurrenceTiming(component, override.timing);
      if (!updateRevisionMetadata(component, now, masterRevision)) {
        throw unsupportedFollowingTimingPatch();
      }
      detached.push(component);
    }

    let icalendar = appendVeventsBeforeCalendarEnd(
      this.sourceICalendar,
      detached,
    );
    const conferencePropertiesByOutputEvent = [
      ...sourceConferencePropertiesByEvent,
      ...detached.map(() => sourceConferencePropertiesByEvent[masterIndex]),
    ];
    icalendar = restoreVeventConferenceProperties(
      icalendar,
      conferencePropertiesByOutputEvent,
    );
    const attachmentPropertiesByOutputEvent = [
      ...sourceAttachmentPropertiesByEvent,
      ...detached.map(() => sourceAttachmentPropertiesByEvent[masterIndex]),
    ];
    icalendar = restoreVeventAttachmentProperties(
      icalendar,
      attachmentPropertiesByOutputEvent,
    );
    if (Buffer.byteLength(icalendar, 'utf8') > MAX_FOLLOWING_RESOURCE_BYTES) {
      throw followingResourceTooLarge();
    }
    const updatedCalendar = ICAL.Component.fromString(icalendar);
    const updatedMaster = findMasterEvent(updatedCalendar, this.event.uid);
    if (!updatedMaster) {
      throw unsupportedFollowingTimingPatch();
    }
    return {
      event: {
        ...this.event,
        recurrence: readRecurrence(
          updatedCalendar,
          updatedMaster,
          this.event.uid,
        ),
      },
      icalendar,
    };
  }
}

/**
 * Build a detached timing override without mutating the parsed calendar.
 * Resource-level insertion/replacement is left to the caller after this
 * complete preflight succeeds.
 */
export function applyOccurrenceTimingOverride(
  calendar: ICAL.Component,
  sourceEvent: CalendarEvent,
  operation: OccurrenceTimingOverrideWrite,
  options: {
    source: string;
    now: Date;
    viewerTimezone: string;
    listProjectionDiagnostic?: 'unsupported-recurrence';
  },
): OccurrenceTimingOverrideResult {
  const recurrenceId = recurrenceDateTimeFromUnknown(operation.recurrenceId);
  const timing = recurrenceTimingFromUnknown(operation.timing);
  const targetIdentity = calendarEventRecurrenceIdentity(recurrenceId);

  if (
    calendar.name !== 'vcalendar' ||
    !sourceEvent.uid ||
    sourceEvent.unsupportedTimezone ||
    sourceEvent.unsupportedRecurrence ||
    options.listProjectionDiagnostic ||
    !isCalendarTimezoneSupported(options.viewerTimezone) ||
    !Number.isFinite(options.now.getTime())
  ) {
    throw unsupportedOccurrenceTimingPatch();
  }

  const events = calendar.getAllSubcomponents('vevent');
  const rawEventProperties = readRawVeventProperties(options.source);
  if (!rawEventProperties || rawEventProperties.length !== events.length) {
    throw unsupportedOccurrenceTimingPatch();
  }
  const sameUidEvents: ICAL.Component[] = [];
  for (const [index, component] of events.entries()) {
    const uidProperties = component.getAllProperties('uid');
    const values = uidProperties.map((property) =>
      textValue(property.getFirstValue()),
    );
    if (!values.includes(sourceEvent.uid)) {
      continue;
    }
    if (uidProperties.length !== 1) {
      throw unsupportedOccurrenceTimingPatch();
    }
    sameUidEvents.push(component);
    validateRawOccurrenceTimingProperties(rawEventProperties[index], component);
  }

  const masters = sameUidEvents.filter(
    (component) => component.getAllProperties('recurrence-id').length === 0,
  );
  if (masters.length !== 1) {
    throw unsupportedOccurrenceTimingPatch();
  }
  const master = masters[0];
  if (
    master.getAllProperties('rrule').length > 1 ||
    master.hasProperty('exrule')
  ) {
    throw unsupportedOccurrenceTimingPatch();
  }

  const overridesByIdentity = new Map<string, ICAL.Component>();
  for (const component of sameUidEvents) {
    const recurrenceIdProperties = component.getAllProperties('recurrence-id');
    if (component === master) {
      continue;
    }
    if (recurrenceIdProperties.length !== 1) {
      throw unsupportedOccurrenceTimingPatch();
    }

    const property = recurrenceIdProperties[0];
    let values: ReturnType<ICAL.Property['getValues']>;
    try {
      values = property.getValues();
    } catch {
      throw unsupportedOccurrenceTimingPatch();
    }
    if (
      values.length !== 1 ||
      (property.getFirstParameter('range') !== null &&
        property.getFirstParameter('range') !== undefined)
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }

    let identity: string;
    try {
      identity = calendarEventRecurrenceIdentity(
        readDateTimeProperty(property),
      );
    } catch {
      throw unsupportedOccurrenceTimingPatch();
    }
    if (overridesByIdentity.has(identity)) {
      throw unsupportedOccurrenceTimingPatch();
    }
    overridesByIdentity.set(identity, component);
  }

  if (
    sameUidEvents.some(
      (component) => component.getAllSubcomponents('valarm').length > 0,
    )
  ) {
    throw new ICalendarEventCodecError(
      'unsupported-patch',
      'Occurrence timing edits are unavailable for recurrence resources with VALARM data; alarms are preserved unchanged.',
    );
  }

  const recurrence = sourceEvent.recurrence;
  if (
    !recurrence ||
    (!recurrence.rrule && !recurrence.rdates?.length) ||
    (recurrence.exdates ?? []).some(
      (exdate) => calendarEventRecurrenceIdentity(exdate) === targetIdentity,
    )
  ) {
    throw unsupportedOccurrenceTimingPatch();
  }

  const sourceRevisionPropertiesByEvent = readVeventRevisionProperties(
    options.source,
  );
  if (
    !sourceRevisionPropertiesByEvent ||
    sourceRevisionPropertiesByEvent.length !== events.length
  ) {
    throw unsupportedOccurrenceTimingPatch();
  }

  validateOccurrenceRecurrenceSource(master, sourceEvent);
  const membershipEvent: CalendarEvent = {
    ...sourceEvent,
    recurrence: {
      ...recurrence,
      exdates: [],
      overrides: [],
    },
  };
  if (
    !isSupportedCalendarEventOccurrenceExclusion(membershipEvent, recurrenceId)
  ) {
    throw unsupportedOccurrenceTimingPatch();
  }
  try {
    validateOccurrenceTiming(timing, sourceEvent, options.viewerTimezone);
  } catch {
    throw unsupportedOccurrenceTimingPatch();
  }

  const existing = overridesByIdentity.get(targetIdentity);
  const sourceComponent = existing ?? master;
  const sourceIndex = events.indexOf(sourceComponent);
  const sourceRevisionProperties = sourceRevisionPropertiesByEvent[sourceIndex];
  const existingTiming = existing
    ? validateExistingOverrideTiming(existing)
    : undefined;
  if (
    existing &&
    existingTiming &&
    sameOccurrenceTiming(existingTiming, timing)
  ) {
    return {
      component: existing,
      action: 'updated',
      sourceRevisionProperties,
      revisionUpdated: false,
      noOp: true,
    };
  }
  const component = ICAL.Component.fromString(sourceComponent.toString());
  if (!existing) {
    component.removeAllProperties('rrule');
    component.removeAllProperties('rdate');
    component.removeAllProperties('exdate');
    component.removeAllProperties('exrule');
    const recurrenceIdProperty = new ICAL.Property('recurrence-id');
    const recurrenceIdIcal = recurrenceIdAsIcalTime(recurrenceId);
    recurrenceIdProperty.setValue(recurrenceIdIcal.value);
    if (recurrenceIdIcal.timezone) {
      recurrenceIdProperty.setParameter('tzid', recurrenceIdIcal.timezone);
    }
    component.addProperty(recurrenceIdProperty);
  }

  const eventSourceBeforePatch = component.toString();
  setOccurrenceTiming(component, timing);
  const revisionUpdated =
    component.toString() !== eventSourceBeforePatch &&
    updateRevisionMetadata(component, options.now, sourceRevisionProperties);

  return {
    component,
    action: existing ? 'updated' : 'created',
    sourceRevisionProperties,
    revisionUpdated,
    noOp: false,
  };
}

export class ICalendarEventCodec {
  constructor(private readonly clock: () => Date = systemClock) {}

  create(
    calendarId: CalendarId,
    eventId: CalendarEventId,
    input: CalendarEventInput,
  ): EncodedICalendarEvent {
    let conferenceInput: CalendarEventConferenceInput | undefined;
    let attachmentInput: CalendarEventAttachmentInput | undefined;
    try {
      validateCalendarEventInputConference(input);
      validateCalendarEventInputAttachment(input);
      conferenceInput = input.conference
        ? normalizeCalendarEventConferenceInput(input.conference)
        : undefined;
      attachmentInput = input.attachment
        ? normalizeCalendarEventAttachmentInput(input.attachment)
        : undefined;
    } catch (error) {
      if (error instanceof CalendarEventConferenceValidationError) {
        throw unsupportedConferencePatch();
      }
      if (error instanceof CalendarEventAttachmentValidationError) {
        throw unsupportedAttachmentPatch();
      }
      throw error;
    }
    if (input.alarm !== undefined) {
      validateDisplayAlarm(input.alarm);
    }
    const recurrenceWrite = recurrenceWriteFromUnknown(input.recurrence);
    if (input.recurrence) {
      if (
        !recurrenceWrite ||
        !('rrule' in recurrenceWrite) ||
        !recurrenceWrite.rrule
      ) {
        throw unsupportedRecurrencePatch();
      }
      validateRecurrenceRule(
        recurrenceWrite.rrule,
        timingStartAsDateTime(input.timing),
      );
    }

    const calendar = new ICAL.Component('vcalendar');
    calendar.addPropertyWithValue('version', '2.0');
    calendar.addPropertyWithValue('prodid', '-//Matrix Calendar Widget//EN');

    const vevent = new ICAL.Component('vevent');
    calendar.addSubcomponent(vevent);

    setTextProperty(vevent, 'uid', input.uid);
    setInitialRevisionMetadata(vevent, this.clock());
    setTextProperty(vevent, 'summary', input.title);
    setTiming(vevent, input.timing);
    setOptionalProperty(vevent, 'description', input.description);
    setOptionalProperty(vevent, 'status', input.status?.toUpperCase());
    setOptionalProperty(
      vevent,
      'transp',
      input.transparency === undefined
        ? undefined
        : input.transparency === 'transparent'
          ? 'TRANSPARENT'
          : 'OPAQUE',
    );
    setOptionalProperty(vevent, 'location', input.location);
    setOptionalProperty(vevent, 'url', input.url);
    setCategories(vevent, input.categories);
    setOptionalProperty(vevent, 'priority', input.priority);
    if (conferenceInput) {
      setConferenceProperty(vevent, { action: 'set', ...conferenceInput });
    }
    if (attachmentInput) {
      setAttachmentProperty(vevent, {
        action: 'add',
        url: attachmentInput.url,
      });
    }
    const recurrenceRule =
      recurrenceWrite && 'rrule' in recurrenceWrite
        ? recurrenceWrite.rrule
        : undefined;
    setRecurrenceRule(vevent, recurrenceRule);
    const alarmUid = input.alarm
      ? setDisplayAlarm(calendar, vevent, input.alarm, input.title)
      : undefined;

    const {
      conference: _conferenceInput,
      attachment: _attachmentInput,
      ...eventInput
    } = input;
    return {
      event: {
        ...eventInput,
        ...(attachmentInput
          ? { attachments: [{ url: attachmentInput.url }] }
          : {}),
        id: eventId,
        calendarId,
        revision: readCalendarEventRevision(vevent),
        externalLinks: readCalendarLinks(vevent),
        ...(input.alarm ? { alarm: { ...input.alarm, uid: alarmUid } } : {}),
        recurrence: recurrenceRule
          ? { rrule: canonicalizeRecurrenceRule(recurrenceRule) }
          : undefined,
      },
      icalendar: calendar.toString(),
    };
  }

  parse(
    calendarId: CalendarId,
    eventId: CalendarEventId,
    source: string,
  ): ParsedICalendarEvent {
    let calendar: ICAL.Component;

    try {
      calendar = ICAL.Component.fromString(source);
    } catch (error) {
      throw new ICalendarEventCodecError(
        'invalid-calendar',
        error instanceof Error
          ? `Invalid iCalendar document: ${error.message}`
          : 'Invalid iCalendar document',
      );
    }

    if (calendar.name !== 'vcalendar') {
      throw new ICalendarEventCodecError(
        'invalid-calendar',
        'iCalendar resource must contain a VCALENDAR root',
      );
    }

    const vevent = findMasterEvent(calendar);
    if (!vevent) {
      throw new ICalendarEventCodecError(
        'missing-event',
        'iCalendar resource does not contain a VEVENT',
      );
    }

    const uid = textValue(vevent.getFirstPropertyValue('uid'));
    if (!uid) {
      throw new ICalendarEventCodecError(
        'missing-uid',
        'VEVENT does not contain a UID',
      );
    }

    const sourceRevisionProperties = readMasterRevisionProperties(source);
    const timing = readTiming(vevent);
    const recurrence = readRecurrence(calendar, vevent, uid);
    const unsupportedRecurrence = readUnsupportedRecurrence(calendar, uid);
    const hasMultipleMasterRules = vevent.getAllProperties('rrule').length > 1;
    const unsupportedTimezone = hasUnsupportedTimezoneRules(calendar, uid);
    const alarmState = readResourceAlarm(calendar, vevent);
    const conferencePropertiesByEvent = rawVeventConferenceProperties(source);
    const eventIndex = calendar.getAllSubcomponents('vevent').indexOf(vevent);
    const conferenceState = readConferenceSourceState(
      vevent,
      conferencePropertiesByEvent[eventIndex] ?? [],
    );
    const ambiguousConferenceSource = hasAmbiguousConferenceSource(
      calendar,
      uid,
      vevent,
      conferencePropertiesByEvent,
    );
    const attachmentPropertiesByEvent = rawVeventAttachmentProperties(source);
    const attachmentState = readAttachmentSourceState(
      vevent,
      attachmentPropertiesByEvent[eventIndex] ?? [],
    );
    const authorableAttachments = attachmentState.editable.filter(
      ({ url }) => !attachmentState.opaqueUriUrls.includes(url),
    );
    const ambiguousAttachmentSource =
      attachmentState.unsupported ||
      hasAmbiguousAttachmentSource(
        calendar,
        uid,
        vevent,
        attachmentPropertiesByEvent,
      );

    const event: CalendarEvent = {
      id: eventId,
      calendarId,
      uid,
      title: textValue(vevent.getFirstPropertyValue('summary')) ?? '',
      description: textValue(vevent.getFirstPropertyValue('description')),
      timing,
      status: readStatus(vevent.getFirstPropertyValue('status')),
      transparency: readTransparency(vevent.getFirstPropertyValue('transp')),
      location: textValue(vevent.getFirstPropertyValue('location')),
      url: textValue(vevent.getFirstPropertyValue('url')),
      externalLinks: readCalendarLinks(vevent),
      ...(authorableAttachments.length > 0 &&
      !ambiguousAttachmentSource
        ? {
            attachments: authorableAttachments.map(({ url }) => ({ url })),
          }
        : {}),
      categories: readCategories(vevent),
      priority: numberValue(vevent.getFirstPropertyValue('priority')),
      recurrence,
      revision: readCalendarEventRevision(vevent, sourceRevisionProperties),
      ...(alarmState.alarm ? { alarm: alarmState.alarm } : {}),
      ...(alarmState.unsupported ? { unsupportedAlarm: true } : {}),
      ...(ambiguousConferenceSource ||
      (conferenceState.present && !conferenceState.editable)
        ? { unsupportedConference: true }
        : {}),
      ...(ambiguousAttachmentSource ? { unsupportedAttachment: true } : {}),
      ...(unsupportedRecurrence ? { unsupportedRecurrence } : {}),
      ...(unsupportedTimezone ? { unsupportedTimezone: true } : {}),
    };

    return new ParsedICalendarEvent(
      calendar,
      event,
      hasMultipleMasterRules ? 'unsupported-recurrence' : undefined,
      this.clock,
      sourceRevisionProperties,
      source,
    );
  }
}

function recurrenceWriteFromUnknown(
  value: unknown,
): CalendarEventRecurrenceWrite | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw unsupportedRecurrencePatch();
  }

  const fields = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(fields, 'following')) {
    const operation = fields.following;
    if (
      Object.keys(fields).length !== 1 ||
      !operation ||
      typeof operation !== 'object' ||
      Array.isArray(operation)
    ) {
      throw unsupportedFollowingTimingPatch();
    }
    const following = operation as Record<string, unknown>;
    if (
      Object.keys(following).length !== 4 ||
      !['action', 'recurrenceId', 'timing', 'viewerTimezone'].every((key) =>
        Object.prototype.hasOwnProperty.call(following, key),
      ) ||
      following.action !== 'set-timing' ||
      typeof following.viewerTimezone !== 'string'
    ) {
      throw unsupportedFollowingTimingPatch();
    }
    const timing = recurrenceTimingFromUnknown(following.timing);
    if (timing.type !== 'end') {
      throw unsupportedFollowingTimingPatch();
    }
    return {
      following: {
        action: 'set-timing',
        recurrenceId: recurrenceDateTimeFromUnknown(following.recurrenceId),
        timing,
        viewerTimezone: following.viewerTimezone,
      },
    };
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'occurrence')) {
    const operation = fields.occurrence;
    if (
      Object.keys(fields).length !== 1 ||
      !operation ||
      typeof operation !== 'object' ||
      Array.isArray(operation)
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    const occurrence = operation as Record<string, unknown>;
    if (
      Object.keys(occurrence).length !== 4 ||
      !['action', 'recurrenceId', 'timing', 'viewerTimezone'].every((key) =>
        Object.prototype.hasOwnProperty.call(occurrence, key),
      ) ||
      occurrence.action !== 'set-timing' ||
      typeof occurrence.viewerTimezone !== 'string'
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    return {
      occurrence: {
        action: 'set-timing',
        recurrenceId: recurrenceDateTimeFromUnknown(occurrence.recurrenceId),
        timing: recurrenceTimingFromUnknown(occurrence.timing),
        viewerTimezone: occurrence.viewerTimezone,
      },
    } as unknown as CalendarEventRecurrenceWrite;
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'exdate')) {
    const operation = fields.exdate;
    if (
      Object.keys(fields).length !== 1 ||
      !operation ||
      typeof operation !== 'object' ||
      Array.isArray(operation)
    ) {
      throw unsupportedRecurrencePatch();
    }

    const exdate = operation as Record<string, unknown>;
    if (
      Object.keys(exdate).length !== 2 ||
      !['action', 'recurrenceId'].every((key) =>
        Object.prototype.hasOwnProperty.call(exdate, key),
      ) ||
      (exdate.action !== 'add' && exdate.action !== 'remove')
    ) {
      throw unsupportedRecurrencePatch();
    }

    return {
      exdate: {
        action: exdate.action,
        recurrenceId: exdate.recurrenceId as CalendarEventDateTime,
      },
    };
  }

  if (Object.prototype.hasOwnProperty.call(fields, 'rdate')) {
    const operation = fields.rdate;
    if (
      Object.keys(fields).length !== 1 ||
      !operation ||
      typeof operation !== 'object' ||
      Array.isArray(operation)
    ) {
      throw unsupportedRecurrencePatch();
    }

    const rdate = operation as Record<string, unknown>;
    if (
      !Object.prototype.hasOwnProperty.call(rdate, 'action') ||
      !Object.prototype.hasOwnProperty.call(rdate, 'value') ||
      (rdate.action !== 'add' &&
        rdate.action !== 'remove' &&
        rdate.action !== 'add-period' &&
        rdate.action !== 'remove-period' &&
        rdate.action !== 'replace-period')
    ) {
      throw unsupportedRecurrencePatch();
    }

    if (rdate.action === 'replace-period') {
      if (
        Object.keys(rdate).length !== 3 ||
        !Object.prototype.hasOwnProperty.call(rdate, 'replacement')
      ) {
        throw unsupportedRecurrencePatch();
      }
      return {
        rdate: {
          action: 'replace-period',
          value: recurrencePeriodFromUnknown(rdate.value),
          replacement: recurrencePeriodFromUnknown(rdate.replacement),
        },
      };
    }

    if (Object.keys(rdate).length !== 2) {
      throw unsupportedRecurrencePatch();
    }
    if (rdate.action === 'remove-period' || rdate.action === 'add-period') {
      const value = recurrencePeriodFromUnknown(rdate.value);
      if (rdate.action === 'add-period') {
        return {
          rdate: {
            action: 'add-period',
            value,
          },
        };
      }
      return { rdate: { action: 'remove-period', value } };
    }

    return {
      rdate: {
        action: rdate.action,
        value: recurrenceDateTimeFromUnknown(rdate.value),
      },
    };
  }

  if (
    Object.keys(fields).some((key) => key !== 'rrule') ||
    (fields.rrule !== undefined && typeof fields.rrule !== 'string')
  ) {
    throw unsupportedRecurrencePatch();
  }

  return { rrule: fields.rrule as string | undefined };
}

function recurrencePeriodFromUnknown(
  value: unknown,
): Extract<CalendarEventRecurrenceDate, { type: 'period' }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw unsupportedRecurrencePatch();
  }
  const period = value as Record<string, unknown>;
  if (
    Object.keys(period).length !== 2 ||
    period.type !== 'period' ||
    !Object.prototype.hasOwnProperty.call(period, 'timing') ||
    !period.timing ||
    typeof period.timing !== 'object' ||
    Array.isArray(period.timing)
  ) {
    throw unsupportedRecurrencePatch();
  }
  const timing = period.timing as Record<string, unknown>;
  if (timing.type === 'end') {
    if (
      Object.keys(timing).length !== 3 ||
      !Object.prototype.hasOwnProperty.call(timing, 'start') ||
      !Object.prototype.hasOwnProperty.call(timing, 'end')
    ) {
      throw unsupportedRecurrencePatch();
    }
    const start = recurrenceDateTimeFromUnknown(timing.start);
    const end = recurrenceDateTimeFromUnknown(timing.end);
    if (start.type === 'date' || end.type === 'date') {
      throw unsupportedRecurrencePatch();
    }
    return { type: 'period', timing: { type: 'end', start, end } };
  }
  if (timing.type === 'duration') {
    if (
      Object.keys(timing).length !== 3 ||
      !Object.prototype.hasOwnProperty.call(timing, 'start') ||
      !Object.prototype.hasOwnProperty.call(timing, 'duration')
    ) {
      throw unsupportedRecurrencePatch();
    }
    const start = recurrenceDateTimeFromUnknown(timing.start);
    const rawDuration = timing.duration;
    if (
      start.type === 'date' ||
      !rawDuration ||
      typeof rawDuration !== 'object' ||
      Array.isArray(rawDuration)
    ) {
      throw unsupportedRecurrencePatch();
    }
    if (!isPositiveRfcDuration(rawDuration)) {
      throw unsupportedRecurrencePatch();
    }
    return {
      type: 'period',
      timing: {
        type: 'duration',
        start,
        duration: rawDuration,
      },
    };
  }
  throw unsupportedRecurrencePatch();
}

function isPositiveRfcDuration(value: unknown): value is CalendarEventDuration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const duration = value as Record<string, unknown>;
  const units = ['weeks', 'days', 'hours', 'minutes', 'seconds'] as const;
  if (
    Object.keys(duration).length !== units.length + 1 ||
    units.some(
      (unit) =>
        !Number.isSafeInteger(duration[unit]) || (duration[unit] as number) < 0,
    ) ||
    typeof duration.isNegative !== 'boolean' ||
    duration.isNegative ||
    !units.some((unit) => (duration[unit] as number) > 0)
  ) {
    return false;
  }

  const hasWeeks = (duration.weeks as number) > 0;
  const hasOtherUnits = units
    .slice(1)
    .some((unit) => (duration[unit] as number) > 0);
  return !(hasWeeks && hasOtherUnits);
}

function readResourceAlarm(
  calendar: ICAL.Component,
  master: ICAL.Component,
): { alarm?: CalendarEventDisplayAlarm; unsupported?: true } {
  const alarms = calendar
    .getAllSubcomponents('vevent')
    .flatMap((vevent) =>
      vevent
        .getAllSubcomponents('valarm')
        .map((alarm) => ({ owner: vevent, alarm })),
    );
  if (alarms.length === 0) {
    return {};
  }
  if (alarms.length !== 1 || alarms[0].owner !== master) {
    return { unsupported: true };
  }

  const alarm = readDisplayAlarm(alarms[0].alarm);
  if (
    alarm?.uid &&
    resourceHasComponentUid(calendar, alarm.uid, alarms[0].alarm)
  ) {
    return { unsupported: true };
  }
  return alarm ? { alarm } : { unsupported: true };
}

function readDisplayAlarm(
  component: ICAL.Component,
): CalendarEventDisplayAlarm | undefined {
  const uidProperties = component.getAllProperties('uid');
  const uid =
    uidProperties.length === 1
      ? textValue(uidProperties[0].getFirstValue())
      : undefined;
  const actionProperties = component.getAllProperties('action');
  const triggerProperties = component.getAllProperties('trigger');
  const descriptions = component.getAllProperties('description');
  if (
    uidProperties.length > 1 ||
    (uidProperties.length === 1 &&
      (uid === undefined || !isValidAlarmUid(uid))) ||
    actionProperties.length !== 1 ||
    triggerProperties.length !== 1 ||
    descriptions.length !== 1 ||
    component.hasProperty('repeat') ||
    component.hasProperty('duration') ||
    textValue(actionProperties[0].getFirstValue())?.toUpperCase() !== 'DISPLAY'
  ) {
    return undefined;
  }

  const triggerProperty = triggerProperties[0];
  const trigger = triggerProperty.getFirstValue();
  const related = triggerProperty.getParameter('related');
  const valueType = triggerProperty.getFirstParameter('value');
  const triggerParameters = Object.keys(triggerProperty.jCal[1] ?? {});
  if (
    !(trigger instanceof ICAL.Duration) ||
    !trigger.isNegative ||
    triggerParameters.some(
      (parameter) => !['related', 'value'].includes(parameter),
    ) ||
    (related !== undefined &&
      (typeof related !== 'string' || related.toUpperCase() !== 'START')) ||
    (valueType !== undefined &&
      (typeof valueType !== 'string' || valueType.toUpperCase() !== 'DURATION'))
  ) {
    return undefined;
  }

  const leadTime = {
    weeks: trigger.weeks,
    days: trigger.days,
    hours: trigger.hours,
    minutes: trigger.minutes,
    seconds: trigger.seconds,
  };
  if (!isValidAlarmLeadTime(leadTime)) {
    return undefined;
  }

  return {
    action: 'display',
    ...(uid !== undefined ? { uid } : {}),
    trigger: leadTime,
  };
}

function validateDisplayAlarm(
  value: unknown,
): asserts value is CalendarEventDisplayAlarmInput {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2
  ) {
    throw unsupportedAlarmPatch();
  }
  const alarm = value as Record<string, unknown>;
  if (
    alarm.action !== 'display' ||
    !alarm.trigger ||
    typeof alarm.trigger !== 'object' ||
    Array.isArray(alarm.trigger) ||
    Object.keys(alarm.trigger).length !== 5 ||
    !isValidAlarmLeadTime(alarm.trigger as Record<string, unknown>)
  ) {
    throw unsupportedAlarmPatch();
  }
}

function isValidAlarmLeadTime(
  value: Record<string, unknown>,
): value is Record<'weeks' | 'days' | 'hours' | 'minutes' | 'seconds', number> {
  const units = ['weeks', 'days', 'hours', 'minutes', 'seconds'] as const;
  if (
    Object.keys(value).length !== units.length ||
    units.some(
      (unit) =>
        !Number.isSafeInteger(value[unit]) || (value[unit] as number) < 0,
    )
  ) {
    return false;
  }

  const hasWeeks = (value.weeks as number) > 0;
  const hasOtherUnits = units
    .slice(1)
    .some((unit) => (value[unit] as number) > 0);
  const hasLeadTime = units.some((unit) => (value[unit] as number) > 0);
  return hasLeadTime && !(hasWeeks && hasOtherUnits);
}

function setDisplayAlarm(
  calendar: ICAL.Component,
  vevent: ICAL.Component,
  alarm: CalendarEventAlarmPatch | undefined,
  description: string,
): string | undefined {
  const existing = vevent.getAllSubcomponents('valarm');
  if (alarm === undefined || isCalendarEventAlarmRemoval(alarm)) {
    existing.forEach((component) => vevent.removeSubcomponent(component));
    return undefined;
  }

  const trigger = ICAL.Duration.fromData({
    ...alarm.trigger,
    isNegative: true,
  });
  if (existing.length === 1) {
    const component = existing[0];
    const triggerProperty = component.getFirstProperty('trigger');
    const supportedAlarm = readDisplayAlarm(component);
    if (!triggerProperty || !supportedAlarm) {
      throw unsupportedAlarmPatch();
    }
    triggerProperty.setValue(trigger);
    const uid = supportedAlarm.uid ?? createAlarmUid(calendar);
    if (!supportedAlarm.uid) {
      component.addPropertyWithValue('uid', uid);
    }
    return uid;
  }
  if (existing.length > 1) {
    throw unsupportedAlarmPatch();
  }

  const component = new ICAL.Component('valarm');
  const uid = createAlarmUid(calendar);
  component.addPropertyWithValue('uid', uid);
  component.addPropertyWithValue('action', 'DISPLAY');
  component.addPropertyWithValue('description', description);
  const triggerProperty = new ICAL.Property('trigger');
  triggerProperty.setValue(trigger);
  component.addProperty(triggerProperty);
  vevent.addSubcomponent(component);
  return uid;
}

function unsupportedAlarmPatch(): ICalendarEventCodecError {
  return new ICalendarEventCodecError(
    'unsupported-patch',
    'Only one negative relative DISPLAY alarm from DTSTART is supported',
  );
}

function isValidAlarmUid(value: string): boolean {
  return (
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 255 &&
    !containsControlCharacters(value)
  );
}

function containsControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}

function createAlarmUid(calendar: ICAL.Component): string {
  const uid = randomUUID();
  if (resourceHasComponentUid(calendar, uid)) {
    throw unsupportedAlarmPatch();
  }
  return uid;
}

function resourceHasComponentUid(
  calendar: ICAL.Component,
  uid: string,
  exceptAlarm?: ICAL.Component,
): boolean {
  return ['vevent', 'vtodo', 'vjournal', 'vfreebusy'].some((componentName) =>
    calendar
      .getAllSubcomponents(componentName)
      .some(
        (component) =>
          component
            .getAllProperties('uid')
            .some((property) => textValue(property.getFirstValue()) === uid) ||
          component
            .getAllSubcomponents('valarm')
            .some(
              (alarm) =>
                alarm !== exceptAlarm &&
                alarm
                  .getAllProperties('uid')
                  .some(
                    (property) => textValue(property.getFirstValue()) === uid,
                  ),
            ),
      ),
  );
}

function assertOccurrenceExdateCanBeEdited(
  event: CalendarEvent,
  recurrenceId: CalendarEventDateTime,
  listProjectionDiagnostic?: 'unsupported-recurrence',
): void {
  if (
    listProjectionDiagnostic === 'unsupported-recurrence' ||
    !isSupportedCalendarEventOccurrenceExclusion(event, recurrenceId)
  ) {
    throw new ICalendarEventCodecError(
      'unsupported-patch',
      'Occurrence exceptions are not supported for this recurrence',
    );
  }
}

function unsupportedOccurrenceTimingPatch(): ICalendarEventCodecError {
  return new ICalendarEventCodecError(
    'unsupported-patch',
    'This occurrence cannot be timed safely because its recurrence identity or source data is unsupported or ambiguous.',
  );
}

function unsupportedFollowingTimingPatch(): ICalendarEventCodecError {
  return new ICalendarEventCodecError(
    'unsupported-patch',
    'This and following timing edit is unavailable because the recurrence or source data is unsupported or ambiguous.',
  );
}

function followingResourceTooLarge(): ICalendarEventCodecError {
  return new ICalendarEventCodecError(
    'event-too-large',
    'This and following edit would exceed the supported calendar resource size.',
  );
}

function validateOccurrenceRecurrenceSource(
  master: ICAL.Component,
  event: CalendarEvent,
): void {
  if (master.getAllProperties('rrule').length === 1) {
    const rule = master.getFirstPropertyValue('rrule');
    if (rule === null || rule === undefined) {
      throw unsupportedOccurrenceTimingPatch();
    }
    validateRecurrenceRule(String(rule), timingStartAsDateTime(event.timing));
  }
  assertRdatePropertiesCanBeEdited(master, event);
  assertExdatePropertiesCanBeRead(master, event);
}

function assertExdatePropertiesCanBeRead(
  master: ICAL.Component,
  event: CalendarEvent,
): void {
  const anchor = timingStartAsDateTime(event.timing);
  for (const property of master.getAllProperties('exdate')) {
    let values: ReturnType<ICAL.Property['getValues']>;
    try {
      values = property.getValues();
    } catch {
      throw unsupportedOccurrenceTimingPatch();
    }

    const explicitValueType = property.getFirstParameter('value');
    const tzid = property.getFirstParameter('tzid');
    if (
      values.length === 0 ||
      (explicitValueType !== null &&
        explicitValueType !== undefined &&
        (typeof explicitValueType !== 'string' ||
          !['DATE', 'DATE-TIME'].includes(explicitValueType.toUpperCase()))) ||
      (tzid !== null &&
        tzid !== undefined &&
        (typeof tzid !== 'string' || !tzid.trim()))
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }

    for (const value of values) {
      if (!(value instanceof ICAL.Time)) {
        throw unsupportedOccurrenceTimingPatch();
      }
      if (
        (value.isDate &&
          explicitValueType !== null &&
          explicitValueType !== undefined &&
          explicitValueType.toUpperCase() !== 'DATE') ||
        (!value.isDate &&
          explicitValueType !== null &&
          explicitValueType !== undefined &&
          explicitValueType.toUpperCase() !== 'DATE-TIME') ||
        (typeof tzid === 'string' &&
          (value.isDate || value.zone === ICAL.Timezone.utcTimezone))
      ) {
        throw unsupportedOccurrenceTimingPatch();
      }
      validatePointRdateValue(readDateTimeValue(value, property), anchor);
    }
  }
}

function validateOccurrenceTiming(
  timing: CalendarEventRecurrenceTiming,
  sourceEvent: CalendarEvent,
  viewerTimezone: string,
): void {
  const anchor = timingStartAsDateTime(sourceEvent.timing);
  validatePointRdateValue(timing.start, anchor);
  const startInstant = recurrenceDateTimeInstant(timing.start, viewerTimezone);

  if (timing.type === 'duration') {
    if (
      timing.start.type === 'date' ||
      !isPositiveRfcDuration(timing.duration)
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    const endInstant = recurrenceDurationEndInstant(
      timing.start,
      timing.duration,
      viewerTimezone,
    );
    if (endInstant <= startInstant) {
      throw unsupportedOccurrenceTimingPatch();
    }
    return;
  }

  validatePointRdateValue(timing.end, anchor);
  if ((timing.start.type === 'date') !== (timing.end.type === 'date')) {
    throw unsupportedOccurrenceTimingPatch();
  }
  if (recurrenceDateTimeInstant(timing.end, viewerTimezone) <= startInstant) {
    throw unsupportedOccurrenceTimingPatch();
  }
}

function recurrenceDateTimeInstant(
  value: CalendarEventDateTime,
  viewerTimezone: string,
): number {
  if (!isCalendarTimezoneSupported(viewerTimezone)) {
    throw unsupportedOccurrenceTimingPatch();
  }
  if (value.type === 'date') {
    const local = `${value.value}T00:00:00`;
    const instant = calendarLocalDateTimeToUnixMillis(local, viewerTimezone);
    if (
      DateTime.fromMillis(instant, { zone: viewerTimezone }).toFormat(
        'yyyy-MM-dd',
      ) !== value.value
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    return instant;
  }

  const timezone =
    value.type === 'date-time' ? value.value.timezone : viewerTimezone;
  if (timezone !== 'UTC' && !isCalendarTimezoneSupported(timezone)) {
    throw unsupportedOccurrenceTimingPatch();
  }
  const timedValue: CalendarEventTimedDateTime =
    value.type === 'floating-date-time'
      ? { type: 'floating', local: value.value }
      : { type: 'zoned', local: value.value.local, timezone };
  const interpreted = calendarEventTimedDateTimeToDateTime(
    timedValue,
    timezone,
  );
  if (
    !interpreted.isValid ||
    interpreted.toFormat("yyyy-MM-dd'T'HH:mm:ss") !==
      (value.type === 'floating-date-time' ? value.value : value.value.local)
  ) {
    // A local wall time that cannot round-trip has no unambiguous supported
    // representation for this typed endpoint.
    throw unsupportedOccurrenceTimingPatch();
  }
  return interpreted.toMillis();
}

function recurrenceDurationEndInstant(
  start: CalendarEventDateTime,
  duration: CalendarEventDuration,
  viewerTimezone: string,
): number {
  if (start.type === 'date' || !isPositiveRfcDuration(duration)) {
    throw unsupportedOccurrenceTimingPatch();
  }
  const timezone =
    start.type === 'date-time' ? start.value.timezone : viewerTimezone;
  const localStart =
    start.type === 'date-time' ? start.value.local : start.value;
  const wallStart = DateTime.fromISO(localStart, { zone: 'UTC' });
  if (!wallStart.isValid) {
    throw unsupportedOccurrenceTimingPatch();
  }

  const calendarDays = duration.weeks > 0 ? duration.weeks * 7 : duration.days;
  const localAfterCalendarUnits = wallStart
    .plus({ days: calendarDays })
    .toFormat("yyyy-MM-dd'T'HH:mm:ss");
  const instantAfterCalendarUnits = calendarLocalDateTimeToUnixMillis(
    localAfterCalendarUnits,
    timezone,
  );
  const exactMilliseconds =
    ((duration.hours * 60 + duration.minutes) * 60 + duration.seconds) * 1000;
  return instantAfterCalendarUnits + exactMilliseconds;
}

function validateExistingOverrideTiming(
  component: ICAL.Component,
): CalendarEventRecurrenceTiming {
  const statusProperties = component.getAllProperties('status');
  if (
    statusProperties.length > 1 ||
    textValue(statusProperties[0]?.getFirstValue())?.toUpperCase() ===
      'CANCELLED'
  ) {
    throw unsupportedOccurrenceTimingPatch();
  }
  const startProperties = component.getAllProperties('dtstart');
  const endProperties = component.getAllProperties('dtend');
  const durationProperties = component.getAllProperties('duration');
  if (
    startProperties.length !== 1 ||
    (endProperties.length === 1) === (durationProperties.length === 1) ||
    endProperties.length > 1 ||
    durationProperties.length > 1
  ) {
    throw unsupportedOccurrenceTimingPatch();
  }

  try {
    const current =
      endProperties.length === 1
        ? readRecurrenceTimingWithEnd(component)
        : readRecurrenceTimingWithDuration(component);
    return recurrenceTimingFromUnknown(current);
  } catch {
    throw unsupportedOccurrenceTimingPatch();
  }
}

function sameOccurrenceTiming(
  left: CalendarEventRecurrenceTiming,
  right: CalendarEventRecurrenceTiming,
): boolean {
  if (
    left.type !== right.type ||
    calendarEventRecurrenceIdentity(left.start) !==
      calendarEventRecurrenceIdentity(right.start)
  ) {
    return false;
  }

  if (left.type === 'end' && right.type === 'end') {
    return (
      calendarEventRecurrenceIdentity(left.end) ===
      calendarEventRecurrenceIdentity(right.end)
    );
  }
  if (left.type === 'duration' && right.type === 'duration') {
    return (
      left.duration.weeks === right.duration.weeks &&
      left.duration.days === right.duration.days &&
      left.duration.hours === right.duration.hours &&
      left.duration.minutes === right.duration.minutes &&
      left.duration.seconds === right.duration.seconds &&
      left.duration.isNegative === right.duration.isNegative
    );
  }
  return false;
}

function setOccurrenceTiming(
  component: ICAL.Component,
  timing: CalendarEventRecurrenceTiming,
): void {
  const start = recurrenceIdAsIcalTime(timing.start);
  setTimeProperty(component, 'dtstart', start.value, start.timezone);
  if (timing.type === 'end') {
    const end = recurrenceIdAsIcalTime(timing.end);
    setTimeProperty(component, 'dtend', end.value, end.timezone);
    component.removeAllProperties('duration');
    return;
  }

  component.removeAllProperties('dtend');
  let durationProperty = component.getFirstProperty('duration');
  if (!durationProperty) {
    durationProperty = new ICAL.Property('duration');
    component.addProperty(durationProperty);
  }
  durationProperty.setValue(ICAL.Duration.fromData(timing.duration));
}

function applyOccurrenceExdate(
  vevent: ICAL.Component,
  operation: Extract<
    CalendarEventRecurrenceWrite,
    { exdate: unknown }
  >['exdate'],
): void {
  const targetIdentity = calendarEventRecurrenceIdentity(
    operation.recurrenceId,
  );
  const properties = vevent.getAllProperties('exdate');

  if (operation.action === 'add') {
    const alreadyExcluded = properties.some((property) =>
      property
        .getValues()
        .some(
          (value) =>
            value instanceof ICAL.Time &&
            calendarEventRecurrenceIdentity(
              readDateTimeValue(value, property),
            ) === targetIdentity,
        ),
    );
    if (alreadyExcluded) {
      return;
    }

    const property = new ICAL.Property('exdate');
    const { value, timezone } = recurrenceIdAsIcalTime(operation.recurrenceId);
    property.setValue(value);
    if (timezone) {
      property.setParameter('tzid', timezone);
    }
    vevent.addProperty(property);
    return;
  }

  for (const property of properties) {
    const values = property.getValues();
    let removed = false;
    const remaining = values.filter((value) => {
      const matches =
        value instanceof ICAL.Time &&
        calendarEventRecurrenceIdentity(readDateTimeValue(value, property)) ===
          targetIdentity;
      if (matches) {
        removed = true;
      }
      return !matches;
    });

    if (!removed) {
      continue;
    }
    if (remaining.length === 0) {
      vevent.removeProperty(property);
    } else {
      property.setValues(remaining);
    }
  }
}

function assertPointRdateCanBeEdited(
  event: CalendarEvent,
  value: CalendarEventDateTime,
  listProjectionDiagnostic?: 'unsupported-recurrence',
): void {
  const recurrence = event.recurrence;
  if (
    listProjectionDiagnostic === 'unsupported-recurrence' ||
    event.unsupportedTimezone ||
    event.unsupportedRecurrence ||
    !recurrence ||
    (!recurrence.rrule && !recurrence.rdates?.length)
  ) {
    throw unsupportedRecurrencePatch();
  }

  if (recurrence.rrule !== undefined) {
    validateRecurrenceRule(
      recurrence.rrule,
      timingStartAsDateTime(event.timing),
    );
  }

  validatePointRdateValue(value, timingStartAsDateTime(event.timing));
}

function assertRdatePropertiesCanBeEdited(
  vevent: ICAL.Component,
  event: CalendarEvent,
): void {
  const anchor = timingStartAsDateTime(event.timing);
  for (const property of vevent.getAllProperties('rdate')) {
    let values: ReturnType<ICAL.Property['getValues']>;
    try {
      values = property.getValues();
    } catch {
      throw unsupportedRecurrencePatch();
    }
    if (values.length === 0) {
      throw unsupportedRecurrencePatch();
    }

    const valueKind = values.map((value) =>
      value instanceof ICAL.Period
        ? 'period'
        : value instanceof ICAL.Time
          ? value.isDate
            ? 'date'
            : 'date-time'
          : 'unsupported',
    );
    if (
      valueKind.includes('unsupported') ||
      valueKind.some((kind) => kind !== valueKind[0])
    ) {
      throw unsupportedRecurrencePatch();
    }

    // PERIOD values are changed only by the exact add/remove operations below.
    if (valueKind[0] === 'period') {
      const explicitValueType = property.getFirstParameter('value');
      const tzid = property.getFirstParameter('tzid');
      if (
        (explicitValueType !== null &&
          explicitValueType !== undefined &&
          (typeof explicitValueType !== 'string' ||
            explicitValueType.toUpperCase() !== 'PERIOD')) ||
        (tzid !== null &&
          tzid !== undefined &&
          (typeof tzid !== 'string' || !tzid.trim()))
      ) {
        throw unsupportedRecurrencePatch();
      }
      for (const value of values) {
        if (!(value instanceof ICAL.Period)) {
          throw unsupportedRecurrencePatch();
        }
        const start = value.start;
        const end = value.end;
        if (
          typeof tzid === 'string' &&
          (start.zone === ICAL.Timezone.utcTimezone ||
            (end instanceof ICAL.Time &&
              end.zone === ICAL.Timezone.utcTimezone))
        ) {
          throw unsupportedRecurrencePatch();
        }
        readPeriodRdateValue(value, property);
      }
      continue;
    }

    const explicitValueType = property.getFirstParameter('value');
    if (
      (valueKind[0] === 'date' &&
        (typeof explicitValueType !== 'string' ||
          explicitValueType.toUpperCase() !== 'DATE')) ||
      (valueKind[0] === 'date-time' &&
        explicitValueType !== null &&
        explicitValueType !== undefined &&
        (typeof explicitValueType !== 'string' ||
          explicitValueType.toUpperCase() !== 'DATE-TIME'))
    ) {
      throw unsupportedRecurrencePatch();
    }

    for (const value of values) {
      if (!(value instanceof ICAL.Time)) {
        throw unsupportedRecurrencePatch();
      }
      const tzid = property.getFirstParameter('tzid');
      if (
        (tzid !== null &&
          tzid !== undefined &&
          (typeof tzid !== 'string' || !tzid.trim())) ||
        (typeof tzid === 'string' &&
          (value.isDate || value.zone === ICAL.Timezone.utcTimezone))
      ) {
        throw unsupportedRecurrencePatch();
      }
      validatePointRdateValue(readDateTimeValue(value, property), anchor);
    }
  }
}

function assertPeriodRdateCanBeRemoved(
  event: CalendarEvent,
  value: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  listProjectionDiagnostic?: 'unsupported-recurrence',
): void {
  const recurrence = event.recurrence;
  if (
    listProjectionDiagnostic === 'unsupported-recurrence' ||
    event.unsupportedTimezone ||
    event.unsupportedRecurrence ||
    !recurrence ||
    !recurrence.rdates?.some(
      (candidate) =>
        recurrenceRdateIdentity(candidate) === recurrenceRdateIdentity(value),
    )
  ) {
    throw unsupportedRecurrencePatch();
  }
  if (recurrence.rrule !== undefined) {
    validateRecurrenceRule(
      recurrence.rrule,
      timingStartAsDateTime(event.timing),
    );
  }
}

function assertPeriodRdateCanBeAdded(
  event: CalendarEvent,
  value: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  listProjectionDiagnostic?: 'unsupported-recurrence',
): void {
  const recurrence = event.recurrence;
  if (
    listProjectionDiagnostic === 'unsupported-recurrence' ||
    event.unsupportedTimezone ||
    event.unsupportedRecurrence ||
    !recurrence ||
    (!recurrence.rrule && !recurrence.rdates?.length)
  ) {
    throw unsupportedRecurrencePatch();
  }
  if (recurrence.rrule !== undefined) {
    validateRecurrenceRule(
      recurrence.rrule,
      timingStartAsDateTime(event.timing),
    );
  }

  if (event.timing.type !== 'timed') {
    throw unsupportedRecurrencePatch();
  }

  const { timing } = value;
  const anchor = timingStartAsDateTime(event.timing);
  validatePointRdateValue(timing.start, anchor);
  if (timing.type === 'duration') {
    if (!isPositiveRfcDuration(timing.duration)) {
      throw unsupportedRecurrencePatch();
    }
    return;
  }

  validatePointRdateValue(timing.end, anchor);
  if (
    timing.start.type !== timing.end.type ||
    (timing.start.type === 'date-time' &&
      timing.end.type === 'date-time' &&
      timing.start.value.timezone !== timing.end.value.timezone)
  ) {
    throw unsupportedRecurrencePatch();
  }
  const zone =
    timing.start.type === 'date-time' ? timing.start.value.timezone : 'UTC';
  const startValue =
    timing.start.type === 'floating-date-time'
      ? timing.start.value
      : timing.start.type === 'date-time'
        ? timing.start.value.local
        : undefined;
  const endValue =
    timing.end.type === 'floating-date-time'
      ? timing.end.value
      : timing.end.type === 'date-time'
        ? timing.end.value.local
        : undefined;
  if (!startValue || !endValue) {
    throw unsupportedRecurrencePatch();
  }
  const startInstant = DateTime.fromISO(startValue, { zone });
  const endInstant = DateTime.fromISO(endValue, { zone });
  if (
    !startInstant.isValid ||
    !endInstant.isValid ||
    endInstant.toMillis() <= startInstant.toMillis()
  ) {
    throw unsupportedRecurrencePatch();
  }
}

function assertPeriodRdateCanBeReplaced(
  event: CalendarEvent,
  source: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  replacement: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  listProjectionDiagnostic?: 'unsupported-recurrence',
): void {
  const recurrence = event.recurrence;
  const sourceIdentity = recurrenceRdateIdentity(source);
  const matchingSources = recurrence?.rdates?.filter(
    (candidate) =>
      candidate.type === 'period' &&
      recurrenceRdateIdentity(candidate) === sourceIdentity,
  );
  if (
    listProjectionDiagnostic === 'unsupported-recurrence' ||
    event.unsupportedTimezone ||
    event.unsupportedRecurrence ||
    event.timing.type !== 'timed' ||
    !recurrence ||
    matchingSources?.length !== 1
  ) {
    throw unsupportedRecurrencePatch();
  }
  if (recurrence.rrule !== undefined) {
    validateRecurrenceRule(
      recurrence.rrule,
      timingStartAsDateTime(event.timing),
    );
  }

  if (
    source.timing.type !== replacement.timing.type ||
    !samePeriodDateTimeIdentity(source.timing.start, replacement.timing.start)
  ) {
    throw unsupportedRecurrencePatch();
  }
  if (
    source.timing.type === 'end' &&
    (replacement.timing.type !== 'end' ||
      !samePeriodDateTimeIdentity(source.timing.end, replacement.timing.end))
  ) {
    throw unsupportedRecurrencePatch();
  }

  validateEditablePeriod(source, event);
  validateEditablePeriod(replacement, event);
}

function validateEditablePeriod(
  value: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  event: CalendarEvent,
): void {
  const anchor = timingStartAsDateTime(event.timing);
  validatePointRdateValue(value.timing.start, anchor);
  if (value.timing.type === 'duration') {
    if (!isPositiveRfcDuration(value.timing.duration)) {
      throw unsupportedRecurrencePatch();
    }
    return;
  }

  validatePointRdateValue(value.timing.end, anchor);
  if (
    !samePeriodDateTimeIdentity(value.timing.start, value.timing.end) ||
    !periodEndIsAfterStart(value.timing.start, value.timing.end)
  ) {
    throw unsupportedRecurrencePatch();
  }
}

function samePeriodDateTimeIdentity(
  left: CalendarEventDateTime,
  right: CalendarEventDateTime,
): boolean {
  return (
    left.type === right.type &&
    (left.type !== 'date-time' ||
      (right.type === 'date-time' &&
        left.value.timezone === right.value.timezone))
  );
}

function periodEndIsAfterStart(
  start: CalendarEventDateTime,
  end: CalendarEventDateTime,
): boolean {
  if (start.type === 'date' || end.type === 'date') {
    return false;
  }
  const startLocal =
    start.type === 'date-time' ? start.value.local : start.value;
  const endLocal = end.type === 'date-time' ? end.value.local : end.value;
  const timezone = start.type === 'date-time' ? start.value.timezone : 'UTC';
  const startDateTime = DateTime.fromISO(startLocal, { zone: timezone });
  const endDateTime = DateTime.fromISO(endLocal, { zone: timezone });
  return (
    isExactLocalDateTime(startDateTime, startLocal) &&
    isExactLocalDateTime(endDateTime, endLocal) &&
    endDateTime.toMillis() > startDateTime.toMillis()
  );
}

function validatePointRdateValue(
  value: CalendarEventDateTime,
  anchor: CalendarEventDateTime,
): void {
  if ((anchor.type === 'date') !== (value.type === 'date')) {
    throw unsupportedRecurrencePatch();
  }

  switch (value.type) {
    case 'date':
      if (!isValidCalendarDate(value.value)) {
        throw unsupportedRecurrencePatch();
      }
      return;
    case 'floating-date-time':
      if (anchor.type === 'date' || !isValidLocalDateTime(value.value)) {
        throw unsupportedRecurrencePatch();
      }
      return;
    case 'date-time':
      if (
        anchor.type === 'date' ||
        !isValidLocalDateTime(value.value.local) ||
        (value.value.timezone !== 'UTC' &&
          !isCalendarTimezoneSupported(value.value.timezone))
      ) {
        throw unsupportedRecurrencePatch();
      }
      return;
  }
}

function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = DateTime.fromISO(value, { zone: 'UTC' });
  return date.isValid && date.toISODate() === value;
}

function isValidLocalDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
    return false;
  }

  const dateTime = DateTime.fromISO(value, { zone: 'UTC' });
  return (
    dateTime.isValid && dateTime.toFormat("yyyy-MM-dd'T'HH:mm:ss") === value
  );
}

function isExactLocalDateTime(dateTime: DateTime, local: string): boolean {
  return (
    dateTime.isValid && dateTime.toFormat("yyyy-MM-dd'T'HH:mm:ss") === local
  );
}

function applyPointRdate(
  calendar: ICAL.Component,
  vevent: ICAL.Component,
  operation: {
    action: 'add' | 'remove';
    value: CalendarEventDateTime;
  },
  event: CalendarEvent,
): void {
  const targetIdentity = calendarEventRecurrenceIdentity(operation.value);
  const properties = vevent.getAllProperties('rdate');

  if (operation.action === 'add') {
    // DTSTART, RRULE, RDATE, and detached instances form one recurrence set.
    // An exact existing identity is already represented and must stay unique.
    const recurrenceWithoutExdates = event.recurrence
      ? { ...event, recurrence: { ...event.recurrence, exdates: [] } }
      : event;
    if (
      isSupportedCalendarEventOccurrenceExclusion(
        recurrenceWithoutExdates,
        operation.value,
      )
    ) {
      return;
    }

    if (operation.value.type === 'date-time') {
      const timezoneId = operation.value.value.timezone;
      if (
        timezoneId !== 'UTC' &&
        !calendar
          .getAllSubcomponents('vtimezone')
          .some(
            (timezone) => timezone.getFirstPropertyValue('tzid') === timezoneId,
          )
      ) {
        throw unsupportedRecurrencePatch();
      }
    }

    const property = new ICAL.Property('rdate');
    const { value, timezone } = recurrenceIdAsIcalTime(operation.value);
    if (timezone) {
      property.setParameter('tzid', timezone);
    }
    property.setValue(value);
    vevent.addProperty(property);
    return;
  }

  for (const property of properties) {
    const values = property.getValues();
    let removed = false;
    const remaining = values.filter((value) => {
      const matches =
        value instanceof ICAL.Time &&
        calendarEventRecurrenceIdentity(readDateTimeValue(value, property)) ===
          targetIdentity;
      if (matches) {
        removed = true;
      }
      return !matches;
    });

    if (!removed) {
      continue;
    }
    if (remaining.length === 0) {
      vevent.removeProperty(property);
    } else {
      property.setValues(remaining);
    }
  }
}

function recurrenceRdateIdentity(value: CalendarEventRecurrenceDate): string {
  if (value.type !== 'period') {
    return `point:${calendarEventRecurrenceIdentity(value)}`;
  }
  const { timing } = value;
  return timing.type === 'end'
    ? `period:end:${calendarEventRecurrenceIdentity(timing.start)}:${calendarEventRecurrenceIdentity(timing.end)}`
    : `period:duration:${calendarEventRecurrenceIdentity(timing.start)}:${timing.duration.weeks}:${timing.duration.days}:${timing.duration.hours}:${timing.duration.minutes}:${timing.duration.seconds}:${timing.duration.isNegative}`;
}

function applyPeriodRdate(
  vevent: ICAL.Component,
  target: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  calendar?: ICAL.Component,
): void {
  if (calendar) {
    const targetIdentity = recurrenceRdateIdentity(target);
    const alreadyPresent = vevent
      .getAllProperties('rdate')
      .some((property) =>
        property
          .getValues()
          .some(
            (value) =>
              value instanceof ICAL.Period &&
              recurrenceRdateIdentity(readPeriodRdateValue(value, property)) ===
                targetIdentity,
          ),
      );
    if (alreadyPresent) {
      return;
    }

    const { start } = target.timing;
    const startIcal = recurrenceIdAsIcalTime(start);
    if (startIcal.timezone) {
      if (
        !calendar
          .getAllSubcomponents('vtimezone')
          .some(
            (timezone) =>
              timezone.getFirstPropertyValue('tzid') === startIcal.timezone,
          )
      ) {
        throw unsupportedRecurrencePatch();
      }
    }

    const period =
      target.timing.type === 'end'
        ? ICAL.Period.fromData({
            start: startIcal.value,
            end: recurrenceIdAsIcalTime(target.timing.end).value,
          })
        : ICAL.Period.fromData({
            start: startIcal.value,
            duration: ICAL.Duration.fromData(target.timing.duration),
          });
    const property = new ICAL.Property('rdate');
    if (startIcal.timezone) {
      property.setParameter('tzid', startIcal.timezone);
    }
    property.setValue(period);
    vevent.addProperty(property);
    return;
  }
  const targetIdentity = recurrenceRdateIdentity(target);
  for (const property of vevent.getAllProperties('rdate')) {
    const values = property.getValues();
    let removed = false;
    const remaining = values.filter((value) => {
      if (removed || !(value instanceof ICAL.Period)) {
        return true;
      }
      if (
        recurrenceRdateIdentity(readPeriodRdateValue(value, property)) !==
        targetIdentity
      ) {
        return true;
      }
      removed = true;
      return false;
    });
    if (!removed) {
      continue;
    }
    if (remaining.length === 0) {
      vevent.removeProperty(property);
    } else {
      property.setValues(remaining);
    }
    return;
  }
}

function applyPeriodRdateReplacement(
  vevent: ICAL.Component,
  source: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  replacement: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
): boolean {
  const sourceIdentity = recurrenceRdateIdentity(source);
  const replacementIdentity = recurrenceRdateIdentity(replacement);
  const matches: Array<{
    property: ICAL.Property;
    values: ReturnType<ICAL.Property['getValues']>;
    index: number;
  }> = [];

  for (const property of vevent.getAllProperties('rdate')) {
    let values: ReturnType<ICAL.Property['getValues']>;
    try {
      values = property.getValues();
    } catch {
      throw unsupportedRecurrencePatch();
    }
    values.forEach((value, index) => {
      if (
        value instanceof ICAL.Period &&
        recurrenceRdateIdentity(readPeriodRdateValue(value, property)) ===
          sourceIdentity
      ) {
        matches.push({ property, values, index });
      }
    });
  }

  if (matches.length !== 1) {
    throw unsupportedRecurrencePatch();
  }
  if (sourceIdentity === replacementIdentity) {
    return false;
  }

  const match = matches[0];
  const replacementStartIdentity = calendarEventRecurrenceIdentity(
    replacement.timing.start,
  );
  for (const property of vevent.getAllProperties('rdate')) {
    const values = property.getValues();
    for (const [index, value] of values.entries()) {
      if (property === match.property && index === match.index) {
        continue;
      }
      const siblingStart =
        value instanceof ICAL.Period
          ? readPeriodRdateValue(value, property).timing.start
          : value instanceof ICAL.Time
            ? readDateTimeValue(value, property)
            : undefined;
      if (
        siblingStart &&
        calendarEventRecurrenceIdentity(siblingStart) ===
          replacementStartIdentity
      ) {
        throw unsupportedRecurrencePatch();
      }
    }
  }

  const replacementStart = recurrenceIdAsIcalTime(replacement.timing.start);
  const replacementPeriod =
    replacement.timing.type === 'end'
      ? ICAL.Period.fromData({
          start: replacementStart.value,
          end: recurrenceIdAsIcalTime(replacement.timing.end).value,
        })
      : ICAL.Period.fromData({
          start: replacementStart.value,
          duration: ICAL.Duration.fromData(replacement.timing.duration),
        });
  const nextValues = [...match.values];
  nextValues[match.index] = replacementPeriod;
  match.property.setValues(nextValues);
  return true;
}

function recurrenceDateTimeFromUnknown(value: unknown): CalendarEventDateTime {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw unsupportedRecurrencePatch();
  }

  const dateTime = value as Record<string, unknown>;
  if (dateTime.type === 'date') {
    if (
      Object.keys(dateTime).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(dateTime, 'value') ||
      typeof dateTime.value !== 'string' ||
      !isValidCalendarDate(dateTime.value)
    ) {
      throw unsupportedRecurrencePatch();
    }
    return { type: 'date', value: dateTime.value };
  }

  if (dateTime.type === 'floating-date-time') {
    if (
      Object.keys(dateTime).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(dateTime, 'value') ||
      typeof dateTime.value !== 'string' ||
      !isValidLocalDateTime(dateTime.value)
    ) {
      throw unsupportedRecurrencePatch();
    }
    return { type: 'floating-date-time', value: dateTime.value };
  }

  if (dateTime.type === 'date-time') {
    const zonedValue = dateTime.value;
    if (
      Object.keys(dateTime).length !== 2 ||
      !zonedValue ||
      typeof zonedValue !== 'object' ||
      Array.isArray(zonedValue)
    ) {
      throw unsupportedRecurrencePatch();
    }

    const zoned = zonedValue as Record<string, unknown>;
    if (
      Object.keys(zoned).length !== 2 ||
      typeof zoned.local !== 'string' ||
      !isValidLocalDateTime(zoned.local) ||
      typeof zoned.timezone !== 'string' ||
      !zoned.timezone.trim()
    ) {
      throw unsupportedRecurrencePatch();
    }
    return {
      type: 'date-time',
      value: { local: zoned.local, timezone: zoned.timezone },
    };
  }

  throw unsupportedRecurrencePatch();
}

function recurrenceTimingFromUnknown(
  value: unknown,
): CalendarEventRecurrenceTiming {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw unsupportedOccurrenceTimingPatch();
  }

  const timing = value as Record<string, unknown>;
  if (timing.type === 'end') {
    if (
      Object.keys(timing).length !== 3 ||
      !Object.prototype.hasOwnProperty.call(timing, 'start') ||
      !Object.prototype.hasOwnProperty.call(timing, 'end')
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    const start = recurrenceDateTimeFromUnknown(timing.start);
    const end = recurrenceDateTimeFromUnknown(timing.end);
    if ((start.type === 'date') !== (end.type === 'date')) {
      throw unsupportedOccurrenceTimingPatch();
    }
    return { type: 'end', start, end };
  }

  if (timing.type === 'duration') {
    if (
      Object.keys(timing).length !== 3 ||
      !Object.prototype.hasOwnProperty.call(timing, 'start') ||
      !Object.prototype.hasOwnProperty.call(timing, 'duration')
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    const start = recurrenceDateTimeFromUnknown(timing.start);
    if (start.type === 'date' || !isPositiveRfcDuration(timing.duration)) {
      throw unsupportedOccurrenceTimingPatch();
    }
    return {
      type: 'duration',
      start,
      duration: timing.duration,
    };
  }

  throw unsupportedOccurrenceTimingPatch();
}

function recurrenceIdAsIcalTime(recurrenceId: CalendarEventDateTime): {
  value: ICAL.Time;
  timezone?: string;
} {
  switch (recurrenceId.type) {
    case 'date':
      return { value: ICAL.Time.fromDateString(recurrenceId.value) };
    case 'floating-date-time':
      return {
        value: ICAL.Time.fromDateTimeString(
          normalizeLocalDateTime(recurrenceId.value),
        ),
      };
    case 'date-time':
      return {
        value: ICAL.Time.fromDateTimeString(
          recurrenceId.value.timezone === 'UTC'
            ? `${normalizeLocalDateTime(recurrenceId.value.local)}Z`
            : normalizeLocalDateTime(recurrenceId.value.local),
        ),
        timezone:
          recurrenceId.value.timezone === 'UTC'
            ? undefined
            : recurrenceId.value.timezone,
      };
  }
}

function assertSimpleRecurrenceCanBeEdited(event: CalendarEvent): void {
  const recurrence = event.recurrence;
  if (
    event.unsupportedTimezone ||
    event.unsupportedRecurrence ||
    recurrence?.rdates?.length ||
    recurrence?.exdates?.length ||
    recurrence?.recurrenceId ||
    recurrence?.overrides?.length
  ) {
    throw unsupportedRecurrencePatch();
  }

  if (recurrence && Object.prototype.hasOwnProperty.call(recurrence, 'rrule')) {
    if (typeof recurrence.rrule !== 'string') {
      throw unsupportedRecurrencePatch();
    }
    validateRecurrenceRule(
      recurrence.rrule,
      timingStartAsDateTime(event.timing),
    );
  }
}

function validateRecurrenceRule(
  rule: string,
  anchor: CalendarEventDateTime,
): void {
  try {
    if (!rule.trim()) {
      throw new Error('empty recurrence rule');
    }
    parseSupportedCalendarEventRecurrenceRule(rule, anchor);
  } catch {
    throw unsupportedRecurrencePatch();
  }
}

function timingStartAsDateTime(
  timing: CalendarEventTiming,
): CalendarEventDateTime {
  if (timing.type === 'all-day') {
    return { type: 'date', value: timing.startDate };
  }

  return timing.start.type === 'floating'
    ? { type: 'floating-date-time', value: timing.start.local }
    : {
        type: 'date-time',
        value: {
          local: timing.start.local,
          timezone: timing.start.timezone,
        },
      };
}

function setRecurrenceRule(
  vevent: ICAL.Component,
  rule: string | undefined,
): void {
  vevent.removeAllProperties('rrule');
  if (rule) {
    const ruleText = rule.trim().replace(/^RRULE:/i, '');
    vevent.addPropertyWithValue('rrule', ICAL.Recur.fromString(ruleText));
  }
}

function canonicalizeRecurrenceRule(rule: string): string {
  const ruleText = rule.trim().replace(/^RRULE:/i, '');
  return String(ICAL.Recur.fromString(ruleText));
}

function unsupportedRecurrencePatch(): ICalendarEventCodecError {
  return new ICalendarEventCodecError(
    'unsupported-patch',
    'Only simple whole-series RRULE changes are supported',
  );
}

function unsupportedConferencePatch(): ICalendarEventCodecError {
  return new ICalendarEventCodecError(
    'unsupported-patch',
    'Only one explicitly URI-typed safe conference link can be edited',
  );
}

function unsupportedAttachmentPatch(): ICalendarEventCodecError {
  return new ICalendarEventCodecError(
    'unsupported-patch',
    'Only one uniquely addressed safe URI attachment can be edited',
  );
}

function readUnsupportedRecurrence(
  calendar: ICAL.Component,
  uid: string,
): CalendarEvent['unsupportedRecurrence'] {
  const hasThisAndFutureOverride = calendar
    .getAllSubcomponents('vevent')
    .some((vevent) => {
      const recurrenceId = vevent.getFirstProperty('recurrence-id');
      if (
        textValue(vevent.getFirstPropertyValue('uid')) !== uid ||
        !recurrenceId
      ) {
        return false;
      }

      return (
        recurrenceId.getFirstParameter('range')?.toUpperCase() ===
        'THISANDFUTURE'
      );
    });

  return hasThisAndFutureOverride ? 'range-this-and-future' : undefined;
}

function findMasterEvent(
  calendar: ICAL.Component,
  uid?: string,
): ICAL.Component | undefined {
  const events = calendar.getAllSubcomponents('vevent');
  const matching = uid
    ? events.filter(
        (event) => textValue(event.getFirstPropertyValue('uid')) === uid,
      )
    : events;

  return (
    matching.find((event) => !event.hasProperty('recurrence-id')) ?? matching[0]
  );
}

function readRecurrence(
  calendar: ICAL.Component,
  master: ICAL.Component,
  uid: string,
): CalendarEventRecurrence | undefined {
  const recurrence: CalendarEventRecurrence = {};
  const rule = master.getFirstPropertyValue('rrule');
  if (rule !== null && rule !== undefined) {
    recurrence.rrule = String(rule);
  }

  const rdates = readRecurrenceDates(master, 'rdate');
  const exdates = readRecurrenceDates(master, 'exdate');
  if (rdates.length > 0) {
    recurrence.rdates = rdates;
  }
  if (exdates.length > 0) {
    recurrence.exdates = exdates;
  }

  const masterRecurrenceId = master.getFirstProperty('recurrence-id');
  if (masterRecurrenceId) {
    recurrence.recurrenceId = readDateTimeProperty(masterRecurrenceId);
  }

  const overrides = calendar
    .getAllSubcomponents('vevent')
    .filter(
      (event) =>
        event !== master &&
        textValue(event.getFirstPropertyValue('uid')) === uid &&
        event.hasProperty('recurrence-id'),
    )
    .map(readRecurrenceOverride);
  if (overrides.length > 0) {
    recurrence.overrides = overrides;
  }

  return Object.keys(recurrence).length > 0 ? recurrence : undefined;
}

function readRecurrenceOverride(
  vevent: ICAL.Component,
): CalendarEventRecurrenceOverride {
  const recurrenceId = vevent.getFirstProperty('recurrence-id');
  if (!recurrenceId) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'Recurrence override VEVENT must contain RECURRENCE-ID',
    );
  }

  const hasStart = vevent.hasProperty('dtstart');
  const hasEnd = vevent.hasProperty('dtend');
  const hasDuration = vevent.hasProperty('duration');

  const override: CalendarEventRecurrenceOverride = {
    recurrenceId: readDateTimeProperty(recurrenceId),
  };
  // Keep unsupported or incomplete exception timing in the raw resource, but
  // do not let it block decoding the recurrence identity and status.
  if (hasStart && hasEnd) {
    override.timing = readRecurrenceTimingWithEnd(vevent);
  } else if (hasStart && hasDuration) {
    override.timing = readRecurrenceTimingWithDuration(vevent);
  }

  const status = readStatus(vevent.getFirstPropertyValue('status'));
  if (status) {
    override.status = status;
  }

  return override;
}

function readRecurrenceDates(
  component: ICAL.Component,
  name: 'rdate',
): CalendarEventRecurrenceDate[];
function readRecurrenceDates(
  component: ICAL.Component,
  name: 'exdate',
): CalendarEventDateTime[];
function readRecurrenceDates(
  component: ICAL.Component,
  name: 'rdate' | 'exdate',
): CalendarEventRecurrenceDate[] {
  return component.getAllProperties(name).flatMap((property) => {
    let values: ReturnType<ICAL.Property['getValues']>;
    try {
      values = property.getValues();
    } catch {
      // Keep malformed source data opaque in the parsed VCALENDAR. RDATE writes
      // preflight the raw property and fail closed before changing it.
      return [];
    }
    return values.flatMap<CalendarEventRecurrenceDate>((value) => {
      if (value instanceof ICAL.Time) {
        return [readDateTimeValue(value, property)];
      }

      if (name === 'rdate' && value instanceof ICAL.Period) {
        try {
          return [readPeriodRdateValue(value, property)];
        } catch {
          return [];
        }
      }

      return [];
    });
  });
}

function readPeriodRdateValue(
  value: ICAL.Period,
  property: ICAL.Property,
): Extract<CalendarEventRecurrenceDate, { type: 'period' }> {
  const start = value.start;
  const end = value.end;
  if (!(start instanceof ICAL.Time) || start.isDate) {
    throw unsupportedRecurrencePatch();
  }
  if (end instanceof ICAL.Time && !end.isDate) {
    if (start.compare(end) >= 0) {
      throw unsupportedRecurrencePatch();
    }
    return {
      type: 'period',
      timing: {
        type: 'end',
        start: readDateTimeValue(start, property),
        end: readDateTimeValue(end, property),
      },
    };
  }
  if (value.duration instanceof ICAL.Duration) {
    const duration = value.duration;
    const components = [
      duration.weeks,
      duration.days,
      duration.hours,
      duration.minutes,
      duration.seconds,
    ];
    if (
      duration.isNegative ||
      components.some(
        (component) => !Number.isSafeInteger(component) || component < 0,
      ) ||
      components.every((component) => component === 0) ||
      (duration.weeks > 0 &&
        [
          duration.days,
          duration.hours,
          duration.minutes,
          duration.seconds,
        ].some((component) => component > 0))
    ) {
      throw unsupportedRecurrencePatch();
    }
    return {
      type: 'period',
      timing: {
        type: 'duration',
        start: readDateTimeValue(start, property),
        duration: readDuration(duration),
      },
    };
  }
  throw unsupportedRecurrencePatch();
}

function readDateTimeProperty(property: ICAL.Property): CalendarEventDateTime {
  const value = property.getFirstValue();
  if (!(value instanceof ICAL.Time)) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      `${property.name.toUpperCase()} must be a date or date-time value`,
    );
  }

  return readDateTimeValue(value, property);
}

function readDateTimeValue(
  value: ICAL.Time,
  property: ICAL.Property,
): CalendarEventDateTime {
  if (value.isDate) {
    return { type: 'date', value: formatDate(value) };
  }

  const tzid = property.getFirstParameter('tzid');
  if (typeof tzid === 'string' && tzid.length > 0) {
    return {
      type: 'date-time',
      value: { local: formatLocalDateTime(value), timezone: tzid },
    };
  }

  if (value.zone === ICAL.Timezone.utcTimezone) {
    return {
      type: 'date-time',
      value: { local: formatLocalDateTime(value), timezone: 'UTC' },
    };
  }

  return {
    type: 'floating-date-time',
    value: formatLocalDateTime(value),
  };
}

function readRecurrenceTimingWithDuration(
  vevent: ICAL.Component,
): CalendarEventRecurrenceTiming {
  const startProperty = vevent.getFirstProperty('dtstart');
  const durationProperty = vevent.getFirstProperty('duration');
  const start = startProperty?.getFirstValue();
  const duration = durationProperty?.getFirstValue();

  if (
    !startProperty ||
    !(start instanceof ICAL.Time) ||
    !(duration instanceof ICAL.Duration)
  ) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'Recurrence override DTSTART and DURATION must be date or date-time values',
    );
  }

  return {
    type: 'duration',
    start: readDateTimeValue(start, startProperty),
    duration: readDuration(duration),
  };
}

function readRecurrenceTimingWithEnd(
  vevent: ICAL.Component,
): CalendarEventRecurrenceTiming {
  const startProperty = vevent.getFirstProperty('dtstart');
  const endProperty = vevent.getFirstProperty('dtend');
  const start = startProperty?.getFirstValue();
  const end = endProperty?.getFirstValue();

  if (
    !startProperty ||
    !endProperty ||
    !(start instanceof ICAL.Time) ||
    !(end instanceof ICAL.Time)
  ) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'Recurrence override DTSTART and DTEND must be date or date-time values',
    );
  }

  if (start.isDate !== end.isDate) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'Recurrence override DTSTART and DTEND must use the same value type',
    );
  }

  return {
    type: 'end',
    start: readDateTimeValue(start, startProperty),
    end: readDateTimeValue(end, endProperty),
  };
}

function readDuration(duration: ICAL.Duration): CalendarEventDuration {
  return {
    weeks: duration.weeks,
    days: duration.days,
    hours: duration.hours,
    minutes: duration.minutes,
    seconds: duration.seconds,
    isNegative: duration.isNegative,
  };
}

function readTiming(vevent: ICAL.Component): CalendarEventTiming {
  const startProperty = vevent.getFirstProperty('dtstart');
  const endProperty = vevent.getFirstProperty('dtend');

  if (!startProperty || !endProperty) {
    throw new ICalendarEventCodecError(
      'missing-timing',
      'VEVENT must contain DTSTART and DTEND',
    );
  }

  const start = startProperty.getFirstValue();
  const end = endProperty.getFirstValue();

  if (!(start instanceof ICAL.Time) || !(end instanceof ICAL.Time)) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'VEVENT DTSTART and DTEND must be date or date-time values',
    );
  }

  if (start.isDate !== end.isDate) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'VEVENT DTSTART and DTEND must use the same value type',
    );
  }

  if (start.isDate) {
    return {
      type: 'all-day',
      startDate: formatDate(start),
      endDate: formatDate(end),
    };
  }

  return {
    type: 'timed',
    start: readMasterDateTimeValue(start, startProperty),
    end: readMasterDateTimeValue(end, endProperty),
  };
}

function readMasterDateTimeValue(
  time: ICAL.Time,
  property: ICAL.Property,
): CalendarEventTimedDateTime {
  const local = formatLocalDateTime(time);
  const tzid = property.getFirstParameter('tzid');
  if (typeof tzid === 'string' && tzid.length > 0) {
    return { type: 'zoned', local, timezone: tzid };
  }

  if (time.zone === ICAL.Timezone.utcTimezone) {
    return { type: 'zoned', local, timezone: 'UTC' };
  }

  return { type: 'floating', local };
}

function formatDate(time: ICAL.Time): string {
  return [
    String(time.year).padStart(4, '0'),
    String(time.month).padStart(2, '0'),
    String(time.day).padStart(2, '0'),
  ].join('-');
}

function formatLocalDateTime(time: ICAL.Time): string {
  return `${formatDate(time)}T${String(time.hour).padStart(2, '0')}:${String(
    time.minute,
  ).padStart(2, '0')}:${String(time.second).padStart(2, '0')}`;
}

function readStatus(value: unknown): CalendarEventStatus | undefined {
  switch (textValue(value)?.toUpperCase()) {
    case 'CONFIRMED':
      return 'confirmed';
    case 'TENTATIVE':
      return 'tentative';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return undefined;
  }
}

function readTransparency(
  value: unknown,
): CalendarEventTransparency | undefined {
  switch (textValue(value)?.toUpperCase()) {
    case 'OPAQUE':
      return 'opaque';
    case 'TRANSPARENT':
      return 'transparent';
    default:
      return undefined;
  }
}

function readCategories(vevent: ICAL.Component): string[] | undefined {
  const categories = vevent
    .getAllProperties('categories')
    .flatMap((property) => property.getValues())
    .flatMap((value) => {
      const text = textValue(value);
      return text ? [text] : [];
    });

  return categories.length > 0 ? categories : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function readCalendarEventRevision(
  vevent: ICAL.Component,
  sourceProperties?: RawRevisionProperty[],
): CalendarEventRevision | undefined {
  const revision: {
    dtstamp?: string;
    created?: string;
    lastModified?: string;
    sequence?: number;
  } = {};
  const dtstamp = sourceProperties
    ? inspectSourceUtcTimestamp(vevent, sourceProperties, 'dtstamp')
    : inspectUtcTimestamp(vevent, 'dtstamp');
  const created = sourceProperties
    ? inspectSourceUtcTimestamp(vevent, sourceProperties, 'created')
    : inspectUtcTimestamp(vevent, 'created');
  const lastModified = sourceProperties
    ? inspectSourceUtcTimestamp(vevent, sourceProperties, 'last-modified')
    : inspectUtcTimestamp(vevent, 'last-modified');
  const sequence = sourceProperties
    ? inspectSourceSequence(vevent, sourceProperties)
    : inspectSequence(vevent);

  if (dtstamp.kind === 'valid') {
    revision.dtstamp = dtstamp.value;
  }
  if (created.kind === 'valid') {
    revision.created = created.value;
  }
  if (lastModified.kind === 'valid') {
    revision.lastModified = lastModified.value;
  }
  if (sequence.kind === 'valid') {
    revision.sequence = sequence.value;
  }

  return Object.keys(revision).length > 0 ? revision : undefined;
}

function readUpdatedCalendarEventRevision(
  vevent: ICAL.Component,
  sourceProperties?: RawRevisionProperty[],
): CalendarEventRevision | undefined {
  const revision = readCalendarEventRevision(vevent);
  if (!revision || !sourceProperties) {
    return revision;
  }

  const updatedRevision = { ...revision };
  const created = inspectSourceUtcTimestamp(
    vevent,
    sourceProperties,
    'created',
  );
  if (created.kind === 'valid') {
    updatedRevision.created = created.value;
  } else {
    delete updatedRevision.created;
  }

  return Object.keys(updatedRevision).length > 0 ? updatedRevision : undefined;
}

function inspectSourceUtcTimestamp(
  vevent: ICAL.Component,
  sourceProperties: RawRevisionProperty[],
  name: 'dtstamp' | 'created' | 'last-modified',
): RevisionPropertyState<string> {
  const source = inspectRawUtcTimestamp(sourceProperties, name);
  if (source.kind !== 'valid') {
    return source;
  }

  const parsed = inspectUtcTimestamp(vevent, name);
  return parsed.kind === 'valid' ? source : { kind: 'invalid' };
}

function inspectSourceSequence(
  vevent: ICAL.Component,
  sourceProperties: RawRevisionProperty[],
): RevisionPropertyState<number> {
  const source = inspectRawSequence(sourceProperties);
  if (source.kind !== 'valid') {
    return source;
  }

  const parsed = inspectSequence(vevent);
  return parsed.kind === 'valid' ? source : { kind: 'invalid' };
}

function inspectRawUtcTimestamp(
  sourceProperties: RawRevisionProperty[],
  name: 'dtstamp' | 'created' | 'last-modified',
): RevisionPropertyState<string> {
  const properties = sourceProperties.filter(
    (property) => property.name === name,
  );
  if (properties.length === 0) {
    return { kind: 'missing' };
  }
  if (properties.length !== 1) {
    return { kind: 'invalid' };
  }

  const parts = parseContentLine(properties[0].value);
  if (
    !parts ||
    hasCalendarParameter(parts.header, 'tzid') ||
    !isValidCompactUtcDateTime(parts.value) ||
    (calendarParameterValue(parts.header, 'value') !== undefined &&
      calendarParameterValue(parts.header, 'value')?.toUpperCase() !==
        'DATE-TIME') ||
    !/^\d{8}T\d{6}Z$/.test(parts.value)
  ) {
    return { kind: 'invalid' };
  }

  return { kind: 'valid', value: compactUtcTimestampToIso(parts.value) };
}

function inspectRawSequence(
  sourceProperties: RawRevisionProperty[],
): RevisionPropertyState<number> {
  const properties = sourceProperties.filter(
    (property) => property.name === 'sequence',
  );
  if (properties.length === 0) {
    return { kind: 'missing' };
  }
  if (properties.length !== 1) {
    return { kind: 'invalid' };
  }

  const parts = parseContentLine(properties[0].value);
  if (
    !parts ||
    (calendarParameterValue(parts.header, 'value') !== undefined &&
      calendarParameterValue(parts.header, 'value')?.toUpperCase() !==
        'INTEGER') ||
    !/^\+?\d+$/.test(parts.value)
  ) {
    return { kind: 'invalid' };
  }

  const value = Number(parts.value);
  return Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_ICALENDAR_SEQUENCE
    ? { kind: 'valid', value }
    : { kind: 'invalid' };
}

function readMasterRevisionProperties(
  source: string,
): RawRevisionProperty[] | undefined {
  const lines = readContentLines(source);
  const range = findMasterVeventRange(lines);
  if (!range) {
    return undefined;
  }

  const properties: RawRevisionProperty[] = [];
  let nestedComponents = 0;
  for (let index = range.start + 1; index < range.end; index += 1) {
    const line = lines[index];
    const marker = line.value.toUpperCase();
    if (marker.startsWith('BEGIN:')) {
      nestedComponents += 1;
      continue;
    }
    if (marker.startsWith('END:')) {
      nestedComponents = Math.max(0, nestedComponents - 1);
      continue;
    }
    if (nestedComponents > 0) {
      continue;
    }

    const parsed = parseContentLine(line.value);
    if (parsed && isRevisionPropertyName(parsed.name)) {
      properties.push({
        ...line,
        name: parsed.name,
      });
    }
  }

  return properties;
}

function readVeventRevisionProperties(
  source: string,
): RawRevisionProperty[][] | undefined {
  const lines = readContentLines(source);
  const ranges = findVeventRanges(lines);
  if (!ranges) {
    return undefined;
  }

  return ranges.map((range) => {
    const properties: RawRevisionProperty[] = [];
    let nestedComponents = 0;
    for (let index = range.start + 1; index < range.end; index += 1) {
      const line = lines[index];
      const marker = line.value.toUpperCase();
      if (marker.startsWith('BEGIN:')) {
        nestedComponents += 1;
        continue;
      }
      if (marker.startsWith('END:')) {
        nestedComponents = Math.max(0, nestedComponents - 1);
        continue;
      }
      if (nestedComponents > 0) {
        continue;
      }

      const parsed = parseContentLine(line.value);
      if (parsed && isRevisionPropertyName(parsed.name)) {
        properties.push({
          ...line,
          name: parsed.name,
        });
      }
    }
    return properties;
  });
}

function readRawVeventProperties(
  source: string,
): RawVeventProperty[][] | undefined {
  const lines = readContentLines(source);
  const ranges = findVeventRanges(lines);
  if (!ranges) {
    return undefined;
  }

  return ranges.map((range) => {
    const properties: RawVeventProperty[] = [];
    let nestedComponents = 0;
    for (let index = range.start + 1; index < range.end; index += 1) {
      const line = lines[index];
      const marker = line.value.toUpperCase();
      if (marker.startsWith('BEGIN:')) {
        nestedComponents += 1;
        continue;
      }
      if (marker.startsWith('END:')) {
        nestedComponents = Math.max(0, nestedComponents - 1);
        continue;
      }
      if (nestedComponents !== 0) {
        continue;
      }
      const parsed = parseContentLine(line.value);
      if (parsed) {
        properties.push({ ...parsed, physicalLines: [...line.physicalLines] });
      }
    }
    return properties;
  });
}

function rawVeventAttachmentProperties(
  source: string,
): ICalendarContentLine[][] {
  const rawProperties = readRawVeventProperties(source);
  return (
    rawProperties?.map((properties) =>
      properties
        .filter((property) => property.name === 'attach')
        .map((property) => ({
          value: `${property.header}:${property.value}`,
          physicalLines: [...property.physicalLines],
        })),
    ) ?? []
  );
}

function readAttachmentSourceState(
  vevent: ICAL.Component,
  rawProperties: ICalendarContentLine[],
): AttachmentSourceState {
  const parsedProperties = vevent.getAllProperties('attach');
  let unsupported = rawProperties.length !== parsedProperties.length;
  const editable: SupportedAttachmentValue[] = [];
  const opaqueUriUrls: string[] = [];

  for (
    let propertyIndex = 0;
    propertyIndex < Math.min(rawProperties.length, parsedProperties.length);
    propertyIndex += 1
  ) {
    const raw = parseContentLine(rawProperties[propertyIndex].value);
    const property = parsedProperties[propertyIndex];
    const valueTypes = raw
      ? contentLineParameters(raw.header).filter(
          (parameter) => parameter.name === 'value',
        )
      : [];
    const hasUriValueType =
      valueTypes.length === 0 ||
      valueTypes.some(
        (parameter) => parameter.value?.toUpperCase() === 'URI',
      );
    const rawUrl = raw
      ? canonicalizeCalendarExternalUrl(raw.value)
      : undefined;
    const parsedUrl = canonicalizeCalendarExternalUrl(property.getFirstValue());
    if (
      !raw ||
      valueTypes.length > 1 ||
      (valueTypes.length === 1 &&
        valueTypes[0].value?.toUpperCase() !== 'URI') ||
      property.type !== 'uri' ||
      !rawUrl ||
      rawUrl !== parsedUrl
    ) {
      if (hasUriValueType && rawUrl) {
        opaqueUriUrls.push(rawUrl);
      }
      continue;
    }
    if (editable.length <= MAX_CALENDAR_EVENT_AUTHORABLE_ATTACHMENTS) {
      editable.push({ url: rawUrl, propertyIndex });
    } else {
      unsupported = true;
    }
  }

  const seenUrls = new Set<string>();
  for (const attachment of editable) {
    if (seenUrls.has(attachment.url)) {
      unsupported = true;
    }
    seenUrls.add(attachment.url);
  }
  if (editable.length > MAX_CALENDAR_EVENT_AUTHORABLE_ATTACHMENTS) {
    unsupported = true;
  }

  return { editable, opaqueUriUrls, unsupported };
}

function hasAmbiguousAttachmentSource(
  calendar: ICAL.Component,
  uid: string,
  master: ICAL.Component,
  attachmentPropertiesByEvent: ICalendarContentLine[][],
): boolean {
  const matchingEvents = calendar
    .getAllSubcomponents('vevent')
    .map((component, index) => ({ component, index }))
    .filter(({ component }) =>
      component
        .getAllProperties('uid')
        .some((property) => textValue(property.getFirstValue()) === uid),
    );
  const masters = matchingEvents.filter(
    ({ component }) => !component.hasProperty('recurrence-id'),
  );
  return (
    masters.length !== 1 ||
    matchingEvents.some(({ component, index }) => {
      if (component.getAllProperties('uid').length !== 1) {
        return true;
      }
      if (component === master) {
        return false;
      }
      return (
        component.getAllProperties('attach').length > 0 ||
        (attachmentPropertiesByEvent[index]?.length ?? 0) > 0
      );
    })
  );
}

function planAttachmentPatch(
  sourceProperties: ICalendarContentLine[],
  sourceState: AttachmentSourceState,
  patch: CalendarEventAttachmentPatch,
): AttachmentPatchPlan {
  if (sourceState.unsupported) {
    throw unsupportedAttachmentPatch();
  }

  const targetUrl = 'sourceUrl' in patch ? patch.sourceUrl : patch.url;
  if (sourceState.opaqueUriUrls.includes(targetUrl)) {
    throw unsupportedAttachmentPatch();
  }
  if (
    patch.action === 'set' &&
    sourceState.opaqueUriUrls.includes(patch.url)
  ) {
    throw unsupportedAttachmentPatch();
  }
  const matches = sourceState.editable.filter(
    (attachment) => attachment.url === targetUrl,
  );
  if (patch.action === 'add') {
    if (matches.length > 1) {
      throw unsupportedAttachmentPatch();
    }
    if (matches.length === 1) {
      return { noOp: true, nextProperties: sourceProperties };
    }
    if (
      sourceState.editable.length >= MAX_CALENDAR_EVENT_AUTHORABLE_ATTACHMENTS
    ) {
      throw unsupportedAttachmentPatch();
    }
    return {
      noOp: false,
      nextProperties: [
        ...sourceProperties,
        foldContentLine(`ATTACH;VALUE=URI:${patch.url}`),
      ],
    };
  }

  if (matches.length !== 1) {
    throw unsupportedAttachmentPatch();
  }
  const sourcePropertyIndex = matches[0].propertyIndex;
  if (patch.action === 'remove') {
    return {
      noOp: false,
      sourcePropertyIndex,
      nextProperties: sourceProperties.filter(
        (_property, index) => index !== sourcePropertyIndex,
      ),
    };
  }
  if (patch.sourceUrl === patch.url) {
    return {
      noOp: true,
      sourcePropertyIndex,
      nextProperties: sourceProperties,
    };
  }
  if (
    sourceState.editable.some(
      (attachment) =>
        attachment.propertyIndex !== sourcePropertyIndex &&
        attachment.url === patch.url,
    )
  ) {
    throw unsupportedAttachmentPatch();
  }
  const source = parseContentLine(sourceProperties[sourcePropertyIndex].value);
  if (!source) {
    throw unsupportedAttachmentPatch();
  }
  return {
    noOp: false,
    sourcePropertyIndex,
    nextProperties: sourceProperties.map((property, index) =>
      index === sourcePropertyIndex
        ? foldContentLine(`${source.header}:${patch.url}`)
        : property,
    ),
  };
}

function setAttachmentProperty(
  vevent: ICAL.Component,
  patch: CalendarEventAttachmentPatch,
  sourcePropertyIndex?: number,
): void {
  if (patch.action === 'add') {
    vevent.addProperty(
      ICAL.Property.fromString(`ATTACH;VALUE=URI:${patch.url}`),
    );
    return;
  }
  const properties = vevent.getAllProperties('attach');
  const property =
    sourcePropertyIndex === undefined ? undefined : properties[sourcePropertyIndex];
  if (!property) {
    throw unsupportedAttachmentPatch();
  }
  if (patch.action === 'remove') {
    vevent.removeProperty(property);
  } else {
    property.setValue(patch.url);
  }
}

function rawVeventConferenceProperties(
  source: string,
): ICalendarContentLine[][] {
  const rawProperties = readRawVeventProperties(source);
  return (
    rawProperties?.map((properties) =>
      properties
        .filter((property) => property.name === 'conference')
        .map((property) => ({
          value: `${property.header}:${property.value}`,
          physicalLines: [...property.physicalLines],
        })),
    ) ?? []
  );
}

function readConferenceSourceState(
  vevent: ICAL.Component,
  rawProperties: ICalendarContentLine[],
): ConferenceSourceState {
  const parsedProperties = vevent.getAllProperties('conference');
  if (rawProperties.length === 0 && parsedProperties.length === 0) {
    return { present: false };
  }
  if (rawProperties.length !== 1 || parsedProperties.length !== 1) {
    return { present: true };
  }

  const raw = parseContentLine(rawProperties[0].value);
  const valueTypes = raw
    ? contentLineParameters(raw.header).filter((p) => p.name === 'value')
    : [];
  const labels = raw
    ? contentLineParameters(raw.header).filter((p) => p.name === 'label')
    : [];
  const property = parsedProperties[0];
  if (
    !raw ||
    valueTypes.length !== 1 ||
    valueTypes[0].value?.toUpperCase() !== 'URI' ||
    labels.length > 1 ||
    property.type !== 'uri'
  ) {
    return { present: true };
  }

  const url = canonicalizeCalendarExternalUrl(property.getFirstValue());
  if (!url) {
    return { present: true };
  }

  let label: string | undefined;
  if (labels.length === 1) {
    const rawLabel = property.getParameter('label');
    if (typeof rawLabel !== 'string') {
      return { present: true };
    }
    label = boundCalendarEventExternalLinkLabel(rawLabel);
    if (!label || label !== rawLabel.trim()) {
      return { present: true };
    }
  }

  return {
    present: true,
    editable: { url, ...(label ? { label } : {}) },
  };
}

function hasAmbiguousConferenceSource(
  calendar: ICAL.Component,
  uid: string,
  master: ICAL.Component,
  conferencePropertiesByEvent: ICalendarContentLine[][],
): boolean {
  const matchingEvents = calendar
    .getAllSubcomponents('vevent')
    .map((component, index) => ({ component, index }))
    .filter(
      ({ component }) =>
        textValue(component.getFirstPropertyValue('uid')) === uid,
    );
  const masters = matchingEvents.filter(
    ({ component }) => !component.hasProperty('recurrence-id'),
  );
  return (
    masters.length !== 1 ||
    matchingEvents.some(
      ({ component, index }) =>
        component !== master &&
        (component.hasProperty('conference') ||
          (conferencePropertiesByEvent[index]?.length ?? 0) > 0),
    )
  );
}

function conferencePatchIsNoOp(
  patch: CalendarEventConferencePatch,
  state: ConferenceSourceState,
): boolean {
  if (patch.action === 'remove') {
    return !state.present;
  }
  return (
    state.editable?.url === patch.url && state.editable.label === patch.label
  );
}

function setConferenceProperty(
  vevent: ICAL.Component,
  patch: CalendarEventConferencePatch,
): void {
  const properties = vevent.getAllProperties('conference');
  if (patch.action === 'remove') {
    for (const property of properties) {
      vevent.removeProperty(property);
    }
    return;
  }

  const property =
    properties.length === 1
      ? properties[0]
      : ICAL.Property.fromString(`CONFERENCE;VALUE=URI:${patch.url}`);
  property.setValue(patch.url);
  if (patch.label) {
    property.setParameter('label', patch.label);
  } else {
    property.removeParameter('label');
  }
  if (properties.length === 0) {
    vevent.addProperty(property);
  }
}

function rawConferencePropertiesAfterPatch(
  sourceProperties: ICalendarContentLine[],
  patch: CalendarEventConferencePatch,
): ICalendarContentLine[] {
  if (patch.action === 'remove' || sourceProperties.length === 0) {
    return [];
  }
  if (sourceProperties.length !== 1) {
    throw unsupportedConferencePatch();
  }

  const parsed = parseContentLine(sourceProperties[0].value);
  if (!parsed) {
    throw unsupportedConferencePatch();
  }
  const segments = splitContentLineHeader(parsed.header);
  const output = [segments[0]];
  let labelWritten = false;
  for (const segment of segments.slice(1)) {
    const separator = segment.indexOf('=');
    const name = (separator < 0 ? segment : segment.slice(0, separator))
      .trim()
      .toLowerCase();
    if (name !== 'label') {
      output.push(segment);
      continue;
    }
    if (patch.label) {
      output.push(`LABEL=${quoteConferenceLabel(patch.label)}`);
      labelWritten = true;
    }
  }
  if (patch.label && !labelWritten) {
    output.push(`LABEL=${quoteConferenceLabel(patch.label)}`);
  }
  return [foldContentLine(`${output.join(';')}:${patch.url}`)];
}

function splitContentLineHeader(header: string): string[] {
  const segments: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < header.length; index += 1) {
    if (header[index] === '"' && header[index - 1] !== '^') {
      quoted = !quoted;
    } else if (header[index] === ';' && !quoted) {
      segments.push(header.slice(start, index));
      start = index + 1;
    }
  }
  segments.push(header.slice(start));
  return segments;
}

function quoteConferenceLabel(label: string): string {
  return `"${label.replace(/\^/g, '^^').replace(/"/g, "^'")}"`;
}

function foldContentLine(value: string): ICalendarContentLine {
  const physicalLines: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const character of Array.from(value)) {
    const bytes = Buffer.byteLength(character, 'utf8');
    if (currentBytes + bytes > 75) {
      physicalLines.push(current);
      current = ` ${character}`;
      currentBytes = 1 + bytes;
    } else {
      current += character;
      currentBytes += bytes;
    }
  }
  physicalLines.push(current);
  return { value, physicalLines };
}

function restoreVeventAttachmentProperties(
  serialized: string,
  sourcePropertiesByEvent: ICalendarContentLine[][],
  forceReplacementForEvent = new Set<number>(),
): string {
  const lines = readContentLines(serialized);
  const ranges = findVeventRanges(lines);
  if (!ranges) {
    return serialized;
  }
  for (let eventIndex = ranges.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const range = ranges[eventIndex];
    const sourceProperties = sourcePropertiesByEvent[eventIndex] ?? [];
    if (
      sourceProperties.length === 0 &&
      !forceReplacementForEvent.has(eventIndex)
    ) {
      continue;
    }

    const body: ICalendarContentLine[] = [];
    let nestedComponents = 0;
    let inserted = false;
    for (let index = range.start + 1; index < range.end; index += 1) {
      const line = lines[index];
      const marker = line.value.toUpperCase();
      if (marker.startsWith('BEGIN:')) {
        nestedComponents += 1;
        body.push(line);
        continue;
      }
      if (marker.startsWith('END:')) {
        nestedComponents = Math.max(0, nestedComponents - 1);
        body.push(line);
        continue;
      }
      if (
        nestedComponents === 0 &&
        contentLinePropertyName(line.value) === 'attach'
      ) {
        if (!inserted) {
          body.push(...sourceProperties);
          inserted = true;
        }
        continue;
      }
      body.push(line);
    }
    if (!inserted && sourceProperties.length > 0) {
      const uidIndex = body.findIndex(
        (line) => contentLinePropertyName(line.value) === 'uid',
      );
      body.splice(uidIndex < 0 ? 0 : uidIndex + 1, 0, ...sourceProperties);
    }
    lines.splice(range.start + 1, range.end - range.start - 1, ...body);
  }
  const physicalLines = lines.flatMap((line) => line.physicalLines);
  const hasFinalLineEnding = /(?:\r\n|\n|\r)$/.test(serialized);
  return `${physicalLines.join('\r\n')}${hasFinalLineEnding ? '\r\n' : ''}`;
}

function restoreVeventConferenceProperties(
  serialized: string,
  sourcePropertiesByEvent: ICalendarContentLine[][],
  forceReplacementForEvent = new Set<number>(),
): string {
  const lines = readContentLines(serialized);
  const ranges = findVeventRanges(lines);
  if (!ranges) {
    return serialized;
  }
  for (let eventIndex = ranges.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const range = ranges[eventIndex];
    const sourceProperties = sourcePropertiesByEvent[eventIndex] ?? [];
    if (
      sourceProperties.length === 0 &&
      !forceReplacementForEvent.has(eventIndex)
    ) {
      continue;
    }

    const body: ICalendarContentLine[] = [];
    let nestedComponents = 0;
    let inserted = false;
    for (let index = range.start + 1; index < range.end; index += 1) {
      const line = lines[index];
      const marker = line.value.toUpperCase();
      if (marker.startsWith('BEGIN:')) {
        nestedComponents += 1;
        body.push(line);
        continue;
      }
      if (marker.startsWith('END:')) {
        nestedComponents = Math.max(0, nestedComponents - 1);
        body.push(line);
        continue;
      }
      if (
        nestedComponents === 0 &&
        contentLinePropertyName(line.value) === 'conference'
      ) {
        if (!inserted) {
          body.push(...sourceProperties);
          inserted = true;
        }
        continue;
      }
      body.push(line);
    }
    if (!inserted && sourceProperties.length > 0) {
      const uidIndex = body.findIndex(
        (line) => contentLinePropertyName(line.value) === 'uid',
      );
      body.splice(uidIndex < 0 ? 0 : uidIndex + 1, 0, ...sourceProperties);
    }
    lines.splice(range.start + 1, range.end - range.start - 1, ...body);
  }
  const physicalLines = lines.flatMap((line) => line.physicalLines);
  const hasFinalLineEnding = /(?:\r\n|\n|\r)$/.test(serialized);
  return `${physicalLines.join('\r\n')}${hasFinalLineEnding ? '\r\n' : ''}`;
}

function validateRawOccurrenceTimingProperties(
  rawProperties: RawVeventProperty[],
  component: ICAL.Component,
): void {
  for (const name of ['dtstart', 'dtend', 'recurrence-id']) {
    const raw = rawProperties.filter((property) => property.name === name);
    const parsed = component.getAllProperties(name);
    if (
      raw.length !== parsed.length ||
      (name === 'dtstart' && raw.length !== 1) ||
      (name !== 'dtstart' && raw.length > 1)
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    for (let index = 0; index < raw.length; index += 1) {
      const value = rawOccurrenceDateTime(raw[index]);
      if (
        name === 'recurrence-id' &&
        contentLineParameters(raw[index].header).some(
          (parameter) => parameter.name === 'range',
        )
      ) {
        throw unsupportedOccurrenceTimingPatch();
      }
      let parsedValue: CalendarEventDateTime;
      try {
        parsedValue = readDateTimeProperty(parsed[index]);
      } catch {
        throw unsupportedOccurrenceTimingPatch();
      }
      if (
        calendarEventRecurrenceIdentity(value) !==
        calendarEventRecurrenceIdentity(parsedValue)
      ) {
        throw unsupportedOccurrenceTimingPatch();
      }
    }
  }

  const rawDurations = rawProperties.filter(
    (property) => property.name === 'duration',
  );
  const parsedDurations = component.getAllProperties('duration');
  if (
    rawDurations.length !== parsedDurations.length ||
    rawDurations.length > 1 ||
    (rawDurations.length > 0 && component.getAllProperties('dtend').length > 0)
  ) {
    throw unsupportedOccurrenceTimingPatch();
  }
  for (let index = 0; index < rawDurations.length; index += 1) {
    const parameters = contentLineParameters(rawDurations[index].header);
    if (
      parameters.some(
        (parameter) => parameter.name === 'tzid' || parameter.name === 'value',
      )
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    const rawDuration = positiveDurationFromRaw(rawDurations[index].value);
    const parsedDuration = parsedDurations[index].getFirstValue();
    if (
      !rawDuration ||
      !(parsedDuration instanceof ICAL.Duration) ||
      !sameDuration(rawDuration, readDuration(parsedDuration))
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
  }
}

function rawOccurrenceDateTime(
  property: RawVeventProperty,
): CalendarEventDateTime {
  const parameters = contentLineParameters(property.header);
  const valueParameters = parameters.filter(
    (parameter) => parameter.name === 'value',
  );
  const timezoneParameters = parameters.filter(
    (parameter) => parameter.name === 'tzid',
  );
  if (valueParameters.length > 1 || timezoneParameters.length > 1) {
    throw unsupportedOccurrenceTimingPatch();
  }
  const valueType = valueParameters[0]?.value?.toUpperCase();
  const timezone = timezoneParameters[0]?.value;
  if (
    (valueParameters.length > 0 && !valueType) ||
    (timezoneParameters.length > 0 && !timezone)
  ) {
    throw unsupportedOccurrenceTimingPatch();
  }

  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(property.value);
  if (date) {
    const value = `${date[1]}-${date[2]}-${date[3]}`;
    if (
      !isValidCalendarDate(value) ||
      (valueType !== undefined && valueType !== 'DATE') ||
      timezone !== undefined
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    return { type: 'date', value };
  }

  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(
    property.value,
  );
  if (!dateTime || (valueType !== undefined && valueType !== 'DATE-TIME')) {
    throw unsupportedOccurrenceTimingPatch();
  }
  const local = `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}T${dateTime[4]}:${dateTime[5]}:${dateTime[6]}`;
  if (!isValidLocalDateTime(local)) {
    throw unsupportedOccurrenceTimingPatch();
  }
  if (timezone !== undefined) {
    if (
      dateTime[7] ||
      timezone === 'UTC' ||
      !isCalendarTimezoneSupported(timezone)
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    return { type: 'date-time', value: { local, timezone } };
  }
  return dateTime[7]
    ? { type: 'date-time', value: { local, timezone: 'UTC' } }
    : { type: 'floating-date-time', value: local };
}

function positiveDurationFromRaw(
  value: string,
): CalendarEventDuration | undefined {
  const match =
    /^([+-])?P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/.exec(
      value,
    );
  if (!match || (value.includes('T') && !match[4] && !match[5] && !match[6])) {
    return undefined;
  }
  const duration: CalendarEventDuration = {
    weeks: Number(match[2] ?? 0),
    days: Number(match[3] ?? 0),
    hours: Number(match[4] ?? 0),
    minutes: Number(match[5] ?? 0),
    seconds: Number(match[6] ?? 0),
    isNegative: match[1] === '-',
  };
  return isPositiveRfcDuration(duration) ? duration : undefined;
}

function sameDuration(
  left: CalendarEventDuration,
  right: CalendarEventDuration,
): boolean {
  return (
    left.weeks === right.weeks &&
    left.days === right.days &&
    left.hours === right.hours &&
    left.minutes === right.minutes &&
    left.seconds === right.seconds &&
    left.isNegative === right.isNegative
  );
}

function contentLineParameters(
  header: string,
): Array<{ name: string; value?: string }> {
  const segments: string[] = [];
  let segment = '';
  let quoted = false;
  for (let index = 0; index < header.length; index += 1) {
    const character = header[index];
    if (character === '"' && header[index - 1] !== '^') {
      quoted = !quoted;
    }
    if (character === ';' && !quoted) {
      segments.push(segment);
      segment = '';
    } else {
      segment += character;
    }
  }
  segments.push(segment);

  return segments.slice(1).map((segment) => {
    const separator = segment.indexOf('=');
    const name = (separator < 0 ? segment : segment.slice(0, separator))
      .trim()
      .toLowerCase();
    const rawValue =
      separator < 0 ? undefined : segment.slice(separator + 1).trim();
    return {
      name,
      ...(rawValue === undefined
        ? {}
        : {
            value:
              rawValue.length >= 2 &&
              rawValue.startsWith('"') &&
              rawValue.endsWith('"')
                ? rawValue.slice(1, -1)
                : rawValue,
          }),
    };
  });
}

function findVeventRanges(
  lines: ICalendarContentLine[],
): Array<{ start: number; end: number }> | undefined {
  const ranges: Array<{ start: number; end: number }> = [];
  let start: number | undefined;
  let nestedComponents = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index].value.toUpperCase();
    if (start === undefined) {
      if (marker === 'BEGIN:VEVENT') {
        start = index;
        nestedComponents = 0;
      }
      continue;
    }

    if (marker === 'END:VEVENT' && nestedComponents === 0) {
      ranges.push({ start, end: index });
      start = undefined;
      continue;
    }
    if (marker.startsWith('BEGIN:')) {
      nestedComponents += 1;
    } else if (marker.startsWith('END:')) {
      nestedComponents = Math.max(0, nestedComponents - 1);
    }
  }

  return start === undefined ? ranges : undefined;
}

function findMasterVeventRange(
  lines: ICalendarContentLine[],
): { start: number; end: number } | undefined {
  let start: number | undefined;
  let hasRecurrenceId = false;
  let nestedComponents = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index].value.toUpperCase();
    if (start === undefined) {
      if (marker === 'BEGIN:VEVENT') {
        start = index;
        hasRecurrenceId = false;
        nestedComponents = 0;
      }
      continue;
    }

    if (marker === 'END:VEVENT' && nestedComponents === 0) {
      if (!hasRecurrenceId) {
        return { start, end: index };
      }
      start = undefined;
      continue;
    }
    if (marker.startsWith('BEGIN:')) {
      nestedComponents += 1;
      continue;
    }
    if (marker.startsWith('END:')) {
      nestedComponents = Math.max(0, nestedComponents - 1);
      continue;
    }
    if (nestedComponents === 0) {
      hasRecurrenceId ||=
        contentLinePropertyName(lines[index].value) === 'recurrence-id';
    }
  }

  return undefined;
}

function restoreRevisionProperties(
  serialized: string,
  sourceProperties: RawRevisionProperty[] | undefined,
  names: Array<RawRevisionProperty['name']>,
  veventIndex?: number,
): string {
  if (!sourceProperties) {
    return serialized;
  }

  const lines = readContentLines(serialized);
  const range =
    veventIndex === undefined
      ? findMasterVeventRange(lines)
      : findVeventRanges(lines)?.[veventIndex];
  if (!range) {
    return serialized;
  }

  const selectedNames = new Set(names);
  const sourceByName = new Map<
    RawRevisionProperty['name'],
    RawRevisionProperty[]
  >();
  for (const property of sourceProperties) {
    if (!selectedNames.has(property.name)) {
      continue;
    }
    const matching = sourceByName.get(property.name) ?? [];
    matching.push(property);
    sourceByName.set(property.name, matching);
  }
  const body: ICalendarContentLine[] = [];
  const outputCounts = new Map<RawRevisionProperty['name'], number>();
  const matchedSource = new Set<RawRevisionProperty>();
  let nestedComponents = 0;

  for (let index = range.start + 1; index < range.end; index += 1) {
    const line = lines[index];
    const marker = line.value.toUpperCase();
    if (marker.startsWith('BEGIN:')) {
      nestedComponents += 1;
      body.push(line);
      continue;
    }
    if (marker.startsWith('END:')) {
      nestedComponents = Math.max(0, nestedComponents - 1);
      body.push(line);
      continue;
    }

    const propertyName =
      nestedComponents === 0 ? contentLinePropertyName(line.value) : undefined;
    if (
      propertyName &&
      isRevisionPropertyName(propertyName) &&
      selectedNames.has(propertyName)
    ) {
      const occurrence = outputCounts.get(propertyName) ?? 0;
      outputCounts.set(propertyName, occurrence + 1);
      const replacement = sourceByName.get(propertyName)?.[occurrence];
      if (replacement) {
        body.push(replacement);
        matchedSource.add(replacement);
      }
      continue;
    }
    body.push(line);
  }

  const unmatchedSource = sourceProperties.filter(
    (property) =>
      selectedNames.has(property.name) && !matchedSource.has(property),
  );
  if (unmatchedSource.length > 0) {
    const uidIndex = body.findIndex(
      (line) => contentLinePropertyName(line.value) === 'uid',
    );
    body.splice(uidIndex < 0 ? 0 : uidIndex + 1, 0, ...unmatchedSource);
  }
  lines.splice(range.start + 1, range.end - range.start - 1, ...body);

  const physicalLines = lines.flatMap((line) => line.physicalLines);
  const hasFinalLineEnding = /(?:\r\n|\n|\r)$/.test(serialized);
  return `${physicalLines.join('\r\n')}${hasFinalLineEnding ? '\r\n' : ''}`;
}

function readContentLines(source: string): ICalendarContentLine[] {
  const physicalLines = source.split(/\r\n|\n|\r/);
  if (physicalLines.at(-1) === '') {
    physicalLines.pop();
  }

  const lines: ICalendarContentLine[] = [];
  for (const physicalLine of physicalLines) {
    if (/^[ \t]/.test(physicalLine) && lines.length > 0) {
      const previous = lines[lines.length - 1];
      previous.value += physicalLine.slice(1);
      previous.physicalLines.push(physicalLine);
    } else {
      lines.push({ value: physicalLine, physicalLines: [physicalLine] });
    }
  }
  return lines;
}

function assertFollowingRawTimingParameters(
  rawProperties: RawVeventProperty[],
): void {
  for (const property of rawProperties) {
    if (
      !['dtstart', 'dtend', 'duration', 'recurrence-id'].includes(property.name)
    ) {
      continue;
    }
    const allowed =
      property.name === 'duration'
        ? new Set<string>()
        : new Set(['value', 'tzid']);
    const parameters = contentLineParameters(property.header);
    if (
      parameters.some((parameter) => !allowed.has(parameter.name)) ||
      (property.name === 'duration' && parameters.length > 0)
    ) {
      throw unsupportedFollowingTimingPatch();
    }
  }
}

function assertFollowingMasterStatus(
  master: ICAL.Component,
  rawProperties: RawVeventProperty[],
): void {
  const rawStatuses = rawProperties.filter(
    (property) => property.name === 'status',
  );
  const parsedStatuses = master.getAllProperties('status');
  if (rawStatuses.length !== parsedStatuses.length || rawStatuses.length > 1) {
    throw unsupportedFollowingTimingPatch();
  }
  if (rawStatuses.length === 0) {
    return;
  }

  const status = rawStatuses[0];
  const value = status.value.toUpperCase();
  if (
    contentLineParameters(status.header).length > 0 ||
    !['CONFIRMED', 'TENTATIVE'].includes(value)
  ) {
    throw unsupportedFollowingTimingPatch();
  }
}

function followingComponentShape(component: ICAL.Component): string {
  const clone = ICAL.Component.fromString(component.toString());
  for (const property of [
    'rrule',
    'rdate',
    'exdate',
    'exrule',
    'recurrence-id',
    'dtstart',
    'dtend',
    'duration',
    'dtstamp',
    'last-modified',
    'sequence',
  ]) {
    clone.removeAllProperties(property);
  }
  return JSON.stringify(clone.toJSON());
}

function rawVeventByteLength(
  source: string,
  veventIndex: number,
): number | undefined {
  const lines = readContentLines(source);
  const ranges = findVeventRanges(lines);
  const range = ranges?.[veventIndex];
  if (!range) {
    return undefined;
  }
  const physical = lines
    .slice(range.start, range.end + 1)
    .flatMap((line) => line.physicalLines);
  // CRLF is the largest common iCalendar line separator; this intentionally
  // overestimates LF and CR resources for the pre-clone guard.
  return (
    physical.reduce(
      (total, line) => total + Buffer.byteLength(line, 'utf8'),
      0,
    ) +
    physical.length * 2
  );
}

function appendVeventsBeforeCalendarEnd(
  source: string,
  components: ICAL.Component[],
): string {
  const endMarker = source.toUpperCase().lastIndexOf('END:VCALENDAR');
  if (endMarker < 0) {
    throw unsupportedFollowingTimingPatch();
  }
  const lineFeeds = [
    source.lastIndexOf('\n', endMarker),
    source.lastIndexOf('\r', endMarker),
  ];
  const previousLineBreak = Math.max(...lineFeeds);
  const insertion = previousLineBreak < 0 ? 0 : previousLineBreak + 1;
  const newline = source.includes('\r\n')
    ? '\r\n'
    : source.includes('\r')
      ? '\r'
      : '\n';
  const serialized = components
    .map((component) =>
      component
        .toString()
        .split(/\r\n|\n|\r/)
        .filter(
          (line, index, lines) => !(line === '' && index === lines.length - 1),
        )
        .join(newline),
    )
    .join(newline);
  return `${source.slice(0, insertion)}${serialized}${newline}${source.slice(insertion)}`;
}

function parseContentLine(
  line: string,
): { name: string; header: string; value: string } | undefined {
  const colonIndex = contentLineColonIndex(line);
  if (colonIndex < 0) {
    return undefined;
  }

  const header = line.slice(0, colonIndex);
  const separator = header.indexOf(';');
  const name = (separator < 0 ? header : header.slice(0, separator))
    .trim()
    .toLowerCase();
  return name ? { name, header, value: line.slice(colonIndex + 1) } : undefined;
}

function contentLineColonIndex(line: string): number {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"' && line[index - 1] !== '^') {
      quoted = !quoted;
    } else if (line[index] === ':' && !quoted) {
      return index;
    }
  }
  return -1;
}

function contentLinePropertyName(line: string): string | undefined {
  return parseContentLine(line)?.name;
}

function calendarParameterValue(
  header: string,
  parameterName: string,
): string | undefined {
  const parameters = header.split(';').slice(1);
  const parameter = parameters.find(
    (item) => item.split('=', 1)[0].trim().toLowerCase() === parameterName,
  );
  return parameter?.includes('=')
    ? parameter.slice(parameter.indexOf('=') + 1).replace(/^"|"$/g, '')
    : undefined;
}

function hasCalendarParameter(header: string, parameterName: string): boolean {
  return header
    .split(';')
    .slice(1)
    .some(
      (item) => item.split('=', 1)[0].trim().toLowerCase() === parameterName,
    );
}

function isRevisionPropertyName(
  name: string,
): name is RawRevisionProperty['name'] {
  return (
    name === 'dtstamp' ||
    name === 'created' ||
    name === 'last-modified' ||
    name === 'sequence'
  );
}

function compactUtcTimestampToIso(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(
    6,
    8,
  )}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
}

function isValidCompactUtcDateTime(value: string): boolean {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) {
    return false;
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = [
    31,
    isGregorianLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];

  return (
    daysInMonth !== undefined &&
    day >= 1 &&
    day <= daysInMonth &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  );
}

function isGregorianLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function inspectUtcTimestamp(
  component: ICAL.Component,
  name: 'dtstamp' | 'created' | 'last-modified',
): RevisionPropertyState<string> {
  const properties = component.getAllProperties(name);
  if (properties.length === 0) {
    return { kind: 'missing' };
  }
  if (properties.length !== 1) {
    return { kind: 'invalid' };
  }

  const property = properties[0];
  const value = property.getFirstValue();
  const tzid = property.getFirstParameter('tzid');
  if (
    !(value instanceof ICAL.Time) ||
    value.isDate ||
    value.zone !== ICAL.Timezone.utcTimezone ||
    (tzid !== undefined && tzid !== null) ||
    !/^\d{8}T\d{6}Z$/.test(value.toICALString())
  ) {
    return { kind: 'invalid' };
  }

  return { kind: 'valid', value: `${formatLocalDateTime(value)}Z` };
}

function inspectSequence(
  vevent: ICAL.Component,
): RevisionPropertyState<number> {
  const properties = vevent.getAllProperties('sequence');
  if (properties.length === 0) {
    return { kind: 'missing' };
  }
  if (properties.length !== 1) {
    return { kind: 'invalid' };
  }

  const value = properties[0].getFirstValue();
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_ICALENDAR_SEQUENCE
  ) {
    return { kind: 'valid', value };
  }

  if (typeof value === 'string' && /^\+?\d+$/.test(value)) {
    const parsed = Number(value);
    if (
      Number.isSafeInteger(parsed) &&
      parsed >= 0 &&
      parsed <= MAX_ICALENDAR_SEQUENCE
    ) {
      return { kind: 'valid', value: parsed };
    }
  }

  return { kind: 'invalid' };
}

function setInitialRevisionMetadata(vevent: ICAL.Component, now: Date): void {
  setUtcTimestamp(vevent, 'dtstamp', now);
  setUtcTimestamp(vevent, 'created', now);
  setUtcTimestamp(vevent, 'last-modified', now);
  vevent.updatePropertyWithValue('sequence', 0);
}

function updateRevisionMetadata(
  vevent: ICAL.Component,
  now: Date,
  sourceProperties?: RawRevisionProperty[],
): boolean {
  const sequence = inspectSequence(vevent);
  const dtstamp = inspectUtcTimestamp(vevent, 'dtstamp');
  const lastModified = inspectUtcTimestamp(vevent, 'last-modified');
  if (
    sequence.kind === 'invalid' ||
    dtstamp.kind === 'invalid' ||
    lastModified.kind === 'invalid'
  ) {
    return false;
  }
  if (
    sourceProperties &&
    (!revisionStatesAgree(inspectRawSequence(sourceProperties), sequence) ||
      !revisionStatesAgree(
        inspectRawUtcTimestamp(sourceProperties, 'dtstamp'),
        dtstamp,
      ) ||
      !revisionStatesAgree(
        inspectRawUtcTimestamp(sourceProperties, 'last-modified'),
        lastModified,
      ))
  ) {
    return false;
  }

  const previousSequence = sequence.kind === 'valid' ? sequence.value : 0;
  const nextSequence = previousSequence + 1;
  if (
    !Number.isSafeInteger(nextSequence) ||
    nextSequence > MAX_ICALENDAR_SEQUENCE
  ) {
    return false;
  }

  setUtcTimestamp(vevent, 'dtstamp', now);
  setUtcTimestamp(vevent, 'last-modified', now);
  vevent.updatePropertyWithValue('sequence', nextSequence);
  return true;
}

/** Parsed normalization must never turn malformed raw metadata into absence. */
function revisionStatesAgree<T extends string | number>(
  source: RevisionPropertyState<T>,
  parsed: RevisionPropertyState<T>,
): boolean {
  if (source.kind === 'missing') return parsed.kind === 'missing';
  return (
    source.kind === 'valid' &&
    parsed.kind === 'valid' &&
    source.value === parsed.value
  );
}

function setUtcTimestamp(
  vevent: ICAL.Component,
  name: 'dtstamp' | 'created' | 'last-modified',
  value: Date,
): void {
  vevent.updatePropertyWithValue(
    name,
    ICAL.Time.fromDateTimeString(toICalendarUtcDateTime(value)),
  );
}

function toICalendarUtcDateTime(value: Date): string {
  const iso = value.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(iso)) {
    throw new RangeError(
      'Timestamp year must be in the four-digit RFC 5545 range',
    );
  }

  return `${iso.slice(0, 19)}Z`;
}

function hasOwn(
  value: CalendarEventPatch,
  key: keyof CalendarEventPatch,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function setTextProperty(
  component: ICAL.Component,
  name: string,
  value: string,
): void {
  component.updatePropertyWithValue(name, value);
}

function setOptionalProperty(
  component: ICAL.Component,
  name: string,
  value: string | number | undefined,
): void {
  if (value === undefined) {
    component.removeAllProperties(name);
  } else {
    component.updatePropertyWithValue(name, value);
  }
}

function setCategories(
  component: ICAL.Component,
  categories: string[] | undefined,
): void {
  component.removeAllProperties('categories');

  if (!categories || categories.length === 0) {
    return;
  }

  const property = new ICAL.Property('categories');
  property.setValues(categories);
  component.addProperty(property);
}

function setTiming(
  component: ICAL.Component,
  timing: CalendarEventTiming,
): void {
  if (timing.type === 'all-day') {
    setTimeProperty(
      component,
      'dtstart',
      ICAL.Time.fromDateString(timing.startDate),
    );
    setTimeProperty(
      component,
      'dtend',
      ICAL.Time.fromDateString(timing.endDate),
    );
    return;
  }

  setTimeProperty(
    component,
    'dtstart',
    timedValueForEventEndpoint(timing.start),
    timing.start.type === 'zoned' ? timing.start.timezone : undefined,
  );
  setTimeProperty(
    component,
    'dtend',
    timedValueForEventEndpoint(timing.end),
    timing.end.type === 'zoned' ? timing.end.timezone : undefined,
  );
}

function timedValueForEventEndpoint(
  value: CalendarEventTimedDateTime,
): ICAL.Time {
  return value.type === 'floating'
    ? ICAL.Time.fromDateTimeString(normalizeLocalDateTime(value.local))
    : timedValue(value.local, value.timezone);
}

function setTimeProperty(
  component: ICAL.Component,
  name: string,
  value: ICAL.Time,
  timezone?: string,
): void {
  let property = component.getFirstProperty(name);

  if (!property) {
    property = new ICAL.Property(name);
    component.addProperty(property);
  }

  property.setValue(value);

  if (value.isDate || timezone === undefined || timezone === 'UTC') {
    property.removeParameter('tzid');
  } else {
    property.setParameter('tzid', timezone);
  }
}

function timedValue(local: string, timezone: string): ICAL.Time {
  const normalized = normalizeLocalDateTime(local);
  return ICAL.Time.fromDateTimeString(
    timezone === 'UTC' ? `${normalized}Z` : normalized,
  );
}

function normalizeLocalDateTime(value: string): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/.exec(
      value,
    );

  if (!match) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      `Invalid local date-time: ${value}`,
    );
  }

  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${
    match[6] ?? '00'
  }`;
}
