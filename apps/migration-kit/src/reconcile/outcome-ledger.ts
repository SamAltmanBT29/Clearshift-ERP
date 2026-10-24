/**
 * ClearShift Migration Kit — Append-Only Terminal Outcome Ledger (KIT-09)
 *
 * Implements the durable, append-only kit_row_outcomes ledger unique by
 * batch_id + source_row, strictly permitting exactly ONE terminal outcome:
 * loaded | rejected | merged | skipped.
 *
 * Traceability:
 * - SDS ClearShift Migration Kit v2.0 §§3-4, §11.1
 * - Master Architecture Spec §5b-c
 * - Issue #76 [KIT-09]
 *
 * @module migration-kit/reconcile/outcome-ledger
 */

import { randomUUID } from 'node:crypto';
import {
  TerminalOutcome,
  type TerminalOutcomeType,
  type KitRowOutcomeRecord,
  SecondTerminalOutcomeError,
  SKIP_POLICY_CODE,
  hasMinNonWhitespaceChars,
  InvalidSkipReasonError,
} from '@clearshift/contracts';

/**
 * Input for appending a row outcome to the ledger
 */
export interface KitRowOutcomeInput {
  id?: string | undefined;
  batchId: string;
  sourceRow: number;
  outcome: TerminalOutcomeType;
  targetId?: string | undefined;
  reasonCode?: string | undefined;
  reasonText?: string | undefined;
  operator?: string | undefined;
  operatorRole?: string | undefined;
  policyCode?: string | undefined;
  idempotencyKey?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  createdAt?: Date | undefined;
}

/**
 * Breakdown of ledger counts by terminal outcome
 */
export interface LedgerOutcomeCounts {
  loaded: number;
  rejected: number;
  merged: number;
  skipped: number;
  total: number;
}

/**
 * Storage contract for append-only kit_row_outcomes
 */
export interface IKitRowOutcomeStore {
  /**
   * Appends an outcome. Throws SecondTerminalOutcomeError if row already has an outcome.
   */
  recordOutcome(input: KitRowOutcomeInput): Promise<KitRowOutcomeRecord>;

  /**
   * Batch append outcomes. Fails atomically if any duplicate exists.
   */
  recordOutcomes(inputs: KitRowOutcomeInput[]): Promise<KitRowOutcomeRecord[]>;

  /**
   * Retrieves single outcome by batchId and sourceRow
   */
  getOutcome(batchId: string, sourceRow: number): Promise<KitRowOutcomeRecord | null>;

  /**
   * Lists all outcomes for a batch in source_row order
   */
  listOutcomes(batchId: string): Promise<KitRowOutcomeRecord[]>;

  /**
   * Calculates outcome counts derived strictly from the ledger (never target table totals)
   */
  countOutcomesByBatch(batchId: string): Promise<LedgerOutcomeCounts>;

  /**
   * Check if an outcome already exists for a batch and source row
   */
  hasOutcome(batchId: string, sourceRow: number): Promise<boolean>;

  /**
   * Clears outcomes for testing purposes only
   */
  clear(batchId?: string): Promise<void>;
}

/**
 * In-Memory append-only outcome ledger store
 * Enforces uniqueness by (batchId, sourceRow) and prevents mutations.
 */
export class InMemoryKitRowOutcomeStore implements IKitRowOutcomeStore {
  // Keyed by `${batchId}:${sourceRow}`
  private outcomes: Map<string, KitRowOutcomeRecord> = new Map();

  public async recordOutcome(input: KitRowOutcomeInput): Promise<KitRowOutcomeRecord> {
    const key = `${input.batchId}:${input.sourceRow}`;

    // 1. Invariant: Database uniqueness blocks second terminal outcome
    const existing = this.outcomes.get(key);
    if (existing) {
      throw new SecondTerminalOutcomeError(
        input.batchId,
        input.sourceRow,
        existing.outcome,
        input.outcome
      );
    }

    // 2. Validate skip policy constraints if outcome is skipped
    if (input.outcome === TerminalOutcome.SKIPPED) {
      if (input.policyCode !== SKIP_POLICY_CODE) {
        throw new Error(
          `Skipped outcome requires policy code '${SKIP_POLICY_CODE}' (received '${input.policyCode}')`
        );
      }
      if (!input.reasonText || !hasMinNonWhitespaceChars(input.reasonText, 10)) {
        throw new InvalidSkipReasonError(
          input.reasonText ? input.reasonText.replace(/\s+/g, '').length : 0
        );
      }
    }

    const record: KitRowOutcomeRecord = {
      id: input.id ?? randomUUID(),
      batchId: input.batchId,
      sourceRow: input.sourceRow,
      outcome: input.outcome,
      targetId: input.targetId,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
      operator: input.operator,
      operatorRole: input.operatorRole,
      policyCode: input.policyCode,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
      createdAt: input.createdAt ?? new Date(),
    };

    // Store in immutable fashion
    this.outcomes.set(key, Object.freeze({ ...record }));
    return record;
  }

  public async recordOutcomes(inputs: KitRowOutcomeInput[]): Promise<KitRowOutcomeRecord[]> {
    // Pre-validate all inputs to ensure atomic failure on duplicates
    const seenInBatch = new Set<string>();
    for (const input of inputs) {
      const key = `${input.batchId}:${input.sourceRow}`;
      if (seenInBatch.has(key)) {
        throw new SecondTerminalOutcomeError(
          input.batchId,
          input.sourceRow,
          'duplicate_in_input',
          input.outcome
        );
      }
      seenInBatch.add(key);

      const existing = this.outcomes.get(key);
      if (existing) {
        throw new SecondTerminalOutcomeError(
          input.batchId,
          input.sourceRow,
          existing.outcome,
          input.outcome
        );
      }
    }

    const results: KitRowOutcomeRecord[] = [];
    for (const input of inputs) {
      results.push(await this.recordOutcome(input));
    }
    return results;
  }

  public async getOutcome(
    batchId: string,
    sourceRow: number
  ): Promise<KitRowOutcomeRecord | null> {
    const key = `${batchId}:${sourceRow}`;
    return this.outcomes.get(key) ?? null;
  }

  public async listOutcomes(batchId: string): Promise<KitRowOutcomeRecord[]> {
    const results: KitRowOutcomeRecord[] = [];
    for (const record of this.outcomes.values()) {
      if (record.batchId === batchId) {
        results.push(record);
      }
    }
    return results.sort((a, b) => a.sourceRow - b.sourceRow);
  }

  public async countOutcomesByBatch(batchId: string): Promise<LedgerOutcomeCounts> {
    let loaded = 0;
    let rejected = 0;
    let merged = 0;
    let skipped = 0;

    for (const record of this.outcomes.values()) {
      if (record.batchId === batchId) {
        switch (record.outcome) {
          case TerminalOutcome.LOADED:
            loaded++;
            break;
          case TerminalOutcome.REJECTED:
            rejected++;
            break;
          case TerminalOutcome.MERGED:
            merged++;
            break;
          case TerminalOutcome.SKIPPED:
            skipped++;
            break;
        }
      }
    }

    return {
      loaded,
      rejected,
      merged,
      skipped,
      total: loaded + rejected + merged + skipped,
    };
  }

  public async hasOutcome(batchId: string, sourceRow: number): Promise<boolean> {
    return this.outcomes.has(`${batchId}:${sourceRow}`);
  }

  public async clear(batchId?: string): Promise<void> {
    if (batchId) {
      for (const [key, record] of this.outcomes.entries()) {
        if (record.batchId === batchId) {
          this.outcomes.delete(key);
        }
      }
    } else {
      this.outcomes.clear();
    }
  }
}
