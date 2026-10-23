/**
 * ERP-5 HR & Employees — Schema Contract Tests (no database required)
 *
 * These tests prove that the Drizzle model and the guarded SQL migration
 * describe the SAME schema, and that the schema encodes the SDS/Master-Arch
 * decisions for ERP-5:
 *
 *   1. Module schema, tables, enums and the read-only identity projection
 *   2. DB-level check constraints carry the documented invariant names
 *   3. Unique constraints / indexes match the documented uniqueness rules
 *   4. No foreign key crosses the module boundary (Decision C7)
 *   5. DDL <-> Drizzle parity — every table, column, constraint and index in
 *      `packages/database/migrations/erp5_v1.sql` exists in the Drizzle model
 *      and vice versa
 *
 * Database-level rejection proofs live in `schema.integration.test.ts`.
 *
 * @module erp5/tests/db/schema.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTableConfig, getViewConfig, isPgView } from 'drizzle-orm/pg-core';
import {
  erp5Schema,
  erp5Departments,
  erp5Employees,
  erp5Leave,
  erp5PayrollTotals,
  erp5ImportReceipts,
  erp5IdentityUsers,
  leaveTypeEnum,
  leaveStatusEnum,
} from '@clearshift/database';

const MIGRATION_PATH = fileURLToPath(
  new URL('../../../../../../packages/database/migrations/erp5_v1.sql', import.meta.url)
);

const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8');

/** Every ERP-5 table owned by the module. */
const MODULE_TABLES = {
  departments: erp5Departments,
  employees: erp5Employees,
  leave: erp5Leave,
  payroll_totals: erp5PayrollTotals,
  import_receipts: erp5ImportReceipts,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Module surface
// ─────────────────────────────────────────────────────────────────────────────
describe('ERP-5 schema surface', () => {
  it('owns the isolated `erp5` PostgreSQL schema', () => {
    expect(erp5Schema.schemaName).toBe('erp5');
  });

  it('exports every module table', () => {
    for (const [name, table] of Object.entries(MODULE_TABLES)) {
      const config = getTableConfig(table);
      expect(config.name).toBe(name);
      expect(config.schema).toBe('erp5');
    }
  });

  it('exports the leave enums with the SDS values', () => {
    expect(leaveTypeEnum.enumValues).toEqual(['sick', 'holiday', 'other']);
    expect(leaveStatusEnum.enumValues).toEqual(['pending', 'approved', 'rejected']);
  });

  it('exposes Hub Identity as a READ-ONLY view, never a table', () => {
    expect(isPgView(erp5IdentityUsers)).toBe(true);

    const viewConfig = getViewConfig(erp5IdentityUsers);
    expect(viewConfig.name).toBe('identity_users');
    expect(viewConfig.schema).toBe('erp5');
    // `.existing()` — the view is created by the migration, never by Drizzle
    expect(viewConfig.isExisting).toBe(true);

    // The projection must not expose credential or token attributes
    const exposed = Object.keys(viewConfig.selectedFields);
    expect(exposed).toEqual(['id', 'username', 'roles', 'employee_ref', 'status']);
    for (const forbidden of ['password', 'argon2_hash', 'token', 'token_hash', 'refresh_token']) {
      expect(exposed).not.toContain(forbidden);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Check constraints — the documented invariants
// ─────────────────────────────────────────────────────────────────────────────
describe('DB-level check constraints', () => {
  const checkNames = (table: Parameters<typeof getTableConfig>[0]): string[] =>
    getTableConfig(table).checks.map((c) => c.name);

  it('[BR-ERP5-01] employees enforce join_date >= birth_date', () => {
    expect(checkNames(erp5Employees)).toContain('employees_join_date_after_birth_date');
  });

  it('employees enforce a non-negative salary', () => {
    expect(checkNames(erp5Employees)).toContain('employees_salary_non_negative');
  });

  it('leave enforces date_to >= date_from', () => {
    expect(checkNames(erp5Leave)).toContain('leave_date_range_valid');
  });

  it('departments forbid self-parenting', () => {
    expect(checkNames(erp5Departments)).toContain('departments_not_self_parent');
  });

  it('payroll totals enforce a valid month, a non-negative amount and headcount', () => {
    const names = checkNames(erp5PayrollTotals);
    expect(names).toContain('payroll_totals_month_format_valid');
    expect(names).toContain('payroll_totals_total_non_negative');
    expect(names).toContain('payroll_totals_headcount_non_negative');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Uniqueness rules
// ─────────────────────────────────────────────────────────────────────────────
describe('DB-level uniqueness rules', () => {
  const uniqueNames = (table: Parameters<typeof getTableConfig>[0]): string[] => [
    ...getTableConfig(table).uniqueConstraints.map((c) => c.name),
    ...getTableConfig(table).indexes.filter((i) => i.config.unique).map((i) => i.config.name),
  ];

  it('department code is unique', () => {
    expect(uniqueNames(erp5Departments)).toContain('departments_code_unique');
  });

  it('employee number is the declared unique identity key', () => {
    expect(uniqueNames(erp5Employees)).toContain('employees_employee_no_unique');
  });

  it('source identity is unique when a source id is present', () => {
    expect(uniqueNames(erp5Employees)).toContain('employees_source_identity_unique');
  });

  it('only one payroll aggregate per department and month', () => {
    expect(uniqueNames(erp5PayrollTotals)).toContain('payroll_totals_department_month_unique');
  });

  it('import receipts are unique per idempotency key', () => {
    expect(uniqueNames(erp5ImportReceipts)).toContain('import_receipts_idempotency_key_unique');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Ownership boundary — no foreign key leaves the module
// ─────────────────────────────────────────────────────────────────────────────
describe('Ownership boundary (Decision C7)', () => {
  it('every foreign key targets a table inside the `erp5` schema', () => {
    for (const table of Object.values(MODULE_TABLES)) {
      for (const fk of getTableConfig(table).foreignKeys) {
        const referenced = fk.reference().foreignTable;
        const referencedConfig = getTableConfig(referenced);
        expect(referencedConfig.schema).toBe('erp5');
      }
    }
  });

  it('declares the expected intra-module relationships', () => {
    const employeeFks = getTableConfig(erp5Employees).foreignKeys.map(
      (fk) => getTableConfig(fk.reference().foreignTable).name
    );
    expect(employeeFks).toEqual(['departments']);

    const leaveFks = getTableConfig(erp5Leave).foreignKeys.map(
      (fk) => getTableConfig(fk.reference().foreignTable).name
    );
    expect(leaveFks).toEqual(['employees']);

    const payrollFks = getTableConfig(erp5PayrollTotals).foreignKeys.map(
      (fk) => getTableConfig(fk.reference().foreignTable).name
    );
    expect(payrollFks).toEqual(['departments']);
  });

  it('import receipts carry no foreign key (they reference any target entity)', () => {
    expect(getTableConfig(erp5ImportReceipts).foreignKeys).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. DDL <-> Drizzle parity
// ─────────────────────────────────────────────────────────────────────────────
describe('Migration DDL <-> Drizzle model parity', () => {
  /** Extracts the body of a `CREATE TABLE IF NOT EXISTS erp5.<name> ( ... )` block. */
  function tableBlock(name: string): string {
    const start = migrationSql.indexOf(`CREATE TABLE IF NOT EXISTS erp5.${name} (`);
    expect(start, `migration must create erp5.${name}`).toBeGreaterThan(-1);
    const end = migrationSql.indexOf('\n);', start);
    expect(end, `migration must close the erp5.${name} block`).toBeGreaterThan(start);
    return migrationSql.slice(start, end);
  }

  /** Column names declared in the DDL table block. */
  function ddlColumnNames(name: string): string[] {
    const block = tableBlock(name);
    const names = new Set<string>();
    const columnPattern = /^\s{4}([a-z_][a-z0-9_]*)\s+(UUID|VARCHAR|BOOLEAN|INTEGER|DATE|TIMESTAMPTZ|NUMERIC|erp5\.[a-z_]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = columnPattern.exec(block)) !== null) {
      names.add(match[1]);
    }
    return [...names];
  }

  it('creates exactly the module tables declared in the Drizzle model', () => {
    const created = [...migrationSql.matchAll(/CREATE TABLE IF NOT EXISTS erp5\.(\w+)/g)].map(
      (m) => m[1]
    );
    expect(created.sort()).toEqual(Object.keys(MODULE_TABLES).sort());
  });

  it('declares the same columns in the DDL and in the Drizzle model', () => {
    for (const [name, table] of Object.entries(MODULE_TABLES)) {
      const ddlColumns = ddlColumnNames(name).sort();
      const drizzleColumns = getTableConfig(table).columns.map((c) => c.name).sort();
      expect(ddlColumns, `column parity for erp5.${name}`).toEqual(drizzleColumns);
    }
  });

  it('declares every DDL check and unique constraint in the Drizzle model', () => {
    const ddlConstraintNames = [
      ...[...migrationSql.matchAll(/CONSTRAINT\s+(\w+)/g)].map((m) => m[1]),
    ];

    const drizzleConstraintNames = Object.values(MODULE_TABLES).flatMap((table) => {
      const config = getTableConfig(table);
      return [
        ...config.checks.map((c) => c.name),
        ...config.uniqueConstraints.map((c) => c.name),
      ];
    });

    for (const name of ddlConstraintNames) {
      expect(drizzleConstraintNames, `constraint ${name} must exist in the Drizzle model`).toContain(
        name
      );
    }
  });

  it('declares every DDL index in the Drizzle model', () => {
    const ddlIndexNames = [
      ...[...migrationSql.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+(\w+)/g)].map(
        (m) => m[1]
      ),
    ];
    expect(ddlIndexNames.length).toBeGreaterThan(0);

    const drizzleIndexNames = Object.values(MODULE_TABLES).flatMap((table) =>
      getTableConfig(table).indexes.map((i) => i.config.name)
    );

    for (const name of ddlIndexNames) {
      expect(drizzleIndexNames, `index ${name} must exist in the Drizzle model`).toContain(name);
    }
  });

  it('creates the module schema and the documented enum types', () => {
    expect(migrationSql).toContain('CREATE SCHEMA IF NOT EXISTS erp5;');
    expect(migrationSql).toContain('CREATE TYPE erp5.leave_type AS ENUM');
    expect(migrationSql).toContain('CREATE TYPE erp5.leave_status AS ENUM');
  });

  it('records the migration in the shared migration ledger', () => {
    expect(migrationSql).toContain("VALUES ('erp5_v1')");
    expect(migrationSql).toContain('ON CONFLICT (migration) DO NOTHING');
  });

  it('keeps every writable object inside the erp5 schema', () => {
    // The only permitted non-`erp5` table is the shared migration ledger,
    // created identically by every module migration for runner idempotency.
    const crossSchemaTables = [
      ...migrationSql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(?!erp5\.)([\w.]+)/g),
    ].map((m) => m[1]);
    expect([...new Set(crossSchemaTables)]).toEqual(['public.schema_migrations']);

    // The only cross-schema object is the read-only Hub Identity projection
    expect(migrationSql).toContain('CREATE VIEW erp5.identity_users');
    expect(migrationSql).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON erp5.identity_users FROM PUBLIC');
  });

  it('never creates a credentials or token table in the module', () => {
    expect(migrationSql).not.toMatch(/CREATE TABLE IF NOT EXISTS erp5\.\w*(password|credential|token|secret)\w*/i);
  });
});
