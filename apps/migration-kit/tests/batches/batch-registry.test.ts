import { describe, it, expect, beforeEach } from 'vitest';
import {
  BatchRegistryService,
  InMemoryBatchRepository,
  InMemoryStepLedgerRepository,
} from '../../src/batches/batch-registry.js';
import {
  IllegalBatchStateTransitionError,
  ImmutableStepLedgerError,
} from '@clearshift/contracts';
import { AuditService, InMemoryAuditRepository } from '@cs/core';

describe('BatchRegistryService & Immutable Step Ledger (KIT-01)', () => {
  let batchRepo: InMemoryBatchRepository;
  let ledgerRepo: InMemoryStepLedgerRepository;
  let auditRepo: InMemoryAuditRepository;
  let auditService: AuditService;
  let service: BatchRegistryService;

  beforeEach(() => {
    batchRepo = new InMemoryBatchRepository();
    ledgerRepo = new InMemoryStepLedgerRepository();
    auditRepo = new InMemoryAuditRepository();
    auditService = new AuditService(auditRepo);
    service = new BatchRegistryService(batchRepo, ledgerRepo, auditService);
  });

  // ---------------------------------------------------------------------------
  // 1. Batch Creation & Initial Ledger State
  // ---------------------------------------------------------------------------
  describe('Batch Creation', () => {
    it('creates batch in created status with attempt=1 and initial ledger entry', async () => {
      const batch = await service.createBatch({
        module: 'crm-1',
        sourceSystem: 'legacy_salesforce',
        fileName: 'contacts_2026.csv',
        fileSizeBytes: 1048576,
        checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        totalRows: 1000,
        createdBy: 'migration_admin',
        correlationId: 'corr-init-001',
      });

      expect(batch.id).toBeDefined();
      expect(batch.batchNumber).toMatch(/^B-/);
      expect(batch.status).toBe('created');
      expect(batch.checkpoint).toBe('created');
      expect(batch.attempt).toBe(1);
      expect(batch.maxAttempts).toBe(3);
      expect(batch.totalRows).toBe(1000);
      expect(batch.unaccountedRows).toBe(1000);
      expect(batch.correlationId).toBe('corr-init-001');

      // Verify initial immutable step ledger entry
      const steps = await service.getStepLedger(batch.id);
      expect(steps).toHaveLength(1);
      expect(steps[0].stepNumber).toBe(1);
      expect(steps[0].stepName).toBe('extract');
      expect(steps[0].fromStatus).toBe('created');
      expect(steps[0].toStatus).toBe('created');
      expect(steps[0].checkpoint).toBe('created');

      // Verify audit trail logged creation
      const auditLogs = await auditService.query({ batchId: batch.id });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].action).toBe('kit.batch.created');
      expect(auditLogs[0].actor).toBe('migration_admin');
      expect(auditLogs[0].result).toBe('success');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Full Pipeline Transition Sequence (Created -> Reconciled)
  // ---------------------------------------------------------------------------
  describe('Full Pipeline Progression', () => {
    it('executes the full 7-step migration pipeline through terminal reconciled state', async () => {
      const batch = await service.createBatch({
        module: 'crm-1',
        checksum: 'a'.repeat(64),
        totalRows: 1000,
        createdBy: 'operator_1',
      });

      // Step 1: Extracting -> Extracted
      await service.transitionBatch(batch.id, {
        targetStatus: 'extracting',
        actor: 'worker_extract',
      });
      await service.transitionBatch(batch.id, {
        targetStatus: 'extracted',
        recordsIn: 1000,
        recordsOut: 1000,
        actor: 'worker_extract',
      });

      // Step 2: Profiled
      await service.transitionBatch(batch.id, {
        targetStatus: 'profiled',
        actor: 'worker_profile',
      });

      // Step 3: Cleaned
      await service.transitionBatch(batch.id, {
        targetStatus: 'cleaned',
        recordsIn: 1000,
        recordsOut: 980,
        recordsRejected: 20,
        actor: 'worker_clean',
      });

      // Step 4: Mapped
      await service.transitionBatch(batch.id, {
        targetStatus: 'mapped',
        actor: 'worker_map',
      });

      // Step 5: Dry-Run Passed
      await service.transitionBatch(batch.id, {
        targetStatus: 'dry_run_passed',
        actor: 'worker_dryrun',
      });

      // Step 6: Loading -> Loaded
      await service.transitionBatch(batch.id, {
        targetStatus: 'loading',
        actor: 'worker_loader',
      });
      await service.transitionBatch(batch.id, {
        targetStatus: 'loaded',
        recordsIn: 1000,
        recordsOut: 850, // loaded
        recordsRejected: 80, // rejected
        recordsMerged: 50, // merged
        recordsSkipped: 20, // skipped
        actor: 'worker_loader',
      });

      // Step 7: Validating -> Validated
      await service.transitionBatch(batch.id, {
        targetStatus: 'validating',
        actor: 'worker_validate',
      });
      await service.transitionBatch(batch.id, {
        targetStatus: 'validated',
        actor: 'worker_validate',
      });

      // Step 8: Reconciled (850 + 80 + 50 + 20 = 1000)
      const reconciledBatch = await service.transitionBatch(batch.id, {
        targetStatus: 'reconciled',
        recordsOut: 850,
        recordsRejected: 80,
        recordsMerged: 50,
        recordsSkipped: 20,
        actor: 'worker_reconcile',
      });

      expect(reconciledBatch.status).toBe('reconciled');
      expect(reconciledBatch.checkpoint).toBe('reconciled');
      expect(reconciledBatch.loadedRows).toBe(850);
      expect(reconciledBatch.rejectedRows).toBe(80);
      expect(reconciledBatch.mergedRows).toBe(50);
      expect(reconciledBatch.skippedRows).toBe(20);
      expect(reconciledBatch.unaccountedRows).toBe(0);
      expect(reconciledBatch.finishedAt).toBeInstanceOf(Date);

      // Verify immutable step ledger has every transition recorded in order
      const steps = await service.getStepLedger(batch.id);
      expect(steps.length).toBe(12); // initial (1) + 11 transitions
      const stepNumbers = steps.map((s) => s.stepNumber);
      expect(stepNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

      // Verify every transition was audited
      const logs = await auditService.query({ batchId: batch.id });
      expect(logs.length).toBe(12); // 1 create + 11 transitions
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Reconciliation Invariant Enforcement
  // ---------------------------------------------------------------------------
  describe('Reconciliation Invariant Guard', () => {
    it('blocks transition to reconciled if unaccounted rows > 0', async () => {
      const batch = await service.createBatch({
        module: 'crm-1',
        checksum: 'b'.repeat(64),
        totalRows: 1000,
      });

      // Advance batch up to validated
      await service.transitionBatch(batch.id, { targetStatus: 'extracting' });
      await service.transitionBatch(batch.id, { targetStatus: 'extracted' });
      await service.transitionBatch(batch.id, { targetStatus: 'profiled' });
      await service.transitionBatch(batch.id, { targetStatus: 'cleaned' });
      await service.transitionBatch(batch.id, { targetStatus: 'mapped' });
      await service.transitionBatch(batch.id, { targetStatus: 'dry_run_passed' });
      await service.transitionBatch(batch.id, { targetStatus: 'loading' });
      await service.transitionBatch(batch.id, { targetStatus: 'loaded' });
      await service.transitionBatch(batch.id, { targetStatus: 'validating' });
      await service.transitionBatch(batch.id, { targetStatus: 'validated' });

      // Attempt to reconcile with sum = 900 != 1000 (100 unaccounted rows)
      await expect(
        service.transitionBatch(batch.id, {
          targetStatus: 'reconciled',
          recordsOut: 800,
          recordsRejected: 50,
          recordsMerged: 50,
          recordsSkipped: 0,
        })
      ).rejects.toThrow(IllegalBatchStateTransitionError);

      // Verify state was not modified
      const current = await service.getBatchById(batch.id);
      expect(current?.status).toBe('validated');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Failure, Resumption & Max Attempts Guard
  // ---------------------------------------------------------------------------
  describe('Failure & Checkpoint Resumption', () => {
    it('resumes from committed checkpoint and increments attempt counter', async () => {
      const batch = await service.createBatch({
        module: 'crm-1',
        checksum: 'c'.repeat(64),
        totalRows: 500,
      });

      await service.transitionBatch(batch.id, { targetStatus: 'extracting' });
      await service.transitionBatch(batch.id, { targetStatus: 'extracted' });
      await service.transitionBatch(batch.id, { targetStatus: 'profiled' });
      await service.transitionBatch(batch.id, { targetStatus: 'cleaned' });
      await service.transitionBatch(batch.id, { targetStatus: 'mapped' });
      await service.transitionBatch(batch.id, { targetStatus: 'dry_run_passed' });
      await service.transitionBatch(batch.id, { targetStatus: 'loading' });

      // Fail partially
      const failedBatch = await service.transitionBatch(batch.id, {
        targetStatus: 'load_failed_partial',
        errorCode: 'ERR_WORKER_TIMEOUT',
        errorMessage: 'Worker timed out during database batch insertion',
      });

      expect(failedBatch.status).toBe('load_failed_partial');
      expect(failedBatch.checkpoint).toBe('load_checkpoint');

      // Operator triggers resume
      const resumedBatch = await service.resumeBatch(batch.id, {
        actor: 'lead_engineer',
        reason: 'transient_network_resolved',
      });

      expect(resumedBatch.status).toBe('loading');
      expect(resumedBatch.attempt).toBe(2);
      expect(resumedBatch.errorCode).toBeNull();
    });

    it('blocks resumption beyond max attempts', async () => {
      const batch = await service.createBatch({
        module: 'crm-1',
        checksum: 'd'.repeat(64),
        totalRows: 100,
      });

      await service.transitionBatch(batch.id, { targetStatus: 'extracting' });
      await service.transitionBatch(batch.id, { targetStatus: 'failed' });

      // Attempt 1 -> 2
      await service.resumeBatch(batch.id);
      await service.transitionBatch(batch.id, { targetStatus: 'failed' });

      // Attempt 2 -> 3
      await service.resumeBatch(batch.id);
      await service.transitionBatch(batch.id, { targetStatus: 'failed' });

      // Attempt 3: max attempts (3) reached!
      await expect(service.resumeBatch(batch.id)).rejects.toThrow(
        /exceeded maximum allowed attempts/
      );
    });

    it('blocks resume on non-resumable states (e.g. reconciled or loading)', async () => {
      const batch = await service.createBatch({
        module: 'crm-1',
        checksum: 'e'.repeat(64),
      });

      await expect(service.resumeBatch(batch.id)).rejects.toThrow(
        IllegalBatchStateTransitionError
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Immutability of Step Ledger
  // ---------------------------------------------------------------------------
  describe('Immutable Step Ledger', () => {
    it('throws ImmutableStepLedgerError when attempting to update or delete ledger records', () => {
      expect(() => ledgerRepo.update()).toThrow(ImmutableStepLedgerError);
      expect(() => ledgerRepo.delete()).toThrow(ImmutableStepLedgerError);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Batch Queries and Filtering
  // ---------------------------------------------------------------------------
  describe('Batch Queries', () => {
    it('retrieves batch by id and batch number', async () => {
      const created = await service.createBatch({
        module: 'crm-1',
        batchNumber: 'B-CRM1-TEST-42',
        checksum: 'f'.repeat(64),
      });

      const byId = await service.getBatchById(created.id);
      expect(byId?.batchNumber).toBe('B-CRM1-TEST-42');

      const byNum = await service.getBatchByNumber('B-CRM1-TEST-42');
      expect(byNum?.id).toBe(created.id);
    });

    it('lists batches filtered by module and status', async () => {
      await service.createBatch({ module: 'crm-1', checksum: '1'.repeat(64) });
      const b2 = await service.createBatch({ module: 'crm-5', checksum: '2'.repeat(64) });
      await service.transitionBatch(b2.id, { targetStatus: 'extracting' });

      const crm1List = await service.listBatches({ module: 'crm-1' });
      expect(crm1List).toHaveLength(1);

      const extractingList = await service.listBatches({ status: 'extracting' });
      expect(extractingList).toHaveLength(1);
      expect(extractingList[0].id).toBe(b2.id);
    });
  });
});
