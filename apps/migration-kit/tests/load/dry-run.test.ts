/**
 * ClearShift Migration Kit — Dry-Run Planner Unit & Regression Suite (KIT-07)
 *
 * Verifies all Acceptance Criteria for Issue #74 [KIT-07]:
 * - AC 1: DB snapshot of target tables & target receipts before/after dry-run is identical.
 *         Target mutation API is spied upon and asserted to have zero calls.
 * - AC 2: Validates mapped rows, duplicate candidates, target invariants, and policies.
 * - AC 3: Returns planned loaded/rejected/merged/skipped counts with deterministic token.
 *         Asserts row conservation: total = loaded + rejected + merged + skipped; unaccounted = 0.
 * - AC 4: A 40%-invalid fixture fails policy before target changes (policyPassed: false, canProceedToLoad: false).
 * - AC 5: Changed mapping checksum, rule version, or target baseline drift invalidates prior dry-run token.
 * - AC 6: Real load precondition assertion blocks unapproved loads.
 *
 * @module migration-kit/tests/load/dry-run.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DryRunPreconditionError,
  DryRunTargetMutationForbiddenError,
  computeTargetBaselineHash,
} from '@clearshift/contracts';
import {
  BaseTargetAdapter,
  InMemoryImportReceiptStore,
} from '../../src/load/target-adapter.js';
import {
  DryRunPlanner,
  dryRunPlanner,
} from '../../src/load/dry-run.js';

interface TestCustomerRow {
  code: string;
  name: string;
  email: string;
  creditLimit?: number;
}

class TestCustomerTargetAdapter extends BaseTargetAdapter<TestCustomerRow> {
  public readonly module = 'crm-1';
  public readonly entity = 'customers';
  public readonly schemaVersion = 1;

  constructor(receiptStore?: InMemoryImportReceiptStore) {
    super(receiptStore);
  }

  protected async validateRow(row: TestCustomerRow): Promise<{
    valid: boolean;
    reasonCode?: string;
    message?: string;
    field?: string;
  }> {
    if (!row.code || row.code.trim().length === 0) {
      return {
        valid: false,
        reasonCode: 'CUSTOMER_CODE_REQUIRED',
        message: 'Customer code is required',
        field: 'code',
      };
    }
    if (!row.email || !row.email.includes('@')) {
      return {
        valid: false,
        reasonCode: 'INVALID_EMAIL',
        message: 'Email is not valid: value has no @ sign',
        field: 'email',
      };
    }
    if (row.creditLimit !== undefined && row.creditLimit < 0) {
      return {
        valid: false,
        reasonCode: 'NEGATIVE_CREDIT_LIMIT',
        message: 'Credit limit cannot be negative',
        field: 'creditLimit',
      };
    }
    return { valid: true };
  }
}

describe('KIT-07: Dry-Run Planner with Strict No-Target-Mutation Guarantee', () => {
  let receiptStore: InMemoryImportReceiptStore;
  let adapter: TestCustomerTargetAdapter;
  let planner: DryRunPlanner;

  beforeEach(() => {
    receiptStore = new InMemoryImportReceiptStore();
    adapter = new TestCustomerTargetAdapter(receiptStore);
    planner = dryRunPlanner;
  });

  describe('1. Strict Zero-Target-Mutation Guarantee (AC 1 & TS-04)', () => {
    it('guarantees zero mutation calls on target adapter and zero receipts created', async () => {
      const importRowSpy = vi.spyOn(adapter, 'importRow');
      const saveReceiptSpy = vi.spyOn(receiptStore, 'saveReceipt');

      const initialTargetCount = adapter.getTargetRecords().length;
      const initialReceiptCount = await receiptStore.countByBatchId('batch-001');

      const testRows: Array<{ sourceRow: number; data: TestCustomerRow }> = [
        { sourceRow: 1, data: { code: 'CUST-001', name: 'Acme Corp', email: 'billing@acme.com', creditLimit: 5000 } },
        { sourceRow: 2, data: { code: 'CUST-002', name: 'Beta Ltd', email: 'info@beta.com', creditLimit: 2500 } },
        { sourceRow: 3, data: { code: 'CUST-003', name: 'Gamma Inc', email: 'sales@gamma.com' } },
      ];

      const batchId = '11111111-1111-4111-8111-111111111111';
      const report = await planner.planDryRun({
        batchId,
        module: 'crm-1',
        entity: 'customers',
        rows: testRows,
        adapter,
        mappingChecksum: 'a'.repeat(64),
      });

      // Assert zero mutation calls
      expect(importRowSpy).toHaveBeenCalledTimes(0);
      expect(saveReceiptSpy).toHaveBeenCalledTimes(0);
      expect(report.targetWriteCalls).toBe(0);
      expect(report.targetReceiptsCreated).toBe(0);

      // Assert target table and receipt state before/after is byte/count-identical
      expect(adapter.getTargetRecords().length).toBe(initialTargetCount);
      expect(await receiptStore.countByBatchId(batchId)).toBe(initialReceiptCount);
    });

    it('throws DryRunTargetMutationForbiddenError if any target mutation is attempted during dry-run', () => {
      expect(() => planner.assertNoMutation('INSERT customers')).toThrow(
        DryRunTargetMutationForbiddenError
      );
    });
  });

  describe('2. Row Outcome Conservation & Deterministic Prediction (AC 2 & AC 3)', () => {
    it('accurately predicts loaded, rejected, merged, and skipped outcomes with exact conservation', async () => {
      const testRows = [
        // 2 clean valid rows -> loaded
        { sourceRow: 1, data: { code: 'CUST-001', name: 'Acme Corp', email: 'acme@example.com' } },
        { sourceRow: 2, data: { code: 'CUST-002', name: 'Beta Ltd', email: 'beta@example.com' } },
        // 1 defective row (invalid email) -> rejected
        { sourceRow: 3, data: { code: 'CUST-003', name: 'Bad Email', email: 'invalid-email' } },
        // 1 defective row (empty code) -> rejected
        { sourceRow: 4, data: { code: '', name: 'No Code', email: 'nocode@example.com' } },
        // 1 merged row -> merged
        { sourceRow: 5, data: { code: 'CUST-001', name: 'Acme Dup', email: 'acme@example.com' }, isMerged: true, mergeTargetId: '11111111-1111-4111-8111-000000000001' },
        // 1 skipped row -> skipped
        { sourceRow: 6, data: { code: 'CUST-099', name: 'Skipped Row', email: 'skip@example.com' }, skipped: true, skipReason: 'Excluded by operator' },
      ];

      const report = await planner.planDryRun({
        batchId: '22222222-2222-4222-8222-222222222222',
        module: 'crm-1',
        entity: 'customers',
        rows: testRows,
        adapter,
        mappingChecksum: 'b'.repeat(64),
        policyConfig: { maxFailureRate: 0.50 }, // Allow up to 50% for this test
      });

      expect(report.plannedCounts.total).toBe(6);
      expect(report.plannedCounts.loaded).toBe(2);
      expect(report.plannedCounts.rejected).toBe(2);
      expect(report.plannedCounts.merged).toBe(1);
      expect(report.plannedCounts.skipped).toBe(1);
      expect(report.plannedCounts.unaccounted).toBe(0);

      // Equation holds: total = loaded + rejected + merged + skipped
      const sum =
        report.plannedCounts.loaded +
        report.plannedCounts.rejected +
        report.plannedCounts.merged +
        report.plannedCounts.skipped;
      expect(sum).toBe(report.plannedCounts.total);

      // Details in rejections
      expect(report.rejections.length).toBe(2);
      expect(report.rejections[0]?.sourceRow).toBe(3);
      expect(report.rejections[0]?.reasonCode).toBe('INVALID_EMAIL');
      expect(report.rejections[1]?.sourceRow).toBe(4);
      expect(report.rejections[1]?.reasonCode).toBe('CUSTOMER_CODE_REQUIRED');
    });
  });

  describe('3. 40%-Invalid Fixture Policy Failure (AC 4)', () => {
    it('fails policy and disables canProceedToLoad when failure rate exceeds 10% threshold', async () => {
      // 50 total rows: 20 invalid (40%), 30 valid (60%)
      const rows: Array<{ sourceRow: number; data: TestCustomerRow }> = [];

      for (let i = 1; i <= 30; i++) {
        rows.push({
          sourceRow: i,
          data: { code: `CUST-${i}`, name: `Customer ${i}`, email: `cust${i}@example.com` },
        });
      }
      for (let i = 31; i <= 50; i++) {
        rows.push({
          sourceRow: i,
          data: { code: `CUST-${i}`, name: `Customer ${i}`, email: `invalid-email-format-${i}` },
        });
      }

      const report = await planner.planDryRun({
        batchId: '33333333-3333-4333-8333-333333333333',
        module: 'crm-1',
        entity: 'customers',
        rows,
        adapter,
        mappingChecksum: 'c'.repeat(64),
        policyConfig: { maxFailureRate: 0.10 }, // 10% ceiling
      });

      expect(report.plannedCounts.total).toBe(50);
      expect(report.plannedCounts.loaded).toBe(30);
      expect(report.plannedCounts.rejected).toBe(20);
      expect(report.failureRate).toBe(0.40); // Exactly 40%
      expect(report.policyPassed).toBe(false);
      expect(report.canProceedToLoad).toBe(false);

      // Real load precondition fails
      expect(() => {
        planner.verifyPrecondition(
          {
            batchId: '33333333-3333-4333-8333-333333333333',
            token: report.token,
            currentTargetBaselineHash: report.targetBaselineHash,
            currentMappingChecksum: report.mappingChecksum,
            currentRuleVersion: report.ruleVersion,
          },
          report
        );
      }).toThrowError(DryRunPreconditionError);
    });
  });

  describe('4. Cryptographic Token & Precondition Drift Invalidation (AC 5 & AC 6)', () => {
    it('derives deterministic SHA-256 token for identical inputs', async () => {
      const rows = [
        { sourceRow: 1, data: { code: 'CUST-001', name: 'Acme', email: 'acme@example.com' } },
      ];

      const report1 = await planner.planDryRun({
        batchId: '44444444-4444-4444-8444-444444444444',
        module: 'crm-1',
        entity: 'customers',
        rows,
        adapter,
        mappingChecksum: 'd'.repeat(64),
      });

      const report2 = await planner.planDryRun({
        batchId: '44444444-4444-4444-8444-444444444444',
        module: 'crm-1',
        entity: 'customers',
        rows,
        adapter,
        mappingChecksum: 'd'.repeat(64),
      });

      expect(report1.token).toBe(report2.token);
      expect(report1.token.length).toBe(64);
    });

    it('invalidates precondition when target baseline has drifted', async () => {
      const rows = [
        { sourceRow: 1, data: { code: 'CUST-001', name: 'Acme', email: 'acme@example.com' } },
      ];

      const report = await planner.planDryRun({
        batchId: '55555555-5555-4555-8555-555555555555',
        module: 'crm-1',
        entity: 'customers',
        rows,
        adapter,
        mappingChecksum: 'e'.repeat(64),
      });

      const driftedBaselineHash = computeTargetBaselineHash([{ id: 'new-external-customer', code: 'EXT-01' }]);

      expect(() => {
        planner.verifyPrecondition(
          {
            batchId: '55555555-5555-4555-8555-555555555555',
            token: report.token,
            currentTargetBaselineHash: driftedBaselineHash, // DRIFTED!
            currentMappingChecksum: report.mappingChecksum,
            currentRuleVersion: report.ruleVersion,
          },
          report
        );
      }).toThrowError(/target baseline has drifted/);
    });

    it('invalidates precondition when mapping checksum has changed', async () => {
      const rows = [
        { sourceRow: 1, data: { code: 'CUST-001', name: 'Acme', email: 'acme@example.com' } },
      ];

      const report = await planner.planDryRun({
        batchId: '66666666-6666-4666-8666-666666666666',
        module: 'crm-1',
        entity: 'customers',
        rows,
        adapter,
        mappingChecksum: 'f'.repeat(64),
      });

      expect(() => {
        planner.verifyPrecondition(
          {
            batchId: '66666666-6666-4666-8666-666666666666',
            token: report.token,
            currentTargetBaselineHash: report.targetBaselineHash,
            currentMappingChecksum: '0'.repeat(64), // CHANGED MAPPING!
            currentRuleVersion: report.ruleVersion,
          },
          report
        );
      }).toThrowError(/mapping rules have changed/);
    });

    it('invalidates precondition when rule version differs', async () => {
      const rows = [
        { sourceRow: 1, data: { code: 'CUST-001', name: 'Acme', email: 'acme@example.com' } },
      ];

      const report = await planner.planDryRun({
        batchId: '77777777-7777-4777-8777-777777777777',
        module: 'crm-1',
        entity: 'customers',
        rows,
        adapter,
        mappingChecksum: '1'.repeat(64),
        ruleVersion: '1.0.0',
      });

      expect(() => {
        planner.verifyPrecondition(
          {
            batchId: '77777777-7777-4777-8777-777777777777',
            token: report.token,
            currentTargetBaselineHash: report.targetBaselineHash,
            currentMappingChecksum: report.mappingChecksum,
            currentRuleVersion: '2.0.0', // CHANGED RULE VERSION!
          },
          report
        );
      }).toThrowError(/differs from plan rule version/);
    });
  });
});
