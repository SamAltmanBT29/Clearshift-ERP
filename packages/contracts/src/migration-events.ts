/**
 * ClearShift Migration Kit — Batch & Migration Event Contracts (KIT-13)
 */

import { z } from 'zod';
import {
  createEventEnvelopeSchema,
  createEventEnvelope,
  type EventEnvelope,
} from './event-envelope.js';

export const KIT_EVENT_TYPES = {
  BATCH_EXTRACTED: 'batch.extracted',
  BATCH_PROFILED: 'batch.profiled',
  BATCH_CLEANED: 'batch.cleaned',
  BATCH_MAPPED: 'batch.mapped',
  BATCH_LOADED: 'batch.loaded',
  BATCH_VALIDATED: 'batch.validated',
  BATCH_FAILED: 'batch.failed',
  CONTACT_MERGED: 'contact.merged',
} as const;

export type KitEventType = (typeof KIT_EVENT_TYPES)[keyof typeof KIT_EVENT_TYPES];

export const BATCH_EVENT_TYPES = KIT_EVENT_TYPES;
export const MIGRATION_EVENT_TYPES = KIT_EVENT_TYPES;
export const MIGRATION_KIT_EVENT_TYPES = KIT_EVENT_TYPES;

export function stableMigrationEventId(key: string): string {
  // Browser-safe deterministic UUID-like id (no node:crypto dependency).
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  const base = (hex + hex + hex + hex).slice(0, 32);
  return `${base.slice(0, 8)}-${base.slice(8, 12)}-4${base.slice(13, 16)}-a${base.slice(17, 20)}-${base.slice(20, 32)}`;
}

function makeDual<T>(obj: T): T {
  return obj;
}

export const BatchExtractedPayloadSchema = z
  .object({
    batch_id: z.string().min(1).optional(),
    batchId: z.string().min(1).optional(),
    module: z.string().min(1),
    rows_read: z.number().int().nonnegative().optional(),
    rowsRead: z.number().int().nonnegative().optional(),
  })
  .transform((v) => {
    const batch_id = v.batch_id ?? v.batchId ?? '';
    const rows_read = v.rows_read ?? v.rowsRead ?? 0;
    return { batch_id, batchId: batch_id, module: v.module, rows_read, rowsRead: rows_read };
  })
  .refine((v) => v.batch_id.length > 0, { message: 'batch_id is required' });

export type BatchExtractedPayload = z.infer<typeof BatchExtractedPayloadSchema>;

export const BatchProfiledPayloadSchema = z
  .object({
    batch_id: z.string().min(1).optional(),
    batchId: z.string().min(1).optional(),
    module: z.string().min(1),
    empty_count: z.number().int().nonnegative().optional(),
    emptyCount: z.number().int().nonnegative().optional(),
    invalid_count: z.number().int().nonnegative().optional(),
    invalidCount: z.number().int().nonnegative().optional(),
    duplicate_count: z.number().int().nonnegative().optional(),
    duplicateCount: z.number().int().nonnegative().optional(),
  })
  .transform((v) => {
    const batch_id = v.batch_id ?? v.batchId ?? '';
    const empty_count = v.empty_count ?? v.emptyCount ?? 0;
    const invalid_count = v.invalid_count ?? v.invalidCount ?? 0;
    const duplicate_count = v.duplicate_count ?? v.duplicateCount ?? 0;
    return { batch_id, batchId: batch_id, module: v.module, empty_count, emptyCount: empty_count, invalid_count, invalidCount: invalid_count, duplicate_count, duplicateCount: duplicate_count };
  })
  .refine((v) => v.batch_id.length > 0, { message: 'batch_id is required' });

export type BatchProfiledPayload = z.infer<typeof BatchProfiledPayloadSchema>;

export const BatchCleanedPayloadSchema = z
  .object({
    batch_id: z.string().min(1).optional(),
    batchId: z.string().min(1).optional(),
    cleaned: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  })
  .transform((v) => {
    const batch_id = v.batch_id ?? v.batchId ?? '';
    return { batch_id, batchId: batch_id, cleaned: v.cleaned, rejected: v.rejected };
  })
  .refine((v) => v.batch_id.length > 0, { message: 'batch_id is required' });

export type BatchCleanedPayload = z.infer<typeof BatchCleanedPayloadSchema>;

export const BatchMappedPayloadSchema = z
  .object({
    batch_id: z.string().min(1).optional(),
    batchId: z.string().min(1).optional(),
    mapped: z.number().int().nonnegative(),
    missing_required: z.number().int().nonnegative().optional(),
    missingRequired: z.number().int().nonnegative().optional(),
  })
  .transform((v) => {
    const batch_id = v.batch_id ?? v.batchId ?? '';
    const missing_required = v.missing_required ?? v.missingRequired ?? 0;
    return { batch_id, batchId: batch_id, mapped: v.mapped, missing_required, missingRequired: missing_required };
  })
  .refine((v) => v.batch_id.length > 0, { message: 'batch_id is required' });

export type BatchMappedPayload = z.infer<typeof BatchMappedPayloadSchema>;

export const BatchLoadedPayloadSchema = z
  .object({
    batch_id: z.string().min(1).optional(),
    batchId: z.string().min(1).optional(),
    loaded: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    merged: z.number().int().nonnegative(),
  })
  .transform((v) => {
    const batch_id = v.batch_id ?? v.batchId ?? '';
    return { batch_id, batchId: batch_id, loaded: v.loaded, rejected: v.rejected, merged: v.merged };
  })
  .refine((v) => v.batch_id.length > 0, { message: 'batch_id is required' });

export type BatchLoadedPayload = z.infer<typeof BatchLoadedPayloadSchema>;

export const BatchValidatedPayloadSchema = z
  .object({
    batch_id: z.string().min(1).optional(),
    batchId: z.string().min(1).optional(),
    validation_failures: z.number().int().nonnegative().optional(),
    validationFailures: z.number().int().nonnegative().optional(),
  })
  .transform((v) => {
    const batch_id = v.batch_id ?? v.batchId ?? '';
    const validation_failures = v.validation_failures ?? v.validationFailures ?? 0;
    return { batch_id, batchId: batch_id, validation_failures, validationFailures: validation_failures };
  })
  .refine((v) => v.batch_id.length > 0, { message: 'batch_id is required' });

export type BatchValidatedPayload = z.infer<typeof BatchValidatedPayloadSchema>;

export const BatchFailedPayloadSchema = z
  .object({
    batch_id: z.string().min(1).optional(),
    batchId: z.string().min(1).optional(),
    step: z.string().min(1),
    reason: z.string().min(1),
  })
  .transform((v) => {
    const batch_id = v.batch_id ?? v.batchId ?? '';
    return { batch_id, batchId: batch_id, step: v.step, reason: v.reason };
  })
  .refine((v) => v.batch_id.length > 0, { message: 'batch_id is required' });

export type BatchFailedPayload = z.infer<typeof BatchFailedPayloadSchema>;

export const ContactMergedPayloadSchema = z
  .object({
    contact_id: z.string().min(1).optional(),
    contactId: z.string().min(1).optional(),
    source_id: z.string().min(1).optional(),
    sourceId: z.string().min(1).optional(),
    target_id: z.string().min(1).optional(),
    targetId: z.string().min(1).optional(),
    merged_count: z.number().int().nonnegative().optional(),
    mergedCount: z.number().int().nonnegative().optional(),
    reason: z.string().optional(),
  })
  .transform((v) => {
    const contact_id = v.contact_id ?? v.contactId ?? '';
    const source_id = v.source_id ?? v.sourceId;
    const target_id = v.target_id ?? v.targetId;
    const merged_count = v.merged_count ?? v.mergedCount ?? 1;
    return { contact_id, contactId: contact_id, source_id, sourceId: source_id, target_id, targetId: target_id, merged_count, mergedCount: merged_count, reason: v.reason };
  });

export type ContactMergedPayload = z.infer<typeof ContactMergedPayloadSchema>;

export const BatchExtractedEventSchema = createEventEnvelopeSchema(BatchExtractedPayloadSchema);
export const BatchExtractedEnvelopeSchema = BatchExtractedEventSchema;

export const BatchProfiledEventSchema = createEventEnvelopeSchema(BatchProfiledPayloadSchema);
export const BatchProfiledEnvelopeSchema = BatchProfiledEventSchema;

export const BatchCleanedEventSchema = createEventEnvelopeSchema(BatchCleanedPayloadSchema);
export const BatchCleanedEnvelopeSchema = BatchCleanedEventSchema;

export const BatchMappedEventSchema = createEventEnvelopeSchema(BatchMappedPayloadSchema);
export const BatchMappedEnvelopeSchema = BatchMappedEventSchema;

export const BatchLoadedEventSchema = createEventEnvelopeSchema(BatchLoadedPayloadSchema);
export const BatchLoadedEnvelopeSchema = BatchLoadedEventSchema;

export const BatchValidatedEventSchema = createEventEnvelopeSchema(BatchValidatedPayloadSchema);
export const BatchValidatedEnvelopeSchema = BatchValidatedEventSchema;

export const BatchFailedEventSchema = createEventEnvelopeSchema(BatchFailedPayloadSchema);
export const BatchFailedEnvelopeSchema = BatchFailedEventSchema;

export const ContactMergedEventSchema = createEventEnvelopeSchema(ContactMergedPayloadSchema);
export const ContactMergedEnvelopeSchema = ContactMergedEventSchema;

export function createKitEvent<T>(params: {
  eventId?: string;
  eventType: string;
  correlationId: string;
  producer?: string;
  entityType?: string;
  entityId?: string;
  batchId?: string;
  payload: T;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
  schemaVersion?: string;
}): EventEnvelope {
  const payloadObj = (params.payload ?? {}) as Record<string, unknown>;
  const batchId =
    params.batchId ??
    (typeof payloadObj['batch_id'] === 'string' ? payloadObj['batch_id'] : undefined) ??
    (typeof payloadObj['batchId'] === 'string' ? payloadObj['batchId'] : undefined);

  const isContact = params.eventType === KIT_EVENT_TYPES.CONTACT_MERGED;
  const entityType = params.entityType ?? (isContact ? 'contact' : 'batch');
  const entityId = params.entityId ?? batchId ?? (isContact ? String(payloadObj['contact_id'] ?? payloadObj['contactId'] ?? 'contact') : 'batch');
  const eventId = params.eventId ?? stableMigrationEventId(`${batchId ?? entityId}:${params.eventType}`);

  return createEventEnvelope({
    event_id: eventId,
    event_type: params.eventType,
    schema_version: params.schemaVersion ?? '1.0.0',
    occurred_at: params.occurredAt ?? new Date().toISOString(),
    correlation_id: params.correlationId,
    producer: params.producer ?? 'migration-kit',
    entity_type: entityType,
    entity_id: entityId,
    ...(batchId ? { batch_id: batchId } : {}),
    payload: params.payload,
    ...(params.metadata ? { metadata: params.metadata } : {}),
  });
}

export const createMigrationEvent = createKitEvent;
export const createBatchEvent = createKitEvent;
export const createMigrationKitEvent = createKitEvent;
export const createKitEventEnvelope = createKitEvent;
