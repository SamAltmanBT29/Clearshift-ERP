import { z } from 'zod';

/**
 * Standard ClearShift Transactional Event Envelope Schema (PLT-04 / PLT-09)
 * Used across Outbox, Redis Streams relay, and idempotent consumers.
 */
export const EventEnvelopeSchema = z
  .object({
    event_id: z.string().uuid({ message: 'event_id must be a valid UUID' }),
    event_type: z.string().min(1, { message: 'event_type is required' }),
    schema_version: z.string().min(1, { message: 'schema_version is required' }).default('1.0.0'),
    occurred_at: z.string().datetime({ message: 'occurred_at must be an ISO 8601 datetime string' }),
    correlation_id: z.string().min(1, { message: 'correlation_id is required' }),
    producer: z.string().min(1, { message: 'producer module identifier is required' }),
    entity_type: z.string().min(1, { message: 'entity_type is required' }),
    entity_id: z.string().min(1, { message: 'entity_id is required' }),
    batch_id: z.string().optional(),
    payload: z.unknown(),
    metadata: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema> & {
  id?: string;
  eventType?: string;
  occurredAt?: string;
  correlationId?: string;
  entityType?: string;
  entityId?: string;
  aggregateType?: string;
  aggregateId?: string;
  batchId?: string;
};

/**
 * Browser-safe UUID generation helper without node:crypto dependency
 */
function generateUUID(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Factory for strongly-typed domain event envelopes
 */
export function createEventEnvelopeSchema<T extends z.ZodTypeAny>(payloadSchema: T) {
  return EventEnvelopeSchema.extend({
    payload: payloadSchema,
  });
}

/**
 * Factory helper to construct an EventEnvelope instance
 */
export function createEventEnvelope<T>(params: {
  event_id?: string;
  id?: string;
  event_type?: string;
  eventType?: string;
  schema_version?: string;
  occurred_at?: string;
  occurredAt?: string;
  correlation_id?: string;
  correlationId?: string;
  producer: string;
  entity_type?: string;
  entityType?: string;
  aggregateType?: string;
  entity_id?: string;
  entityId?: string;
  aggregateId?: string;
  batch_id?: string;
  batchId?: string;
  payload: T;
  metadata?: Record<string, unknown>;
}): EventEnvelope {
  const event_id = params.event_id ?? params.id ?? generateUUID();
  const event_type = params.event_type ?? params.eventType ?? '';
  const occurred_at = params.occurred_at ?? params.occurredAt ?? new Date().toISOString();
  const correlation_id = params.correlation_id ?? params.correlationId ?? '';
  const entity_type = params.entity_type ?? params.entityType ?? params.aggregateType ?? '';
  const entity_id = params.entity_id ?? params.entityId ?? params.aggregateId ?? '';
  const batch_id = params.batch_id ?? params.batchId;

  return {
    event_id,
    id: event_id,
    event_type,
    eventType: event_type,
    schema_version: params.schema_version ?? '1.0.0',
    occurred_at,
    occurredAt: occurred_at,
    correlation_id,
    correlationId: correlation_id,
    producer: params.producer,
    entity_type,
    entityType: entity_type,
    aggregateType: entity_type,
    entity_id,
    entityId: entity_id,
    aggregateId: entity_id,
    ...(batch_id ? { batch_id, batchId: batch_id } : {}),
    payload: params.payload,
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}
