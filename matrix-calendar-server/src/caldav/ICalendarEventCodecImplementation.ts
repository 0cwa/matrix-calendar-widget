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
  CalendarEventAttachmentInput,
  CalendarEventAttachmentPatch,
  CalendarEventAttachmentValidationError,
  CalendarEventConferenceInput,
  CalendarEventConferencePatch,
  CalendarEventConferenceValidationError,
  CalendarEventDateTime,
  CalendarEventDisplayAlarmInput,
  CalendarEventFollowingTimingWrite,
  CalendarEventId,
  CalendarEventInput,
  CalendarEventOccurrenceTextField,
  CalendarEventOccurrenceWrite,
  CalendarEventPatch,
  CalendarEventRecurrenceOverride,
  CalendarEventRecurrenceTiming,
  CalendarEventTimedDateTime,
  CalendarEventTiming,
  CalendarId,
  calendarEventFollowingTimingOverrides,
  calendarEventRecurrenceIdentity,
  isCalendarEventAlarmRemoval,
  isCalendarTimezoneSupported,
  isSupportedCalendarEventOccurrenceExclusion,
  normalizeCalendarEventAttachmentInput,
  normalizeCalendarEventAttachmentPatch,
  normalizeCalendarEventConferenceInput,
  normalizeCalendarEventConferencePatch,
  parseSupportedCalendarEventRecurrenceRule,
  projectCalendarEventOccurrenceByRecurrenceId,
  validateCalendarEventInputAttachment,
  validateCalendarEventInputConference,
  validateCalendarEventPatchAttachment,
  validateCalendarEventPatchConference,
  validateCalendarEventPatchOccurrence,
} from '@matrix-calendar-widget/calendar';
import ICAL from 'ical.js';
import {
  displayAlarmTriggersEqual,
  readResourceAlarm,
  setDisplayAlarm,
  validateDisplayAlarm,
} from './ICalendarAlarm';
import {
  hasAmbiguousAttachmentSource,
  planAttachmentPatch,
  readAttachmentSourceState,
  setAttachmentProperty,
} from './ICalendarAttachments';
import {
  ICalendarEventCodecError,
  unsupportedAlarmPatch,
  unsupportedAttachmentPatch,
  unsupportedConferencePatch,
  unsupportedRecurrencePatch,
} from './ICalendarCodecError';
import {
  conferencePatchIsNoOp,
  hasAmbiguousConferenceSource,
  rawConferencePropertiesAfterPatch,
  readConferenceSourceState,
  setConferenceProperty,
} from './ICalendarConference';
import {
  contentLineParameters,
  contentLinePropertyName,
  readContentLines,
  type ICalendarContentLine,
} from './ICalendarContentLine';
import {
  numberValue,
  readCategories,
  readStatus,
  readTransparency,
  textValue,
} from './ICalendarEventFields';
import {
  findMasterVeventRange,
  findVeventRanges,
  isRevisionPropertyName,
  rawVeventAlarmProperties,
  rawVeventAttachmentProperties,
  rawVeventBlocks,
  rawVeventConferenceProperties,
  rawVeventTextProperties,
  readMasterRevisionProperties,
  readRawVeventProperties,
  readVeventRevisionProperties,
  type RawVeventProperty,
} from './ICalendarRawRead';
import {
  occurrenceTextOperationMap,
  restoreOccurrenceTextProperties,
  restoreOccurrenceUntouchedProperties,
  restoreUntouchedVeventBlocks,
  restoreVeventAlarmComponents,
  restoreVeventAttachmentProperties,
  restoreVeventConferenceProperties,
  type OccurrenceTextOperationMap,
} from './ICalendarRawRestore';
import {
  findMasterEvent,
  readRecurrence,
  readUnsupportedRecurrence,
} from './ICalendarRecurrenceRead';
import {
  applyOccurrenceExdate,
  applyPeriodRdate,
  applyPeriodRdateReplacement,
  applyPointRdate,
  assertOccurrenceExdateCanBeEdited,
  assertPeriodRdateCanBeAdded,
  assertPeriodRdateCanBeRemoved,
  assertPeriodRdateCanBeReplaced,
  assertPointRdateCanBeEdited,
  assertRdatePropertiesCanBeEdited,
  assertSimpleRecurrenceCanBeEdited,
  canonicalizeRecurrenceRule,
  followingResourceTooLarge,
  recurrenceDateTimeFromUnknown,
  recurrenceIdAsIcalTime,
  recurrenceTimingFromUnknown,
  recurrenceWriteFromUnknown,
  sameOccurrenceTiming,
  setOccurrenceTiming,
  setRecurrenceRule,
  timingStartAsDateTime,
  unsupportedFollowingTimingPatch,
  unsupportedOccurrenceTimingPatch,
  validateExistingOverrideTiming,
  validateOccurrenceRecurrenceSource,
  validateOccurrenceTiming,
  validateRawOccurrenceTimingProperties,
  validateRecurrenceRule,
} from './ICalendarRecurrenceWrite';
import {
  readCalendarEventRevision,
  readUpdatedCalendarEventRevision,
  setInitialRevisionMetadata,
  updateRevisionMetadata,
  type RawRevisionProperty,
} from './ICalendarRevision';
import { hasUnsupportedTimezoneRules } from './ICalendarTimezoneProjectionSafety';
import { readDateTimeProperty, readTiming } from './ICalendarTiming';
import {
  addNewEventTimezoneDefinitions,
  setCategories,
  setOptionalProperty,
  setTextProperty,
  setTiming,
} from './ICalendarTimingWrite';
import { readCalendarLinks } from './readCalendarLinks';
export {
  ICalendarEventCodecError,
  type ICalendarEventCodecErrorCode,
} from './ICalendarCodecError';

const systemClock = (): Date => new Date();
/** Fixed cap for finite suffix materialization before cloning or transport. */
export const MAX_FOLLOWING_RESOURCE_BYTES = 4 * 1024 * 1024;

export type EncodedICalendarEvent = {
  event: CalendarEvent;
  icalendar: string;
};

export type OccurrenceTimingOverrideWrite =
  | CalendarEventOccurrenceWrite
  | {
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
    try {
      validateCalendarEventPatchOccurrence(patch);
    } catch {
      throw unsupportedOccurrenceTimingPatch();
    }
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
        readResourceAlarm(calendar, vevent, () =>
          rawVeventAlarmProperties(this.sourceICalendar),
        ).unsupported)
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
    const alarmWriteIsNoOp =
      hasAlarmPatch &&
      patch.alarm !== undefined &&
      !isCalendarEventAlarmRemoval(patch.alarm) &&
      this.event.alarm !== undefined &&
      displayAlarmTriggersEqual(this.event.alarm.trigger, patch.alarm.trigger);
    const writtenAlarmUid = hasAlarmPatch
      ? setDisplayAlarm(
          calendar,
          vevent,
          patch.alarm,
          patch.title ?? this.event.title,
          this.event.alarm,
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
        ? readAttachmentSourceState(vevent, attachmentWritePlan.nextProperties)
        : undefined;
    const attachmentProjection = updatedAttachmentState?.projectable
      ? updatedAttachmentState.editable
          .filter(
            ({ url }) => !updatedAttachmentState.opaqueUriUrls.includes(url),
          )
          .map(({ url }) => ({ url }))
      : undefined;
    const {
      alarm: alarmPatch,
      conference: _conferencePatch,
      attachment: _attachmentPatch,
      ...eventPatch
    } = patch;
    const {
      attachments: _sourceAttachments,
      ...eventWithoutAttachmentProjection
    } = this.event;
    const event: CalendarEvent = {
      ...(attachmentWritePlan ? eventWithoutAttachmentProjection : this.event),
      ...eventPatch,
      title: patch.title ?? this.event.title,
      timing: patch.timing ?? this.event.timing,
      externalLinks: readCalendarLinks(vevent),
      ...(attachmentWritePlan && attachmentProjection?.length
        ? { attachments: attachmentProjection }
        : {}),
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
    if (attachmentWritePlan) {
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
    const withRawAttachments = restoreVeventAttachmentProperties(
      withRawConference,
      attachmentPropertiesByOutputEvent,
      forceAttachmentReplacement,
    );
    const icalendar =
      hasAlarmPatch && !alarmWriteIsNoOp
        ? withRawAttachments
        : restoreVeventAlarmComponents(
            withRawAttachments,
            this.sourceICalendar,
          );
    if (hasAlarmPatch && explicitLinkPatchesAreNoOp && !veventContentChanged) {
      return { event: this.event, icalendar: this.sourceICalendar };
    }
    return { event, icalendar };
  }

  private applyOccurrencePatch(
    operation: OccurrenceTimingOverrideWrite & { viewerTimezone: string },
  ): EncodedICalendarEvent {
    const writeOperation: CalendarEventOccurrenceWrite =
      'action' in operation
        ? operation
        : {
            action: 'set-timing',
            recurrenceId: operation.recurrenceId,
            timing: operation.timing,
            viewerTimezone: operation.viewerTimezone,
          };
    const result = applyOccurrenceTimingOverride(
      this.calendar,
      this.event,
      writeOperation,
      {
        source: this.sourceICalendar,
        now: this.clock(),
        viewerTimezone: writeOperation.viewerTimezone,
        listProjectionDiagnostic: this.listProjectionDiagnostic,
      },
    );
    if (result.noOp) {
      return { event: this.event, icalendar: this.sourceICalendar };
    }
    const calendar = ICAL.Component.fromString(this.calendar.toString());
    const targetIdentity = calendarEventRecurrenceIdentity(
      writeOperation.recurrenceId,
    );
    const components = calendar.getAllSubcomponents();
    const sourceRevisionPropertiesByEvent = readVeventRevisionProperties(
      this.sourceICalendar,
    );
    const sourceRawPropertiesByEvent = readRawVeventProperties(
      this.sourceICalendar,
    );
    const sourceVeventBlocksByEvent = rawVeventBlocks(this.sourceICalendar);
    const originalEvents = calendar.getAllSubcomponents('vevent');
    const sourceConferencePropertiesByEvent = rawVeventConferenceProperties(
      this.sourceICalendar,
    );
    const sourceAttachmentPropertiesByEvent = rawVeventAttachmentProperties(
      this.sourceICalendar,
    );
    const sourceTextPropertiesByEvent = rawVeventTextProperties(
      this.sourceICalendar,
    );
    const sourceMasterEvent = findMasterEvent(calendar, this.event.uid);
    const sourceMasterIndex = sourceMasterEvent
      ? originalEvents.indexOf(sourceMasterEvent)
      : -1;
    if (
      !sourceRevisionPropertiesByEvent ||
      sourceRevisionPropertiesByEvent.length !== originalEvents.length ||
      !sourceRawPropertiesByEvent ||
      sourceRawPropertiesByEvent.length !== originalEvents.length ||
      sourceVeventBlocksByEvent.length !== originalEvents.length ||
      sourceConferencePropertiesByEvent.length !== originalEvents.length ||
      sourceAttachmentPropertiesByEvent.length !== originalEvents.length ||
      sourceTextPropertiesByEvent.length !== originalEvents.length ||
      sourceMasterIndex < 0
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    const outputComponents: ICAL.Component[] = [];
    const outputRevisionProperties: RawRevisionProperty[][] = [];
    const outputConferenceProperties: ICalendarContentLine[][] = [];
    const outputAttachmentProperties: ICalendarContentLine[][] = [];
    const outputTextProperties: RawVeventProperty[][] = [];
    const outputRawProperties: RawVeventProperty[][] = [];
    const outputVeventBlocks: ICalendarContentLine[][] = [];
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
        outputTextProperties.push(
          result.action === 'created'
            ? []
            : sourceTextPropertiesByEvent[originalEventIndex],
        );
        outputRawProperties.push(
          sourceRawPropertiesByEvent[originalEventIndex],
        );
        outputVeventBlocks.push(sourceVeventBlocksByEvent[originalEventIndex]);
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
        outputTextProperties.push(
          sourceTextPropertiesByEvent[originalEventIndex],
        );
        outputRawProperties.push(
          sourceRawPropertiesByEvent[originalEventIndex],
        );
        outputVeventBlocks.push(sourceVeventBlocksByEvent[originalEventIndex]);
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
      outputTextProperties.push(sourceTextPropertiesByEvent[sourceMasterIndex]);
      outputRawProperties.push(sourceRawPropertiesByEvent[sourceMasterIndex]);
      outputVeventBlocks.push(sourceVeventBlocksByEvent[sourceMasterIndex]);
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
    icalendar = restoreOccurrenceTextProperties(
      icalendar,
      outputTextProperties,
      targetEventIndex,
      writeOperation,
      result.action === 'created',
    );
    icalendar = restoreOccurrenceUntouchedProperties(
      icalendar,
      outputRawProperties,
      targetEventIndex,
      writeOperation,
      result.action === 'created',
    );
    icalendar = restoreUntouchedVeventBlocks(
      icalendar,
      outputVeventBlocks,
      targetEventIndex,
    );
    icalendar = restoreVeventAttachmentProperties(
      icalendar,
      outputAttachmentProperties,
    );
    icalendar = restoreVeventAlarmComponents(icalendar, this.sourceICalendar);

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
function validateOccurrenceTextOperations(
  component: ICAL.Component,
  rawProperties: RawVeventProperty[],
  operations: OccurrenceTextOperationMap,
): void {
  const propertyNames: Record<CalendarEventOccurrenceTextField, string> = {
    title: 'summary',
    description: 'description',
    location: 'location',
  };
  for (const field of Object.keys(
    operations,
  ) as CalendarEventOccurrenceTextField[]) {
    const name = propertyNames[field];
    const raw = rawProperties.filter((property) => property.name === name);
    const parsed = component.getAllProperties(name);
    if (raw.length !== parsed.length || raw.length > 1) {
      throw unsupportedOccurrenceTimingPatch();
    }
    if (raw.length === 0) {
      continue;
    }
    const parameters = contentLineParameters(raw[0].header);
    let values: ReturnType<ICAL.Property['getValues']>;
    try {
      values = parsed[0].getValues();
    } catch {
      throw unsupportedOccurrenceTimingPatch();
    }
    if (
      parameters.length > 0 ||
      parsed[0].type !== 'text' ||
      values.length !== 1 ||
      typeof values[0] !== 'string'
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
  }
}

function occurrenceTextOperationIsNoOp(
  operation: CalendarEventOccurrenceWrite,
  existing: CalendarEventRecurrenceOverride | undefined,
): boolean {
  if (operation.action !== 'set-fields') {
    return true;
  }
  const operations = occurrenceTextOperationMap(operation);
  for (const field of Object.keys(
    operations,
  ) as CalendarEventOccurrenceTextField[]) {
    const textOperation = operations[field]!;
    const hasExplicitValue =
      existing !== undefined &&
      Object.prototype.hasOwnProperty.call(existing, field);
    if (textOperation.action === 'inherit') {
      if (hasExplicitValue) {
        return false;
      }
    } else if (!hasExplicitValue || existing?.[field] !== textOperation.value) {
      // An explicit value equal to the master still changes source presence.
      return false;
    }
  }
  return true;
}

function applyOccurrenceTextOperations(
  component: ICAL.Component,
  operations: OccurrenceTextOperationMap,
  existing: CalendarEventRecurrenceOverride | undefined,
): void {
  const propertyNames: Record<CalendarEventOccurrenceTextField, string> = {
    title: 'summary',
    description: 'description',
    location: 'location',
  };
  for (const field of Object.keys(
    operations,
  ) as CalendarEventOccurrenceTextField[]) {
    const operation = operations[field]!;
    const property = propertyNames[field];
    if (operation.action === 'inherit') {
      if (existing && !Object.prototype.hasOwnProperty.call(existing, field)) {
        continue;
      }
      component.removeAllProperties(property);
    } else {
      if (
        existing &&
        Object.prototype.hasOwnProperty.call(existing, field) &&
        existing[field] === operation.value
      ) {
        continue;
      }
      setTextProperty(component, property, operation.value);
    }
  }
}

function recurrenceTimingFromCalendarEventTiming(
  timing: CalendarEventTiming,
): CalendarEventRecurrenceTiming {
  if (timing.type === 'all-day') {
    return {
      type: 'end',
      start: { type: 'date', value: timing.startDate },
      end: { type: 'date', value: timing.endDate },
    };
  }
  const convert = (
    endpoint: CalendarEventTimedDateTime,
  ): CalendarEventDateTime =>
    endpoint.type === 'floating'
      ? { type: 'floating-date-time', value: endpoint.local }
      : {
          type: 'date-time',
          value: { local: endpoint.local, timezone: endpoint.timezone },
        };
  return {
    type: 'end',
    start: convert(timing.start),
    end: convert(timing.end),
  };
}

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
  const writeOperation: CalendarEventOccurrenceWrite =
    'action' in operation
      ? operation
      : {
          action: 'set-timing',
          recurrenceId: operation.recurrenceId,
          timing: operation.timing,
          viewerTimezone: options.viewerTimezone,
        };
  const recurrenceId = recurrenceDateTimeFromUnknown(
    writeOperation.recurrenceId,
  );
  const timing = writeOperation.timing
    ? recurrenceTimingFromUnknown(writeOperation.timing)
    : undefined;
  const textOperations = occurrenceTextOperationMap(writeOperation);
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
  const existing = overridesByIdentity.get(targetIdentity);
  if (
    existing?.getFirstPropertyValue('status')?.toString().toUpperCase() ===
    'CANCELLED'
  ) {
    throw unsupportedOccurrenceTimingPatch();
  }
  const sourceComponent = existing ?? master;
  const sourceIndex = events.indexOf(sourceComponent);
  const sourceRevisionProperties = sourceRevisionPropertiesByEvent[sourceIndex];
  const existingTiming = existing
    ? validateExistingOverrideTiming(existing)
    : undefined;
  const overrideSnapshot = sourceEvent.recurrence?.overrides?.find(
    (override) =>
      calendarEventRecurrenceIdentity(override.recurrenceId) === targetIdentity,
  );
  const rawTextProperties = rawEventProperties[sourceIndex] ?? [];
  if (existing && Object.keys(textOperations).length > 0) {
    validateOccurrenceTextOperations(
      existing,
      rawTextProperties,
      textOperations,
    );
  }

  const projectedOriginal = existing
    ? undefined
    : projectCalendarEventOccurrenceByRecurrenceId(
        sourceEvent,
        recurrenceId,
        options.viewerTimezone,
      );
  const defaultTiming =
    !existing && writeOperation.action === 'set-fields' && !timing
      ? projectedOriginal
        ? recurrenceTimingFromCalendarEventTiming(
            projectedOriginal.event.timing,
          )
        : undefined
      : undefined;
  const timingToApply = timing ?? defaultTiming;
  if (timingToApply && (!existing || timing)) {
    try {
      validateOccurrenceTiming(
        timingToApply,
        sourceEvent,
        options.viewerTimezone,
      );
    } catch {
      throw unsupportedOccurrenceTimingPatch();
    }
  }
  if (!existing && writeOperation.action === 'set-fields' && !timingToApply) {
    throw unsupportedOccurrenceTimingPatch();
  }

  const noTextChange = occurrenceTextOperationIsNoOp(
    writeOperation,
    overrideSnapshot,
  );
  const timingIsNoOp =
    !timing ||
    (existing
      ? Boolean(existingTiming && sameOccurrenceTiming(existingTiming, timing))
      : Boolean(
          projectedOriginal &&
          sameOccurrenceTiming(
            recurrenceTimingFromCalendarEventTiming(
              projectedOriginal.event.timing,
            ),
            timing,
          ),
        ));
  if (noTextChange && timingIsNoOp) {
    return {
      component: existing ?? master,
      action: existing ? 'updated' : 'created',
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
    if (writeOperation.action === 'set-fields') {
      component.removeAllProperties('summary');
      component.removeAllProperties('description');
      component.removeAllProperties('location');
    }
    const recurrenceIdProperty = new ICAL.Property('recurrence-id');
    const recurrenceIdIcal = recurrenceIdAsIcalTime(recurrenceId);
    recurrenceIdProperty.setValue(recurrenceIdIcal.value);
    if (recurrenceIdIcal.timezone) {
      recurrenceIdProperty.setParameter('tzid', recurrenceIdIcal.timezone);
    }
    component.addProperty(recurrenceIdProperty);
  }

  const eventSourceBeforePatch = component.toString();
  if (timingToApply && (!existing || timing)) {
    setOccurrenceTiming(component, timingToApply);
  }
  if (Object.keys(textOperations).length > 0) {
    applyOccurrenceTextOperations(component, textOperations, overrideSnapshot);
  }
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
    addNewEventTimezoneDefinitions(calendar, input.timing);

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
    const alarmState = readResourceAlarm(calendar, vevent, () =>
      rawVeventAlarmProperties(source),
    );
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
    const authorableAttachments = attachmentState.projectable
      ? attachmentState.editable.filter(
          ({ url }) => !attachmentState.opaqueUriUrls.includes(url),
        )
      : [];
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
      ...(authorableAttachments.length > 0
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

function hasOwn(
  value: CalendarEventPatch,
  key: keyof CalendarEventPatch,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
