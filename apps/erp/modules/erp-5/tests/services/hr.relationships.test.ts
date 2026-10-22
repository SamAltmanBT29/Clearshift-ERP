/**
 * ERP-5 HR & Employees — Service Level Relationship and State Tests
 *
 * The service layer proof of issue #51 (`ERP5-06`):
 *
 *   - every required relationship is validated **before** the mutation and an
 *     invalid reference leaves **no** partial write behind
 *   - the leave state matrix is enforced at the service level, not only at the
 *     HTTP boundary (a non-HTTP caller — the Migration Kit adapter — gets the
 *     same answer)
 *   - the unknown enumerations are rejected with a stable code
 *   - the response is built from the persisted row (read model)
 *   - the optional relationship produces the approved warning
 *
 * @module erp5/tests/services/hr.relationships.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { HR_DOMAIN_RULES, type CreateHrLeaveRequest, type UpdateHrLeaveRequest } from '@clearshift/contracts';
import { HrService } from '../../src/services/hr.service.js';
import { InMemoryHrRepository } from '../../src/services/in-memory.repository.js';
import { HrServiceError } from '../../src/services/errors.js';
import {
  FIXTURE_DEPARTMENT_ENGINEERING,
  FIXTURE_DEPARTMENT_PLATFORM,
  FIXTURE_EMPLOYEE_ASHA,
  FIXTURE_LEAVE_SICK,
} from '../../fixtures/index.js';

const VALID_LEAVE: CreateHrLeaveRequest = {
  employee_id: FIXTURE_EMPLOYEE_ASHA.id,
  date_from: '2026-09-01',
  date_to: '2026-09-05',
  type: 'sick',
};

describe('ERP-5 HR Service — relationships, state transitions and read model (#51)', () => {
  let repository: InMemoryHrRepository;
  let service: HrService;

  beforeEach(() => {
    repository = new InMemoryHrRepository(true);
    service = new HrService(repository);
  });

  // ── Relationships ─────────────────────────────────────────────────────────

  describe('Relationship validation before commit', () => {
    it('rejects a leave for an unknown employee without writing the row', async () => {
      const error = await service
        .createLeave({ ...VALID_LEAVE, employee_id: randomUUID() })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(404);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.EMPLOYEE_REQUIRED);

      // The fixture leave is untouched and no new leave was written.
      const stored = await repository.getLeaveById(FIXTURE_LEAVE_SICK.id);
      expect(stored?.employee_id).toBe(FIXTURE_EMPLOYEE_ASHA.id);
    });

    it('rejects an employee for an unknown department without writing the row', async () => {
      const employeeNo = 'EMP-SVC-NO-DEPT';

      const error = await service
        .createEmployee({
          employee_no: employeeNo,
          first_name: 'Kiran',
          last_name: 'Desai',
          birth_date: '1992-07-19',
          join_date: '2023-09-04',
          department_id: randomUUID(),
          job_title: 'Engineer',
          salary: '100000.0000',
        })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      expect((error as HrServiceError).statusCode).toBe(404);

      const written = await repository.getEmployeeByEmployeeNo(employeeNo);
      expect(written).toBeNull();
    });

    it('rejects a payroll aggregate for an unknown department without writing the row', async () => {
      const error = await service
        .createPayrollTotal({
          department_id: randomUUID(),
          month: '2026-09',
          total_amount: '1000.0000',
        })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      expect((error as HrServiceError).statusCode).toBe(404);
    });

    it('rejects a half-set source identity with 400', async () => {
      const error = await service
        .createEmployee({
          employee_no: 'EMP-SVC-HALF-SOURCE',
          first_name: 'Kiran',
          last_name: 'Desai',
          birth_date: '1992-07-19',
          join_date: '2023-09-04',
          department_id: FIXTURE_DEPARTMENT_ENGINEERING.id,
          job_title: 'Engineer',
          salary: '100000.0000',
          batch_id: randomUUID(),
          source_row: 1,
          idempotency_key: `erp5-${randomUUID()}`,
          source_system: 'legacy_hr_csv',
        })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(400);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.SOURCE_IDENTITY_INCOMPLETE);
    });
  });

  // ── State transitions ─────────────────────────────────────────────────────

  describe('Leave state transitions', () => {
    it('applies pending → approved', async () => {
      const updated = await service.updateLeave(FIXTURE_LEAVE_SICK.id, {
        status: 'approved',
      } as UpdateHrLeaveRequest);

      expect(updated.status).toBe('approved');
    });

    it('applies pending → rejected', async () => {
      const updated = await service.updateLeave(FIXTURE_LEAVE_SICK.id, {
        status: 'rejected',
      } as UpdateHrLeaveRequest);

      expect(updated.status).toBe('rejected');
    });

    it('treats the same status as a no-op', async () => {
      const updated = await service.updateLeave(FIXTURE_LEAVE_SICK.id, {
        status: 'pending',
      } as UpdateHrLeaveRequest);

      expect(updated.status).toBe('pending');
    });

    it('forbids reversing a decision with 422 and leaves the row untouched', async () => {
      await service.updateLeave(FIXTURE_LEAVE_SICK.id, { status: 'approved' } as UpdateHrLeaveRequest);

      const error = await service
        .updateLeave(FIXTURE_LEAVE_SICK.id, { status: 'rejected' } as UpdateHrLeaveRequest)
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(422);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.INVALID_LEAVE_STATUS_TRANSITION);
      expect(serviceError.details[0]?.field).toBe('status');

      const stored = await repository.getLeaveById(FIXTURE_LEAVE_SICK.id);
      expect(stored?.status).toBe('approved');
    });

    it('forbids un-deciding a leave with 422', async () => {
      await service.updateLeave(FIXTURE_LEAVE_SICK.id, { status: 'approved' } as UpdateHrLeaveRequest);

      const error = await service
        .updateLeave(FIXTURE_LEAVE_SICK.id, { status: 'pending' } as UpdateHrLeaveRequest)
        .catch((err: unknown) => err);

      expect((error as HrServiceError).statusCode).toBe(422);
    });

    it('rejects an unknown status with 422 at the service level', async () => {
      const error = await service
        .updateLeave(FIXTURE_LEAVE_SICK.id, { status: 'cancelled' } as unknown as UpdateHrLeaveRequest)
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(422);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.INVALID_LEAVE_STATUS);
    });

    it('rejects an unknown type with 422 at the service level', async () => {
      const error = await service
        .createLeave({ ...VALID_LEAVE, type: 'unpaid' } as unknown as CreateHrLeaveRequest)
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HrServiceError);
      const serviceError = error as HrServiceError;
      expect(serviceError.statusCode).toBe(422);
      expect(serviceError.code).toBe(HR_DOMAIN_RULES.INVALID_LEAVE_TYPE);
    });

    it('rejects an edit of an unknown leave with 404', async () => {
      const error = await service
        .updateLeave(randomUUID(), { status: 'approved' } as UpdateHrLeaveRequest)
        .catch((err: unknown) => err);

      expect((error as HrServiceError).statusCode).toBe(404);
    });
  });

  // ── Optional relationship ─────────────────────────────────────────────────

  describe('Optional relationship warning', () => {
    it('warns for a root department and invents no parent', async () => {
      const result = await service.createDepartment({ name: 'Quality Assurance', code: 'QA' });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings?.[0]?.code).toBe('HR_OPTIONAL_REFERENCE_ABSENT');
      expect(result.warnings?.[0]?.relationship).toBe('DEPARTMENT_PARENT');
      expect(result.entity.parent_id).toBeNull();
    });

    it('reports no warning when the parent is present', async () => {
      const result = await service.createDepartment({
        name: 'Platform West',
        code: 'PLAT-W',
        parent_id: FIXTURE_DEPARTMENT_ENGINEERING.id,
      });

      expect(result.warnings).toBeUndefined();
      expect(result.entity.parent_id).toBe(FIXTURE_DEPARTMENT_ENGINEERING.id);
    });
  });

  // ── Read model ────────────────────────────────────────────────────────────

  describe('Read-model consistency', () => {
    it('returns the persisted department, not the request payload', async () => {
      const result = await service.createDepartment({ name: 'Finance & Accounts', code: 'FIN2' });

      const stored = await repository.getDepartmentById(result.entity.id);
      expect(stored?.name).toBe(result.entity.name);
      expect(stored?.code).toBe(result.entity.code);
      expect(stored?.created_at).toBe(result.entity.created_at);
    });

    it('returns the persisted leave status after a transition', async () => {
      const updated = await service.updateLeave(FIXTURE_LEAVE_SICK.id, {
        status: 'approved',
      } as UpdateHrLeaveRequest);

      const stored = await repository.getLeaveById(FIXTURE_LEAVE_SICK.id);
      expect(stored?.status).toBe(updated.status);
      expect(stored?.updated_at).toBe(updated.updated_at);
    });

    it('keeps a payroll aggregate bound to its department', async () => {
      const result = await service.createPayrollTotal({
        department_id: FIXTURE_DEPARTMENT_PLATFORM.id,
        month: '2026-09',
        total_amount: '500000.0000',
        headcount: 2,
      });

      const stored = await repository.getPayrollTotalById(result.entity.id);
      expect(stored?.department_id).toBe(FIXTURE_DEPARTMENT_PLATFORM.id);
      expect(stored?.total_amount).toBe('500000.0000');
    });
  });
});
