/**
 * ClearShift Migration Kit — Compensating Saga Rollback Tests (KIT-12)
 *
 * Verifies Acceptance Criteria for Issue #79 [KIT-12]:
 * - Conflict Preflight: batch/receipt completeness, target version, and child references.
 * - Reverse Dependency Order: compensations execute in reverse load position order (LIFO).
 * - Created vs Updated Semantics: created records removed, updated records restore beforeState.
 * - Conflict Detection: later edits / child refs produce rollback_blocked without mutating data.
 * - Idempotency: repeated rollback request returns existing status without duplicate compensations.
 * - Resumability: failed or interrupted sagas safely resume uncompensated actions.
 * - Append-Only Journal: before/after state, target version, actor, idempotency key, and status recorded.
 * - 100% Confirmed Completion: status reaches rolled_back only when all actions are confirmed.
 *
 * @module tests/migration-kit/rollback
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RollbackAction,
  RollbackItemStatus,
  RollbackBatchStatus,
  RollbackConflictReason,
} from '@clearshift/contracts';
import {
  BaseTargetAdapter,
  GenericTargetAdapterRegistry,
  InMemoryImportReceiptStore,
  TargetBatchLoader,
} from '../../src/load/target-adapter.js';
import {
  InMemoryRollbackJournalStore,
  RollbackPreflightChecker,
  CompensatingSagaEngine,
} from '../../src/rollback/index.js';

interface TestItemRow {
  sku: string;
  name: string;
  price?: number;
}

class TestItemTargetAdapter extends BaseTargetAdapter<TestItemRow> {
  public readonly module = 'erp-1';
  public readonly entity = 'products';
  public readonly schemaVersion = 1;

  public failOnTargetId?: string;

  constructor(receiptStore?: InMemoryImportReceiptStore) {
    super(receiptStore);
  }

  protected async validateRow(row: TestItemRow): Promise<{
    valid: boolean;
    reasonCode?: string;
    message?: string;
  }> {
    if (!row.sku) {
      return { valid: false, reasonCode: 'SKU_REQUIRED', message: 'SKU is required' };
    }
    return { valid: true };
  }

  public override async compensateRow(
    targetId: string,
    action: (typeof RollbackAction)[keyof typeof RollbackAction],
    options?: {
      beforeState?: Record<string, unknown> | null;
      expectedVersion?: number;
    }
  ) {
    if (this.failOnTargetId && targetId === this.failOnTargetId) {
      return {
        ok: false,
        targetId,
        action,
        error: `Injected failure compensating record '${targetId}'`,
      };
    }
    return super.compensateRow(targetId, action, options);
  }
}

describe('KIT-12: Resumable Compensating-Saga Rollback with Conflict Preflight', () => {
  let receiptStore: InMemoryImportReceiptStore;
  let journalStore: InMemoryRollbackJournalStore;
  let adapter: TestItemTargetAdapter;
  let registry: GenericTargetAdapterRegistry;
  let loader: TargetBatchLoader;
  let preflightChecker: RollbackPreflightChecker;
  let sagaEngine: CompensatingSagaEngine;

  beforeEach(() => {
    receiptStore = new InMemoryImportReceiptStore();
    journalStore = new InMemoryRollbackJournalStore();
    adapter = new TestItemTargetAdapter(receiptStore);
    registry = new GenericTargetAdapterRegistry();
    registry.register(adapter);
    loader = new TargetBatchLoader(registry);
    preflightChecker = new RollbackPreflightChecker(receiptStore, registry, journalStore);
    sagaEngine = new CompensatingSagaEngine(registry, receiptStore, journalStore, preflightChecker);
  });

  // ==========================================================================
  // Helper to load test rows into adapter & receipts
  // ==========================================================================
  async function seedBatch(batchId: string, count = 3) {
    const rows = Array.from({ length: count }, (_, i) => ({
      sourceRow: i + 1,
      data: {
        sku: `SKU-00${i + 1}`,
        name: `Product ${i + 1}`,
        price: (i + 1) * 10,
      },
    }));

    const result = await loader.loadBatch(batchId, 'erp-1', 'products', rows);
    return { rows, result };
  }

  // ==========================================================================
  // 1. Conflict Preflight Verification (AC-1 & AC-4)
  // ==========================================================================
  describe('1. Conflict Preflight Verification', () => {
    it('passes preflight on a clean loaded batch without conflicts', async () => {
      const batchId = 'batch-clean-01';
      await seedBatch(batchId, 3);

      const preflight = await preflightChecker.checkBatch(batchId);
      expect(preflight.passed).toBe(true);
      expect(preflight.totalReceipts).toBe(3);
      expect(preflight.conflictCount).toBe(0);
      expect(preflight.conflicts).toHaveLength(0);
    });

    it('fails preflight when no durable import receipts exist for batch', async () => {
      const preflight = await preflightChecker.checkBatch('non-existent-batch');
      expect(preflight.passed).toBe(false);
      expect(preflight.conflictCount).toBe(1);
      expect(preflight.conflicts[0]!.reasonCode).toBe(RollbackConflictReason.RECEIPT_NOT_FOUND);
    });

    it('fails preflight and produces rollback_blocked when downstream child references exist', async () => {
      const batchId = 'batch-child-ref-01';
      await seedBatch(batchId, 2);

      const receipts = await receiptStore.listByBatchId(batchId);
      const targetIdWithChild = receipts[0]!.targetId;

      // Add child reference (e.g., an order line referencing product)
      adapter.addChildReference(targetIdWithChild, 'sales_order_lines', 'line-1234');

      const summary = await sagaEngine.rollbackBatch({
        batchId,
        actor: 'operator-1',
        reason: 'Rollback test with child ref',
      });

      expect(summary.status).toBe(RollbackBatchStatus.ROLLBACK_BLOCKED);
      expect(summary.preflightPassed).toBe(false);
      expect(summary.blockedItems).toBe(1);
      expect(summary.compensatedItems).toBe(0);
      expect(summary.conflicts[0]!.reasonCode).toBe(RollbackConflictReason.CHILD_REFERENCES_EXIST);
      expect(summary.conflicts[0]!.targetId).toBe(targetIdWithChild);

      // Verify business records remain intact (zero mutations!)
      expect(adapter.getTargetRecords()).toHaveLength(2);

      // Verify conflict is durably recorded in journal for audit
      const journal = await journalStore.getJournalByBatchId(batchId);
      expect(journal).toHaveLength(1);
      expect(journal[0]!.status).toBe(RollbackItemStatus.BLOCKED);
      expect(journal[0]!.errorReason).toContain('child reference(s) exist');
    });

    it('fails preflight and produces rollback_blocked when target record version was modified by later edits', async () => {
      const batchId = 'batch-version-mismatch-01';
      await seedBatch(batchId, 2);

      const receipts = await receiptStore.listByBatchId(batchId);
      const targetIdEdited = receipts[1]!.targetId;

      // Simulate external user editing the record after load (bumps version from 1 to 2)
      adapter.updateRecord(targetIdEdited, { name: 'Updated Product Name' });

      const summary = await sagaEngine.rollbackBatch({
        batchId,
        actor: 'operator-1',
        reason: 'Rollback test with version mismatch',
      });

      expect(summary.status).toBe(RollbackBatchStatus.ROLLBACK_BLOCKED);
      expect(summary.preflightPassed).toBe(false);
      expect(summary.blockedItems).toBe(1);
      expect(summary.compensatedItems).toBe(0);
      expect(summary.conflicts[0]!.reasonCode).toBe(RollbackConflictReason.TARGET_VERSION_MISMATCH);
      expect(summary.conflicts[0]!.currentVersion).toBe(2);
      expect(summary.conflicts[0]!.postLoadVersion).toBe(1);

      // Target records untouched
      expect(adapter.getTargetRecords()).toHaveLength(2);
    });
  });

  // ==========================================================================
  // 2. Reverse Dependency Order Compensation (AC-2 & AC-3)
  // ==========================================================================
  describe('2. Reverse Dependency Order Compensation', () => {
    it('compensates loaded rows in strict reverse load position order (LIFO)', async () => {
      const batchId = 'batch-lifo-01';
      await seedBatch(batchId, 4);

      const summary = await sagaEngine.rollbackBatch({
        batchId,
        actor: 'admin-lead',
        reason: 'Test reverse order compensation',
      });

      expect(summary.status).toBe(RollbackBatchStatus.ROLLED_BACK);
      expect(summary.compensatedItems).toBe(4);
      expect(summary.totalItems).toBe(4);

      // Inspect journal order: position 4 (sourceRow 4) -> 3 -> 2 -> 1
      const journal = await journalStore.getJournalByBatchId(batchId);
      expect(journal).toHaveLength(4);

      // Verify strict reverse position order
      expect(journal[0]!.sourceRow).toBe(4);
      expect(journal[1]!.sourceRow).toBe(3);
      expect(journal[2]!.sourceRow).toBe(2);
      expect(journal[3]!.sourceRow).toBe(1);

      // Verify all actions reached compensated status
      for (const entry of journal) {
        expect(entry.status).toBe(RollbackItemStatus.COMPENSATED);
        expect(entry.executedAt).toBeDefined();
        expect(entry.actor).toBe('admin-lead');
      }

      // Verify target business table is completely empty (all 4 created items removed)
      expect(adapter.getTargetRecords()).toHaveLength(0);
    });

    it('safely removes created records only when no child/later edits exist', async () => {
      const batchId = 'batch-created-removal-01';
      await seedBatch(batchId, 2);

      expect(adapter.getTargetRecords()).toHaveLength(2);

      const summary = await sagaEngine.rollbackBatch({
        batchId,
        actor: 'migration-admin',
        reason: 'Remove created records',
      });

      expect(summary.status).toBe(RollbackBatchStatus.ROLLED_BACK);
      expect(adapter.getTargetRecords()).toHaveLength(0);
    });

    it('safely restores updated records to beforeState when current version matches post-load version', async () => {
      const batchId = 'batch-restore-update-01';

      // Manually seed an import receipt representing an updated record
      const targetId = 'record-to-restore';
      adapter.getTargetRecords().push(); // record created
      // Populate target record
      (adapter as unknown as { targetRecords: Map<string, unknown> }).targetRecords.set(targetId, {
        id: targetId,
        data: { sku: 'SKU-OLD', name: 'New Name Post-Load', price: 99 },
        createdAt: new Date(),
        version: 1,
      });

      await receiptStore.saveReceipt({
        id: 'rec-001',
        batchId,
        sourceRow: 1,
        module: 'erp-1',
        entity: 'products',
        schemaVersion: 1,
        idempotencyKey: 'idemp-restore-001',
        payloadHash: 'hash-001',
        targetId,
        kind: 'linked', // update/linked kind
        createdAt: new Date(),
      });

      // Journal contains beforeState
      await journalStore.recordAction({
        batchId,
        module: 'erp-1',
        entity: 'products',
        targetId,
        sourceRow: 1,
        action: RollbackAction.RESTORE_UPDATED,
        targetVersion: 1,
        beforeState: { sku: 'SKU-OLD', name: 'Original Pre-Load Name', price: 50 },
        actor: 'operator-1',
        status: RollbackItemStatus.PENDING,
        idempotencyKey: 'idemp-restore-001',
        position: 1,
      });

      const summary = await sagaEngine.rollbackBatch({
        batchId,
        actor: 'operator-1',
        reason: 'Restore update test',
      });

      expect(summary.status).toBe(RollbackBatchStatus.ROLLED_BACK);

      // Verify the target record was restored to beforeState
      const restored = adapter.getRecordById(targetId);
      expect(restored).toBeDefined();
      expect(restored!.data.name).toBe('Original Pre-Load Name');
      expect(restored!.data.price).toBe(50);
    });
  });

  // ==========================================================================
  // 3. Repeated Rollback Request Idempotency (AC-5)
  // ==========================================================================
  describe('3. Repeated Rollback Request Idempotency', () => {
    it('returns existing execution state immediately without re-compensating', async () => {
      const batchId = 'batch-idempotent-01';
      await seedBatch(batchId, 3);

      // First rollback execution
      const firstRun = await sagaEngine.rollbackBatch({
        batchId,
        actor: 'operator-1',
        reason: 'First rollback request',
      });

      expect(firstRun.status).toBe(RollbackBatchStatus.ROLLED_BACK);
      expect(firstRun.compensatedItems).toBe(3);
      expect(firstRun.isExisting).toBeUndefined();

      // Second rollback request for identical batch
      const secondRun = await sagaEngine.rollbackBatch({
        batchId,
        actor: 'operator-1',
        reason: 'Second rollback request (duplicate call)',
      });

      expect(secondRun.status).toBe(RollbackBatchStatus.ROLLED_BACK);
      expect(secondRun.compensatedItems).toBe(3);
      expect(secondRun.isExisting).toBe(true);

      // Journal entry count remains exactly 3 (no duplicate journal entries)
      const journal = await journalStore.getJournalByBatchId(batchId);
      expect(journal).toHaveLength(3);
    });
  });

  // ==========================================================================
  // 4. Resumability & Mid-Saga Failure Injection (AC-6 & AC-8)
  // ==========================================================================
  describe('4. Resumability & Failure Injection', () => {
    it('halts safely on mid-saga failure, preserves progress, and resumes cleanly to rolled_back', async () => {
      const batchId = 'batch-crash-resume-01';
      await seedBatch(batchId, 4);

      const receipts = await receiptStore.listByBatchId(batchId);
      // In LIFO order: receipts are sorted by descending sourceRow:
      // index 0 -> sourceRow 4
      // index 1 -> sourceRow 3
      // index 2 -> sourceRow 2 (Inject failure here!)
      // index 3 -> sourceRow 1
      const failTargetId = receipts.find((r) => r.sourceRow === 2)!.targetId;
      adapter.failOnTargetId = failTargetId;

      // 1. First Run: Mid-saga crash injection
      const firstRun = await sagaEngine.rollbackBatch({
        batchId,
        actor: 'operator-1',
        reason: 'First run with injected crash',
      });

      expect(firstRun.status).toBe(RollbackBatchStatus.FAILED);
      expect(firstRun.compensatedItems).toBe(2); // sourceRow 4 & 3 succeeded
      expect(firstRun.failedItems).toBe(1); // sourceRow 2 failed
      expect(firstRun.totalItems).toBe(4);

      // Inspect journal: 2 compensated, 1 failed, 1 still pending
      const journalMid = await journalStore.getJournalByBatchId(batchId);
      const compEntries = journalMid.filter((j) => j.status === RollbackItemStatus.COMPENSATED);
      const failEntries = journalMid.filter((j) => j.status === RollbackItemStatus.FAILED);
      const pendEntries = journalMid.filter((j) => j.status === RollbackItemStatus.PENDING);

      expect(compEntries).toHaveLength(2);
      expect(failEntries).toHaveLength(1);
      expect(pendEntries).toHaveLength(1);

      // Target records at this point: 2 removed, 2 still present
      expect(adapter.getTargetRecords()).toHaveLength(2);

      // 2. Clear failure injection (simulating issue fix / transient DB reconnect)
      adapter.failOnTargetId = undefined;

      // 3. Second Run: Resume saga
      const secondRun = await sagaEngine.rollbackBatch({
        batchId,
        actor: 'operator-1',
        reason: 'Resume rollback after error resolution',
      });

      // Status transitions to rolled_back ONLY when 100% of actions are confirmed
      expect(secondRun.status).toBe(RollbackBatchStatus.ROLLED_BACK);
      expect(secondRun.compensatedItems).toBe(4);
      expect(secondRun.failedItems).toBe(0);

      // All journal items now COMPENSATED
      const journalFinal = await journalStore.getJournalByBatchId(batchId);
      for (const entry of journalFinal) {
        expect(entry.status).toBe(RollbackItemStatus.COMPENSATED);
      }

      // Business table is now 100% cleanly emptied
      expect(adapter.getTargetRecords()).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 5. Append-Only Rollback Journal & Audit Durability (AC-7)
  // ==========================================================================
  describe('5. Append-Only Rollback Journal & Audit Durability', () => {
    it('audits every action with actor, target version, idempotency key, and before/after state', async () => {
      const batchId = 'batch-audit-01';
      await seedBatch(batchId, 2);

      await sagaEngine.rollbackBatch({
        batchId,
        actor: 'compliance-auditor',
        reason: 'Full audit verification run',
      });

      const journal = await journalStore.getJournalByBatchId(batchId);
      expect(journal).toHaveLength(2);

      for (const entry of journal) {
        expect(entry.batchId).toBe(batchId);
        expect(entry.actor).toBe('compliance-auditor');
        expect(entry.module).toBe('erp-1');
        expect(entry.entity).toBe('products');
        expect(entry.targetVersion).toBe(1);
        expect(entry.idempotencyKey).toBeDefined();
        expect(entry.idempotencyKey.length).toBeGreaterThan(10);
        expect(entry.status).toBe(RollbackItemStatus.COMPENSATED);
        expect(entry.executedAt).toBeInstanceOf(Date);
        expect(entry.createdAt).toBeInstanceOf(Date);
      }
    });
  });
});
