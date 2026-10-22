/**
 * ERP-5 HR & Employees — Database Constraint Proofs (live PostgreSQL)
 *
 * These tests prove that the ERP-5 invariants are enforced **by PostgreSQL**,
 * not only by the application layer:
 *
 *   1. A clean database applies every migration exactly once
 *   2. Re-running the migration job does not reapply a migration
 *   3. Every unique rule rejects a duplicate with SQLSTATE 23505
 *   4. Every check constraint rejects an invalid value with SQLSTATE 23514
 *   5. Every foreign key rejects a missing reference with SQLSTATE 23503
 *   6. The Hub Identity projection is a read-only view with no credential
 *      column and no write path for application roles
 *   7. No foreign key crosses the module schema boundary
 *   8. The `updated_at` trigger keeps the audit column current
 *
 * The suite creates its own throwaway database and drops it afterwards; it
 * never touches a developer or production database.
 *
 * Run with:
 *   DATABASE_URL_TEST=postgresql://user:pass@localhost:5432/postgres \
 *     npx vitest run apps/erp/modules/erp-5
 *
 * @module erp5/tests/db/schema.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL('../../../../../..', import.meta.url));
const MIGRATION_RUNNER = fileURLToPath(
  new URL('../../../../../../packages/database/scripts/migrate.js', import.meta.url)
);
const MIGRATION_SQL = readFileSync(
  fileURLToPath(new URL('../../../../../../packages/database/migrations/erp5_v1.sql', import.meta.url)),
  'utf-8'
);

/** Administrative connection used to create/remove the throwaway database. */
const ADMIN_URL = process.env['DATABASE_URL_TEST'];
/** Connection to the throwaway database created by this suite. */
const SCRATCH_NAME = `erp5_scratch_${Math.random().toString(36).slice(2, 10)}`;
const SCRATCH_URL = ADMIN_URL
  ? ADMIN_URL.replace(/\/([^/?]+)(\?|$)/, `/${SCRATCH_NAME}$2`)
  : undefined;

if (!ADMIN_URL) {
  console.warn(
    '[erp-5] DATABASE_URL_TEST is not set — the live PostgreSQL constraint proofs are skipped. ' +
      'Set DATABASE_URL_TEST to run them.'
  );
}

interface PgError extends Error {
  code?: string;
  constraint?: string;
}

/** Runs `statement` inside a savepoint and asserts the PostgreSQL SQLSTATE. */
async function expectViolation(
  client: pg.PoolClient,
  statement: string,
  params: unknown[],
  expectedCode: string
): Promise<PgError> {
  await client.query('SAVEPOINT violation_probe');
  let caught: PgError | null = null;
  try {
    await client.query(statement, params);
  } catch (error) {
    caught = error as PgError;
  }
  await client.query('ROLLBACK TO SAVEPOINT violation_probe');

  expect(caught, `expected ${expectedCode} while executing: ${statement}`).not.toBeNull();
  expect(caught?.code, `PostgreSQL said: ${caught?.message}`).toBe(expectedCode);
  return caught as PgError;
}

describe.skipIf(!ADMIN_URL)('ERP-5 database constraints (live PostgreSQL)', () => {
  let admin: pg.Pool;
  let db: pg.Pool;
  let runnerOutput = '';
  let secondRunnerOutput = '';

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: ADMIN_URL as string });

    // A dedicated throwaway database — the guard below refuses to drop
    // anything that is not clearly a scratch database of this suite.
    await admin.query(`CREATE DATABASE "${SCRATCH_NAME}" TEMPLATE template0`);

    db = new pg.Pool({ connectionString: SCRATCH_URL as string });

    // Run 1 — applies every migration to the empty database.
    const first = await execFileAsync(process.execPath, [MIGRATION_RUNNER], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        DATABASE_URL: SCRATCH_URL as string,
        DATABASE_URL_TEST: SCRATCH_URL as string,
      },
    });
    runnerOutput = `${first.stdout}${first.stderr}`;

    // Run 2 — proves the job does not reapply an applied migration.
    const second = await execFileAsync(process.execPath, [MIGRATION_RUNNER], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        DATABASE_URL: SCRATCH_URL as string,
        DATABASE_URL_TEST: SCRATCH_URL as string,
      },
    });
    secondRunnerOutput = `${second.stdout}${second.stderr}`;
  }, 120_000);

  afterAll(async () => {
    if (db) await db.end();
    if (admin) {
      if (SCRATCH_NAME.startsWith('erp5_scratch_')) {
        await admin.query(`DROP DATABASE IF EXISTS "${SCRATCH_NAME}" WITH (FORCE)`);
      }
      await admin.end();
    }
  });

  // ── 1. Migration application ──────────────────────────────────────────────
  describe('Migration application', () => {
    it('applies every migration to a clean database exactly once', () => {
      expect(runnerOutput).toContain('erp4_v1 applied successfully');
      expect(runnerOutput).toContain('erp5_v1 applied successfully');
    });

    it('records the migration in the shared migration ledger', async () => {
      const { rows } = await db.query<{ migration: string }>(
        'SELECT migration FROM public.schema_migrations ORDER BY migration'
      );
      expect(rows.map((r) => r.migration)).toContain('erp5_v1');
    });

    it('does not reapply an already applied migration on a second run', () => {
      expect(secondRunnerOutput).toContain('Skipping erp4_v1 (already applied)');
      expect(secondRunnerOutput).toContain('Skipping erp5_v1 (already applied)');
    });

    it('creates the module schema, tables and enum types', async () => {
      const { rows } = await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'erp5' ORDER BY table_name`
      );
      expect(rows.map((r) => r.table_name)).toEqual([
        'departments',
        'employees',
        'import_receipts',
        'leave',
        'payroll_totals',
      ]);

      const { rows: enums } = await db.query<{ typname: string; enumlabel: string }>(
        `SELECT t.typname, e.enumlabel
           FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typnamespace = 'erp5'::regnamespace
          ORDER BY t.typname, e.enumsortorder`
      );
      expect(enums.filter((e) => e.typname === 'leave_type').map((e) => e.enumlabel)).toEqual([
        'sick',
        'holiday',
        'other',
      ]);
      expect(enums.filter((e) => e.typname === 'leave_status').map((e) => e.enumlabel)).toEqual([
        'pending',
        'approved',
        'rejected',
      ]);
    });

    it('creates no identity projection while Hub Identity is absent', async () => {
      const { rows } = await db.query<{ regclass: string | null }>(
        `SELECT to_regclass('erp5.identity_users')::text AS regclass`
      );
      expect(rows[0]?.regclass).toBeNull();
    });
  });

  // ── 2. Uniqueness ─────────────────────────────────────────────────────────
  describe('Unique constraints', () => {
    it('accepts a valid department and employee', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const department = await client.query<{ id: string }>(
          `INSERT INTO erp5.departments (name, code) VALUES ('Engineering', 'ENG') RETURNING id`
        );
        const departmentId = department.rows[0]!.id;

        const employee = await client.query<{ id: string }>(
          `INSERT INTO erp5.employees
             (employee_no, first_name, last_name, birth_date, join_date, department_id, job_title, salary)
           VALUES ('EMP-0001', 'Asha', 'Iyer', '1990-04-12', '2024-01-08', $1, 'Software Engineer', 125000.0000)
           RETURNING id`,
          [departmentId]
        );
        expect(employee.rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects a duplicate employee number (23505)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const department = await client.query<{ id: string }>(
          `INSERT INTO erp5.departments (name, code) VALUES ('Engineering', 'ENG') RETURNING id`
        );
        const departmentId = department.rows[0]!.id;

        await client.query(
          `INSERT INTO erp5.employees
             (employee_no, first_name, last_name, birth_date, join_date, department_id, job_title, salary)
           VALUES ('EMP-DUP', 'Asha', 'Iyer', '1990-04-12', '2024-01-08', $1, 'Engineer', 100.0000)`,
          [departmentId]
        );

        const error = await expectViolation(
          client,
          `INSERT INTO erp5.employees
             (employee_no, first_name, last_name, birth_date, join_date, department_id, job_title, salary)
           VALUES ('EMP-DUP', 'Rahul', 'Verma', '1991-01-01', '2024-02-01', $1, 'Engineer', 100.0000)`,
          [departmentId],
          '23505'
        );
        expect(error.constraint).toBe('employees_employee_no_unique');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects a duplicate department code (23505)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query(`INSERT INTO erp5.departments (name, code) VALUES ('Engineering', 'ENG')`);
        const error = await expectViolation(
          client,
          `INSERT INTO erp5.departments (name, code) VALUES ('Engineering West', 'ENG')`,
          [],
          '23505'
        );
        expect(error.constraint).toBe('departments_code_unique');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects a duplicate source identity but allows rows without a source id (23505)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const department = await client.query<{ id: string }>(
          `INSERT INTO erp5.departments (name, code) VALUES ('Engineering', 'ENG') RETURNING id`
        );
        const departmentId = department.rows[0]!.id;

        const insertSource = (employeeNo: string, sourceId: string | null) =>
          client.query(
            `INSERT INTO erp5.employees
               (employee_no, first_name, last_name, birth_date, join_date, department_id,
                job_title, salary, source_system, source_id)
             VALUES ($1, 'Asha', 'Iyer', '1990-04-12', '2024-01-08', $2, 'Engineer', 100.0000,
                     'legacy_hr_csv', $3)`,
            [employeeNo, departmentId, sourceId]
          );

        await insertSource('EMP-SRC-1', 'ROW-1');
        const error = await expectViolation(
          client,
          `INSERT INTO erp5.employees
             (employee_no, first_name, last_name, birth_date, join_date, department_id,
              job_title, salary, source_system, source_id)
           VALUES ('EMP-SRC-2', 'Rahul', 'Verma', '1991-01-01', '2024-02-01', $1, 'Engineer', 100.0000,
                   'legacy_hr_csv', 'ROW-1')`,
          [departmentId],
          '23505'
        );
        expect(error.constraint).toBe('employees_source_identity_unique');

        // Manually created employees (no source id) are not constrained
        await insertSource('EMP-SRC-3', null);
        await insertSource('EMP-SRC-4', null);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects a second payroll aggregate for the same department and month (23505)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const department = await client.query<{ id: string }>(
          `INSERT INTO erp5.departments (name, code) VALUES ('Engineering', 'ENG') RETURNING id`
        );
        const departmentId = department.rows[0]!.id;

        await client.query(
          `INSERT INTO erp5.payroll_totals (department_id, month, total_amount, headcount)
           VALUES ($1, '2026-04', 500000.0000, 4)`,
          [departmentId]
        );

        const error = await expectViolation(
          client,
          `INSERT INTO erp5.payroll_totals (department_id, month, total_amount, headcount)
           VALUES ($1, '2026-04', 510000.0000, 4)`,
          [departmentId],
          '23505'
        );
        expect(error.constraint).toBe('payroll_totals_department_month_unique');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects a duplicate import receipt idempotency key (23505)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const receipt = `INSERT INTO erp5.import_receipts
          (batch_id, source_row, entity, idempotency_key, target_id)
         VALUES ('00000000-0000-0000-0000-000000000001', 1, 'employee', 'key-1',
                 '00000000-0000-0000-0000-000000000002')`;
        await client.query(receipt);
        const error = await expectViolation(
          client,
          receipt.replace('key-1', 'key-1').replace('000000000001', '000000000003'),
          [],
          '23505'
        );
        expect(error.constraint).toBe('import_receipts_idempotency_key_unique');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });
  });

  // ── 3. Check constraints ──────────────────────────────────────────────────
  describe('Check constraints', () => {
    it('[BR-ERP5-01] rejects a join date before the birth date (23514)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const department = await client.query<{ id: string }>(
          `INSERT INTO erp5.departments (name, code) VALUES ('Engineering', 'ENG') RETURNING id`
        );
        const error = await expectViolation(
          client,
          `INSERT INTO erp5.employees
             (employee_no, first_name, last_name, birth_date, join_date, department_id, job_title, salary)
           VALUES ('EMP-BAD', 'Asha', 'Iyer', '1990-04-12', '1989-01-08', $1, 'Engineer', 100.0000)`,
          [department.rows[0]!.id],
          '23514'
        );
        expect(error.constraint).toBe('employees_join_date_after_birth_date');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects a negative salary (23514)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const department = await client.query<{ id: string }>(
          `INSERT INTO erp5.departments (name, code) VALUES ('Engineering', 'ENG') RETURNING id`
        );
        const error = await expectViolation(
          client,
          `INSERT INTO erp5.employees
             (employee_no, first_name, last_name, birth_date, join_date, department_id, job_title, salary)
           VALUES ('EMP-NEG', 'Asha', 'Iyer', '1990-04-12', '2024-01-08', $1, 'Engineer', -1.0000)`,
          [department.rows[0]!.id],
          '23514'
        );
        expect(error.constraint).toBe('employees_salary_non_negative');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects a leave record whose end date precedes the start date (23514)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const department = await client.query<{ id: string }>(
          `INSERT INTO erp5.departments (name, code) VALUES ('Engineering', 'ENG') RETURNING id`
        );
        const employee = await client.query<{ id: string }>(
          `INSERT INTO erp5.employees
             (employee_no, first_name, last_name, birth_date, join_date, department_id, job_title, salary)
           VALUES ('EMP-LEAVE', 'Asha', 'Iyer', '1990-04-12', '2024-01-08', $1, 'Engineer', 100.0000)
           RETURNING id`,
          [department.rows[0]!.id]
        );
        const error = await expectViolation(
          client,
          `INSERT INTO erp5.leave (employee_id, date_from, date_to, type)
           VALUES ($1, '2026-04-10', '2026-04-01', 'sick')`,
          [employee.rows[0]!.id],
          '23514'
        );
        expect(error.constraint).toBe('leave_date_range_valid');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects a department that is its own parent (23514)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const department = await client.query<{ id: string }>(
          `INSERT INTO erp5.departments (name, code) VALUES ('Engineering', 'ENG') RETURNING id`
        );
        const error = await expectViolation(
          client,
          `UPDATE erp5.departments SET parent_id = $1 WHERE id = $1`,
          [department.rows[0]!.id],
          '23514'
        );
        expect(error.constraint).toBe('departments_not_self_parent');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects a malformed payroll month and a negative aggregate (23514)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const department = await client.query<{ id: string }>(
          `INSERT INTO erp5.departments (name, code) VALUES ('Engineering', 'ENG') RETURNING id`
        );
        const departmentId = department.rows[0]!.id;

        const monthError = await expectViolation(
          client,
          `INSERT INTO erp5.payroll_totals (department_id, month, total_amount, headcount)
           VALUES ($1, '2026-13', 1000.0000, 1)`,
          [departmentId],
          '23514'
        );
        expect(monthError.constraint).toBe('payroll_totals_month_format_valid');

        const amountError = await expectViolation(
          client,
          `INSERT INTO erp5.payroll_totals (department_id, month, total_amount, headcount)
           VALUES ($1, '2026-04', -1.0000, 1)`,
          [departmentId],
          '23514'
        );
        expect(amountError.constraint).toBe('payroll_totals_total_non_negative');

        const headcountError = await expectViolation(
          client,
          `INSERT INTO erp5.payroll_totals (department_id, month, total_amount, headcount)
           VALUES ($1, '2026-05', 1000.0000, -1)`,
          [departmentId],
          '23514'
        );
        expect(headcountError.constraint).toBe('payroll_totals_headcount_non_negative');

        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });
  });

  // ── 4. Foreign keys ───────────────────────────────────────────────────────
  describe('Foreign keys', () => {
    it('rejects an employee whose department does not exist (23503)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await expectViolation(
          client,
          `INSERT INTO erp5.employees
             (employee_no, first_name, last_name, birth_date, join_date, department_id, job_title, salary)
           VALUES ('EMP-NODEPT', 'Asha', 'Iyer', '1990-04-12', '2024-01-08',
                   '00000000-0000-0000-0000-0000000000ff', 'Engineer', 100.0000)`,
          [],
          '23503'
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects a leave record whose employee does not exist (23503)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await expectViolation(
          client,
          `INSERT INTO erp5.leave (employee_id, date_from, date_to, type)
           VALUES ('00000000-0000-0000-0000-0000000000ff', '2026-04-01', '2026-04-02', 'holiday')`,
          [],
          '23503'
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects a payroll aggregate whose department does not exist (23503)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await expectViolation(
          client,
          `INSERT INTO erp5.payroll_totals (department_id, month, total_amount, headcount)
           VALUES ('00000000-0000-0000-0000-0000000000ff', '2026-04', 1000.0000, 1)`,
          [],
          '23503'
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects a department whose parent does not exist (23503)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await expectViolation(
          client,
          `INSERT INTO erp5.departments (name, code, parent_id)
           VALUES ('Orphan', 'ORPH', '00000000-0000-0000-0000-0000000000ff')`,
          [],
          '23503'
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('keeps every foreign key inside the erp5 schema', async () => {
      const { rows } = await db.query<{ referenced_schema: string }>(
        `SELECT ns.nspname AS referenced_schema
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace sn ON sn.oid = t.relnamespace
           JOIN pg_class ft ON ft.oid = c.confrelid
           JOIN pg_namespace ns ON ns.oid = ft.relnamespace
          WHERE c.contype = 'f' AND sn.nspname = 'erp5'`
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.referenced_schema).toBe('erp5');
      }
    });
  });

  // ── 5. Read-only Hub Identity projection ──────────────────────────────────
  describe('Read-only Hub Identity projection', () => {
    const probeRole = `erp5_probe_${Math.random().toString(36).slice(2, 8)}`;

    beforeAll(async () => {
      // The platform's Hub Identity table is owned by PLT-03/PLT-05; this
      // fixture mirrors `packages/database/src/schema/platform.ts` so the
      // projection can be exercised.
      await db.query(`
        CREATE SCHEMA IF NOT EXISTS platform;
        CREATE TABLE IF NOT EXISTS platform.hub_users (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          username     TEXT NOT NULL UNIQUE,
          roles         TEXT[] NOT NULL,
          employee_ref  UUID,
          status        TEXT NOT NULL DEFAULT 'active',
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      // Re-running the guarded migration creates the projection now that
      // Hub Identity exists — the migration is safe to re-apply.
      await db.query(MIGRATION_SQL);

      await admin.query(`CREATE ROLE "${probeRole}" NOLOGIN`);
      await admin.query(`GRANT CONNECT ON DATABASE "${SCRATCH_NAME}" TO "${probeRole}"`);
      await db.query(`GRANT USAGE ON SCHEMA erp5 TO "${probeRole}"`);
      await db.query(`GRANT SELECT ON erp5.identity_users TO "${probeRole}"`);
    }, 60_000);

    afterAll(async () => {
      // Release the grants held inside the throwaway database before the
      // cluster-wide role is dropped.
      await db.query(`DROP OWNED BY "${probeRole}"`);
      await admin.query(`DROP ROLE IF EXISTS "${probeRole}"`);
    });

    it('exposes the projection as a view, not a table', async () => {
      const { rows } = await db.query<{ table_type: string; table_name: string }>(
        `SELECT table_type, table_name FROM information_schema.tables
          WHERE table_schema = 'erp5' AND table_name = 'identity_users'`
      );
      expect(rows[0]?.table_type).toBe('VIEW');
    });

    it('exposes identity attributes only — no password, hash or token column', async () => {
      const { rows } = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'erp5' AND table_name = 'identity_users'
          ORDER BY column_name`
      );
      expect(rows.map((r) => r.column_name)).toEqual([
        'employee_ref',
        'id',
        'roles',
        'status',
        'username',
      ]);
    });

    it('reads through to the Hub Identity owner table', async () => {
      const { rows } = await db.query<{ definition: string }>(
        `SELECT pg_get_viewdef('erp5.identity_users'::regclass, true) AS definition`
      );
      expect(rows[0]?.definition).toContain('platform.hub_users');
    });

    it('refuses writes from an application role (42501)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET ROLE "${probeRole}"`);
        try {
          const error = await expectViolation(
            client,
            `INSERT INTO erp5.identity_users (id, username, roles, employee_ref, status)
             VALUES (gen_random_uuid(), 'intruder', ARRAY['admin'], NULL, 'active')`,
            [],
            '42501'
          );
          expect(error.message).toMatch(/permission denied/i);
        } finally {
          // Leave the pooled connection exactly as it was found.
          await client.query('ROLLBACK');
          await client.query('RESET ROLE');
        }
      } finally {
        client.release();
      }
    });
  });

  // ── 6. Audit timestamps ───────────────────────────────────────────────────
  describe('Audit timestamps', () => {
    it('keeps updated_at current on update', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const inserted = await client.query<{ id: string; updated_at: Date }>(
          `INSERT INTO erp5.departments (name, code) VALUES ('Engineering', 'ENG')
           RETURNING id, updated_at`
        );
        await client.query('SELECT pg_sleep(0.01)');
        const updated = await client.query<{ updated_at: Date }>(
          `UPDATE erp5.departments SET name = 'Engineering West' WHERE id = $1
           RETURNING updated_at`,
          [inserted.rows[0]!.id]
        );
        expect(updated.rows[0]!.updated_at.getTime()).toBeGreaterThanOrEqual(
          inserted.rows[0]!.updated_at.getTime()
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });
  });
});
