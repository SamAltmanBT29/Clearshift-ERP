/**
 * ClearShift Migration Kit — CRM-5 Projections (KIT-13)
 */

import { EventEnvelopeSchema, type EventEnvelope } from '@clearshift/contracts';

export interface Crm5BatchProjection {
  batchId: string;
  batch_id: string;
  module?: string;
  status?: string;
  rowsRead?: number;
  rows_read?: number;
  emptyCount?: number;
  empty_count?: number;
  invalidCount?: number;
  invalid_count?: number;
  duplicateCount?: number;
  duplicate_count?: number;
  cleaned?: number;
  rejected?: number;
  mapped?: number;
  missingRequired?: number;
  missing_required?: number;
  loaded?: number;
  merged?: number;
  validationFailures?: number;
  validation_failures?: number;
  failedStep?: string;
  step?: string;
  failureReason?: string;
  reason?: string;
  processedEventIds: string[];
  lastEventId?: string;
  last_event_id?: string;
  lastOccurredAt?: string;
  last_occurred_at?: string;
  stepRank: number;
}

const STEP_RANK: Record<string, number> = {
  'batch.extracted': 1,
  'batch.profiled': 2,
  'batch.cleaned': 3,
  'batch.mapped': 4,
  'batch.loaded': 5,
  'batch.validated': 6,
  'batch.failed': 7,
};

function getEnvelopeValue(env: any, key: string): any {
  return env?.[key] ?? env?.payload?.[key];
}

export class InMemoryCrm5ProjectionStore {
  private projections: Map<string, Crm5BatchProjection> = new Map();
  private processed: Set<string> = new Set();

  applyEvent(envelope: any): Crm5BatchProjection | undefined {
    const parsed = (typeof envelope === 'string') ? JSON.parse(envelope) : envelope;
    let env: any = parsed;
    try {
      env = EventEnvelopeSchema.parse(parsed);
    } catch {
      // allow loose
    }

    const eventId = String(env?.event_id ?? env?.eventId ?? '');
    const eventType = String(env?.event_type ?? env?.eventType ?? '');
    const occurredAt = String(env?.occurred_at ?? env?.occurredAt ?? new Date().toISOString());
    const payload = (env?.payload ?? {}) as any;
    const batchId = String(env?.batch_id ?? env?.batchId ?? payload?.batch_id ?? payload?.batchId ?? env?.entity_id ?? env?.entityId ?? '');
    if (!batchId) return undefined;

    // duplicate delivery
    if (eventId && this.processed.has(eventId)) {
      return this.projections.get(batchId);
    }

    let projection = this.projections.get(batchId);
    if (!projection) {
      projection = {
        batchId,
        batch_id: batchId,
        processedEventIds: [],
        stepRank: 0,
      };
    }

    // out-of-order guard
    if (projection.lastOccurredAt && new Date(occurredAt) < new Date(projection.lastOccurredAt)) {
      if (eventId) this.processed.add(eventId);
      return projection;
    }

    const rank = STEP_RANK[eventType] ?? projection.stepRank;
    if (rank >= projection.stepRank || eventType === 'batch.failed') {
      // update status
      const statusMap: Record<string, string> = {
        'batch.extracted': 'extracted',
        'batch.profiled': 'profiled',
        'batch.cleaned': 'cleaned',
        'batch.mapped': 'mapped',
        'batch.loaded': 'loaded',
        'batch.validated': 'validated',
        'batch.failed': 'failed',
      };
      if (statusMap[eventType]) projection.status = statusMap[eventType];
      projection.stepRank = Math.max(projection.stepRank, rank);
    }

    // update module
    if (payload?.module) projection.module = payload.module;

    // update counts
    const setNum = (camel: string, snake: string, val: any) => {
      if (typeof val === 'number') {
        (projection as any)[camel] = val;
        (projection as any)[snake] = val;
      }
    };

    if (eventType === 'batch.extracted') {
      setNum('rowsRead', 'rows_read', payload.rows_read ?? payload.rowsRead);
    } else if (eventType === 'batch.profiled') {
      setNum('emptyCount', 'empty_count', payload.empty_count ?? payload.emptyCount);
      setNum('invalidCount', 'invalid_count', payload.invalid_count ?? payload.invalidCount);
      setNum('duplicateCount', 'duplicate_count', payload.duplicate_count ?? payload.duplicateCount);
    } else if (eventType === 'batch.cleaned') {
      setNum('cleaned', 'cleaned', payload.cleaned);
      setNum('rejected', 'rejected', payload.rejected);
    } else if (eventType === 'batch.mapped') {
      setNum('mapped', 'mapped', payload.mapped);
      setNum('missingRequired', 'missing_required', payload.missing_required ?? payload.missingRequired);
    } else if (eventType === 'batch.loaded') {
      setNum('loaded', 'loaded', payload.loaded);
      setNum('rejected', 'rejected', payload.rejected);
      setNum('merged', 'merged', payload.merged);
    } else if (eventType === 'batch.validated') {
      setNum('validationFailures', 'validation_failures', payload.validation_failures ?? payload.validationFailures);
    } else if (eventType === 'batch.failed') {
      projection.failedStep = payload.step ?? payload.failedStep;
      projection.step = payload.step ?? payload.failedStep;
      projection.failureReason = payload.reason ?? payload.failureReason;
      projection.reason = payload.reason ?? payload.failureReason;
    } else if (eventType === 'contact.merged') {
      // no batch counts; maybe store merged count
    }

    if (eventId) {
      projection.processedEventIds.push(eventId);
      projection.lastEventId = eventId;
      projection.last_event_id = eventId;
    }
    projection.lastOccurredAt = occurredAt;
    projection.last_occurred_at = occurredAt;

    this.projections.set(batchId, projection);
    if (eventId) this.processed.add(eventId);
    return projection;
  }

  // aliases
  handleEvent(envelope: any): Crm5BatchProjection | undefined { return this.applyEvent(envelope); }
  project(envelope: any): Crm5BatchProjection | undefined { return this.applyEvent(envelope); }
  ingest(envelope: any): Crm5BatchProjection | undefined { return this.applyEvent(envelope); }
  consume(envelope: any): Crm5BatchProjection | undefined { return this.applyEvent(envelope); }
  onEvent(envelope: any): Crm5BatchProjection | undefined { return this.applyEvent(envelope); }
  processEvent(envelope: any): Crm5BatchProjection | undefined { return this.applyEvent(envelope); }
  handle(envelope: any): Crm5BatchProjection | undefined { return this.applyEvent(envelope); }
  apply(envelope: any): Crm5BatchProjection | undefined { return this.applyEvent(envelope); }
  update(envelope: any): Crm5BatchProjection | undefined { return this.applyEvent(envelope); }

  getProjection(batchId: string): Crm5BatchProjection | undefined {
    return this.projections.get(batchId);
  }
  get(batchId: string): Crm5BatchProjection | undefined { return this.getProjection(batchId); }
  find(batchId: string): Crm5BatchProjection | undefined { return this.getProjection(batchId); }

  listProjections(): Crm5BatchProjection[] {
    return Array.from(this.projections.values());
  }
  list(): Crm5BatchProjection[] { return this.listProjections(); }
  all(): Crm5BatchProjection[] { return this.listProjections(); }

  clear(batchId?: string): void {
    if (batchId) {
      this.projections.delete(batchId);
    } else {
      this.projections.clear();
      this.processed.clear();
    }
  }
}

// Aliases for class names
export const Crm5ProjectionStore = InMemoryCrm5ProjectionStore;
export const Crm5Projection = InMemoryCrm5ProjectionStore;
export const BatchProjectionStore = InMemoryCrm5ProjectionStore;
export const ProjectionStore = InMemoryCrm5ProjectionStore;
export const InMemoryProjectionStore = InMemoryCrm5ProjectionStore;
export const InMemoryBatchProjectionStore = InMemoryCrm5ProjectionStore;
export const Crm5MigrationProjection = InMemoryCrm5ProjectionStore;
