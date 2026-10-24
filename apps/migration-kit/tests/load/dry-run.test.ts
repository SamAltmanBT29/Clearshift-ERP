import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  type CleanCrmRow,
  type MappingTemplate,
  DryRunPolicyViolationError,
  DryRunPreconditionError,
  DryRunTargetMutationForbiddenError,
  computeTargetBaselineHash,
} from '@clearshift/contracts';
import {
  BatchRegistryService,
  InMemoryBatchRepository,
  InMemoryStepLedgerRepository,
} from '../../src/batches/batch-registry.js';
import { InMemoryCleanCrmRepository } from '../../src/mapping/mapping-service.js';
import {
  DryRunPlanner,
  DefaultTargetValidator,
  DefaultCrmTargetValidator,
  type ITargetBaselineProvider,
} from '../../src/load/dry-run.js';

describe('KIT-07: Dry-Run Planner with Strict No-Target-Mutation Guarantee', () => {
  let batchRepo: InMemoryBatchRepository;
  let stepRepo: InMemoryStepLedgerRepository;
  let batchRegistry: BatchRegistryService;
  let cleanCrmRepo: InMemoryCleanCrmRepository;
  let planner: DryRunPlanner;

  // Mock Target Database State
  let targetDatabaseRecords: Record<string, unknown>[];
  let targetDatabaseReceipts: unknown[];

  beforeEach(() => {
    batchRepo = new InMemoryBatchRepository();
    stepRepo = new InMemoryStepLedgerRepository();
    batchRegistry = new BatchRegistryService(batchRepo, stepRepo);
    cleanCrmRepo = new InMemoryCleanCrmRepository();

    targetDatabaseRecords = [
      { id: '11111111-1111-1111-1111-111111111111', email: 'existing.corp@example.com', _entity: 'contacts' },
      { id: '22222222-2222-2222-2222-222222222222', companyId: 'comp-acme-1', _entity: 'companies' },
      { id: '33333333-3333-3333-3333-333333333333', sku: 'SKU-EXISTING-001', name: 'Existing Widget', price: 99.99, _entity: 'products' },
    ];
    targetDatabaseReceipts = [
      { receiptId: 'rcpt-001', targetId: '11111111-1111-1111-1111-111111111111', entity: 'contacts' },
    ];

    const baselineProvider: ITargetBaselineProvider = {
      getTargetRecords: async () => [...targetDatabaseRecords],
      getTargetReceipts: async () => [...targetDatabaseReceipts],
    };

    planner = new DryRunPlanner({
      batchRegistry,
      cleanCrmRepo,
      baselineProvider,
      validatorPort: new DefaultTargetValidator(),
      policyConfig: { maxFailureRate: 0.10 }, // 10% halt threshold
    });
  });

  async function createMappedBatch(module: string = 'crm'): Promise<string> {
    const batch = await batchRegistry.createBatch({
      module,
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ruleVersion: '1.0.0',
    });

    // Advance through the standard pipeline to mapped
    await batchRegistry.transitionBatch(batch.id, { targetStatus: 'extracting', stepName: 'extract' });
    await batchRegistry.transitionBatch(batch.id, { targetStatus: 'extracted', stepName: 'extract' });
    await batchRegistry.transitionBatch(batch.id, { targetStatus: 'profiled', stepName: 'profile' });
    await batchRegistry.transitionBatch(batch.id, { targetStatus: 'cleaned', stepName: 'clean' });
    await batchRegistry.transitionBatch(batch.id, { targetStatus: 'mapped', stepName: 'map' });

    return batch.id;
  }

  describe('1. Strict No-Target-Mutation Guarantee & Zero Write Invocations', () => {
    it('executes dry run with zero mutation calls and leaves target tables and receipts untouched', async () => {
      const batchId = await createMappedBatch();

      // Seed mapped rows in clean CRM repository
      const mappedRows: CleanCrmRow[] = [
        {
          id: 'row-1',
          batchId,
          sourceRow: 1,
          payload: { firstName: 'Alice', lastName: 'Walker', email: 'alice.w@example.com', leadStatus: 'New' },
        },
        {
          id: 'row-2',
          batchId,
          sourceRow: 2,
          payload: { firstName: 'Bob', lastName: 'Builder', email: 'bob.b@example.com', leadStatus: 'Qualified' },
        },
      ];
      await cleanCrmRepo.saveRows(mappedRows);

      // Deep snapshot of target records and receipts before dry run
      const targetRecordsSnapshotBefore = JSON.stringify(targetDatabaseRecords);
      const targetReceiptsSnapshotBefore = JSON.stringify(targetDatabaseReceipts);

      // Mock target adapter write API to verify zero calls
      const mockTargetAdapter = {
        importRow: vi.fn().mockRejectedValue(new Error('importRow must never be called during dry run')),
        createReceipt: vi.fn().mockRejectedValue(new Error('createReceipt must never be called during dry run')),
      };

      const report = await planner.executeDryRun({
        batchId,
        mappingChecksum: 'a'.repeat(64),
        targetRecords: targetDatabaseRecords,
      });

      // 1. Target write API must have 0 invocations
      expect(mockTargetAdapter.importRow).toHaveBeenCalledTimes(0);
      expect(mockTargetAdapter.createReceipt).toHaveBeenCalledTimes(0);

      // 2. Database snapshots before and after must be byte-for-byte identical
      expect(JSON.stringify(targetDatabaseRecords)).toBe(targetRecordsSnapshotBefore);
      expect(JSON.stringify(targetDatabaseReceipts)).toBe(targetReceiptsSnapshotBefore);

      // 3. Report guarantees 0 write calls and 0 receipts created
      expect(report.targetWriteCalls).toBe(0);
      expect(report.targetReceiptsCreated).toBe(0);
    });

    it('mutation guard throws DryRunTargetMutationForbiddenError if any write is attempted', () => {
      const mockService = {
        query: () => 'read ok',
        importRecord: () => 'should be blocked',
        insertRow: () => 'should be blocked',
        updateRecord: () => 'should be blocked',
      };

      const guarded = planner.createTargetMutationGuard(mockService);

      expect(guarded.query()).toBe('read ok');
      expect(() => guarded.importRecord()).toThrow(DryRunTargetMutationForbiddenError);
      expect(() => guarded.insertRow()).toThrow(DryRunTargetMutationForbiddenError);
      expect(() => guarded.updateRecord()).toThrow(DryRunTargetMutationForbiddenError);
    });
  });

  describe('2. Exact Row Conservation Invariant', () => {
    it('enforces source = loaded + rejected + merged + skipped; unaccounted = 0', async () => {
      const batchId = await createMappedBatch();

      const mappedRows: CleanCrmRow[] = [
        // 1. Valid new row -> planned 'loaded'
        {
          id: 'row-1',
          batchId,
          sourceRow: 1,
          payload: { firstName: 'Diana', lastName: 'Prince', email: 'diana@themyscira.io', leadStatus: 'New' },
        },
        // 2. Exact match with existing target record -> planned 'merged'
        {
          id: 'row-2',
          batchId,
          sourceRow: 2,
          payload: { firstName: 'Existing', lastName: 'Corp', email: 'existing.corp@example.com', leadStatus: 'Qualified' },
        },
        // 3. Intra-batch duplicate with row 1 -> planned 'merged'
        {
          id: 'row-3',
          batchId,
          sourceRow: 3,
          payload: { firstName: 'Diana', lastName: 'Prince', email: 'diana@themyscira.io', leadStatus: 'Working' },
        },
        // 4. Invalid leadStatus -> planned 'rejected'
        {
          id: 'row-4',
          batchId,
          sourceRow: 4,
          payload: { firstName: 'Clark', lastName: 'Kent', email: 'clark@dailyplanet.com', leadStatus: 'InvalidStatus' },
        },
        // 5. Valid new row with parent company reference -> planned 'loaded'
        {
          id: 'row-5',
          batchId,
          sourceRow: 5,
          payload: { firstName: 'Bruce', lastName: 'Wayne', email: 'bruce@wayne.com', companyId: 'comp-acme-1', leadStatus: 'Closed' },
        },
      ];
      await cleanCrmRepo.saveRows(mappedRows);

      const report = await planner.executeDryRun({
        batchId,
        mappingChecksum: 'b'.repeat(64),
        targetRecords: targetDatabaseRecords,
        policyConfig: { maxFailureRate: 0.30 }, // 30% allowance for this test
      });

      const { total, loaded, rejected, merged, skipped, unaccounted } = report.plannedCounts;

      expect(total).toBe(5);
      expect(loaded).toBe(2); // Diana (row 1), Bruce (row 5)
      expect(merged).toBe(2); // Existing (row 2), duplicate Diana (row 3)
      expect(rejected).toBe(1); // Invalid lead status (row 4)
      expect(skipped).toBe(0);
      expect(unaccounted).toBe(0);
      expect(total).toBe(loaded + rejected + merged + skipped);
    });
  });

  describe('3. 40%-Invalid Fixture Policy Failure & Load Prevention', () => {
    it('fails policy on 40%-invalid fixture, sets batch to failed, and strictly prevents real load', async () => {
      const batchId = await createMappedBatch();

      // 10 total rows: 6 valid, 4 invalid (40% invalid rate > 10% threshold)
      const mappedRows: CleanCrmRow[] = [
        // 6 Valid rows
        { id: 'r1', batchId, sourceRow: 1, payload: { firstName: 'User1', lastName: 'Test', email: 'u1@test.com', leadStatus: 'New' } },
        { id: 'r2', batchId, sourceRow: 2, payload: { firstName: 'User2', lastName: 'Test', email: 'u2@test.com', leadStatus: 'New' } },
        { id: 'r3', batchId, sourceRow: 3, payload: { firstName: 'User3', lastName: 'Test', email: 'u3@test.com', leadStatus: 'Working' } },
        { id: 'r4', batchId, sourceRow: 4, payload: { firstName: 'User4', lastName: 'Test', email: 'u4@test.com', leadStatus: 'Qualified' } },
        { id: 'r5', batchId, sourceRow: 5, payload: { firstName: 'User5', lastName: 'Test', email: 'u5@test.com', leadStatus: 'Closed' } },
        { id: 'r6', batchId, sourceRow: 6, payload: { firstName: 'User6', lastName: 'Test', email: 'u6@test.com', leadStatus: 'New' } },
        // 4 Invalid rows (40%)
        { id: 'r7', batchId, sourceRow: 7, payload: { firstName: '', lastName: 'MissingFirst', email: 'u7@test.com' } }, // Missing firstName
        { id: 'r8', batchId, sourceRow: 8, payload: { firstName: 'User8', lastName: '', email: 'u8@test.com' } }, // Missing lastName
        { id: 'r9', batchId, sourceRow: 9, payload: { firstName: 'User9', lastName: 'Test', email: 'not-an-email' } }, // Malformed email
        { id: 'r10', batchId, sourceRow: 10, payload: { firstName: 'User10', lastName: 'Test', email: 'u10@test.com', leadStatus: 'BOGUS_STATUS' } }, // Invalid enum
      ];
      await cleanCrmRepo.saveRows(mappedRows);

      const mappingChecksum = 'c'.repeat(64);
      const report = await planner.executeDryRun({
        batchId,
        mappingChecksum,
        targetRecords: targetDatabaseRecords,
        policyConfig: { maxFailureRate: 0.10 }, // 10% maximum failure rate (Decision C9)
      });

      // 1. Policy must fail
      expect(report.policyPassed).toBe(false);
      expect(report.canProceedToLoad).toBe(false);
      expect(report.failureRate).toBe(0.40);
      expect(report.plannedCounts.rejected).toBe(4);
      expect(report.plannedCounts.total).toBe(10);
      expect(report.rejections).toHaveLength(4);

      // 2. Batch status must transition to 'failed' with threshold violation error code
      const updatedBatch = await batchRegistry.getBatch(batchId);
      expect(updatedBatch?.status).toBe('failed');
      expect(updatedBatch?.errorCode).toBe('POLICY_VIOLATION_THRESHOLD_EXCEEDED');

      // 3. Attempting to execute load precondition check MUST throw DryRunPolicyViolationError
      expect(() => {
        planner.assertCanExecuteLoad(report, {
          batchId,
          token: report.token,
          currentTargetBaselineHash: report.targetBaselineHash,
          currentMappingChecksum: mappingChecksum,
          currentRuleVersion: '1.0.0',
        });
      }).toThrow(DryRunPolicyViolationError);
    });
  });

  describe('4. Token Invalidation on Target Baseline Drift', () => {
    it('invalidates prior dry-run token when target baseline data changes', async () => {
      const batchId = await createMappedBatch();

      const mappedRows: CleanCrmRow[] = [
        { id: 'r1', batchId, sourceRow: 1, payload: { firstName: 'Grace', lastName: 'Hopper', email: 'grace@navy.mil', leadStatus: 'Qualified' } },
      ];
      await cleanCrmRepo.saveRows(mappedRows);

      const mappingChecksum = 'd'.repeat(64);
      const initialBaseline = [...targetDatabaseRecords];
      const initialBaselineHash = computeTargetBaselineHash(initialBaseline);

      const report = await planner.executeDryRun({
        batchId,
        mappingChecksum,
        targetRecords: initialBaseline,
      });

      expect(report.policyPassed).toBe(true);
      expect(report.canProceedToLoad).toBe(true);

      // Precondition check with identical baseline succeeds
      const checkResult = planner.assertCanExecuteLoad(report, {
        batchId,
        token: report.token,
        currentTargetBaselineHash: initialBaselineHash,
        currentMappingChecksum: mappingChecksum,
        currentRuleVersion: '1.0.0',
      });
      expect(checkResult.ok).toBe(true);

      // Drift simulated: new record added to target database
      const driftedBaseline = [
        ...initialBaseline,
        { id: 'newly-created-external-id', email: 'external.actor@corp.com', _entity: 'contacts' },
      ];
      const driftedBaselineHash = computeTargetBaselineHash(driftedBaseline);
      expect(driftedBaselineHash).not.toBe(initialBaselineHash);

      // Precondition check with drifted baseline must throw DryRunPreconditionError (BASELINE_DRIFT)
      expect(() => {
        planner.assertCanExecuteLoad(report, {
          batchId,
          token: report.token,
          currentTargetBaselineHash: driftedBaselineHash,
          currentMappingChecksum: mappingChecksum,
          currentRuleVersion: '1.0.0',
        });
      }).toThrow(DryRunPreconditionError);

      try {
        planner.assertCanExecuteLoad(report, {
          batchId,
          token: report.token,
          currentTargetBaselineHash: driftedBaselineHash,
          currentMappingChecksum: mappingChecksum,
          currentRuleVersion: '1.0.0',
        });
      } catch (err: any) {
        expect(err.reason).toBe('BASELINE_DRIFT');
        expect(err.message).toContain('Target baseline drift detected');
      }
    });
  });

  describe('5. Token Invalidation on Mapping or Rule Change', () => {
    it('invalidates prior dry-run token when mapping checksum or rule version changes', async () => {
      const batchId = await createMappedBatch();

      const mappedRows: CleanCrmRow[] = [
        { id: 'r1', batchId, sourceRow: 1, payload: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@computing.org', leadStatus: 'New' } },
      ];
      await cleanCrmRepo.saveRows(mappedRows);

      const originalMappingChecksum = 'e'.repeat(64);
      const report = await planner.executeDryRun({
        batchId,
        mappingChecksum: originalMappingChecksum,
        ruleVersion: '1.0.0',
        targetRecords: targetDatabaseRecords,
      });

      // 1. Changed mapping checksum invalidates token
      const modifiedMappingChecksum = 'f'.repeat(64);
      expect(() => {
        planner.assertCanExecuteLoad(report, {
          batchId,
          token: report.token,
          currentTargetBaselineHash: report.targetBaselineHash,
          currentMappingChecksum: modifiedMappingChecksum,
          currentRuleVersion: '1.0.0',
        });
      }).toThrow(DryRunPreconditionError);

      // 2. Changed rule version invalidates token
      expect(() => {
        planner.assertCanExecuteLoad(report, {
          batchId,
          token: report.token,
          currentTargetBaselineHash: report.targetBaselineHash,
          currentMappingChecksum: originalMappingChecksum,
          currentRuleVersion: '1.1.0', // bumped version
        });
      }).toThrow(DryRunPreconditionError);
    });

    it('rejects tampered or forged dry-run token', async () => {
      const batchId = await createMappedBatch();
      const mappedRows: CleanCrmRow[] = [
        { id: 'r1', batchId, sourceRow: 1, payload: { firstName: 'Alan', lastName: 'Turing', email: 'alan@bletchley.uk', leadStatus: 'New' } },
      ];
      await cleanCrmRepo.saveRows(mappedRows);

      const mappingChecksum = '1'.repeat(64);
      const report = await planner.executeDryRun({
        batchId,
        mappingChecksum,
        targetRecords: targetDatabaseRecords,
      });

      expect(() => {
        planner.assertCanExecuteLoad(report, {
          batchId,
          token: 'forged_token_0000000000000000000000000000000000000000000000000000000',
          currentTargetBaselineHash: report.targetBaselineHash,
          currentMappingChecksum: mappingChecksum,
          currentRuleVersion: '1.0.0',
        });
      }).toThrow(DryRunPreconditionError);
    });
  });

  describe('6. Clean Fixture Success & State Machine Progression', () => {
    it('successfully plans clean dataset and transitions batch to dry_run_passed', async () => {
      const batchId = await createMappedBatch();

      const mappedRows: CleanCrmRow[] = [
        { id: 'r1', batchId, sourceRow: 1, payload: { firstName: 'Linus', lastName: 'Torvalds', email: 'linus@kernel.org', leadStatus: 'Qualified' } },
        { id: 'r2', batchId, sourceRow: 2, payload: { firstName: 'Margaret', lastName: 'Hamilton', email: 'margaret@apollo.nasa.gov', leadStatus: 'New' } },
      ];
      await cleanCrmRepo.saveRows(mappedRows);

      const mappingChecksum = '2'.repeat(64);
      const report = await planner.executeDryRun({
        batchId,
        mappingChecksum,
        targetRecords: targetDatabaseRecords,
      });

      expect(report.policyPassed).toBe(true);
      expect(report.canProceedToLoad).toBe(true);
      expect(report.failureRate).toBe(0);
      expect(report.plannedCounts.loaded).toBe(2);
      expect(report.plannedCounts.rejected).toBe(0);

      // Batch status should be dry_run_passed
      const updatedBatch = await batchRegistry.getBatch(batchId);
      expect(updatedBatch?.status).toBe('dry_run_passed');
      expect(updatedBatch?.checkpoint).toBe('dry_run_passed');

      // Verify assertCanExecuteLoad passes
      const loadPrecondition = planner.assertCanExecuteLoad(report, {
        batchId,
        token: report.token,
        currentTargetBaselineHash: report.targetBaselineHash,
        currentMappingChecksum: mappingChecksum,
        currentRuleVersion: '1.0.0',
      });
      expect(loadPrecondition.ok).toBe(true);
      expect(loadPrecondition.planId).toBe(report.planId);
      expect(loadPrecondition.token).toBe(report.token);
    });
  });

  describe('7. Determinism and Append-Only Ledger', () => {
    it('produces byte-for-byte identical dry-run token for identical inputs', async () => {
      const batchId1 = await createMappedBatch();
      const batchId2 = await createMappedBatch();

      const payload = { firstName: 'Claude', lastName: 'Shannon', email: 'claude@bell.com', leadStatus: 'New' };
      await cleanCrmRepo.saveRows([{ id: 'r1', batchId: batchId1, sourceRow: 1, payload }]);
      await cleanCrmRepo.saveRows([{ id: 'r2', batchId: batchId2, sourceRow: 1, payload }]);

      const mappingChecksum = '3'.repeat(64);
      const report1 = await planner.executeDryRun({
        batchId: batchId1,
        mappingChecksum,
        targetRecords: targetDatabaseRecords,
      });

      const report2 = await planner.executeDryRun({
        batchId: batchId2,
        mappingChecksum,
        targetRecords: targetDatabaseRecords,
      });

      expect(report1.plannedCounts).toEqual(report2.plannedCounts);
      expect(report1.targetBaselineHash).toBe(report2.targetBaselineHash);
    });

    it('persists immutable step ledger record in kit_batch_steps with telemetry', async () => {
      const batchId = await createMappedBatch();
      const mappedRows: CleanCrmRow[] = [
        { id: 'r1', batchId, sourceRow: 1, payload: { firstName: 'Barbara', lastName: 'Liskov', email: 'barbara@mit.edu', leadStatus: 'Qualified' } },
      ];
      await cleanCrmRepo.saveRows(mappedRows);

      const mappingChecksum = '4'.repeat(64);
      await planner.executeDryRun({
        batchId,
        mappingChecksum,
        targetRecords: targetDatabaseRecords,
      });

      const steps = await stepRepo.findByBatchId(batchId);
      const dryRunStep = steps.find((s) => s.stepName === 'dry_run');

      expect(dryRunStep).toBeDefined();
      expect(dryRunStep?.fromStatus).toBe('mapped');
      expect(dryRunStep?.toStatus).toBe('dry_run_passed');
      expect(dryRunStep?.recordsIn).toBe(1);
      expect(dryRunStep?.recordsOut).toBe(1);
      expect(dryRunStep?.recordsRejected).toBe(0);
      expect(dryRunStep?.metadata).toHaveProperty('token');
      expect(dryRunStep?.metadata).toHaveProperty('policyPassed', true);
    });
  });

  describe('8. ERP Target Entity Validation Support', () => {
    it('validates ERP product rows with sku, name, price, handling intra-batch duplicates and invalid price', async () => {
      const batchId = await createMappedBatch('erp-1');

      const mappedRows: CleanCrmRow[] = [
        // 1. Valid new product -> loaded
        {
          id: 'p-1',
          batchId,
          sourceRow: 1,
          payload: { sku: 'SKU-NEW-001', name: 'Bolt M8', price: 1.50 },
        },
        // 2. Intra-batch duplicate SKU -> merged
        {
          id: 'p-2',
          batchId,
          sourceRow: 2,
          payload: { sku: 'SKU-NEW-001', name: 'Bolt M8 Extra', price: 1.50 },
        },
        // 3. Baseline duplicate SKU -> merged
        {
          id: 'p-3',
          batchId,
          sourceRow: 3,
          payload: { sku: 'SKU-EXISTING-001', name: 'Existing Widget V2', price: 99.99 },
        },
        // 4. Negative price -> rejected
        {
          id: 'p-4',
          batchId,
          sourceRow: 4,
          payload: { sku: 'SKU-BAD-001', name: 'Negative Item', price: -5.0 },
        },
      ];
      await cleanCrmRepo.saveRows(mappedRows);

      const report = await planner.executeDryRun({
        batchId,
        mappingChecksum: '5'.repeat(64),
        targetRecords: targetDatabaseRecords,
        policyConfig: { maxFailureRate: 0.30 },
      });

      expect(report.plannedCounts.total).toBe(4);
      expect(report.plannedCounts.loaded).toBe(1);
      expect(report.plannedCounts.merged).toBe(2);
      expect(report.plannedCounts.rejected).toBe(1);
      expect(report.plannedCounts.unaccounted).toBe(0);
      expect(report.rejections[0]?.message).toContain('Price cannot be negative');
    });
  });
});
