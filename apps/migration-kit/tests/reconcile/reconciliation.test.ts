/**
 * ClearShift Migration Kit — Reconciliation & Terminal Outcome Ledger Tests (KIT-09)
 *
 * Verifies Acceptance Criteria for Issue #76 [KIT-09]:
 * - Database uniqueness blocks second terminal outcome
 * - Ledger counts match seeded truth
 * - Double-count fixture is rejected
 * - Batch is reconciliation OK only when formula holds and unaccounted_count = 0
 * - Failure injection results in reconciliation_failed and disabled signoff
 * - Operator skip RBAC (Editor/Admin required, runner self-approval blocked, min 10 char reason)
 * - Dry-run token invalidation upon post-dry-run skip
 * - Formula-safe CSV export defense
 *
 * @module tests/migration-kit/reconcile
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TerminalOutcome,
  SKIP_POLICY_CODE,
  SecondTerminalOutcomeError,
  SkipApprovalForbiddenError,
  InvalidSkipReasonError,
  DryRunTokenInvalidatedError,
  ReconciliationFailedError,
} from '@clearshift/contracts';
import { BatchStatus } from '@cs/kit';
import {
  InMemoryKitRowOutcomeStore,
  InMemoryDryRunTokenManager,
  InMemoryReconciliationStore,
  SkipManager,
  ReconciliationEngine,
  exportReconciliationReportCsv,
} from '../../src/reconcile/index.js';
import {
  BaseTargetAdapter,
  GenericTargetAdapterRegistry,
  InMemoryImportReceiptStore,
  TargetBatchLoader,
} from '../../src/load/target-adapter.js';

interface TestRecord {
  id: string;
  name: string;
}

class MockAdapter extends BaseTargetAdapter<TestRecord> {
  public readonly module = 'erp-1';
  public readonly entity = 'test_entities';
  public readonly schemaVersion = 1;

  constructor(receiptStore?: InMemoryImportReceiptStore) {
    super(receiptStore);
  }

  protected async validateRow(row: TestRecord): Promise<{
    valid: boolean;
    reasonCode?: string;
    message?: string;
  }> {
    if (!row.name || row.name.trim().length === 0) {
      return {
        valid: false,
        reasonCode: 'NAME_REQUIRED',
        message: 'Name is required',
      };
    }
    return { valid: true };
  }
}

describe('KIT-09: Terminal Outcome Ledger and Mathematically Exact Reconciliation', () => {
  let outcomeStore: InMemoryKitRowOutcomeStore;
  let tokenManager: InMemoryDryRunTokenManager;
  let reconStore: InMemoryReconciliationStore;
  let skipManager: SkipManager;
  let engine: ReconciliationEngine;

  beforeEach(() => {
    outcomeStore = new InMemoryKitRowOutcomeStore();
    tokenManager = new InMemoryDryRunTokenManager();
    reconStore = new InMemoryReconciliationStore();
    skipManager = new SkipManager(outcomeStore, tokenManager);
    engine = new ReconciliationEngine(outcomeStore, reconStore);
  });

  // ==========================================================================
  // 1. Database Uniqueness & Single Terminal Outcome
  // ==========================================================================
  describe('1. Database Uniqueness & Single Terminal Outcome', () => {
    it('successfully appends a single terminal outcome for a source row', async () => {
      const record = await outcomeStore.recordOutcome({
        batchId: 'batch-001',
        sourceRow: 1,
        outcome: TerminalOutcome.LOADED,
        targetId: 'target-uuid-1',
      });

      expect(record.batchId).toBe('batch-001');
      expect(record.sourceRow).toBe(1);
      expect(record.outcome).toBe(TerminalOutcome.LOADED);

      const fetched = await outcomeStore.getOutcome('batch-001', 1);
      expect(fetched).toEqual(record);
    });

    it('blocks a second terminal outcome for the same source row with SecondTerminalOutcomeError', async () => {
      await outcomeStore.recordOutcome({
        batchId: 'batch-001',
        sourceRow: 1,
        outcome: TerminalOutcome.LOADED,
        targetId: 'target-uuid-1',
      });

      // Attempt second outcome: rejected
      await expect(
        outcomeStore.recordOutcome({
          batchId: 'batch-001',
          sourceRow: 1,
          outcome: TerminalOutcome.REJECTED,
          reasonCode: 'SOME_REASON',
        })
      ).rejects.toThrow(SecondTerminalOutcomeError);

      // Attempt second outcome: skipped
      await expect(
        outcomeStore.recordOutcome({
          batchId: 'batch-001',
          sourceRow: 1,
          outcome: TerminalOutcome.SKIPPED,
          policyCode: SKIP_POLICY_CODE,
          reasonText: 'Valid reason of at least 10 chars',
        })
      ).rejects.toThrow(SecondTerminalOutcomeError);
    });

    it('rejects batch write if double-count duplicate source row exists in input', async () => {
      const batchInput = [
        {
          batchId: 'batch-002',
          sourceRow: 1,
          outcome: TerminalOutcome.LOADED,
          targetId: 'target-1',
        },
        {
          batchId: 'batch-002',
          sourceRow: 2,
          outcome: TerminalOutcome.LOADED,
          targetId: 'target-2',
        },
        {
          batchId: 'batch-002',
          sourceRow: 1, // DUPLICATE row index
          outcome: TerminalOutcome.REJECTED,
          reasonCode: 'BAD_DATA',
        },
      ];

      await expect(outcomeStore.recordOutcomes(batchInput)).rejects.toThrow(
        SecondTerminalOutcomeError
      );

      // Verify atomicity: no rows from the duplicate batch should remain
      const counts = await outcomeStore.countOutcomesByBatch('batch-002');
      expect(counts.total).toBe(0);
    });
  });

  // ==========================================================================
  // 2. Operator Skip Authorization & Lifecycle Guard
  // ==========================================================================
  describe('2. Operator Skip Authorization & Lifecycle Guard', () => {
    it('allows an Editor to approve a skip with >= 10 non-whitespace characters', async () => {
      const res = await skipManager.approveSkip(
        {
          batchId: 'batch-skip-01',
          sourceRow: 5,
          actor: 'alice.editor',
          actorRoles: ['editor'],
          reason: 'Legacy corrupted customer record from 2012',
          batchRunner: 'bob.runner',
        },
        BatchStatus.CLEANED
      );

      expect(res.record.outcome).toBe(TerminalOutcome.SKIPPED);
      expect(res.record.policyCode).toBe(SKIP_POLICY_CODE);
      expect(res.record.operator).toBe('alice.editor');
      expect(res.record.reasonText).toBe('Legacy corrupted customer record from 2012');
      expect(res.dryRunInvalidated).toBe(false);
    });

    it('allows an Admin to approve a skip with >= 10 non-whitespace characters', async () => {
      const res = await skipManager.approveSkip(
        {
          batchId: 'batch-skip-02',
          sourceRow: 12,
          actor: 'charlie.admin',
          actorRoles: ['admin'],
          reason: 'Duplicate supplier marked inactive by auditor',
          batchRunner: 'bob.runner',
        },
        BatchStatus.MAPPED
      );

      expect(res.record.outcome).toBe(TerminalOutcome.SKIPPED);
      expect(res.record.operatorRole).toBe('admin');
    });

    it('rejects skip approval from an unauthorized role (viewer or migration_runner only)', async () => {
      await expect(
        skipManager.approveSkip(
          {
            batchId: 'batch-skip-03',
            sourceRow: 8,
            actor: 'dave.viewer',
            actorRoles: ['viewer'],
            reason: 'This row should be omitted from load',
            batchRunner: 'bob.runner',
          },
          BatchStatus.CLEANED
        )
      ).rejects.toThrow(SkipApprovalForbiddenError);
    });

    it('blocks a Migration Runner from approving its own skip (separation of duties)', async () => {
      await expect(
        skipManager.approveSkip(
          {
            batchId: 'batch-skip-04',
            sourceRow: 15,
            actor: 'sam.runner', // same as batch runner
            actorRoles: ['migration_runner', 'editor'], // even if editor role attached
            reason: 'Self-skipping because record has issues',
            batchRunner: 'sam.runner',
          },
          BatchStatus.CLEANED
        )
      ).rejects.toThrow(SkipApprovalForbiddenError);
    });

    it('rejects skip if reason has fewer than 10 non-whitespace characters', async () => {
      // "bad row" = 6 non-whitespace characters
      await expect(
        skipManager.approveSkip(
          {
            batchId: 'batch-skip-05',
            sourceRow: 3,
            actor: 'alice.editor',
            actorRoles: ['editor'],
            reason: 'bad row',
          },
          BatchStatus.CLEANED
        )
      ).rejects.toThrow(InvalidSkipReasonError);

      // Whitespace padding only: "   ab cd   " = 4 chars
      await expect(
        skipManager.approveSkip(
          {
            batchId: 'batch-skip-05',
            sourceRow: 3,
            actor: 'alice.editor',
            actorRoles: ['editor'],
            reason: '   a b   c d   ',
          },
          BatchStatus.CLEANED
        )
      ).rejects.toThrow(InvalidSkipReasonError);
    });

    it('rejects skip action during or after real load', async () => {
      await expect(
        skipManager.approveSkip(
          {
            batchId: 'batch-skip-06',
            sourceRow: 7,
            actor: 'alice.editor',
            actorRoles: ['editor'],
            reason: 'Attempting to skip while load is running',
          },
          BatchStatus.LOADING
        )
      ).rejects.toThrow(SkipApprovalForbiddenError);

      await expect(
        skipManager.approveSkip(
          {
            batchId: 'batch-skip-06',
            sourceRow: 7,
            actor: 'alice.editor',
            actorRoles: ['editor'],
            reason: 'Attempting to skip after batch loaded',
          },
          BatchStatus.LOADED
        )
      ).rejects.toThrow(SkipApprovalForbiddenError);
    });
  });

  // ==========================================================================
  // 3. Dry-Run Token Lifecycle & Post-Dry-Run Invalidation
  // ==========================================================================
  describe('3. Dry-Run Token Lifecycle & Post-Dry-Run Invalidation', () => {
    it('issues a valid token upon dry-run completion', async () => {
      const token = await tokenManager.issueToken('batch-drt-01');
      expect(token.token.startsWith('drt_')).toBe(true);
      expect(token.invalidated).toBe(false);

      const isValid = await tokenManager.isValidToken('batch-drt-01', token.token);
      expect(isValid).toBe(true);
    });

    it('invalidates dry-run token when a skip is confirmed post-dry-run', async () => {
      // 1. Dry run complete
      const token = await tokenManager.issueToken('batch-drt-02');
      expect(await tokenManager.isValidToken('batch-drt-02', token.token)).toBe(true);

      // 2. Operator performs a skip while batch is in DRY_RUN_OK state
      const res = await skipManager.approveSkip(
        {
          batchId: 'batch-drt-02',
          sourceRow: 4,
          actor: 'alice.editor',
          actorRoles: ['editor'],
          reason: 'Post-dry-run exclusion approved by auditor',
          batchRunner: 'bob.runner',
        },
        BatchStatus.DRY_RUN_OK
      );

      expect(res.dryRunInvalidated).toBe(true);

      // 3. Token is now invalidated
      const isValid = await tokenManager.isValidToken('batch-drt-02', token.token);
      expect(isValid).toBe(false);

      // 4. Asserting token for real load throws DryRunTokenInvalidatedError
      await expect(
        tokenManager.assertValidToken('batch-drt-02', token.token)
      ).rejects.toThrow(DryRunTokenInvalidatedError);
    });
  });

  // ==========================================================================
  // 4. Mathematically Exact Reconciliation
  // ==========================================================================
  describe('4. Mathematically Exact Reconciliation', () => {
    it('evaluates status OK and enables signoff when formula holds and unaccounted = 0', async () => {
      const batchId = 'batch-recon-pass';
      const sourceCount = 100;

      // Seed outcomes matching: 60 loaded, 25 rejected, 10 merged, 5 skipped = 100
      let row = 1;
      for (let i = 0; i < 60; i++) {
        await outcomeStore.recordOutcome({
          batchId,
          sourceRow: row++,
          outcome: TerminalOutcome.LOADED,
          targetId: `target-${row}`,
        });
      }
      for (let i = 0; i < 25; i++) {
        await outcomeStore.recordOutcome({
          batchId,
          sourceRow: row++,
          outcome: TerminalOutcome.REJECTED,
          reasonCode: 'INVALID_FORMAT',
        });
      }
      for (let i = 0; i < 10; i++) {
        await outcomeStore.recordOutcome({
          batchId,
          sourceRow: row++,
          outcome: TerminalOutcome.MERGED,
          targetId: `merged-target-${row}`,
        });
      }
      for (let i = 0; i < 5; i++) {
        await outcomeStore.recordOutcome({
          batchId,
          sourceRow: row++,
          outcome: TerminalOutcome.SKIPPED,
          policyCode: SKIP_POLICY_CODE,
          reasonText: 'Audited duplicate row from legacy system',
        });
      }

      const summary = await engine.evaluate({
        batchId,
        sourceCount,
        evaluator: 'reconciler-service',
      });

      expect(summary.batchId).toBe(batchId);
      expect(summary.sourceCount).toBe(100);
      expect(summary.loadedCount).toBe(60);
      expect(summary.rejectedCount).toBe(25);
      expect(summary.mergedCount).toBe(10);
      expect(summary.skippedCount).toBe(5);
      expect(summary.unaccountedCount).toBe(0);
      expect(summary.formulaHolds).toBe(true);
      expect(summary.result).toBe('OK');
      expect(summary.signoffAllowed).toBe(true);
      expect(summary.failureReasons).toBeUndefined();
    });

    it('derives counts strictly from outcome ledger, never target table totals', async () => {
      const batchId = 'batch-isolated-ledger';
      const sourceCount = 3;

      await outcomeStore.recordOutcome({
        batchId,
        sourceRow: 1,
        outcome: TerminalOutcome.LOADED,
        targetId: 'target-1',
      });
      await outcomeStore.recordOutcome({
        batchId,
        sourceRow: 2,
        outcome: TerminalOutcome.LOADED,
        targetId: 'target-2',
      });
      await outcomeStore.recordOutcome({
        batchId,
        sourceRow: 3,
        outcome: TerminalOutcome.REJECTED,
        reasonCode: 'BAD_SKU',
      });

      // Even if another batch has 10,000 target rows, this batch derives solely from its ledger
      const summary = await engine.evaluate({ batchId, sourceCount });
      expect(summary.loadedCount).toBe(2);
      expect(summary.rejectedCount).toBe(1);
      expect(summary.result).toBe('OK');
    });

    it('fails reconciliation and disables signoff when unaccounted > 0 (missing rows)', async () => {
      const batchId = 'batch-missing-rows';
      const sourceCount = 10;

      // Only record 9 rows out of 10
      for (let i = 1; i <= 9; i++) {
        await outcomeStore.recordOutcome({
          batchId,
          sourceRow: i,
          outcome: TerminalOutcome.LOADED,
          targetId: `target-${i}`,
        });
      }

      const summary = await engine.evaluate({ batchId, sourceCount });

      expect(summary.sourceCount).toBe(10);
      expect(summary.loadedCount).toBe(9);
      expect(summary.unaccountedCount).toBe(1); // 1 missing row
      expect(summary.formulaHolds).toBe(false);
      expect(summary.result).toBe('reconciliation_failed');
      expect(summary.signoffAllowed).toBe(false);
      expect(summary.failureReasons).toBeDefined();
      expect(summary.failureReasons![0]).toContain('Equation does not balance');
    });

    it('fails reconciliation when accounted exceeds source (double-count injection)', async () => {
      const batchId = 'batch-overcount';
      const sourceCount = 5;

      // Record 6 outcomes when source was 5
      for (let i = 1; i <= 6; i++) {
        await outcomeStore.recordOutcome({
          batchId,
          sourceRow: i,
          outcome: TerminalOutcome.LOADED,
          targetId: `target-${i}`,
        });
      }

      const summary = await engine.evaluate({ batchId, sourceCount });

      expect(summary.unaccountedCount).toBe(-1);
      expect(summary.formulaHolds).toBe(false);
      expect(summary.result).toBe('reconciliation_failed');
      expect(summary.signoffAllowed).toBe(false);
    });

    it('throws ReconciliationFailedError when throwOnFailure is enabled', async () => {
      const batchId = 'batch-throw-failure';
      const sourceCount = 10;

      await expect(
        engine.evaluate({ batchId, sourceCount, throwOnFailure: true })
      ).rejects.toThrow(ReconciliationFailedError);
    });
  });

  // ==========================================================================
  // 5. TargetBatchLoader & Reconciliation Integration
  // ==========================================================================
  describe('5. TargetBatchLoader & Reconciliation Integration', () => {
    it('records terminal outcomes to ledger during real load and guarantees conservation', async () => {
      const receiptStore = new InMemoryImportReceiptStore();
      const adapter = new MockAdapter(receiptStore);
      const registry = new GenericTargetAdapterRegistry();
      registry.register(adapter);

      const loader = new TargetBatchLoader(registry, outcomeStore, tokenManager);
      const batchId = 'batch-loader-recon';

      // 1. Dry run creates valid dry-run token
      const dryRunRes = await loader.loadBatch(
        batchId,
        'erp-1',
        'test_entities',
        [
          { sourceRow: 1, data: { id: 'e-1', name: 'Valid Entity 1' } },
          { sourceRow: 2, data: { id: 'e-2', name: 'Valid Entity 2' } },
          { sourceRow: 3, data: { id: 'e-3', name: '' } }, // Invalid
          { sourceRow: 4, data: { id: 'e-4', name: 'Valid Entity 4' }, skipped: true, skipReason: 'Excluded legacy record 1234' },
        ],
        { isDryRun: true }
      );

      expect(dryRunRes.dryRunToken).toBeDefined();

      // 2. Real load with valid token writes terminal outcomes to outcomeStore
      const loadRes = await loader.loadBatch(
        batchId,
        'erp-1',
        'test_entities',
        [
          { sourceRow: 1, data: { id: 'e-1', name: 'Valid Entity 1' } },
          { sourceRow: 2, data: { id: 'e-2', name: 'Valid Entity 2' } },
          { sourceRow: 3, data: { id: 'e-3', name: '' } },
          { sourceRow: 4, data: { id: 'e-4', name: 'Valid Entity 4' }, skipped: true, skipReason: 'Excluded legacy record 1234' },
        ],
        { dryRunToken: dryRunRes.dryRunToken, maxFailureRatePercent: 50.0 }
      );

      expect(loadRes.loadedCount).toBe(2);
      expect(loadRes.rejectedCount).toBe(1);
      expect(loadRes.skippedCount).toBe(1);
      expect(loadRes.unaccountedCount).toBe(0);
      expect(loadRes.reconciliationStatus).toBe('OK');

      // 3. Verify ledger directly
      const ledgerOutcomes = await outcomeStore.listOutcomes(batchId);
      expect(ledgerOutcomes.length).toBe(4);
      expect(ledgerOutcomes.map((o) => o.outcome)).toEqual([
        TerminalOutcome.LOADED,
        TerminalOutcome.LOADED,
        TerminalOutcome.REJECTED,
        TerminalOutcome.SKIPPED,
      ]);

      // 4. Exact reconciliation engine evaluates to OK
      const reconSummary = await engine.evaluate({
        batchId,
        sourceCount: 4,
      });
      expect(reconSummary.result).toBe('OK');
      expect(reconSummary.signoffAllowed).toBe(true);
    });

    it('rejects real load if dry-run token is invalidated by a post-dry-run skip', async () => {
      const adapter = new MockAdapter();
      const registry = new GenericTargetAdapterRegistry();
      registry.register(adapter);

      const loader = new TargetBatchLoader(registry, outcomeStore, tokenManager);
      const batchId = 'batch-loader-inval';

      // 1. Dry run
      const dryRunRes = await loader.loadBatch(
        batchId,
        'erp-1',
        'test_entities',
        [{ sourceRow: 1, data: { id: 'e-1', name: 'Entity 1' } }],
        { isDryRun: true }
      );

      // 2. Operator performs skip in DRY_RUN_OK state -> invalidates token
      await skipManager.approveSkip(
        {
          batchId,
          sourceRow: 2,
          actor: 'alice.editor',
          actorRoles: ['editor'],
          reason: 'Post-dry-run audit omission approved',
        },
        BatchStatus.DRY_RUN_OK
      );

      // 3. Attempting load with the old token throws DryRunTokenInvalidatedError
      await expect(
        loader.loadBatch(
          batchId,
          'erp-1',
          'test_entities',
          [{ sourceRow: 1, data: { id: 'e-1', name: 'Entity 1' } }],
          { dryRunToken: dryRunRes.dryRunToken }
        )
      ).rejects.toThrow(DryRunTokenInvalidatedError);
    });
  });

  // ==========================================================================
  // 6. Formula-Safe CSV Export Defense
  // ==========================================================================
  describe('6. Formula-Safe CSV Export Defense', () => {
    it('neutralizes dangerous spreadsheet formula prefixes in export CSV', async () => {
      const summary = {
        batchId: 'batch-export-01',
        sourceCount: 2,
        loadedCount: 1,
        rejectedCount: 1,
        mergedCount: 0,
        skippedCount: 0,
        unaccountedCount: 0,
        formulaHolds: true,
        result: 'OK' as const,
        signoffAllowed: true,
        evaluatedAt: new Date('2026-10-24T12:00:00Z'),
      };

      const outcomes = [
        {
          batchId: 'batch-export-01',
          sourceRow: 1,
          outcome: TerminalOutcome.LOADED,
          targetId: 't-1',
          createdAt: new Date('2026-10-24T12:00:00Z'),
        },
        {
          batchId: 'batch-export-01',
          sourceRow: 2,
          outcome: TerminalOutcome.REJECTED,
          reasonCode: '=CMD|calc!A1', // Formula injection attempt
          reasonText: '+2+2=4', // Formula injection attempt
          operator: '@evil_admin', // Formula injection attempt
          createdAt: new Date('2026-10-24T12:00:00Z'),
        },
      ];

      const csv = exportReconciliationReportCsv(summary, outcomes);

      // Verify that leading formula characters are escaped with a leading single quote
      expect(csv).toContain("'=CMD|calc!A1");
      expect(csv).toContain("'+2+2=4");
      expect(csv).toContain("'@evil_admin");

      // Verify header lines
      expect(csv).toContain('# ClearShift Migration Kit V1 — Reconciliation Report');
      expect(csv).toContain('# Result: OK');
      expect(csv).toContain('# Signoff Allowed: true');
    });
  });
});

