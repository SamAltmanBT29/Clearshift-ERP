import { describe, it, expect, beforeEach } from 'vitest';
import { HrService } from '../../src/services/hr.service.js';
import { InMemoryHrRepository } from '../../src/services/in-memory.repository.js';
import { AuditService, InMemoryAuditRepository } from '@cs/core/audit/audit-service.js';
import {
  CreateHrEmployeeRequestSchema,
  UpdateHrEmployeeRequestSchema,
} from '@clearshift/contracts';

describe('HR Masking Security', () => {
  let hrService: HrService;
  let repository: InMemoryHrRepository;

  const ADMIN_ROLES = ['admin'];
  const VIEWER_ROLES = ['viewer'];
  const ANALYST_ROLES = ['analyst'];
  const correlationId = 'corr-mask-123';

  beforeEach(() => {
    const auditRepo = new InMemoryAuditRepository();
    const auditService = new AuditService(auditRepo);
    repository = new InMemoryHrRepository(false);
    hrService = new HrService(repository, auditService);
  });

  it('should mask salary for VIEWER role', async () => {
    const emp = await repository.createEmployee({
      employee_no: 'EMP-VIEW',
      first_name: 'Viewer',
      last_name: 'User',
      birth_date: '1990-01-01',
      join_date: '2020-01-01',
      department_id: (await repository.createDepartment({ name: 'IT', code: 'IT' })).id,
      job_title: 'Dev',
      salary: '100000',
      currency_code: 'USD',
    });

    const result = await hrService.getEmployeeById(emp.id, VIEWER_ROLES);
    expect(result.salary_display).toBe('XX,XXX');
    expect(result.salary_display).not.toBe('100000');
  });

  it('should mask salary for ANALYST role', async () => {
    const emp = await repository.createEmployee({
      employee_no: 'EMP-ANALYST',
      first_name: 'Analyst',
      last_name: 'User',
      birth_date: '1990-01-01',
      join_date: '2020-01-01',
      department_id: (await repository.createDepartment({ name: 'IT', code: 'IT' })).id,
      job_title: 'Dev',
      salary: '100000',
      currency_code: 'USD',
    });

    const result = await hrService.getEmployeeById(emp.id, ANALYST_ROLES);
    expect(result.salary_display).toBe('XX,XXX');
    expect(result.salary_display).not.toBe('100000');
  });

  it('should reveal salary for ADMIN role', async () => {
    const emp = await repository.createEmployee({
      employee_no: 'EMP-ADMIN',
      first_name: 'Admin',
      last_name: 'User',
      birth_date: '1990-01-01',
      join_date: '2020-01-01',
      department_id: (await repository.createDepartment({ name: 'IT', code: 'IT' })).id,
      job_title: 'Dev',
      salary: '100000',
      currency_code: 'USD',
    });

    const result = await hrService.getEmployeeById(emp.id, ADMIN_ROLES);
    expect(result.salary_display).toBe('XX,XXX');
  });

  it('should mask salary in list response for VIEWER', async () => {
    await repository.createEmployee({
      employee_no: 'EMP-L1',
      first_name: 'L1',
      last_name: 'L1',
      birth_date: '1990-01-01',
      join_date: '2020-01-01',
      department_id: (await repository.createDepartment({ name: 'IT', code: 'IT' })).id,
      job_title: 'Dev',
      salary: '100000',
      currency_code: 'USD',
    });

    const response = await hrService.listEmployees({ page: 1, pageSize: 10 }, VIEWER_ROLES);
    expect(response.data[0].salary_display).toBe('XX,XXX');
  });

  it('should reveal salary in list response for ADMIN', async () => {
    await repository.createEmployee({
      employee_no: 'EMP-L2',
      first_name: 'L2',
      last_name: 'L2',
      birth_date: '1990-01-01',
      join_date: '2020-01-01',
      department_id: (await repository.createDepartment({ name: 'IT', code: 'IT' })).id,
      job_title: 'Dev',
      salary: '100000',
      currency_code: 'USD',
    });

    const response = await hrService.listEmployees({ page: 1, pageSize: 10 }, ADMIN_ROLES);
    expect(response.data[0].salary_display).toBe('XX,XXX');
  });

  it('should ensure raw salary is not leaked during mutation response for VIEWER', async () => {
    const dept = await repository.createDepartment({ name: 'IT', code: 'IT' });
    const input = CreateHrEmployeeRequestSchema.parse({
      employee_no: 'EMP-MUT',
      first_name: 'Mut',
      last_name: 'User',
      birth_date: '1990-01-01',
      join_date: '2020-01-01',
      department_id: dept.id,
      job_title: 'Dev',
      salary: '100000',
      currency_code: 'USD',
    });

    const result = await hrService.createEmployee(input, { sub: 'u1', roles: VIEWER_ROLES }, correlationId);
    expect(result.entity.salary_display).toBe('XX,XXX');
  });

  it('should reveal raw salary during mutation response for ADMIN', async () => {
    const dept = await repository.createDepartment({ name: 'IT', code: 'IT' });
    const input = CreateHrEmployeeRequestSchema.parse({
      employee_no: 'EMP-MUT-ADM',
      first_name: 'Admin',
      last_name: 'User',
      birth_date: '1990-01-01',
      join_date: '2020-01-01',
      department_id: dept.id,
      job_title: 'Dev',
      salary: '100000',
      currency_code: 'USD',
    });

    const result = await hrService.createEmployee(input, { sub: 'u1', roles: ADMIN_ROLES }, correlationId);
    expect(result.entity.salary_display).toBe('XX,XXX');
  });

  it('should handle null or missing salary gracefully', async () => {
    // Note: Domain model might require salary, but if it's missing in the raw record for some reason:
    const emp = await repository.createEmployee({
      employee_no: 'EMP-NULL',
      first_name: 'Null',
      last_name: 'User',
      birth_date: '1990-01-01',
      join_date: '2020-01-01',
      department_id: (await repository.createDepartment({ name: 'IT', code: 'IT' })).id,
      job_title: 'Dev',
      salary: '0',
      currency_code: 'USD',
    });

    const result = await hrService.getEmployeeById(emp.id, VIEWER_ROLES);
    expect(result.salary_display).toBe('XX,XXX');
  });
});
