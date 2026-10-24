import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HrService } from '../../src/services/hr.service.js';
import { InMemoryHrRepository } from '../../src/services/in-memory.repository.js';
import { AuditService, InMemoryAuditRepository } from '@cs/core/audit/audit-service.js';
import {
  CreateHrDepartmentRequestSchema,
  UpdateHrDepartmentRequestSchema,
  CreateHrEmployeeRequestSchema,
  UpdateHrEmployeeRequestSchema,
  CreateHrLeaveRequestSchema,
  UpdateHrLeaveRequestSchema,
  CreateHrPayrollTotalRequestSchema,
} from '@clearshift/contracts';

describe('HR Audit Security', () => {
  let hrService: HrService;
  let auditRepo: InMemoryAuditRepository;
  let auditService: AuditService;
  let repository: InMemoryHrRepository;

  const actor = { sub: 'user-123', roles: ['hr_admin'] };
  const correlationId = 'corr-456';

  beforeEach(() => {
    auditRepo = new InMemoryAuditRepository();
    auditService = new AuditService(auditRepo);
    repository = new InMemoryHrRepository(false);
    hrService = new HrService(repository, auditService);
  });

  describe('Successful Mutations', () => {
    it('should audit department creation', async () => {
      const input = CreateHrDepartmentRequestSchema.parse({
        name: 'Engineering',
        code: 'ENG',
      });
      const result = await hrService.createDepartment(input, actor, correlationId);
      const records = await auditRepo.query({ action: 'department.created' });

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        actor: actor.sub,
        actorRole: actor.roles[0],
        action: 'department.created',
        targetEntity: 'department',
        targetId: result.entity.id,
        correlationId,
        result: 'success',
        metadata: { department_code: 'ENG' },
      });
    });

    it('should audit department updates', async () => {
      const dept = await repository.createDepartment({ name: 'Sales', code: 'SALES' });
      const input = UpdateHrDepartmentRequestSchema.parse({ name: 'Global Sales' });
      const result = await hrService.updateDepartment(dept.id, input, actor, correlationId);
      const records = await auditRepo.query({ action: 'department.updated' });

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        actor: actor.sub,
        action: 'department.updated',
        targetId: dept.id,
        correlationId,
        result: 'success',
        metadata: { department_code: 'SALES' },
      });
    });

    it('should audit employee creation', async () => {
      const input = CreateHrEmployeeRequestSchema.parse({
        employee_no: 'EMP001',
        first_name: 'John',
        last_name: 'Doe',
        birth_date: '1990-01-01',
        join_date: '2020-01-01',
        department_id: (await repository.createDepartment({ name: 'IT', code: 'IT' })).id,
        job_title: 'Developer',
        salary: '100000',
        currency_code: 'USD',
      });
      const result = await hrService.createEmployee(input, actor, correlationId);
      const records = await auditRepo.query({ action: 'employee.created' });

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        actor: actor.sub,
        action: 'employee.created',
        targetId: result.entity.id,
        correlationId,
        result: 'success',
        metadata: { employee_no: 'EMP001' },
      });
      expect(records[0].metadata).not.toHaveProperty('salary');
    });

    it('should audit employee updates', async () => {
      const emp = await repository.createEmployee({
        employee_no: 'EMP002',
        first_name: 'Jane',
        last_name: 'Doe',
        birth_date: '1990-01-01',
        join_date: '2020-01-01',
        department_id: (await repository.createDepartment({ name: 'IT', code: 'IT' })).id,
        job_title: 'Lead',
        salary: '120000',
        currency_code: 'USD',
      });
      const input = UpdateHrEmployeeRequestSchema.parse({ job_title: 'Senior Lead' });
      const result = await hrService.updateEmployee(emp.id, input, actor, correlationId);
      const records = await auditRepo.query({ action: 'employee.updated' });

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: 'employee.updated',
        targetId: emp.id,
        correlationId,
        result: 'success',
        metadata: { employee_no: emp.employee_no },
      });
      expect(records[0].metadata).not.toHaveProperty('salary');
    });

    it('should audit leave creation', async () => {
      const emp = await repository.createEmployee({
        employee_no: 'EMP003',
        first_name: 'Jim',
        last_name: 'Beam',
        birth_date: '1990-01-01',
        join_date: '2020-01-01',
        department_id: (await repository.createDepartment({ name: 'IT', code: 'IT' })).id,
        job_title: 'Dev',
        salary: '80000',
        currency_code: 'USD',
      });
      const input = CreateHrLeaveRequestSchema.parse({
        employee_id: emp.id,
        date_from: '2023-01-01',
        date_to: '2023-01-05',
        type: 'sick',
      });
      const result = await hrService.createLeave(input, actor, correlationId);
      const records = await auditRepo.query({ action: 'leave.created' });

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: 'leave.created',
        targetId: result.entity.id,
        correlationId,
        result: 'success',
        metadata: { employee_id: emp.id },
      });
    });

    it('should audit leave updates', async () => {
      const emp = await repository.createEmployee({
        employee_no: 'EMP004',
        first_name: 'Jill',
        last_name: 'Doe',
        birth_date: '1990-01-01',
        join_date: '2020-01-01',
        department_id: (await repository.createDepartment({ name: 'IT', code: 'IT' })).id,
        job_title: 'Dev',
        salary: '80000',
        currency_code: 'USD',
      });
      const leave = await repository.createLeave({
        employee_id: emp.id,
        date_from: '2023-01-01',
        date_to: '2023-01-05',
        type: 'sick',
        status: 'pending',
      });
      const input = UpdateHrLeaveRequestSchema.parse({ status: 'approved' });
      const result = await hrService.updateLeave(leave.id, input, actor, correlationId);
      const records = await auditRepo.query({ action: 'leave.updated' });

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: 'leave.updated',
        targetId: leave.id,
        correlationId,
        result: 'success',
        metadata: { employee_id: emp.id },
      });
    });

    it('should audit payroll total loading', async () => {
      const dept = await repository.createDepartment({ name: 'Finance', code: 'FIN' });
      const input = CreateHrPayrollTotalRequestSchema.parse({
        department_id: dept.id,
        month: '2023-01',
        total_amount: '500000',
        currency_code: 'USD',
        headcount: 10,
      });
      const result = await hrService.createPayrollTotal(input, actor, correlationId);
      const records = await auditRepo.query({ action: 'payroll_total.loaded' });

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: 'payroll_total.loaded',
        targetId: result.entity.id,
        correlationId,
        result: 'success',
        metadata: { department_id: dept.id, month: '2023-01' },
      });
      expect(records[0].metadata).not.toHaveProperty('total_amount');
    });
  });

  describe('Security and Failure Behavior', () => {
    it('should NOT audit successful event when validation fails', async () => {
      const input = CreateHrDepartmentRequestSchema.parse({
        name: 'Too Short',
        code: 'S', // Assuming validation fails if code is too short or we force an error
      });
      
      // We force a conflict error by creating a duplicate
      await repository.createDepartment({ name: 'Existing', code: 'DUP' });
      const duplicateInput = CreateHrDepartmentRequestSchema.parse({
        name: 'New',
        code: 'DUP',
      });

      await expect(hrService.createDepartment(duplicateInput, actor, correlationId))
        .rejects.toThrow();

      const records = await auditRepo.query();
      expect(records).toHaveLength(0);
    });

    it('should persist mutation but return error if audit write fails', async () => {
      // Mock auditService.log to throw
      vi.spyOn(auditService, 'log').mockRejectedValue(new Error('Audit system down'));
      
      const input = CreateHrDepartmentRequestSchema.parse({
        name: 'Persistent Dept',
        code: 'PERSIST',
      });

      await expect(hrService.createDepartment(input, actor, correlationId))
        .rejects.toThrow('Audit system down');

      // Verify department WAS created in repository
      const dept = await repository.getDepartmentByCode('PERSIST');
      expect(dept).not.toBeNull();
    });
  });
});
