/**
 * ERP-5 HR & Employees — Deterministic Mock API
 *
 * Provides a stable, predictable Fastify-based mock implementation of the
 * ERP-5 API for contract testing and frontend development.
 *
 * Implements:
 *   - Employees (list, create, read, update)
 *   - Departments (list, create, read, update)
 *   - Leave (list, create, read, update)
 *   - Identity Users (read-only projection)
 *   - Payroll Totals (list, create, read)
 *
 * Constraints:
 *   - Salary masking (BR-ERP5-02) is strictly enforced.
 *   - No sensitive personal data in fixtures.
 *   - Deterministic resets.
 *
 * @module contracts/erp-5-mock
 */

import { ZodError } from 'zod';

/**
 * ERP-5 HR & Employees — Deterministic Mock API
 *
 * Provides a stable, predictable Fastify-based mock implementation of the
 * ERP-5 API for contract testing and frontend development.
 *
 * Implements:
 *   - Employees (list, create, read, update)
 *   - Departments (list, create, read, update)
 *   - Leave (list, create, read, update)
 *   - Identity Users (read-only projection)
 *   - Payroll Totals (list, create, read)
 *
 * Constraints:
 *   - Salary masking (BR-ERP5-02) is strictly enforced.
 *   - No sensitive personal data in fixtures.
 *   - Deterministic resets.
 *
 * @module contracts/erp-5-mock
 */

import Fastify, { FastifyInstance } from 'fastify';
import {
  HrUuid,
  HrDepartmentSchema,
  HrEmployeeSchema,
  HrEmployeeViewSchema,
  HrLeaveSchema,
  HrPayrollTotalSchema,
  HrIdentityUserSchema,
  CreateHrDepartmentRequestSchema,
  UpdateHrDepartmentRequestSchema,
  CreateHrEmployeeRequestSchema,
  UpdateHrEmployeeRequestSchema,
  CreateHrLeaveRequestSchema,
  UpdateHrLeaveRequestSchema,
  CreateHrPayrollTotalRequestSchema,
  HrPaginationQuerySchema,
  HrLeaveListQuerySchema,
} from './erp-5.js';
import {
  HttpStatusCodes,
  StandardErrorCodes,
  createErrorEnvelope,
  createPaginatedResponseSchema,
} from './common.js';

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const FIXTURES = {
  departments: [
    {
      id: 'd1111111-1111-1111-1111-111111111111',
      name: 'Executive Office',
      code: 'EXEC',
      parent_id: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'd2222222-2222-2222-2222-222222222222',
      name: 'Engineering',
      code: 'ENG',
      parent_id: 'd1111111-1111-1111-1111-111111111111',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'd3333333-3333-3333-3333-333333333333',
      name: 'Human Resources',
      code: 'HR',
      parent_id: 'd1111111-1111-1111-1111-111111111111',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
  ],
  employees: [
    {
      id: 'e1111111-1111-1111-1111-111111111111',
      employee_no: 'EMP-001',
      first_name: 'Alice',
      last_name: 'Smith',
      birth_date: '1985-05-15',
      join_date: '2010-06-01',
      department_id: 'd2222222-2222-2222-2222-222222222222',
      job_title: 'Chief Architect',
      salary: '150000.00',
      currency_code: 'INR',
      source_system: 'legacy-hr',
      source_id: 'L-101',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'e2222222-2222-2222-2222-222222222222',
      employee_no: 'EMP-002',
      first_name: 'Bob',
      last_name: 'Jones',
      birth_date: '1990-11-20',
      join_date: '2015-03-12',
      department_id: 'd2222222-2222-2222-2222-222222222222',
      job_title: 'Senior Engineer',
      salary: '120000.00',
      currency_code: 'INR',
      source_system: 'legacy-hr',
      source_id: 'L-102',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
  ],
  leave: [
    {
      id: 'l1111111-1111-1111-1111-111111111111',
      employee_id: 'e1111111-1111-1111-1111-111111111111',
      date_from: '2024-10-01',
      date_to: '2024-10-05',
      type: 'holiday',
      status: 'approved',
      created_at: '2024-09-01T00:00:00Z',
      updated_at: '2024-09-01T00:00:00Z',
    },
  ],
  payroll: [
    {
      id: 'p1111111-1111-1111-1111-111111111111',
      department_id: 'd2222222-2222-2222-2222-222222222222',
      month: '2024-10',
      total_amount: '270000.00',
      currency_code: 'INR',
      headcount: 2,
      created_at: '2024-10-01T00:00:00Z',
      updated_at: '2024-10-01T00:00:00Z',
    },
  ],
  identity: [
    {
      id: 'u1111111-1111-1111-1111-111111111111',
      username: 'asmith',
      roles: ['admin', 'user'],
      employee_ref: 'e1111111-1111-1111-1111-111111111111',
      status: 'active',
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory State
// ─────────────────────────────────────────────────────────────────────────────

let state = {
  departments: [...FIXTURES.departments],
  employees: [...FIXTURES.employees],
  leave: [...FIXTURES.leave],
  payroll: [...FIXTURES.payroll],
  identity: [...FIXTURES.identity],
};

export function resetMockState() {
  state.departments = [...FIXTURES.departments];
  state.employees = [...FIXTURES.employees];
  state.leave = [...FIXTURES.leave];
  state.payroll = [...FIXTURES.payroll];
  state.identity = [...FIXTURES.identity];
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function maskSalary(employee: any) {
  return {
    ...employee,
    salary_display: 'XX,XXX',
    salary: undefined, // Ensure raw salary is removed
    birth_date: undefined, // Mask personal data
    source_system: undefined,
    source_id: undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Implementation
// ─────────────────────────────────────────────────────────────────────────────

export async function createHrMockServer(fastify: FastifyInstance) {
  const base = '/api/v1/erp-hr';

  // ── Employees ─────────────────────────────────────────────────────────────

  fastify.get(`${base}/employees`, async (request, reply) => {
    try {
      const query = HrPaginationQuerySchema.parse(request.query);
      const { page, pageSize } = query;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;

      const items = state.employees
        .slice(start, end)
        .map(maskSalary);

      return {
        items,
        page,
        pageSize,
        total: state.employees.length,
      };
    } catch (e: any) {
      reply.code(HttpStatusCodes.UNPROCESSABLE_ENTITY);
       return createErrorEnvelope(StandardErrorCodes.VALIDATION_ERROR, e.message);
    }
  });

  fastify.post(`${base}/employees`, async (request, reply) => {
    try {
      const body = CreateHrEmployeeRequestSchema.parse(request.body);
      const newEmployee = {
        ...body,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any;
      state.employees.push(newEmployee);
      reply.code(201);
      return maskSalary(newEmployee);
    } catch (e: any) {
      reply.code(HttpStatusCodes.UNPROCESSABLE_ENTITY);
       return createErrorEnvelope(StandardErrorCodes.VALIDATION_ERROR, e.message);
    }
  });

  fastify.get(`${base}/employees/:id`, async (request, reply) => {
    const { id } = request.params as any;
    const employee = state.employees.find((e) => e.id === id);
    if (!employee) {
      reply.code(HttpStatusCodes.NOT_FOUND);
      return createErrorEnvelope(StandardErrorCodes.NOT_FOUND, 'Employee not found');
    }
    return maskSalary(employee);
  });

  fastify.patch(`${base}/employees/:id`, async (request, reply) => {
    try {
      const { id } = request.params as any;
      const body = UpdateHrEmployeeRequestSchema.parse(request.body);
      const idx = state.employees.findIndex((e) => e.id === id);
      if (idx === -1) {
        reply.code(HttpStatusCodes.NOT_FOUND);
        return createErrorEnvelope(StandardErrorCodes.NOT_FOUND, 'Employee not found');
      }
      state.employees[idx] = { ...state.employees[idx], ...body, updated_at: new Date().toISOString() };
      return maskSalary(state.employees[idx]);
    } catch (e: any) {
      if (reply.statusCode === HttpStatusCodes.NOT_FOUND) return createErrorEnvelope(StandardErrorCodes.NOT_FOUND, 'Employee not found');
      reply.code(HttpStatusCodes.UNPROCESSABLE_ENTITY);
       return createErrorEnvelope(StandardErrorCodes.VALIDATION_ERROR, e.message);
    }
  });

  // ── Departments ─────────────────────────────────────────────────────────────

  fastify.get(`${base}/departments`, async (request, reply) => {
    try {
      const query = HrPaginationQuerySchema.parse(request.query);
      const { page, pageSize } = query;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;

      const items = state.departments.slice(start, end);
      return {
        items,
        page,
        pageSize,
        total: state.departments.length,
      };
    } catch (e: any) {
      reply.code(HttpStatusCodes.UNPROCESSABLE_ENTITY);
       return createErrorEnvelope(StandardErrorCodes.VALIDATION_ERROR, e.message);
    }
  });

  fastify.post(`${base}/departments`, async (request, reply) => {
    try {
      const body = CreateHrDepartmentRequestSchema.parse(request.body);
      const newDept = {
        ...body,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any;
      state.departments.push(newDept);
      reply.code(201);
      return newDept;
    } catch (e: any) {
      reply.code(HttpStatusCodes.UNPROCESSABLE_ENTITY);
       return createErrorEnvelope(StandardErrorCodes.VALIDATION_ERROR, e.message);
    }
  });

  fastify.get(`${base}/departments/:id`, async (request, reply) => {
    const { id } = request.params as any;
    const dept = state.departments.find((d) => d.id === id);
    if (!dept) {
      reply.code(HttpStatusCodes.NOT_FOUND);
      return createErrorEnvelope(StandardErrorCodes.NOT_FOUND, 'Department not found');
    }
    return dept;
  });

  fastify.patch(`${base}/departments/:id`, async (request, reply) => {
    try {
      const { id } = request.params as any;
      const body = UpdateHrDepartmentRequestSchema.parse(request.body);
      const idx = state.departments.findIndex((d) => d.id === id);
      if (idx === -1) {
        reply.code(HttpStatusCodes.NOT_FOUND);
        return createErrorEnvelope(StandardErrorCodes.NOT_FOUND, 'Department not found');
      }
      state.departments[idx] = { ...state.departments[idx], ...body, updated_at: new Date().toISOString() };
      return state.departments[idx];
    } catch (e: any) {
      if (reply.statusCode === HttpStatusCodes.NOT_FOUND) return createErrorEnvelope(StandardErrorCodes.NOT_FOUND, 'Department not found');
      reply.code(HttpStatusCodes.UNPROCESSABLE_ENTITY);
       return createErrorEnvelope(StandardErrorCodes.VALIDATION_ERROR, e.message);
    }
  });

  // ── Leave ─────────────────────────────────────────────────────────────

  fastify.get(`${base}/leave`, async (request, reply) => {
    try {
      const query = HrLeaveListQuerySchema.parse(request.query);
      const { page, pageSize } = query;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;

      let items = state.leave;
      if (query.employee_id) {
        items = items.filter((l) => l.employee_id === query.employee_id);
      }

      return {
        items: items.slice(start, end),
        page,
        pageSize,
        total: items.length,
      };
    } catch (e: any) {
      reply.code(HttpStatusCodes.UNPROCESSABLE_ENTITY);
       return createErrorEnvelope(StandardErrorCodes.VALIDATION_ERROR, e.message);
    }
  });

  fastify.post(`${base}/leave`, async (request, reply) => {
    try {
      const body = CreateHrLeaveRequestSchema.parse(request.body);
      const newLeave = {
        ...body,
        id: crypto.randomUUID(),
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any;
      state.leave.push(newLeave);
      reply.code(201);
      return newLeave;
    } catch (e: any) {
      reply.code(HttpStatusCodes.UNPROCESSABLE_ENTITY);
       return createErrorEnvelope(StandardErrorCodes.VALIDATION_ERROR, e.message);
    }
  });

  fastify.get(`${base}/leave/:id`, async (request, reply) => {
    const { id } = request.params as any;
    const record = state.leave.find((l) => l.id === id);
    if (!record) {
      reply.code(HttpStatusCodes.NOT_FOUND);
      return createErrorEnvelope(StandardErrorCodes.NOT_FOUND, 'Leave record not found');
    }
    return record;
  });

  fastify.patch(`${base}/leave/:id`, async (request, reply) => {
    try {
      const { id } = request.params as any;
      const body = UpdateHrLeaveRequestSchema.parse(request.body);
      const idx = state.leave.findIndex((l) => l.id === id);
      if (idx === -1) {
        reply.code(HttpStatusCodes.NOT_FOUND);
        return createErrorEnvelope(StandardErrorCodes.NOT_FOUND, 'Leave record not found');
      }
      state.leave[idx] = { ...state.leave[idx], ...body, updated_at: new Date().toISOString() };
      return state.leave[idx];
    } catch (e: any) {
      if (reply.statusCode === HttpStatusCodes.NOT_FOUND) return createErrorEnvelope(StandardErrorCodes.NOT_FOUND, 'Leave record not found');
      reply.code(HttpStatusCodes.UNPROCESSABLE_ENTITY);
       return createErrorEnvelope(StandardErrorCodes.VALIDATION_ERROR, e.message);
    }
  });

  // ── Identity ─────────────────────────────────────────────────────────────

  fastify.get(`${base}/identity-users`, async (request, reply) => {
    try {
      const query = HrPaginationQuerySchema.parse(request.query || {});
      const { page, pageSize } = query;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;

      return {
        items: state.identity.slice(start, end),
        page,
        pageSize,
        total: state.identity.length,
      };
    } catch (e: any) {
      reply.code(HttpStatusCodes.UNPROCESSABLE_ENTITY);
      return createErrorEnvelope(StandardErrorCodes.VALIDATION_ERROR, e.message);
    }
  });

  // ── Payroll ────────────────────────────────────────────────────────────────

  fastify.get(`${base}/payroll-totals`, async (request, reply) => {
    try {
      const query = HrPaginationQuerySchema.parse(request.query);
      const { page, pageSize } = query;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;

      return {
        items: state.payroll.slice(start, end),
        page,
        pageSize,
        total: state.payroll.length,
      };
    } catch (e: any) {
      reply.code(HttpStatusCodes.UNPROCESSABLE_ENTITY);
       return createErrorEnvelope(StandardErrorCodes.VALIDATION_ERROR, e.message);
    }
  });

  fastify.post(`${base}/payroll-totals`, async (request, reply) => {
    try {
      const body = CreateHrPayrollTotalRequestSchema.parse(request.body);
      const newTotal = {
        ...body,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any;
      state.payroll.push(newTotal);
      reply.code(201);
      return newTotal;
    } catch (e: any) {
      reply.code(HttpStatusCodes.UNPROCESSABLE_ENTITY);
       return createErrorEnvelope(StandardErrorCodes.VALIDATION_ERROR, e.message);
    }
  });

  fastify.get(`${base}/payroll-totals/:id`, async (request, reply) => {
    const { id } = request.params as any;
    const total = state.payroll.find((p) => p.id === id);
    if (!total) {
      reply.code(HttpStatusCodes.NOT_FOUND);
      return createErrorEnvelope(StandardErrorCodes.NOT_FOUND, 'Payroll total not found');
    }
    return total;
  });
}
