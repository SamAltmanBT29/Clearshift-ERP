/**
 * ClearShift Migration Kit — Rollback Journal Storage (KIT-12)
 *
 * Implements the append-only journal store and durable saga execution status tracker
 * for compensating rollback operations according to SDS §11.1–11.9 and Issue #79.
 *
 * Invariants:
 * - Append-only journal: records before/after state, target version, actor, idempotency key, and status.
 * - Idempotency key per action guarantees repeat requests do not re-insert duplicate actions.
 * - Execution state machine: idle -> preflight_passed | rollback_blocked -> in_progress -> rolled_back | failed.
 *
 * @module migration-kit/rollback/journal
 */

import { randomUUID } from 'node:crypto';
import type {
  RollbackJournalRecord,
  RollbackActionType,
  RollbackItemStatusType,
  RollbackBatchSummary,
} from '@clearshift/contracts';

/**
 * Storage contract for the append-only rollback journal and execution status.
 */
export interface IKitRollbackJournalStore {
  /**
   * Records a new compensation action in the append-only journal.
   */
  recordAction(entry: Omit<RollbackJournalRecord, 'id' | 'createdAt'>): Promise<RollbackJournalRecord>;

  /**
   * Updates an existing action's execution status (e.g. pending -> compensated | failed).
   */
  updateActionStatus(
    batchId: string,
    idempotencyKey: string,
    action: RollbackActionType,
    status: RollbackItemStatusType,
    options?: {
      errorReason?: string;
      executedAt?: Date;
      afterState?: Record<string, unknown> | null;
    }
  ): Promise<void>;

  /**
   * Retrieves all journal entries for a given batch sorted by position descending (reverse order).
   */
  getJournalByBatchId(batchId: string): Promise<RollbackJournalRecord[]>;

  /**
   * Looks up a specific journal action by batchId, idempotencyKey, and action type.
   */
  getAction(
    batchId: string,
    idempotencyKey: string,
    action: RollbackActionType
  ): Promise<RollbackJournalRecord | null>;

  /**
   * Retrieves the current execution summary for a batch.
   */
  getExecution(batchId: string): Promise<RollbackBatchSummary | null>;

  /**
   * Saves or overwrites the execution summary for a batch.
   */
  saveExecution(summary: RollbackBatchSummary): Promise<void>;

  /**
   * Updates partial execution summary fields.
   */
  updateExecution(batchId: string, updates: Partial<RollbackBatchSummary>): Promise<void>;

  /**
   * Clears in-memory state (useful for test resets).
   */
  clear?(): void;
}

/**
 * In-memory implementation of IKitRollbackJournalStore for deterministic unit testing
 * and worker crash/resumption simulations.
 */
export class InMemoryRollbackJournalStore implements IKitRollbackJournalStore {
  private actions: Map<string, RollbackJournalRecord> = new Map();
  private executions: Map<string, RollbackBatchSummary> = new Map();

  private makeActionKey(batchId: string, idempotencyKey: string, action: RollbackActionType): string {
    return `${batchId}:${idempotencyKey}:${action}`;
  }

  public async recordAction(
    entry: Omit<RollbackJournalRecord, 'id' | 'createdAt'>
  ): Promise<RollbackJournalRecord> {
    const key = this.makeActionKey(entry.batchId, entry.idempotencyKey, entry.action);
    const existing = this.actions.get(key);
    if (existing) {
      return existing;
    }

    const record: RollbackJournalRecord = {
      id: randomUUID(),
      batchId: entry.batchId,
      module: entry.module,
      entity: entry.entity,
      targetId: entry.targetId,
      sourceRow: entry.sourceRow,
      action: entry.action,
      targetVersion: entry.targetVersion,
      beforeState: entry.beforeState ?? null,
      afterState: entry.afterState ?? null,
      actor: entry.actor,
      status: entry.status,
      idempotencyKey: entry.idempotencyKey,
      errorReason: entry.errorReason,
      position: entry.position,
      executedAt: entry.executedAt,
      createdAt: new Date(),
    };

    this.actions.set(key, record);
    return record;
  }

  public async updateActionStatus(
    batchId: string,
    idempotencyKey: string,
    action: RollbackActionType,
    status: RollbackItemStatusType,
    options: {
      errorReason?: string;
      executedAt?: Date;
      afterState?: Record<string, unknown> | null;
    } = {}
  ): Promise<void> {
    const key = this.makeActionKey(batchId, idempotencyKey, action);
    const existing = this.actions.get(key);
    if (!existing) {
      throw new Error(`Rollback action not found: ${key}`);
    }

    existing.status = status;
    if (options.errorReason !== undefined) {
      existing.errorReason = options.errorReason;
    }
    if (options.executedAt !== undefined) {
      existing.executedAt = options.executedAt;
    }
    if (options.afterState !== undefined) {
      existing.afterState = options.afterState;
    }
    this.actions.set(key, existing);
  }

  public async getJournalByBatchId(batchId: string): Promise<RollbackJournalRecord[]> {
    return Array.from(this.actions.values())
      .filter((r) => r.batchId === batchId)
      .sort((a, b) => a.position - b.position); // execution sequence order (1 is first)
  }

  public async getAction(
    batchId: string,
    idempotencyKey: string,
    action: RollbackActionType
  ): Promise<RollbackJournalRecord | null> {
    const key = this.makeActionKey(batchId, idempotencyKey, action);
    return this.actions.get(key) ?? null;
  }

  public async getExecution(batchId: string): Promise<RollbackBatchSummary | null> {
    const exec = this.executions.get(batchId);
    return exec ? { ...exec } : null;
  }

  public async saveExecution(summary: RollbackBatchSummary): Promise<void> {
    this.executions.set(summary.batchId, { ...summary });
  }

  public async updateExecution(
    batchId: string,
    updates: Partial<RollbackBatchSummary>
  ): Promise<void> {
    const existing = this.executions.get(batchId);
    if (!existing) {
      throw new Error(`Rollback execution not found for batch '${batchId}'`);
    }
    this.executions.set(batchId, {
      ...existing,
      ...updates,
    });
  }

  public clear(): void {
    this.actions.clear();
    this.executions.clear();
  }
}
