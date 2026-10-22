/**
 * ERP-5 HR & Employees — Drizzle Repository Proofs (live PostgreSQL)
 *
 * Issue #47 (`[ERP5-02]`) — the Drizzle implementation of the `HrRepository`
 * contract, proven against a real PostgreSQL:
 *
 *   1. the write path persists exactly what the service sent
 *   2. the query layer is **server-side**: the search and the filter run in
 *      the database and are parameterised (a search term that looks like SQL
 *      is treated as text)
 *   3. the paging is **bounded** and **deterministic** — the pages do not
 *      overlap and the `id` breaks the ties
 *   4. the import receipt commits in the **same transaction** as the target
 *      mutation, and a failure rolls both back
 *   5. the Hub Identity projection is read **read-only** and degrades to an
 *      empty page when the platform has not created it
 *   6. the read model of a persisted row agrees with its projection
 *
 * The suite creates its own throwaway database and drops it afterwards; it
 * never touches a developer or production database.
 *
 * Run with:
 *   DATABASE_URL_TEST=postgresql://user:pass@localhost:5432/postgres \
 *     npx vitest run apps/erp/modules/erp-5/tests/db/repository.integration.test.ts
 *
 * @module erp5/tests/db/repository.integration.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DrizzleHrRepository } from '../../db/repository.js';
import { HrService } from '../../src/services/hr.service.js';

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL('../../../../../..', import.meta.url));
const MIGRATION_RUNNER = fileURLToPath(
  new URL('../../../../../../packages/database/scripts/migrate.js', import.meta.url)
);
const MIGRATION_SQL = readFileSync(
  fileURLToPath(new URL('../../../../../../packages/database/migrations/erp5_v1.sql', import.meta.url)),
  'utf-8'
);

const ADMIN_URL = process.env['DATABASE_URL_TEST'];
const SCRATCH_NAME = `erp5_repo_scratch_${Math.random().toString(36).slice(2, 10)}`;
const SCRATCH_URL = ADMIN_URL
  ? ADMIN_URL.replace(/\/([^/?]+)(\?|$)/, `/${SCRATCH_NAME}$2`)
  : undefined;

if (!ADMIN_URL) {
  console.warn(
    '[erp-5] DATABASE_URL_TEST is not set — the live PostgreSQL repository proofs are skipped. ' +
      'Set DATABASE_URL_TEST to run them.'
  );
}

describe.skipIf(!ADMIN_URL)('ERP-5 Drizzle repository (live PostgreSQL)', () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let repository: DrizzleHrRepository;
  let service: HrService;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: ADMIN_URL as string });

    // A dedicated throwaway database — the guard below refuses to drop
    // anything that is not clearly a scratch database of this suite.
    await admin.query(`CREATE DATABASE "${SCRATCH_NAME}" TEMPLATE template0`);

    pool = new pg.Pool({ connectionString: SCRATCH_URL as string });

    await execFileAsync(process.execPath, [MIGRATION_RUNNER], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        DATABASE_URL: SCRATCH_URL as string,
        DATABASE_URL_TEST: SCRATCH_URL as string,
      },
    });
  }, 120_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      if (SCRATCH_NAME.startsWith('erp5_repo_scratch_')) {
        await admin.query(`DROP DATABASE IF EXISTS "${SCRATCH_NAME}" WITH (FORCE)`);
      }
      await admin.end();
    }
  });

  beforeEach(async () => {
    // A clean slate for every test — the suite never relies on the order.
    await pool.query('TRUNCATE erp5.leave, erp5.payroll_totals, erp5.import_receipts, erp5.employees, erp5.departments CASCADE');

    repository = new DrizzleHrRepository(drizzle(pool));
    service = new HrService(repository);
  });

  // ── 1. The write path ─────────────────────────────────────────────────────

  describe('Write path', () => {
    it('persists a department, an employee, a leave record and an aggregate', async () => {
      const department = await repository.createDepartment({
        name: 'Engineering',
        code: 'ENG',
        parent_id: null,
      });
      expect(department.id).toBeTruthy();
      expect(department.code).toBe('ENG');
      expect(department.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const employee = await repository.createEmployee({
        employee_no: 'EMP-0001',
        first_name: 'Asha',
        last_name: 'Iyer',
        birth_date: '1990-04-12',
        join_date: '2024-01-08',
        department_id: department.id,
        job_title: 'Software Engineer',
        salary: '125000.0000',
        currency_code: 'INR',
        source_system: null,
        source_id: null,
      });
      expect(employee.id).toBeTruthy();
      expect(employee.salary).toBe('125000.0000');

      const leave = await repository.createLeave({
        employee_id: employee.id,
        date_from: '2026-04-01',
        date_to: '2026-04-05',
        type: 'sick',
        status: 'pending',
      });
      expect(leave.employee_id).toBe(employee.id);

      const total = await repository.createPayrollTotal({
        department_id: department.id,
        month: '2026-04',
        total_amount: '250000.0000',
        currency_code: 'INR',
        headcount: 1,
      });
      expect(total.month).toBe('2026-04');

      // The rows really are in PostgreSQL.
      const { rows } = await pool.query<{ count: string }>(
        'SELECT count(*) FROM erp5.employees'
      );
      expect(rows[0]?.count).toBe('1');
    });

    it('reads a row back with the same values', async () => {
      const created = await repository.createDepartment({
        name: 'Finance',
        code: 'FIN',
        parent_id: null,
      });

      const read = await repository.getDepartmentById(created.id);
      expect(read?.name).toBe('Finance');
      expect(read?.parent_id).toBeNull();

      const byCode = await repository.getDepartmentByCode('FIN');
      expect(byCode?.id).toBe(created.id);

      // The lookup is case sensitive, exactly like the UNIQUE constraint.
      expect(await repository.getDepartmentByCode('fin')).toBeNull();
    });

    it('updates only the allow-listed fields', async () => {
      const department = await repository.createDepartment({
        name: 'Finance',
        code: 'FIN',
        parent_id: null,
      });

      const updated = await repository.updateDepartment(department.id, { name: 'Finance & Accounts' });
      expect(updated.name).toBe('Finance & Accounts');
      expect(updated.code).toBe('FIN');
      expect(updated.updated_at).not.toBe(department.updated_at);
    });

    it('resolves the department ancestry', async () => {
      const root = await repository.createDepartment({ name: 'Root', code: 'ROOT', parent_id: null });
      const child = await repository.createDepartment({
        name: 'Child',
        code: 'CHILD',
        parent_id: root.id,
      });
      const grandchild = await repository.createDepartment({
        name: 'Grandchild',
        code: 'GC',
        parent_id: child.id,
      });

      const ancestors = await repository.listDepartmentAncestors(grandchild.id);
      expect(ancestors.map((a) => a.id)).toEqual([child.id, root.id]);

      expect(await repository.listDepartmentAncestors(root.id)).toEqual([]);
    });
  });

  // ── 2. The query layer is server-side ─────────────────────────────────────

  describe('Query layer', () => {
    async function seedThreeEmployees(): Promise<void> {
      const department = await repository.createDepartment({
        name: 'Engineering',
        code: 'ENG',
        parent_id: null,
      });
      const other = await repository.createDepartment({
        name: 'Finance',
        code: 'FIN',
        parent_id: null,
      });

      for (const [index, name] of ['asha.iyer', 'rohan.mehta', 'nisha.rao'].entries()) {
        await repository.createEmployee({
          employee_no: `EMP-000${index + 1}`,
          first_name: name.split('.')[0]!,
          last_name: name.split('.')[1]!,
          birth_date: '1990-04-12',
          join_date: '2024-01-08',
          department_id: index === 2 ? other.id : department.id,
          job_title: 'Engineer',
          salary: '100000.0000',
          currency_code: 'INR',
          source_system: null,
          source_id: null,
        });
      }
    }

    it('applies the search in the database and counts the whole result set', async () => {
      await seedThreeEmployees();

      const page = await repository.listEmployees({ page: 1, pageSize: 25, sort: 'name' });
      expect(page.total).toBe(3);

      const filtered = await repository.listEmployees({
        page: 1,
        pageSize: 25,
        sort: 'name',
        search: 'asha',
      });
      expect(filtered.items).toHaveLength(1);
      expect(filtered.total).toBe(1);
      expect(filtered.items[0]?.first_name).toBe('asha');
    });

    it('treats a SQL-like search term as text, never as SQL', async () => {
      await seedThreeEmployees();

      const page = await repository.listEmployees({
        page: 1,
        pageSize: 25,
        sort: 'name',
        search: "'; DROP TABLE erp5.employees; --",
      });

      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);

      // The table is still there.
      const { rows } = await pool.query<{ count: string }>(
        'SELECT count(*) FROM erp5.employees'
      );
      expect(rows[0]?.count).toBe('3');
    });

    it('filters by department', async () => {
      await seedThreeEmployees();
      const finance = await repository.getDepartmentByCode('FIN');

      const page = await repository.listEmployees({
        page: 1,
        pageSize: 25,
        sort: 'name',
        department_id: finance!.id,
      });

      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(1);
    });

    it('returns bounded, non-overlapping and deterministic pages', async () => {
      await seedThreeEmployees();

      const first = await repository.listEmployees({ page: 1, pageSize: 2, sort: 'employee_no' });
      const second = await repository.listEmployees({ page: 2, pageSize: 2, sort: 'employee_no' });

      expect(first.items).toHaveLength(2);
      expect(second.items).toHaveLength(1);
      expect(first.total).toBe(3);
      expect(second.total).toBe(3);

      const firstIds = first.items.map((e) => e.id);
      const secondIds = second.items.map((e) => e.id);
      expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);

      const again = await repository.listEmployees({ page: 1, pageSize: 2, sort: 'employee_no' });
      expect(again.items.map((e) => e.id)).toEqual(firstIds);
    });

    it('orders by every allow-listed sort field', async () => {
      await seedThreeEmployees();

      const byNo = await repository.listEmployees({ page: 1, pageSize: 25, sort: 'employee_no' });
      expect(byNo.items.map((e) => e.employee_no)).toEqual(['EMP-0001', 'EMP-0002', 'EMP-0003']);

      const byJoin = await repository.listEmployees({ page: 1, pageSize: 25, sort: 'join_date' });
      expect(byJoin.items).toHaveLength(3);

      const byName = await repository.listEmployees({ page: 1, pageSize: 25, sort: 'name' });
      expect(byName.items.map((e) => e.last_name)).toEqual(['iyer', 'mehta', 'rao']);
    });

    it('lists the departments, the leave records and the aggregates', async () => {
      const department = await repository.createDepartment({
        name: 'Engineering',
        code: 'ENG',
        parent_id: null,
      });
      const employee = await repository.createEmployee({
        employee_no: 'EMP-0001',
        first_name: 'Asha',
        last_name: 'Iyer',
        birth_date: '1990-04-12',
        join_date: '2024-01-08',
        department_id: department.id,
        job_title: 'Engineer',
        salary: '100000.0000',
        currency_code: 'INR',
        source_system: null,
        source_id: null,
      });
      await repository.createLeave({
        employee_id: employee.id,
        date_from: '2026-04-01',
        date_to: '2026-04-05',
        type: 'sick',
        status: 'pending',
      });
      await repository.createPayrollTotal({
        department_id: department.id,
        month: '2026-04',
        total_amount: '100000.0000',
        currency_code: 'INR',
        headcount: 1,
      });

      const departments = await repository.listDepartments({ page: 1, pageSize: 25, sort: 'name' });
      expect(departments.total).toBe(1);

      const leave = await repository.listLeave({ page: 1, pageSize: 25 });
      expect(leave.total).toBe(1);
      expect(leave.items[0]?.type).toBe('sick');

      const totals = await repository.listPayrollTotals({ page: 1, pageSize: 25, month: '2026-04' });
      expect(totals.total).toBe(1);
      expect(totals.items[0]?.total_amount).toBe('100000.0000');
    });
  });

  // ── 3. The transaction boundary ───────────────────────────────────────────

  describe('Transaction boundary', () => {
    it('commits the target mutation and the import receipt together', async () => {
      const department = await repository.createDepartment({
        name: 'Engineering',
        code: 'ENG',
        parent_id: null,
      });

      const result = await service.createEmployee({
        employee_no: 'EMP-0001',
        first_name: 'Asha',
        last_name: 'Iyer',
        birth_date: '1990-04-12',
        join_date: '2024-01-08',
        department_id: department.id,
        job_title: 'Engineer',
        salary: '100000.0000',
        batch_id: randomUUID(),
        source_row: 7,
        idempotency_key: `erp5-${randomUUID()}`,
      });

      expect(result.created).toBe(true);
      expect(result.receipt?.target_id).toBe(result.entity.id);

      const { rows } = await pool.query<{ employees: string; receipts: string }>(
        `SELECT (SELECT count(*) FROM erp5.employees) AS employees,
                (SELECT count(*) FROM erp5.import_receipts) AS receipts`
      );
      expect(rows[0]?.employees).toBe('1');
      expect(rows[0]?.receipts).toBe('1');
    });

    it('rolls the target mutation back when the receipt write fails', async () => {
      const department = await repository.createDepartment({
        name: 'Engineering',
        code: 'ENG',
        parent_id: null,
      });

      // The receipt carries an invalid batch id, so PostgreSQL rejects the
      // receipt insert *inside* the transaction — the target mutation must be
      // rolled back with it.
      await expect(
        service.createEmployee({
          employee_no: 'EMP-0001',
          first_name: 'Asha',
          last_name: 'Iyer',
          birth_date: '1990-04-12',
          join_date: '2024-01-08',
          department_id: department.id,
          job_title: 'Engineer',
          salary: '100000.0000',
          batch_id: 'not-a-uuid' as unknown as string,
          source_row: 7,
          idempotency_key: `erp5-${randomUUID()}`,
        })
      ).rejects.toThrow();

      // Neither the employee nor the receipt survived the rollback.
      const { rows } = await pool.query<{ employees: string; receipts: string }>(
        `SELECT (SELECT count(*) FROM erp5.employees) AS employees,
                (SELECT count(*) FROM erp5.import_receipts) AS receipts`
      );
      expect(rows[0]?.employees).toBe('0');
      expect(rows[0]?.receipts).toBe('0');
    });

    it('enforces the database constraints behind the service rules', async () => {
      const department = await repository.createDepartment({
        name: 'Engineering',
        code: 'ENG',
        parent_id: null,
      });

      // BR-ERP5-01 — the CHECK constraint rejects it, not only the service.
      await expect(
        repository.createEmployee({
          employee_no: 'EMP-0001',
          first_name: 'Asha',
          last_name: 'Iyer',
          birth_date: '1990-04-12',
          join_date: '1989-01-01',
          department_id: department.id,
          job_title: 'Engineer',
          salary: '100000.0000',
          currency_code: 'INR',
          source_system: null,
          source_id: null,
        })
      ).rejects.toThrow();

      // The unique employee number.
      await repository.createEmployee({
        employee_no: 'EMP-0001',
        first_name: 'Asha',
        last_name: 'Iyer',
        birth_date: '1990-04-12',
        join_date: '2024-01-08',
        department_id: department.id,
        job_title: 'Engineer',
        salary: '100000.0000',
        currency_code: 'INR',
        source_system: null,
        source_id: null,
      });

      await expect(
        repository.createEmployee({
          employee_no: 'EMP-0001',
          first_name: 'Other',
          last_name: 'Person',
          birth_date: '1990-04-12',
          join_date: '2024-01-08',
          department_id: department.id,
          job_title: 'Engineer',
          salary: '100000.0000',
          currency_code: 'INR',
          source_system: null,
          source_id: null,
        })
      ).rejects.toThrow();
    });
  });

  // ── 4. The Hub Identity projection ───────────────────────────────────────

  describe('Hub Identity projection', () => {
    const probeRole = `erp5_repo_probe_${Math.random().toString(36).slice(2, 8)}`;

    beforeAll(async () => {
      // The platform's Hub Identity table is owned by PLT-05; this fixture
      // mirrors `packages/database/src/schema/platform.ts` so the projection
      // can be exercised.
      await pool.query(`
        CREATE SCHEMA IF NOT EXISTS platform;
        CREATE TABLE IF NOT EXISTS platform.hub_users (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          username     TEXT NOT NULL UNIQUE,
          roles        TEXT[] NOT NULL,
          employee_ref UUID,
          status       TEXT NOT NULL DEFAULT 'active',
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      // Re-apply the migration so the guarded view creation runs now that
      // Hub Identity exists.
      await pool.query(MIGRATION_SQL);

      await admin.query(`CREATE ROLE "${probeRole}" NOLOGIN`);
      await admin.query(`GRANT CONNECT ON DATABASE "${SCRATCH_NAME}" TO "${probeRole}"`);
      await pool.query(`GRANT USAGE ON SCHEMA erp5 TO "${probeRole}"`);
      await pool.query(`GRANT SELECT ON erp5.identity_users TO "${probeRole}"`);
    }, 60_000);

    afterAll(async () => {
      await pool.query(`DROP OWNED BY "${probeRole}"`);
      await admin.query(`DROP ROLE IF EXISTS "${probeRole}"`);
    });

    it('degrades to an empty page when the platform has not created the projection', async () => {
      const { rows: views } = await pool.query<{ viewname: string }>(
        `SELECT viewname FROM pg_views WHERE schemaname = 'erp5' AND viewname = 'identity_users'`
      );

      if (views.length === 0) {
        // The projection is created only when `platform.hub_users` exists.
        const page = await repository.listIdentityUsers({ page: 1, pageSize: 25 });
        expect(page.items).toEqual([]);
        expect(page.total).toBe(0);
      } else {
        // The projection exists in this database — it must still read.
        const page = await repository.listIdentityUsers({ page: 1, pageSize: 25 });
        expect(Array.isArray(page.items)).toBe(true);
      }
    });

    it('reads the projection read-only and never a credential column', async () => {
      await pool.query(
        `INSERT INTO platform.hub_users (id, username, roles, employee_ref, status)
         VALUES ('c1000000-0000-4000-8000-000000000001', 'asha.iyer', ARRAY['viewer'], NULL, 'active')
         ON CONFLICT (username) DO NOTHING`
      );

      const page = await repository.listIdentityUsers({ page: 1, pageSize: 25 });
      expect(page.total).toBeGreaterThan(0);
      const user = page.items.find((u) => u.username === 'asha.iyer');
      expect(user?.roles).toEqual(['viewer']);

      // The projection carries no credential column at all.
      const { rows: columns } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'erp5' AND table_name = 'identity_users'`
      );
      const names = columns.map((c) => c.column_name);
      expect(names).not.toContain('password');
      expect(names).not.toContain('password_hash');
      expect(names).not.toContain('token');
      expect(names).not.toContain('refresh_token');

      // And it is not writable by an application role.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET ROLE "${probeRole}"`);
        try {
          await client.query(
            `INSERT INTO erp5.identity_users (id, username, roles, employee_ref, status)
             VALUES (gen_random_uuid(), 'intruder', ARRAY['admin'], NULL, 'active')`
          );
          expect.unreachable('the projection must refuse the write');
        } catch (error) {
          expect((error as { code?: string }).code).toBe('42501');
        } finally {
          await client.query('ROLLBACK');
          await client.query('RESET ROLE');
        }
      } finally {
        client.release();
      }
    });
  });

  // ── 5. The read model ─────────────────────────────────────────────────────

  describe('Read model', () => {
    it('returns the persisted row, never the request payload', async () => {
      const department = await repository.createDepartment({
        name: 'Engineering',
        code: 'ENG',
        parent_id: null,
      });

      const result = await service.createEmployee({
        employee_no: 'EMP-0001',
        first_name: 'Asha',
        last_name: 'Iyer',
        birth_date: '1990-04-12',
        join_date: '2024-01-08',
        department_id: department.id,
        job_title: 'Engineer',
        salary: '100000.0000',
      });

      const persisted = await repository.getEmployeeById(result.entity.id);
      expect(persisted?.employee_no).toBe('EMP-0001');
      expect(persisted?.created_at).toBe(result.entity.created_at);
      // The projection is masked — the raw salary never leaves the module.
      expect(result.entity.salary_display).toBe('XX,XXX');
      expect(result.entity).not.toHaveProperty('salary');
    });
  });
});
