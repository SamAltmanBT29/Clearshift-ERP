import { z } from 'zod';

/**
 * Standard ClearShift Transactional Event Envelope Schema (PLT-04 / PLT-09)
 * Used across Outbox, Redis Streams relay, and idempotent consumers.
 */
export const EventEnvelopeSchema = z.object({
  event_id: z.string().uuid({ message: 'event_id must be a valid UUID' }),
  event_type: z.string().min(1, { message: 'event_type is required' }),
  schema_version: z.string().min(1, { message: 'schema_version is required' }).default('1.0.0'),
  occurred_at: z.string().datetime({ message: 'occurred_at must be an ISO 8601 datetime string' }),
  correlation_id: z.string().min(1, { message: 'correlation_id is required' }),
  producer: z.string().min(1, { message: 'producer module identifier is required' }),
  entity_type: z.string().min(1, { message: 'entity_type is required' }),
  entity_id: z.string().min(1, { message: 'entity_id is required' }),
  payload: z.unknown(),
  metadata: z.record(z.unknown()).optional(),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

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
  event_id: string;
  event_type: string;
  schema_version?: string;
  occurred_at?: string;
  correlation_id: string;
  producer: string;
  entity_type: string;
  entity_id: string;
  payload: T;
  metadata?: Record<string, unknown>;
}): EventEnvelope {
  return {
    event_id: params.event_id,
    event_type: params.event_type,
    schema_version: params.schema_version ?? '1.0.0',
    occurred_at: params.occurred_at ?? new Date().toISOString(),
    correlation_id: params.correlation_id,
    producer: params.producer,
    entity_type: params.entity_type,
    entity_id: params.entity_id,
    payload: params.payload,
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}
