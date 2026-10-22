/**
 * ERP-5 HR & Employees — Service Level Tests
 *
 * Every domain invariant of the module is asserted here at the **service**
 * level, with a valid and an invalid input:
 *
 *   - BR-ERP5-01  join date can never precede the birth date
 *   - BR-ERP5-02  salary is masked before it leaves the service
 *   - FR-ERP5-03  unique department code, acyclic hierarchy
 *   - FR-ERP5-04  leave date range, referenced employee must exist
 *   - FR-ERP5-05  HR stores no credentials and grants no application roles
 *   - FR-ERP5-06  one department/month aggregate, no employee rows
 *   - KIT-08      the import receipt commits with the target mutation and a
 *                 repeated idempotency key performs no second mutation
 *
 * @module erp5/tests/services/hr.service.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  HR_DOMAIN_RULES,
  HR_SALARY_MASK,
  type CreateHrDepartmentRequest,
  type CreateHrEmployeeRequest,
  type CreateHrLeaveRequest,
  type CreateHrPayrollTotalRequest,
  type UpdateHrDepartmentRequest,
  type UpdateHrEmployeeRequest,
} from '@clearshift/contracts';
import { HrService } from '../../src/services/hr.service.js';
import { InMemoryHrRepository } from '../../src/services/in-memory.repository.js';
import { HrServiceError } from '../../src/services/errors.js';
import {
  FIXTURE_DEPARTMENT_ENGINEERING,
  FIXTURE_DEPARTMENT_FINANCE,
  FIXTURE_DEPARTMENT_PLATFORM,
  FIXTURE_EMPLOYEE_ASHA,
} from '../../fixtures/index.js';

const VALID_EMPLOYEE: CreateHrEmployeeRequest = {
  employee_no: 'EMP-9001',
  first_name: 'Kiran',
  last_name: 'Desai',
  birth_date: '1992-07-19',
  join_date: '2023-09-04',
  department_id: FIXTURE_DEPARTMENT_ENGINEERING.id,
  job_title: 'Site Reliability Engineer',
  salary: '132000.0000',
  currency_code: 'INR',
};

const VALID_DEPARTMENT: CreateHrDepartmentRequest = {
  name: 'Quality Assurance',
  code: 'QA',
};

const VALID_LEAVE: CreateHrLeaveRequest = {
  employee_id: FIXTURE_EMPLOYEE_ASHA.id,
  date_from: '2026-05-04',
  date_to: '2026-05-08',
  type: 'holiday',
};

const VALID_PAYROLL_TOTAL: CreateHrPayrollTotalRequest = {
  department_id: FIXTURE_DEPARTMENT_PLATFORM.id,
  month: '2026-05',
  total_amount: '118500.5000',
  headcount: 1,
};

describe('ERP-5 HR Service — domain invariants (#48)', () => {
  let repository: InMemoryHrRepository;
  let service: HrService;

  beforeEach(() => {
    repository = new InMemoryHrRepository(true);
    service = new HrService(repository);
  });

  // ── Employees ─────────────────────────────────────────────────────────────

  describe('Employee creation', () => {
    it('creates an employee and returns the masked projection (BR-ERP5-02)', async () => {
      const result = await service.createEmployee(VALID_EMPLOYEE);

      expect(result.created).toBe(true);
      expect(result.entity.employee_no).toBe('EMP-9001');
      expect(result.entity.salary_display).toBe(HR_SALARY_MASK);
      expect(result.entity).not.toHaveProperty('salary');
      expect(JSON.stringify(result.entity)).not.toContain('132000');
    });

    it('[BR-ERP5-01] rejects a join date before the birth date with 422', async () => {
      const error = await service
        .createEmployee({ ...VALID_EMPLOYEE, join_date: '1991-01-01' })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(422);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.JOIN_DATE_AFTER_BIRTH_DATE);
      expect(serviceError.details[0]?.field).toBe('join_date');
    });

    it('rejects a negative salary with 422', async () => {
      const error = await service
        .createEmployee({ ...VALID_EMPLOYEE, salary: '-100.0000' })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(422);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.SALARY_NON_NEGATIVE);
    });

    it('rejects a duplicate employee number with 409', async () => {
      await service.createEmployee(VALID_EMPLOYEE);

      const error = await service
        .createEmployee({ ...VALID_EMPLOYEE, first_name: 'Other' })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(409);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.EMPLOYEE_NO_DUPLICATE);
      expect(serviceError.details[0]?.field).toBe('employee_no');
    });

    it('rejects an unknown department with 404', async () => {
      const error = await service
        .createEmployee({ ...VALID_EMPLOYEE, department_id: randomUUID() })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(404);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.DEPARTMENT_REQUIRED);
    });

    it('rejects source-identity fields on a write without import provenance', async () => {
      const error = await service
        .createEmployee({
          ...VALID_EMPLOYEE,
          source_system: 'legacy_hr_csv',
          source_id: 'row-1',
        })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(400);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.PROTECTED_FIELD);
    });

    it('rejects a payload that carries an identity credential', async () => {
      const error = await service
        .createEmployee({
          ...VALID_EMPLOYEE,
          password_hash: 'not-a-real-hash',
        } as unknown as CreateHrEmployeeRequest)
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(400);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.CREDENTIALS_FORBIDDEN);
    });

    it('rejects an incomplete import provenance triple with 400', async () => {
      const error = await service
        .createEmployee({ ...VALID_EMPLOYEE, batch_id: randomUUID() })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(400);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.IMPORT_PROVENANCE_REQUIRED);
    });
  });

  describe('Employee update', () => {
    it('updates the allow-listed fields and keeps the salary masked', async () => {
      const updated = await service.updateEmployee(FIXTURE_EMPLOYEE_ASHA.id, {
        job_title: 'Staff Software Engineer',
        salary: '131000.0000',
      } as UpdateHrEmployeeRequest);

      expect(updated.job_title).toBe('Staff Software Engineer');
      expect(updated.salary_display).toBe(HR_SALARY_MASK);
      expect(updated).not.toHaveProperty('salary');
    });

    it('[BR-ERP5-01] rejects a join date before the stored birth date with 422', async () => {
      const error = await service
        .updateEmployee(FIXTURE_EMPLOYEE_ASHA.id, { join_date: '1989-01-01' })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(422);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.JOIN_DATE_AFTER_BIRTH_DATE);
    });

    it('rejects an unknown employee with 404', async () => {
      const error = await service
        .updateEmployee(randomUUID(), { job_title: 'Nobody' })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      expect((error as HrServiceError).statusCode).toBe(404);
    });

    it('rejects a duplicate employee number with 409', async () => {
      const error = await service
        .updateEmployee(FIXTURE_EMPLOYEE_ASHA.id, { employee_no: 'EMP-0002' })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(409);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.EMPLOYEE_NO_DUPLICATE);
    });

    it('rejects an unknown department with 404', async () => {
      const error = await service
        .updateEmployee(FIXTURE_EMPLOYEE_ASHA.id, { department_id: randomUUID() })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      expect((error as HrServiceError).statusCode).toBe(404);
    });
  });

  // ── Departments ───────────────────────────────────────────────────────────

  describe('Department creation and update', () => {
    it('creates a department', async () => {
      const result = await service.createDepartment(VALID_DEPARTMENT);

      expect(result.created).toBe(true);
      expect(result.entity.code).toBe('QA');
      expect(result.entity.parent_id).toBeNull();
    });

    it('rejects a duplicate department code with 409', async () => {
      await service.createDepartment(VALID_DEPARTMENT);

      const error = await service
        .createDepartment({ name: 'Quality Assurance West', code: 'QA' })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(409);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.DEPARTMENT_CODE_DUPLICATE);
    });

    it('rejects an unknown parent department with 404', async () => {
      const error = await service
        .createDepartment({ ...VALID_DEPARTMENT, parent_id: randomUUID() })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      expect((error as HrServiceError).statusCode).toBe(404);
    });

    it('rejects a self-referential parent with 422', async () => {
      const created = await service.createDepartment(VALID_DEPARTMENT);

      const error = await service
        .updateDepartment(created.entity.id, { parent_id: created.entity.id })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(422);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.DEPARTMENT_SELF_PARENT);
    });

    it('rejects a circular hierarchy with 422', async () => {
      // Engineering → Platform → (Platform's parent is Engineering)
      const error = await service
        .updateDepartment(FIXTURE_DEPARTMENT_ENGINEERING.id, {
          parent_id: FIXTURE_DEPARTMENT_PLATFORM.id,
        })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(422);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.DEPARTMENT_CYCLE);
    });

    it('updates a department and clears its parent', async () => {
      const updated = await service.updateDepartment(FIXTURE_DEPARTMENT_PLATFORM.id, {
        name: 'Platform Engineering',
        parent_id: null,
      } as UpdateHrDepartmentRequest);

      expect(updated.name).toBe('Platform Engineering');
      expect(updated.parent_id).toBeNull();
    });

    it('rejects an unknown department with 404', async () => {
      const error = await service
        .updateDepartment(randomUUID(), { name: 'Ghost' })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      expect((error as HrServiceError).statusCode).toBe(404);
    });

    it('rejects a duplicate department code on update with 409', async () => {
      const error = await service
        .updateDepartment(FIXTURE_DEPARTMENT_FINANCE.id, { code: 'ENG' })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(409);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.DEPARTMENT_CODE_DUPLICATE);
    });
  });

  // ── Leave ─────────────────────────────────────────────────────────────────

  describe('Leave creation', () => {
    it('creates a leave record with the default status', async () => {
      const result = await service.createLeave(VALID_LEAVE);

      expect(result.created).toBe(true);
      expect(result.entity.status).toBe('pending');
      expect(result.entity.type).toBe('holiday');
    });

    it('rejects a date range that ends before it starts with 422', async () => {
      const error = await service
        .createLeave({ ...VALID_LEAVE, date_to: '2026-05-01' })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(422);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.LEAVE_DATE_RANGE_VALID);
    });

    it('rejects an unknown employee with 404', async () => {
      const error = await service
        .createLeave({ ...VALID_LEAVE, employee_id: randomUUID() })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(404);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.EMPLOYEE_REQUIRED);
    });
  });

  // ── Payroll totals ────────────────────────────────────────────────────────

  describe('Payroll aggregate creation', () => {
    it('creates one department/month aggregate', async () => {
      const result = await service.createPayrollTotal(VALID_PAYROLL_TOTAL);

      expect(result.created).toBe(true);
      expect(result.entity.month).toBe('2026-05');
      expect(result.entity.headcount).toBe(1);
      expect(result.entity.currency_code).toBe('INR');
    });

    it('rejects a second aggregate for the same department and month with 409', async () => {
      await service.createPayrollTotal(VALID_PAYROLL_TOTAL);

      const error = await service
        .createPayrollTotal({ ...VALID_PAYROLL_TOTAL, total_amount: '99000.0000' })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(409);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.PAYROLL_TOTAL_DUPLICATE);
    });

    it('rejects an unknown department with 404', async () => {
      const error = await service
        .createPayrollTotal({ ...VALID_PAYROLL_TOTAL, department_id: randomUUID() })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      expect((error as HrServiceError).statusCode).toBe(404);
    });

    it('rejects an aggregate that carries an employee row with 400 (FR-ERP5-06)', async () => {
      const error = await service
        .createPayrollTotal({
          ...VALID_PAYROLL_TOTAL,
          employee_id: FIXTURE_EMPLOYEE_ASHA.id,
        } as unknown as CreateHrPayrollTotalRequest)
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(400);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.PAYROLL_AGGREGATE_ONLY);
    });
  });

  // ── Import receipts and idempotency ──────────────────────────────────────

  describe('Import receipts and idempotency (KIT-08)', () => {
    it('writes the import receipt in the same transaction as the target mutation', async () => {
      const idempotencyKey = `erp5-${randomUUID()}`;

      const result = await service.createEmployee({
        ...VALID_EMPLOYEE,
        source_system: 'legacy_hr_csv',
        source_id: 'row-42',
        batch_id: randomUUID(),
        source_row: 42,
        idempotency_key: idempotencyKey,
      });

      expect(result.created).toBe(true);
      expect(result.receipt).toBeDefined();
      expect(result.receipt?.idempotency_key).toBe(idempotencyKey);
      expect(result.receipt?.target_id).toBe(result.entity.id);
      expect(result.receipt?.entity).toBe('employee');
      expect(result.receipt?.source_row).toBe(42);

      const stored = await repository.getImportReceiptByIdempotencyKey(idempotencyKey);
      expect(stored).not.toBeNull();
      expect(stored?.target_id).toBe(result.entity.id);
    });

    it('returns the original result without a second mutation on a repeated import', async () => {
      const idempotencyKey = `erp5-${randomUUID()}`;
      const payload = {
        ...VALID_EMPLOYEE,
        batch_id: randomUUID(),
        source_row: 7,
        idempotency_key: idempotencyKey,
      };

      const first = await service.createEmployee(payload);
      const second = await service.createEmployee(payload);

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.entity.id).toBe(first.entity.id);
      expect(second.receipt?.id).toBe(first.receipt?.id);

      // Exactly one row exists — a further create with the same employee
      // number is rejected as a duplicate.
      const stored = await repository.getEmployeeByEmployeeNo(VALID_EMPLOYEE.employee_no);
      expect(stored?.id).toBe(first.entity.id);

      const duplicate = await service
        .createEmployee({ ...payload, idempotency_key: `erp5-${randomUUID()}` })
        .catch((err: unknown) => err);
      expect((duplicate as HrServiceError).code).toBe(HR_DOMAIN_RULES.EMPLOYEE_NO_DUPLICATE);
    });

    it('rejects the same idempotency key with a different payload with 409', async () => {
      const idempotencyKey = `erp5-${randomUUID()}`;
      const payload = {
        ...VALID_EMPLOYEE,
        batch_id: randomUUID(),
        source_row: 7,
        idempotency_key: idempotencyKey,
      };

      await service.createEmployee(payload);

      const error = await service
        .createEmployee({ ...payload, job_title: 'A different title' })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(409);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.IDEMPOTENCY_CONFLICT);
      expect(serviceError.details[0]?.field).toBe('idempotency_key');
    });

    it('performs exactly one mutation when the same import is replayed concurrently', async () => {
      const idempotencyKey = `erp5-${randomUUID()}`;
      const payload = {
        ...VALID_EMPLOYEE,
        batch_id: randomUUID(),
        source_row: 11,
        idempotency_key: idempotencyKey,
      };

      const [first, second] = await Promise.all([
        service.createEmployee(payload),
        service.createEmployee(payload),
      ]);

      expect(first.entity.id).toBe(second.entity.id);
      expect([first.created, second.created].filter(Boolean)).toHaveLength(1);

      const stored = await repository.getEmployeeByEmployeeNo(VALID_EMPLOYEE.employee_no);
      expect(stored?.id).toBe(first.entity.id);
    });

    it('rolls the target mutation back when the receipt write fails', async () => {
      const failingRepository = new InMemoryHrRepository(true);
      failingRepository.createImportReceipt = async () => {
        throw new Error('simulated receipt failure');
      };
      const failingService = new HrService(failingRepository);

      await expect(
        failingService.createEmployee({
          ...VALID_EMPLOYEE,
          batch_id: randomUUID(),
          source_row: 3,
          idempotency_key: `erp5-${randomUUID()}`,
        })
      ).rejects.toThrow();

      // The target mutation was rolled back with the receipt.
      const stored = await failingRepository.getEmployeeByEmployeeNo(VALID_EMPLOYEE.employee_no);
      expect(stored).toBeNull();
    });

    it('replays a payroll aggregate import without a second aggregate', async () => {
      const idempotencyKey = `erp5-${randomUUID()}`;
      const payload = {
        ...VALID_PAYROLL_TOTAL,
        batch_id: randomUUID(),
        source_row: 5,
        idempotency_key: idempotencyKey,
      };

      const first = await service.createPayrollTotal(payload);
      const second = await service.createPayrollTotal(payload);

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.entity.id).toBe(first.entity.id);
      expect(second.receipt?.id).toBe(first.receipt?.id);
    });

    it('replays a department import without a second department', async () => {
      const idempotencyKey = `erp5-${randomUUID()}`;
      const payload = {
        ...VALID_DEPARTMENT,
        batch_id: randomUUID(),
        source_row: 9,
        idempotency_key: idempotencyKey,
      };

      const first = await service.createDepartment(payload);
      const second = await service.createDepartment(payload);

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.entity.id).toBe(first.entity.id);
      expect(second.receipt?.id).toBe(first.receipt?.id);

      const duplicate = await service
        .createDepartment({ ...payload, idempotency_key: `erp5-${randomUUID()}` })
        .catch((err: unknown) => err);
      expect((duplicate as HrServiceError).code).toBe(HR_DOMAIN_RULES.DEPARTMENT_CODE_DUPLICATE);
    });

    it('replays a leave import without a second leave record', async () => {
      const idempotencyKey = `erp5-${randomUUID()}`;
      const payload = {
        ...VALID_LEAVE,
        batch_id: randomUUID(),
        source_row: 4,
        idempotency_key: idempotencyKey,
      };

      const first = await service.createLeave(payload);
      const second = await service.createLeave(payload);

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.entity.id).toBe(first.entity.id);
      expect(second.receipt?.id).toBe(first.receipt?.id);
    });

    it('rejects an idempotency key whose target record no longer exists with 409', async () => {
      const idempotencyKey = `erp5-${randomUUID()}`;
      const payload = {
        ...VALID_EMPLOYEE,
        batch_id: randomUUID(),
        source_row: 8,
        idempotency_key: idempotencyKey,
      };

      const first = await service.createEmployee(payload);

      // The target row disappears while the receipt stays.
      const store = repository as unknown as {
        store: { employees: Map<string, unknown> };
      };
      store.store.employees.delete(first.entity.id);

      const error = await service.createEmployee(payload).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(409);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.IDEMPOTENCY_CONFLICT);
    });
  });
});
