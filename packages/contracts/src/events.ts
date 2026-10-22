import { z } from 'zod';
import { randomUUID } from 'crypto';

/**
 * Standard Outbox Event Envelope Schema as mandated by PLT-04 & PLT-09.
 * Ensures consistent serialization across Redis Streams, outbox tables, and consumers.
 */
export const EventEnvelopeSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string().min(1, 'eventType is required'),
  aggregateType: z.string().min(1, 'aggregateType is required'),
  aggregateId: z.string().min(1, 'aggregateId is required'),
  timestamp: z.string().datetime({ message: 'timestamp must be a valid ISO-8601 string' }),
  version: z.number().int().min(1).default(1),
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
  producer: z.string().min(1).default('clearshift'),
  payload: z.record(z.string(), z.unknown()),
});

export type RawEventEnvelope = z.infer<typeof EventEnvelopeSchema>;

export type EventEnvelope<T extends Record<string, unknown> = Record<string, unknown>> = Omit<
  RawEventEnvelope,
  'payload'
> & {
  payload: T;
};

/**
 * Event Headers / Metadata for transport boundaries (Redis Streams, HTTP webhooks, etc.)
 */
export const EventHeadersSchema = z.object({
  'x-event-id': z.string().uuid().optional(),
  'x-event-type': z.string().optional(),
  'x-correlation-id': z.string().optional(),
  'x-aggregate-id': z.string().optional(),
});

export type EventHeaders = z.infer<typeof EventHeadersSchema>;

/**
 * Factory helper to construct a deterministic EventEnvelope.
 */
export function createEventEnvelope<T extends Record<string, unknown>>(params: {
  id?: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: T;
  version?: number;
  correlationId?: string;
  causationId?: string;
  producer?: string;
  timestamp?: string;
}): EventEnvelope<T> {
  const envelope: EventEnvelope<T> = {
    id: params.id ?? randomUUID(),
    eventType: params.eventType,
    aggregateType: params.aggregateType,
    aggregateId: params.aggregateId,
    timestamp: params.timestamp ?? new Date().toISOString(),
    version: params.version ?? 1,
    correlationId: params.correlationId,
    causationId: params.causationId,
    producer: params.producer ?? 'clearshift',
    payload: params.payload,
  };

  // Validate envelope against schema (payload is validated as record)
  EventEnvelopeSchema.parse(envelope);
  return envelope;
}
