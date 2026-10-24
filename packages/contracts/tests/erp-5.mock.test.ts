import { expect } from 'vitest';
import Fastify from 'fastify';
import { createHrMockServer, resetMockState } from '../src/erp-5-mock.js';
import { 
  HttpStatusCodes, 
  StandardErrorCodes 
} from '../src/common.js';

describe('ERP-5 Mock API', () => {
  let server: any;

  beforeAll(async () => {
    server = Fastify();
    await createHrMockServer(server);
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    resetMockState();
  });

  describe('Employees', () => {
    it('GET /employees should return paginated masked employees', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/erp-hr/employees?page=1&pageSize=10',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.items).toBeInstanceOf(Array);
      expect(body.items[0]).toHaveProperty('salary_display');
      expect(body.items[0]).not.toHaveProperty('salary');
      expect(body.items[0]).not.toHaveProperty('birth_date');
    });

    it('GET /employees/{id} should return masked employee', async () => {
      const employeeId = 'e1111111-1111-1111-1111-111111111111';
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/erp-hr/employees/${employeeId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.salary_display).toBe('XX,XXX');
      expect(body).not.toHaveProperty('salary');
    });

    it('GET /employees/{id} should return 404 for missing employee', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/erp-hr/employees/00000000-0000-0000-0000-000000000000',
      });

      expect(res.statusCode).toBe(HttpStatusCodes.NOT_FOUND);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe(StandardErrorCodes.NOT_FOUND);
    });

    it('POST /employees should create and return masked employee', async () => {
      const payload = {
        employee_no: 'EMP-999',
        first_name: 'New',
        last_name: 'Hire',
        birth_date: '1995-01-01',
        join_date: '2024-10-01',
        department_id: 'd2222222-2222-2222-2222-222222222222',
        job_title: 'Developer',
        salary: '100000.00',
        currency_code: 'INR',
      };

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/erp-hr/employees',
        payload,
      });

      expect(res.statusCode).toBe(HttpStatusCodes.CREATED);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('id');
      expect(body.salary_display).toBe('XX,XXX');
      expect(body).not.toHaveProperty('salary');
    });
  });

  describe('Departments', () => {
    it('GET /departments should return paginated departments', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/erp-hr/departments?page=1&pageSize=10',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items[0]).toHaveProperty('name');
    });

    it('POST /departments should create a department', async () => {
      const payload = {
        name: 'Quality Assurance',
        code: 'QA',
        parent_id: 'd1111111-1111-1111-1111-111111111111',
      };

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/erp-hr/departments',
        payload,
      });

      expect(res.statusCode).toBe(HttpStatusCodes.CREATED);
      expect(JSON.parse(res.payload)).toHaveProperty('id');
    });
  });

  describe('Leave', () => {
    it('GET /leave should return paginated leave records', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/erp-hr/leave?page=1&pageSize=10',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.items).toBeInstanceOf(Array);
    });

    it('POST /leave should create leave record', async () => {
      const payload = {
        employee_id: 'e1111111-1111-1111-1111-111111111111',
        date_from: '2024-11-01',
        date_to: '2024-11-05',
        type: 'sick',
      };

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/erp-hr/leave',
        payload,
      });

      expect(res.statusCode).toBe(HttpStatusCodes.CREATED);
      expect(JSON.parse(res.payload)).toHaveProperty('id');
    });
  });

  describe('Identity Users', () => {
    it('GET /identity-users should return identity projections', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/erp-hr/identity-users',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.items[0]).toHaveProperty('username');
      expect(body.items[0]).not.toHaveProperty('password');
    });
  });

  describe('Payroll Totals', () => {
    it('GET /payroll-totals should return aggregates', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/erp-hr/payroll-totals?page=1&pageSize=10',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.items[0]).toHaveProperty('total_amount');
    });
  });

  describe('Determinism', () => {
    it('should return identical results after reset', async () => {
      const res1 = await server.inject({
        method: 'GET',
        url: '/api/v1/erp-hr/employees?page=1&pageSize=1',
      });
      const body1 = JSON.parse(res1.payload);

      resetMockState();

      const res2 = await server.inject({
        method: 'GET',
        url: '/api/v1/erp-hr/employees?page=1&pageSize=1',
      });
      const body2 = JSON.parse(res2.payload);

      expect(body1).toEqual(body2);
    });
  });
});
