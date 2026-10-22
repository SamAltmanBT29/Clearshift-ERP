/**
 * ERP-5 HR & Employees — Drizzle ORM Schema
 *
 * Tables:
 *   erp5_departments     — Department hierarchy (name, code, optional parent)
 *   erp5_employees       — Employee master record
 *   erp5_leave           — Leave records (employee, date range, type, status)
 *   erp5_payroll_totals  — Department/month payroll aggregates (no employee rows)
 *   erp5_import_receipts — Durable import receipts (idempotency + migration audit)
 *
 * View:
 *   erp5.identity_users  — READ-ONLY projection over Hub Identity (platform.hub_users)
 *
 * Design decisions:
 *   - UUID primary keys (gen_random_uuid())
 *   - Objects live inside the `erp5` PostgreSQL schema (namespace isolation)
 *   - Database-level check/unique/foreign-key constraints enforce every domain
 *     invariant that PostgreSQL can enforce
 *   - No foreign key into another module's private tables. The only cross-schema
 *     object is the read-only `identity_users` view sanctioned by the Master
 *     Architecture Spec (C3) — it exposes no credential or token column and
 *     admits no writes.
 *   - `salary` is stored as NUMERIC(20,4) and masked at serialization time
 *     (BR-ERP5-02). See the data dictionary for the SDS/Master-Arch divergence
 *     that is escalated as a decision record.
 *
 * @module erp5/db/schema
 */

import {
  pgSchema,
  uuid,
  varchar,
  text,
  timestamp,
  date,
  numeric,
  integer,
  uniqueIndex,
  unique,
  index,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// Module-scoped PostgreSQL schema (namespace isolation)
// ─────────────────────────────────────────────────────────────────────────────
export const erp5Schema = pgSchema('erp5');

// ─────────────────────────────────────────────────────────────────────────────
// Enum types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Leave category.
 * FR-ERP5-04: leave has a type of sick / holiday / other.
 */
export const leaveTypeEnum = erp5Schema.enum('leave_type', [
  'sick',
  'holiday',
  'other',
]);

/**
 * Leave record status.
 * V1 records the status of a leave record. The V2 request→approve/reject
 * workflow (FR-ERP5-10) reuses these states, so V1 rows need no remapping.
 */
export const leaveStatusEnum = erp5Schema.enum('leave_status', [
  'pending',
  'approved',
  'rejected',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Table 1 — erp5_departments (Department Hierarchy)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * One row per department. Departments form an optional self-referential
 * hierarchy (parent department).
 *
 * Invariants (DB-enforced):
 *   - code is unique across the module
 *   - parent_id must reference another department in the same module
 *   - a department can never be its own parent
 *
 * FR-ERP5-03
 */
export const erp5Departments = erp5Schema.table(
  'departments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Human-readable department name, e.g. "Engineering". */
    name: varchar('name', { length: 255 }).notNull(),

    /** Short mnemonic code, e.g. "ENG", "SALES-OPS". Must be unique. */
    code: varchar('code', { length: 32 }).notNull(),

    /**
     * Optional parent department. Nullable — root-level departments have no parent.
     * Self-referential FK (same module only; no cross-module FK).
     */
    parent_id: uuid('parent_id').references((): AnyPgColumn => erp5Departments.id, {
      onDelete: 'restrict',
    }),

    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    // DB-level uniqueness — FR-ERP5-03: department code is unique
    codeUnique: unique('departments_code_unique').on(table.code),

    // Hierarchy traversal
    parentIdx: index('departments_parent_id_idx').on(table.parent_id),

    // DB-enforced: a department can never be its own parent
    notSelfParentCheck: check(
      'departments_not_self_parent',
      sql`parent_id IS NULL OR parent_id <> id`
    ),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 2 — erp5_employees (Employee Master)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * One row per employee.
 *
 * Invariants (DB-enforced):
 *   - employee_no is unique across the module (declared identity key)
 *   - department_id must reference an existing department in this module
 *   - join_date can never be before birth_date (BR-ERP5-01)
 *   - salary is never negative
 *   - (source_system, source_id) is unique when present — stable source
 *     identity for idempotent migration loads
 *
 * FR-ERP5-01, FR-ERP5-02, BR-ERP5-01, BR-ERP5-02
 */
export const erp5Employees = erp5Schema.table(
  'employees',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Declared employee identifier, e.g. "EMP-0001". Unique across the module.
     * (Master Architecture Spec ERD: `text employee_no UK`.)
     */
    employee_no: varchar('employee_no', { length: 32 }).notNull(),

    first_name: varchar('first_name', { length: 120 }).notNull(),

    last_name: varchar('last_name', { length: 120 }).notNull(),

    birth_date: date('birth_date').notNull(),

    /** Employment start date. Must not precede birth_date. */
    join_date: date('join_date').notNull(),

    /** Owning department. Must exist — FK → erp5.departments(id). */
    department_id: uuid('department_id')
      .notNull()
      .references(() => erp5Departments.id, { onDelete: 'restrict' }),

    job_title: varchar('job_title', { length: 120 }).notNull(),

    /**
     * Monthly salary. NUMERIC(20,4) — no IEEE-754 float.
     * Never returned in full to viewers and never logged (BR-ERP5-02);
     * masking is applied at serialization time.
     */
    salary: numeric('salary', { precision: 20, scale: 4 }).notNull(),

    /** ISO 4217 currency of `salary` and of the payroll aggregates derived from it. */
    currency_code: varchar('currency_code', { length: 3 }).notNull().default('INR'),

    /** Source system that produced this record, e.g. "legacy_hr_csv". */
    source_system: varchar('source_system', { length: 64 }),

    /** Source-system identifier for this employee. NULL for manually created rows. */
    source_id: varchar('source_id', { length: 128 }),

    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    // Declared identity key — unique across the module
    employeeNoUnique: unique('employees_employee_no_unique').on(table.employee_no),

    // Source identity — partial unique index (NULL source_id rows are unaffected)
    sourceIdentityUniqueIdx: uniqueIndex('employees_source_identity_unique')
      .on(table.source_system, table.source_id)
      .where(sql`source_id IS NOT NULL`),

    // Department-scoped listings
    departmentIdx: index('employees_department_id_idx').on(table.department_id),

    // Name search (FR-ERP5-01)
    nameIdx: index('employees_last_first_name_idx').on(table.last_name, table.first_name),

    jobTitleIdx: index('employees_job_title_idx').on(table.job_title),

    // BR-ERP5-01: join date can never be before birth date
    joinAfterBirthCheck: check(
      'employees_join_date_after_birth_date',
      sql`join_date >= birth_date`
    ),

    // Salary is a non-negative amount
    salaryNonNegativeCheck: check('employees_salary_non_negative', sql`salary >= 0`),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 3 — erp5_leave (Leave Records)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * One row per leave record.
 *
 * Invariants (DB-enforced):
 *   - employee_id must reference an existing employee in this module
 *   - date_to can never precede date_from
 *
 * FR-ERP5-04
 */
export const erp5Leave = erp5Schema.table(
  'leave',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Employee the leave belongs to. Must exist — FK → erp5.employees(id). */
    employee_id: uuid('employee_id')
      .notNull()
      .references(() => erp5Employees.id, { onDelete: 'cascade' }),

    /** First day of the leave period (inclusive). */
    date_from: date('date_from').notNull(),

    /** Last day of the leave period (inclusive). Must not precede date_from. */
    date_to: date('date_to').notNull(),

    type: leaveTypeEnum('type').notNull(),

    status: leaveStatusEnum('status').notNull().default('pending'),

    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    // Employee-scoped leave listing
    employeeIdx: index('leave_employee_id_idx').on(table.employee_id),

    // Status / period filtering
    statusDateIdx: index('leave_status_date_from_idx').on(table.status, table.date_from),

    // DB-enforced: leave end date can never precede the start date
    dateRangeCheck: check('leave_date_range_valid', sql`date_to >= date_from`),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 4 — erp5_payroll_totals (Department / Month Aggregates)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * One row per department per month. Aggregates only — never employee rows
 * (FR-ERP5-06: "one number per department, no personal data").
 *
 * Invariants (DB-enforced):
 *   - (department_id, month) is unique — one aggregate per department/month
 *   - month must be a valid YYYY-MM label
 *   - total_amount and headcount are never negative
 *
 * FR-ERP5-06
 */
export const erp5PayrollTotals = erp5Schema.table(
  'payroll_totals',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Department the aggregate belongs to. Must exist — FK → erp5.departments(id). */
    department_id: uuid('department_id')
      .notNull()
      .references(() => erp5Departments.id, { onDelete: 'restrict' }),

    /** Payroll month in YYYY-MM form, e.g. "2026-04". */
    month: varchar('month', { length: 7 }).notNull(),

    /** Aggregated payroll amount for the department/month. No personal data. */
    total_amount: numeric('total_amount', { precision: 20, scale: 4 }).notNull(),

    /** ISO 4217 currency of `total_amount`. */
    currency_code: varchar('currency_code', { length: 3 }).notNull().default('INR'),

    /** Number of employees included in the aggregate. */
    headcount: integer('headcount').notNull().default(0),

    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    // One aggregate per department per month
    departmentMonthUnique: unique('payroll_totals_department_month_unique').on(
      table.department_id,
      table.month
    ),

    // Month-scoped listing
    monthIdx: index('payroll_totals_month_idx').on(table.month),

    // DB-enforced: month label must be YYYY-MM with a valid month number
    monthFormatCheck: check(
      'payroll_totals_month_format_valid',
      sql`month ~ '^\d{4}-(0[1-9]|1[0-2])$'`
    ),

    // DB-enforced: aggregate amount and headcount are never negative
    totalNonNegativeCheck: check('payroll_totals_total_non_negative', sql`total_amount >= 0`),
    headcountNonNegativeCheck: check('payroll_totals_headcount_non_negative', sql`headcount >= 0`),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 5 — erp5_import_receipts (Idempotency & Migration Audit Receipts)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Durable import receipts (Master Architecture Spec §6.1 slot 01, KIT-08).
 * Persisted in the same PostgreSQL transaction as the target mutation.
 */
export const erp5ImportReceipts = erp5Schema.table(
  'import_receipts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    batch_id: uuid('batch_id').notNull(),
    source_row: integer('source_row').notNull(),
    entity: varchar('entity', { length: 64 }).notNull(),
    schema_version: integer('schema_version').notNull().default(1),
    idempotency_key: varchar('idempotency_key', { length: 128 }).notNull(),
    target_id: uuid('target_id').notNull(),
    kind: varchar('kind', { length: 16 }).notNull().default('created'),

    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    // Unique idempotency key — guarantees zero duplicate mutations
    idempotencyKeyUnique: unique('import_receipts_idempotency_key_unique').on(
      table.idempotency_key
    ),

    batchRowIdx: index('import_receipts_batch_row_idx').on(table.batch_id, table.source_row),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// View — erp5.identity_users (READ-ONLY Hub Identity projection)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Read-only projection over Hub Identity (`platform.hub_users`).
 *
 * Master Architecture Spec (C3): "erp5_users is a read-only projection/view".
 * HR never owns users, never stores credentials and never grants application
 * roles — this view exposes identity attributes only:
 *
 *   - NO password / hash / token / refresh-token column
 *   - NO write path (it is a view, not a table)
 *   - NO foreign key into the platform schema
 *
 * The view is created by `packages/database/migrations/erp5_v1.sql` only when
 * `platform.hub_users` exists, so a clean-database migration never fails while
 * PLT-05 (Hub Identity) is still open. `.existing()` marks it as a
 * pre-existing database object: Drizzle never emits DDL for it.
 */
export const erp5IdentityUsers = erp5Schema
  .view('identity_users', {
    id: uuid('id'),
    username: text('username'),
    roles: text('roles').array(),
    employee_ref: uuid('employee_ref'),
    status: text('status'),
  })
  .existing();

// ─────────────────────────────────────────────────────────────────────────────
// Relation type helpers (used by the application layer for type inference)
// ─────────────────────────────────────────────────────────────────────────────
export type Erp5Department = typeof erp5Departments.$inferSelect;
export type NewErp5Department = typeof erp5Departments.$inferInsert;

export type Erp5Employee = typeof erp5Employees.$inferSelect;
export type NewErp5Employee = typeof erp5Employees.$inferInsert;

export type Erp5Leave = typeof erp5Leave.$inferSelect;
export type NewErp5Leave = typeof erp5Leave.$inferInsert;

export type Erp5PayrollTotal = typeof erp5PayrollTotals.$inferSelect;
export type NewErp5PayrollTotal = typeof erp5PayrollTotals.$inferInsert;

export type Erp5ImportReceipt = typeof erp5ImportReceipts.$inferSelect;
export type NewErp5ImportReceipt = typeof erp5ImportReceipts.$inferInsert;

/**
 * Row shape of the read-only Hub Identity projection.
 *
 * Drizzle 0.36 does not derive a select model from a view, so the shape is
 * declared explicitly. The API contract for the same projection lives in
 * `packages/contracts/src/erp-5.ts` (`HrIdentityUserSchema`).
 */
export interface Erp5IdentityUser {
  id: string;
  username: string;
  roles: string[];
  employee_ref: string | null;
  status: string;
}
