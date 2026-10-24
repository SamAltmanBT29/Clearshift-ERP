/**
 * ClearShift Migration Kit — Transactional Outbox Event Producer (KIT-13)
 */

import {
  createKitEvent,
  KIT_EVENT_TYPES,
  type EventEnvelope,
} from '@clearshift/contracts';
import type { IOutboxRepository, OutboxRecord } from '@clearshift/database';

export interface OutboxProducerOptions {
  producer?: string;
}

export class OutboxEventProducer {
  private outboxRepo: IOutboxRepository;
  private producerName: string;

  constructor(outboxRepo: IOutboxRepository, options?: OutboxProducerOptions | string) {
    this.outboxRepo = outboxRepo;
    if (typeof options === 'string') {
      this.producerName = options;
    } else {
      this.producerName = options?.producer ?? 'migration-kit';
    }
  }

  private coerce(first: any, second?: any): any {
    const ctx = (typeof second === 'object' && second !== null) ? second : {};
    if (typeof first === 'string') {
      return { batchId: first, ...ctx };
    }
    return { ...(first ?? {}), ...ctx };
  }

  private txFrom(ctx: any): any {
    return ctx?.tx ?? ctx?.transaction ?? ctx?.dbTx ?? ctx?.client ?? undefined;
  }

  private stableId(key: string): string {
    // deterministic UUID-ish id
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    const hex = h.toString(16).padStart(8, '0');
    return `${hex.slice(0,8)}-${hex.slice(0,4)}-4${hex.slice(1,4)}-a${hex.slice(0,3)}-${hex}${hex}`.slice(0, 36);
  }

  async publish(envelope: EventEnvelope, tx?: any): Promise<OutboxRecord> {
    return this.outboxRepo.writeEvent(envelope, tx);
  }

  async publishEvent(envelope: EventEnvelope, tx?: any): Promise<OutboxRecord> {
    return this.publish(envelope, tx);
  }

  async writeEvent(envelope: EventEnvelope, tx?: any): Promise<OutboxRecord> {
    return this.publish(envelope, tx);
  }

  async emit(envelope: EventEnvelope, tx?: any): Promise<OutboxRecord> {
    return this.publish(envelope, tx);
  }

  async publishBatchExtracted(first: any, second?: any): Promise<OutboxRecord> {
    const c = this.coerce(first, second);
    const batchId = c.batchId ?? c.batch_id ?? c.batch;
    const module = c.module;
    const rowsRead = c.rowsRead ?? c.rows_read ?? c.rows ?? 0;
    const payload = c.payload ?? { batch_id: batchId, module, rows_read: rowsRead };
    const eventId = c.eventId ?? c.event_id ?? this.stableId(`${batchId}:batch.extracted`);
    const envelope = createKitEvent({
      eventId,
      eventType: KIT_EVENT_TYPES.BATCH_EXTRACTED,
      correlationId: c.correlationId ?? c.correlation_id ?? `corr-${batchId}`,
      producer: c.producer ?? this.producerName,
      entityType: c.entityType ?? 'batch',
      entityId: c.entityId ?? batchId,
      batchId,
      payload,
      occurredAt: c.occurredAt ?? c.occurred_at,
      metadata: c.metadata,
    });
    return this.outboxRepo.writeEvent(envelope, this.txFrom(c));
  }

  async publishBatchProfiled(first: any, second?: any): Promise<OutboxRecord> {
    const c = this.coerce(first, second);
    const batchId = c.batchId ?? c.batch_id ?? c.batch;
    const module = c.module;
    const emptyCount = c.emptyCount ?? c.empty_count ?? 0;
    const invalidCount = c.invalidCount ?? c.invalid_count ?? 0;
    const duplicateCount = c.duplicateCount ?? c.duplicate_count ?? 0;
    const payload = c.payload ?? { batch_id: batchId, module, empty_count: emptyCount, invalid_count: invalidCount, duplicate_count: duplicateCount };
    const eventId = c.eventId ?? c.event_id ?? this.stableId(`${batchId}:batch.profiled`);
    const envelope = createKitEvent({
      eventId,
      eventType: KIT_EVENT_TYPES.BATCH_PROFILED,
      correlationId: c.correlationId ?? c.correlation_id ?? `corr-${batchId}`,
      producer: c.producer ?? this.producerName,
      entityType: c.entityType ?? 'batch',
      entityId: c.entityId ?? batchId,
      batchId,
      payload,
      occurredAt: c.occurredAt ?? c.occurred_at,
      metadata: c.metadata,
    });
    return this.outboxRepo.writeEvent(envelope, this.txFrom(c));
  }

  async publishBatchCleaned(first: any, second?: any): Promise<OutboxRecord> {
    const c = this.coerce(first, second);
    const batchId = c.batchId ?? c.batch_id ?? c.batch;
    const cleaned = c.cleaned ?? 0;
    const rejected = c.rejected ?? 0;
    const payload = c.payload ?? { batch_id: batchId, cleaned, rejected };
    const eventId = c.eventId ?? c.event_id ?? this.stableId(`${batchId}:batch.cleaned`);
    const envelope = createKitEvent({
      eventId,
      eventType: KIT_EVENT_TYPES.BATCH_CLEANED,
      correlationId: c.correlationId ?? c.correlation_id ?? `corr-${batchId}`,
      producer: c.producer ?? this.producerName,
      entityType: c.entityType ?? 'batch',
      entityId: c.entityId ?? batchId,
      batchId,
      payload,
      occurredAt: c.occurredAt ?? c.occurred_at,
      metadata: c.metadata,
    });
    return this.outboxRepo.writeEvent(envelope, this.txFrom(c));
  }

  async publishBatchMapped(first: any, second?: any): Promise<OutboxRecord> {
    const c = this.coerce(first, second);
    const batchId = c.batchId ?? c.batch_id ?? c.batch;
    const mapped = c.mapped ?? 0;
    const missingRequired = c.missingRequired ?? c.missing_required ?? 0;
    const payload = c.payload ?? { batch_id: batchId, mapped, missing_required: missingRequired };
    const eventId = c.eventId ?? c.event_id ?? this.stableId(`${batchId}:batch.mapped`);
    const envelope = createKitEvent({
      eventId,
      eventType: KIT_EVENT_TYPES.BATCH_MAPPED,
      correlationId: c.correlationId ?? c.correlation_id ?? `corr-${batchId}`,
      producer: c.producer ?? this.producerName,
      entityType: c.entityType ?? 'batch',
      entityId: c.entityId ?? batchId,
      batchId,
      payload,
      occurredAt: c.occurredAt ?? c.occurred_at,
      metadata: c.metadata,
    });
    return this.outboxRepo.writeEvent(envelope, this.txFrom(c));
  }

  async publishBatchLoaded(first: any, second?: any): Promise<OutboxRecord> {
    const c = this.coerce(first, second);
    const batchId = c.batchId ?? c.batch_id ?? c.batch;
    const loaded = c.loaded ?? 0;
    const rejected = c.rejected ?? 0;
    const merged = c.merged ?? 0;
    const payload = c.payload ?? { batch_id: batchId, loaded, rejected, merged };
    const eventId = c.eventId ?? c.event_id ?? this.stableId(`${batchId}:batch.loaded`);
    const envelope = createKitEvent({
      eventId,
      eventType: KIT_EVENT_TYPES.BATCH_LOADED,
      correlationId: c.correlationId ?? c.correlation_id ?? `corr-${batchId}`,
      producer: c.producer ?? this.producerName,
      entityType: c.entityType ?? 'batch',
      entityId: c.entityId ?? batchId,
      batchId,
      payload,
      occurredAt: c.occurredAt ?? c.occurred_at,
      metadata: c.metadata,
    });
    return this.outboxRepo.writeEvent(envelope, this.txFrom(c));
  }

  async publishBatchValidated(first: any, second?: any): Promise<OutboxRecord> {
    const c = this.coerce(first, second);
    const batchId = c.batchId ?? c.batch_id ?? c.batch;
    const validationFailures = c.validationFailures ?? c.validation_failures ?? 0;
    const payload = c.payload ?? { batch_id: batchId, validation_failures: validationFailures };
    const eventId = c.eventId ?? c.event_id ?? this.stableId(`${batchId}:batch.validated`);
    const envelope = createKitEvent({
      eventId,
      eventType: KIT_EVENT_TYPES.BATCH_VALIDATED,
      correlationId: c.correlationId ?? c.correlation_id ?? `corr-${batchId}`,
      producer: c.producer ?? this.producerName,
      entityType: c.entityType ?? 'batch',
      entityId: c.entityId ?? batchId,
      batchId,
      payload,
      occurredAt: c.occurredAt ?? c.occurred_at,
      metadata: c.metadata,
    });
    return this.outboxRepo.writeEvent(envelope, this.txFrom(c));
  }

  async publishBatchFailed(first: any, second?: any): Promise<OutboxRecord> {
    const c = this.coerce(first, second);
    const batchId = c.batchId ?? c.batch_id ?? c.batch;
    const step = c.step ?? c.failedStep ?? 'unknown';
    const reason = c.reason ?? c.failureReason ?? c.message ?? 'hard failure';
    const payload = c.payload ?? { batch_id: batchId, step, reason };
    const eventId = c.eventId ?? c.event_id ?? this.stableId(`${batchId}:batch.failed:${step}`);
    const envelope = createKitEvent({
      eventId,
      eventType: KIT_EVENT_TYPES.BATCH_FAILED,
      correlationId: c.correlationId ?? c.correlation_id ?? `corr-${batchId}`,
      producer: c.producer ?? this.producerName,
      entityType: c.entityType ?? 'batch',
      entityId: c.entityId ?? batchId,
      batchId,
      payload,
      occurredAt: c.occurredAt ?? c.occurred_at,
      metadata: c.metadata,
    });
    return this.outboxRepo.writeEvent(envelope, this.txFrom(c));
  }

  async publishContactMerged(first: any, second?: any): Promise<OutboxRecord> {
    const c = this.coerce(first, second);
    const contactId = c.contactId ?? c.contact_id ?? c.id;
    const payload = c.payload ?? {
      contact_id: contactId,
      source_id: c.sourceId ?? c.source_id,
      target_id: c.targetId ?? c.target_id,
      merged_count: c.mergedCount ?? c.merged_count ?? 1,
      reason: c.reason,
    };
    const eventId = c.eventId ?? c.event_id ?? this.stableId(`contact.merged:${contactId}`);
    const envelope = createKitEvent({
      eventId,
      eventType: KIT_EVENT_TYPES.CONTACT_MERGED,
      correlationId: c.correlationId ?? c.correlation_id ?? `corr-${contactId}`,
      producer: c.producer ?? this.producerName,
      entityType: c.entityType ?? 'contact',
      entityId: c.entityId ?? contactId,
      batchId: c.batchId ?? c.batch_id,
      payload,
      occurredAt: c.occurredAt ?? c.occurred_at,
      metadata: c.metadata,
    });
    return this.outboxRepo.writeEvent(envelope, this.txFrom(c));
  }

  async produce(envelope: EventEnvelope, tx?: any): Promise<OutboxRecord> { return this.publish(envelope, tx); }
  async send(envelope: EventEnvelope, tx?: any): Promise<OutboxRecord> { return this.publish(envelope, tx); }
  async enqueue(envelope: EventEnvelope, tx?: any): Promise<OutboxRecord> { return this.publish(envelope, tx); }
}

// Aliases
export const TransactionalOutboxProducer = OutboxEventProducer;
export const BatchEventProducer = OutboxEventProducer;
export const MigrationKitEventProducer = OutboxEventProducer;
export const MigrationEventProducer = OutboxEventProducer;
export const KitEventProducer = OutboxEventProducer;
export const EventProducer = OutboxEventProducer;
export const TransactionalEventEnvelopeProducer = OutboxEventProducer;
