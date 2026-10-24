/**
 * ClearShift Migration Kit — Mathematically Exact Reconciliation Engine (KIT-09)
 *
 * Implements Step 7 exact mathematical accounting per SDS §3-4, §11.1 and Issue #76:
 * - Counts derive strictly from the append-only ledger (kit_row_outcomes), NEVER target table totals.
 * - Enforces conservation equation: source = loaded + rejected + merged + skipped
 * - Requires unaccounted = 0
 * - Reconciliation status:
 *   - 'OK' ONLY when equation holds and unaccounted = 0 (signoff allowed)
 *   - 'reconciliation_failed' if any mismatch exists (signoff strictly disabled)
 *
 * @module migration-kit/reconcile/reconciler
 */

import {
  type KitReconciliationSummary,
  ReconciliationFailedError,
} from '@clearshift/contracts';
import type { IKitRowOutcomeStore, LedgerOutcomeCounts } from './outcome-ledger.js';

export interface ReconciliationEvaluationOptions {
  batchId: string;
  sourceCount: number;
  evaluator?: string | undefined;
  throwOnFailure?: boolean | undefined;
}

export interface IReconciliationStore {
  saveSummary(summary: KitReconciliationSummary): Promise<void>;
  getSummary(batchId: string): Promise<KitReconciliationSummary | null>;
  clear(batchId?: string): Promise<void>;
}

export class InMemoryReconciliationStore implements IReconciliationStore {
  private summaries: Map<string, KitReconciliationSummary> = new Map();

  public async saveSummary(summary: KitReconciliationSummary): Promise<void> {
    this.summaries.set(summary.batchId, Object.freeze({ ...summary }));
  }

  public async getSummary(batchId: string): Promise<KitReconciliationSummary | null> {
    return this.summaries.get(batchId) ?? null;
  }

  public async clear(batchId?: string): Promise<void> {
    if (batchId) {
      this.summaries.delete(batchId);
    } else {
      this.summaries.clear();
    }
  }
}

export class ReconciliationEngine {
  constructor(
    private readonly outcomeStore: IKitRowOutcomeStore,
    private readonly reconStore?: IReconciliationStore | undefined
  ) {}

  /**
   * Evaluates exact mathematical reconciliation for a batch.
   * Derives counts strictly from the kit_row_outcomes ledger.
   *
   * @param options Evaluation options containing batchId and sourceCount
   */
  public async evaluate(
    options: ReconciliationEvaluationOptions
  ): Promise<KitReconciliationSummary> {
    const { batchId, sourceCount, throwOnFailure = false } = options;

    if (sourceCount < 0) {
      throw new Error(`sourceCount must be >= 0 (received ${sourceCount})`);
    }

    // 1. Invariant: Counts derive from ledger, NEVER target table totals
    const ledgerCounts: LedgerOutcomeCounts = await this.outcomeStore.countOutcomesByBatch(
      batchId
    );

    const loaded = ledgerCounts.loaded;
    const rejected = ledgerCounts.rejected;
    const merged = ledgerCounts.merged;
    const skipped = ledgerCounts.skipped;

    // 2. Audit check: Ensure no duplicate source rows exist in the ledger
    const allOutcomes = await this.outcomeStore.listOutcomes(batchId);
    const seenRows = new Set<number>();
    const duplicateRows: number[] = [];

    for (const record of allOutcomes) {
      if (seenRows.has(record.sourceRow)) {
        duplicateRows.push(record.sourceRow);
      }
      seenRows.add(record.sourceRow);
    }

    const failureReasons: string[] = [];

    if (duplicateRows.length > 0) {
      failureReasons.push(
        `Duplicate terminal outcome detected in ledger for source row(s): ${duplicateRows.join(', ')}`
      );
    }

    // 3. Mathematical Formula: source = loaded + rejected + merged + skipped
    const accounted = loaded + rejected + merged + skipped;
    const unaccounted = sourceCount - accounted;
    const formulaHolds = sourceCount === accounted && duplicateRows.length === 0;

    if (!formulaHolds) {
      failureReasons.push(
        `Equation does not balance: source (${sourceCount}) != loaded (${loaded}) + rejected (${rejected}) + merged (${merged}) + skipped (${skipped}) = ${accounted}`
      );
    }

    if (unaccounted !== 0) {
      failureReasons.push(`Unaccounted count (${unaccounted}) is not zero`);
    }

    // 4. Batch is reconciliation OK only when formula holds and unaccounted_count = 0
    const isOk = formulaHolds && unaccounted === 0 && failureReasons.length === 0;
    const result: 'OK' | 'reconciliation_failed' = isOk ? 'OK' : 'reconciliation_failed';
    const signoffAllowed = isOk;

    const summary: KitReconciliationSummary = {
      batchId,
      sourceCount,
      loadedCount: loaded,
      rejectedCount: rejected,
      mergedCount: merged,
      skippedCount: skipped,
      unaccountedCount: unaccounted,
      formulaHolds,
      result,
      signoffAllowed,
      failureReasons: failureReasons.length > 0 ? failureReasons : undefined,
      evaluatedAt: new Date(),
    };

    // 5. Persist durable reconciliation state
    if (this.reconStore) {
      await this.reconStore.saveSummary(summary);
    }

    if (!isOk && throwOnFailure) {
      throw new ReconciliationFailedError(batchId, summary);
    }

    return summary;
  }
}
