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

const REMINDER_DELIVERY_SNAPSHOT_MAX_COUNT = 2;
const REMINDER_DELIVERY_SNAPSHOT_FIELDS = [
  'count',
  'attemptCount',
  'deliveryStateSent',
  'deliveryClaimClear',
  'configurationCount',
];

export function isReminderDeliverySnapshot(details) {
  const fields = Object.keys(details ?? {});
  const hasStageMetadata =
    fields.includes('phase') || fields.includes('status');
  return (
    details !== null &&
    typeof details === 'object' &&
    !Array.isArray(details) &&
    fields.length ===
      REMINDER_DELIVERY_SNAPSHOT_FIELDS.length + (hasStageMetadata ? 2 : 0) &&
    REMINDER_DELIVERY_SNAPSHOT_FIELDS.every((field) =>
      fields.includes(field),
    ) &&
    (!hasStageMetadata ||
      (details.phase === 'reminder-delivery-snapshot' &&
        details.status === 'passed')) &&
    Number.isSafeInteger(details.count) &&
    details.count >= 1 &&
    details.count <= REMINDER_DELIVERY_SNAPSHOT_MAX_COUNT &&
    Number.isSafeInteger(details.attemptCount) &&
    details.attemptCount >= details.count &&
    details.deliveryStateSent === true &&
    details.deliveryClaimClear === true &&
    details.configurationCount === details.count
  );
}

export function createReminderDeliverySnapshot(details) {
  if (!isReminderDeliverySnapshot(details)) {
    throw new TypeError('Invalid reminder delivery snapshot');
  }
  const snapshot = Object.fromEntries(
    REMINDER_DELIVERY_SNAPSHOT_FIELDS.map((field) => [field, details[field]]),
  );
  return snapshot;
}
