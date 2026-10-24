/**
 * KIT-08 Idempotency & Transactional Dual-Write Tests
 *
 * Verifies that the HrTargetAdapter guarantees:
 * 1. Atomic commit of target record + import receipt.
 * 2. Idempotency: Duplicate keys return `isExisting: true`.
 * 3. Isolation: Failed mutations roll back receipts.
 *
 * @module erp5/tests/migration/idempotency
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryHrRepository } from '../../src/services/in-memory.repository.js';
import { HrTargetAdapter } from '../../src/migration/target-adapter.js';

describe('HrTargetAdapter Idempotency (KIT-08)', () => {
  let repository: InMemoryHrRepository;
  let adapter: HrTargetAdapter;

  beforeEach(() => {
    // Use a fresh repository without fixtures for clean state
    repository = new InMemoryHrRepository(false);
    adapter = new HrTargetAdapter(repository);
  });

  it('should commit target employee and receipt atomically', async () => {
    const batchId = 'batch-1';
    const sourceRow = 1;
    const idempotencyKey = 'key-1';
    const employeeData = {
      employee_no: 'EMP-001',
      first_name: 'John',
      last_name: 'Doe',
      birth_date: '1990-01-01',
      join_date: '2020-01-01',
      department_id: 'dept-1',
      job_title: 'Engineer',
      salary: '5000',
      currency_code: 'USD',
    };

    // Manually create department first
    await repository.createDepartment({ id: 'dept-1', name: 'Engineering', code: 'ENG' });

    const result = await adapter.importRow(batchId, sourceRow, idempotencyKey, employeeData);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.targetId).toBeDefined();
      expect(result.value.receipt.idempotencyKey).toBe(idempotencyKey);

      // Verify both exist in repository
      const employee = await repository.getEmployeeById(result.value.targetId);
      expect(employee).not.toBeNull();

      const receipt = await repository.getImportReceiptByIdempotencyKey(idempotencyKey);
      expect(receipt).not.toBeNull();
      expect(receipt?.target_id).toBe(result.value.targetId);
    }
  });

  it('should return isExisting: true when the same idempotency key and payload are used', async () => {
    const batchId = 'batch-1';
    const sourceRow = 1;
    const idempotencyKey = 'key-1';
    const employeeData = {
      employee_no: 'EMP-001',
      first_name: 'John',
      last_name: 'Doe',
      birth_date: '1990-01-01',
      join_date: '2020-01-01',
      department_id: 'dept-1',
      job_title: 'Engineer',
      salary: '5000',
      currency_code: 'USD',
    };

    await repository.createDepartment({ id: 'dept-1', name: 'Engineering', code: 'ENG' });

    // First import
    const firstResult = await adapter.importRow(batchId, sourceRow, idempotencyKey, employeeData);
    expect(firstResult.ok).toBe(true);

    // Second import with same key and payload
    const secondResult = await adapter.importRow(batchId, sourceRow, idempotencyKey, employeeData);

    expect(secondResult.ok).toBe(true);
    if (secondResult.ok) {
      expect(secondResult.value.isExisting).toBe(true);
      expect(secondResult.value.targetId).toBe(firstResult.value?.targetId);
    }
  });

  it('should return an idempotency conflict when the same key but different payload is used', async () => {
    const batchId = 'batch-1';
    const sourceRow = 1;
    const idempotencyKey = 'key-conflict';
    const employeeData1 = {
      employee_no: 'EMP-001',
      first_name: 'John',
      last_name: 'Doe',
      birth_date: '1990-01-01',
      join_date: '2020-01-01',
      department_id: 'dept-1',
      job_title: 'Engineer',
      salary: '5000',
      currency_code: 'USD',
    };
    const employeeData2 = {
      ...employeeData1,
      first_name: 'Jane', // Changed payload
    };

    await repository.createDepartment({ id: 'dept-1', name: 'Engineering', code: 'ENG' });

    // First import
    await adapter.importRow(batchId, sourceRow, idempotencyKey, employeeData1);

    // Second import with same key but different payload
    const result = await adapter.importRow(batchId, sourceRow, idempotencyKey, employeeData2);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reasonCode).toBe('IDEMPOTENCY_CONFLICT');
    }
  });


  it('should roll back the receipt if the target mutation fails', async () => {
    const batchId = 'batch-1';
    const sourceRow = 1;
    const idempotencyKey = 'key-fail';
    const invalidEmployeeData = {
      // Missing required fields to trigger repository error
      employee_no: '',
    };

    // We trigger a failure by providing data that fails a mock constraint
    // or we can mock the repository to throw.
    // Since InMemoryHrRepository is simple, let's mock a failure.
    const spy = vi.spyOn(repository, 'createEmployee').mockRejectedValue(new Error('DB Failure'));

    const result = await adapter.importRow(batchId, sourceRow, idempotencyKey, invalidEmployeeData);

    expect(result.ok).toBe(false);

    // Verify no receipt was created
    const receipt = await repository.getImportReceiptByIdempotencyKey(idempotencyKey);
    expect(receipt).toBeNull();

    spy.mockRestore();
  });

  it('should handle different entities via setEntity', async () => {
    const batchId = 'batch-1';
    const sourceRow = 1;
    const idempotencyKey = 'key-dept';
    const deptData = {
      name: 'HR',
      code: 'HR-DEPT',
    };

    adapter.setEntity('department');
    const result = await adapter.importRow(batchId, sourceRow, idempotencyKey, deptData);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const dept = await repository.getDepartmentById(result.value.targetId);
      expect(dept).not.toBeNull();
      expect(dept?.code).toBe('HR-DEPT');
    }
  });

  it('should handle concurrent requests with the same idempotency key', async () => {
    const batchId = 'batch-1';
    const sourceRow = 1;
    const idempotencyKey = 'concurrent-key';
    const employeeData = {
      employee_no: 'EMP-CONC',
      first_name: 'Conc',
      last_name: 'Urrent',
      birth_date: '1990-01-01',
      join_date: '2020-01-01',
      department_id: 'dept-1',
      job_title: 'Engineer',
      salary: '5000',
      currency_code: 'USD',
    };

    await repository.createDepartment({ id: 'dept-1', name: 'Engineering', code: 'ENG' });

    const [res1, res2] = await Promise.all([
      adapter.importRow(batchId, sourceRow, idempotencyKey, employeeData),
      adapter.importRow(batchId, sourceRow, idempotencyKey, employeeData),
    ]);

    const successes = [res1, res2].filter(r => r.ok && !r.value.isExisting);
    const replays = [res1, res2].filter(r => r.ok && r.value.isExisting);

    expect(successes.length).toBe(1);
    expect(replays.length).toBe(1);
    expect(successes[0].value.targetId).toBe(replays[0].value.targetId);
  });

  it('should handle concurrent requests with the same key but different payloads', async () => {
    const batchId = 'batch-1';
    const sourceRow = 1;
    const idempotencyKey = 'concurrent-conflict-key';
    const data1 = { employee_no: 'EMP-1', first_name: 'A', last_name: 'B', birth_date: '1990-01-01', join_date: '2020-01-01', department_id: 'dept-1', job_title: 'E', salary: '1', currency_code: 'USD' };
    const data2 = { ...data1, first_name: 'C' };

    await repository.createDepartment({ id: 'dept-1', name: 'Engineering', code: 'ENG' });

    const [res1, res2] = await Promise.all([
      adapter.importRow(batchId, sourceRow, idempotencyKey, data1),
      adapter.importRow(batchId, sourceRow, idempotencyKey, data2),
    ]);

    const success = [res1, res2].find(r => r.ok);
    const conflict = [res1, res2].find(r => !r.ok && r.error.reasonCode === 'IDEMPOTENCY_CONFLICT');

    expect(success).toBeDefined();
    expect(conflict).toBeDefined();
  });
});
