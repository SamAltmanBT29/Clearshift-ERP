/**
 * ERP-5 HR & Employees — Deterministic Seed / Reset Helper (Synthetic Data Only)
 *
 * Writes ONLY through the public API (/api/v1/erp-hr/*), never directly to private tables.
 * Deterministic: fixed batch id, fixed department codes, fixed employee numbers.
 * Re-running is idempotent and safe (replays return HTTP 200 with the same IDs).
 *
 * CLI usage (against a running API):
 *   ERP5_BASE_URL=http://localhost:3000 [ERP5_AUTH_TOKEN=...] node sample-data/erp-5/seed.ts
 *
 * In-process usage (e.g. Vitest):
 *   import { runSeed } from './seed.js';
 *   await runSeed(postFn);
 *
 * @module sample-data/erp-5/seed
 */

export const SEED_BATCH_ID = 'b5000000-0000-4000-8000-000000000001';

export const SEED_DEPARTMENTS = [
  { name: 'Engineering', code: 'ENG', parent_id: null },
  { name: 'Operations', code: 'OPS', parent_id: null },
  { name: 'Human Resources', code: 'HR', parent_id: null },
] as const;

export const SEED_EMPLOYEES = [
  {
    employee_no: 'EMP-001',
    first_name: 'Ananya',
    last_name: 'Sharma',
    birth_date: '1990-05-15',
    join_date: '2020-01-10',
    departmentIndex: 0, // ENG
    job_title: 'Senior Software Engineer',
    salary: '120000.00',
    currency_code: 'INR',
  },
  {
    employee_no: 'EMP-002',
    first_name: 'Marcus',
    last_name: 'Vance',
    birth_date: '1988-11-20',
    join_date: '2021-03-01',
    departmentIndex: 1, // OPS
    job_title: 'Operations Manager',
    salary: '95000.00',
    currency_code: 'USD',
  },
  {
    employee_no: 'EMP-003',
    first_name: 'Priya',
    last_name: 'Patel',
    birth_date: '1985-08-12',
    join_date: '2019-06-15',
    departmentIndex: 2, // HR
    job_title: 'HR Director',
    salary: '110000.00',
    currency_code: 'EUR',
  },
] as const;

export const SEED_LEAVE = [
  {
    employeeIndex: 0, // EMP-001
    type: 'holiday',
    date_from: '2026-06-01',
    date_to: '2026-06-05',
    status: 'pending',
  },
  {
    employeeIndex: 1, // EMP-002
    type: 'sick',
    date_from: '2026-04-10',
    date_to: '2026-04-12',
    status: 'approved',
  },
] as const;

export const SEED_PAYROLL_TOTALS = [
  {
    departmentIndex: 0, // ENG
    month: '2026-04',
    total_amount: '1500000.00',
    headcount: 15,
    currency_code: 'INR',
  },
  {
    departmentIndex: 1, // OPS
    month: '2026-04',
    total_amount: '950000.00',
    headcount: 10,
    currency_code: 'USD',
  },
] as const;

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

export type PostFn = (
  method: 'POST' | 'PATCH',
  path: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
) => Promise<ApiResponse>;

export interface SeedResult {
  replayed: boolean;
  departmentIds: string[];
  employeeIds: string[];
  leaveIds: string[];
  payrollTotalIds: string[];
}

const BASE = '/api/v1/erp-hr';

/**
 * Runs the deterministic seed against an in-process Fastify injector or remote HTTP API.
 */
export async function runSeed(post: PostFn): Promise<SeedResult> {
  let replayed = false;
  const departmentIds: string[] = [];
  const employeeIds: string[] = [];
  const leaveIds: string[] = [];
  const payrollTotalIds: string[] = [];

  const headers = {
    authorization: 'Bearer role:admin',
  };

  // 1. Seed Departments
  for (let i = 0; i < SEED_DEPARTMENTS.length; i++) {
    const d = SEED_DEPARTMENTS[i]!;
    const idempotencyKey = `seed-dept-${d.code}-${SEED_BATCH_ID}`;

    const res = await post(
      'POST',
      `${BASE}/departments`,
      {
        name: d.name,
        code: d.code,
        parent_id: d.parent_id,
        idempotency_key: idempotencyKey,
        batch_id: SEED_BATCH_ID,
        source_row: i + 1,
      },
      headers,
    );

    if (res.status === 200) {
      replayed = true;
    } else if (res.status !== 201) {
      throw new Error(`Failed to seed department ${d.code}: HTTP ${res.status} ${JSON.stringify(res.body)}`);
    }

    departmentIds.push(String(res.body['id']));
  }

  // 2. Seed Employees
  for (let i = 0; i < SEED_EMPLOYEES.length; i++) {
    const e = SEED_EMPLOYEES[i]!;
    const deptId = departmentIds[e.departmentIndex];
    if (!deptId) throw new Error(`Missing department for index ${e.departmentIndex}`);

    const idempotencyKey = `seed-emp-${e.employee_no}-${SEED_BATCH_ID}`;

    const res = await post(
      'POST',
      `${BASE}/employees`,
      {
        employee_no: e.employee_no,
        first_name: e.first_name,
        last_name: e.last_name,
        birth_date: e.birth_date,
        join_date: e.join_date,
        department_id: deptId,
        job_title: e.job_title,
        salary: e.salary,
        currency_code: e.currency_code,
        idempotency_key: idempotencyKey,
        batch_id: SEED_BATCH_ID,
        source_row: i + 1,
      },
      headers,
    );

    if (res.status === 200) {
      replayed = true;
    } else if (res.status !== 201) {
      throw new Error(`Failed to seed employee ${e.employee_no}: HTTP ${res.status} ${JSON.stringify(res.body)}`);
    }

    employeeIds.push(String(res.body['id']));
  }

  // 3. Seed Leave Records
  for (let i = 0; i < SEED_LEAVE.length; i++) {
    const l = SEED_LEAVE[i]!;
    const empId = employeeIds[l.employeeIndex];
    if (!empId) throw new Error(`Missing employee for index ${l.employeeIndex}`);

    const idempotencyKey = `seed-leave-${empId}-${l.date_from}-${SEED_BATCH_ID}`;

    const res = await post(
      'POST',
      `${BASE}/leave`,
      {
        employee_id: empId,
        type: l.type,
        date_from: l.date_from,
        date_to: l.date_to,
        status: l.status,
        idempotency_key: idempotencyKey,
        batch_id: SEED_BATCH_ID,
        source_row: i + 1,
      },
      headers,
    );

    if (res.status === 200) {
      replayed = true;
    } else if (res.status !== 201) {
      throw new Error(`Failed to seed leave record: HTTP ${res.status} ${JSON.stringify(res.body)}`);
    }

    leaveIds.push(String(res.body['id']));
  }

  // 4. Seed Payroll Totals
  for (let i = 0; i < SEED_PAYROLL_TOTALS.length; i++) {
    const p = SEED_PAYROLL_TOTALS[i]!;
    const deptId = departmentIds[p.departmentIndex];
    if (!deptId) throw new Error(`Missing department for payroll index ${p.departmentIndex}`);

    const idempotencyKey = `seed-payroll-${deptId}-${p.month}-${SEED_BATCH_ID}`;

    const res = await post(
      'POST',
      `${BASE}/payroll-totals`,
      {
        department_id: deptId,
        month: p.month,
        total_amount: p.total_amount,
        headcount: p.headcount,
        currency_code: p.currency_code,
        idempotency_key: idempotencyKey,
        batch_id: SEED_BATCH_ID,
        source_row: i + 1,
      },
      headers,
    );

    if (res.status === 200) {
      replayed = true;
    } else if (res.status !== 201) {
      throw new Error(`Failed to seed payroll total: HTTP ${res.status} ${JSON.stringify(res.body)}`);
    }

    payrollTotalIds.push(String(res.body['id']));
  }

  return {
    replayed,
    departmentIds,
    employeeIds,
    leaveIds,
    payrollTotalIds,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone CLI Execution
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const baseUrl = process.env['ERP5_BASE_URL'] || 'http://localhost:3000';
  const authToken = process.env['ERP5_AUTH_TOKEN'] || 'role:admin';

  const post: PostFn = async (method, path, body, customHeaders) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: customHeaders?.['authorization'] || `Bearer ${authToken}`,
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body: json };
  };

  console.log(`[ERP-5] Seeding deterministic synthetic data against ${baseUrl}...`);
  const result = await runSeed(post);
  console.log(`[ERP-5] Seed completed successfully:`, {
    replayed: result.replayed,
    departments: result.departmentIds.length,
    employees: result.employeeIds.length,
    leave: result.leaveIds.length,
    payrollTotals: result.payrollTotalIds.length,
  });
}

// Check if running directly in Node CLI
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('seed.ts')) {
  main().catch((err) => {
    console.error('[ERP-5] Seed failed:', err);
    process.exit(1);
  });
}
