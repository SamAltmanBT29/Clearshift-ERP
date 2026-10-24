import { describe, it, expect, vi } from 'vitest';
import { HrTargetAdapter } from '../../src/migration/target-adapter.js';
import { HrRepository } from '../../src/services/repository.js';
import { computeCanonicalPayloadHash } from '@clearshift/contracts';

describe('HrTargetAdapter Failure Threshold & Idempotency', () => {
  let mockRepo: any;
  let adapter: HrTargetAdapter;

  beforeEach(() => {
    mockRepo = {
      transaction: vi.fn(async (fn) => await fn(mockRepo)),
      getImportReceiptByIdempotencyKey: vi.fn(),
      createEmployee: vi.fn().mockResolvedValue({ id: 'emp-1' }),
      createDepartment: vi.fn().mockResolvedValue({ id: 'dept-1' }),
      createPayrollTotal: vi.fn().mockResolvedValue({ id: 'pay-1' }),
      createImportReceipt: vi.fn().mockResolvedValue({ id: 'rec-1' }),
      listEmployees: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listDepartments: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    };
    adapter = new HrTargetAdapter(mockRepo);
    adapter.setEntity('employee');
  });

  it('should continue processing if failures are below threshold', async () => {
    mockRepo.getImportReceiptByIdempotencyKey.mockResolvedValue(null);
    // Mock listEmployees to return empty array so duplicate detection doesn't trigger
    mockRepo.listEmployees.mockResolvedValue({ items: [], total: 0 });
    
    mockRepo.createEmployee
      .mockResolvedValueOnce({ id: 'emp-1' })
      .mockRejectedValueOnce(new Error('DB Fail'))
      .mockResolvedValueOnce({ id: 'emp-2' });

    const rows = [
      { sourceRow: 1, idempotencyKey: 'k1', data: { employee_no: 'E1' } },
      { sourceRow: 2, idempotencyKey: 'k2', data: { employee_no: 'E2' } },
      { sourceRow: 3, idempotencyKey: 'k3', data: { employee_no: 'E3' } },
    ];

    const result = await adapter.loadBatch('b1', rows, { failureThreshold: 2 });

    expect(result.totalSucceeded).toBe(2);
    expect(result.totalFailed).toBe(1);
    expect(result.outcomes[1].outcome).toBe('failed');
    expect(result.outcomes[2].outcome).toBe('created');
  });

  it('should stop processing immediately when threshold is reached', async () => {
    mockRepo.getImportReceiptByIdempotencyKey.mockResolvedValue(null);
    mockRepo.listEmployees.mockResolvedValue({ items: [], total: 0 });
    mockRepo.createEmployee.mockRejectedValue(new Error('DB Fail'));

    const rows = [
      { sourceRow: 1, idempotencyKey: 'k1', data: { employee_no: 'E1' } },
      { sourceRow: 2, idempotencyKey: 'k2', data: { employee_no: 'E2' } },
      { sourceRow: 3, idempotencyKey: 'k3', data: { employee_no: 'E3' } },
    ];

    const result = await adapter.loadBatch('b1', rows, { failureThreshold: 1 });

    expect(result.totalSucceeded).toBe(0);
    expect(result.totalFailed).toBe(1);
    expect(result.outcomes[0].outcome).toBe('failed');
    expect(result.outcomes[1].error.reasonCode).toBe('FAILURE_THRESHOLD_REACHED');
    expect(result.outcomes[2].error.reasonCode).toBe('FAILURE_THRESHOLD_REACHED');
    // Only the first row should have actually attempted a DB call
    expect(mockRepo.createEmployee).toHaveBeenCalledTimes(1);
  });

  it('should be idempotent when re-importing a successful row', async () => {
    const testData = { employee_no: 'E1' };
    const hash = computeCanonicalPayloadHash(testData);

    mockRepo.getImportReceiptByIdempotencyKey.mockResolvedValue({
      batch_id: 'b1',
      source_row: 1,
      entity: 'employee',
      schema_version: 1,
      idempotency_key: 'k1',
      request_hash: hash,
      target_id: 'emp-1',
      kind: 'created',
      created_at: new Date(),
    });

    const result = await adapter.importRow('b1', 1, 'k1', testData);
    
    expect(result.ok).toBe(true);
    expect(result.value.isExisting).toBe(true);
    expect(mockRepo.createEmployee).not.toHaveBeenCalled();
  });

});
