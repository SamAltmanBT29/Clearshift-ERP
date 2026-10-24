/**
 * ERP-5 HR & Employees — Drizzle Repository (query layer)
 *
 * The production implementation of {@link HrRepository} against the `erp5`
 * PostgreSQL schema. It is the **hand-over** promised by decision record
 * DR-8: ERP5-03 owns the repository contract, ERP5-02 owns this
 * implementation.
 *
 * Guarantees:
 *   - every search and filter is applied **in the database**, parameterised —
 *     no SQL is ever built by string concatenation
 *   - every collection is **bounded** (`page` / `pageSize`, `pageSize ≤ 100`)
 *     and deterministically ordered, with the `id` as the tie-breaker
 *   - the target mutation and its import receipt commit in **one**
 *     PostgreSQL transaction
 *   - the Hub Identity projection is read **read-only** and never reaches a
 *     credential column; when the projection does not exist (it is created
 *     only when `platform.hub_users` exists) the query degrades to an empty
 *     page instead of failing the request
 *
 * @module erp5/db/repository
 */

import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type {
  HrDepartment,
  HrDepartmentListQuery,
  HrEmployee,
  HrEmployeeListQuery,
  HrIdentityUser,
  HrIdentityUserListQuery,
  HrImportReceipt,
  HrLeave,
  HrLeaveListQuery,
  HrPayrollTotal,
  HrPayrollTotalListQuery,
} from '@clearshift/contracts';
import {
  erp5Departments,
  erp5Employees,
  erp5IdentityUsers,
  erp5ImportReceipts,
  erp5Leave,
  erp5PayrollTotals,
} from './schema.js';
import type {
  HrDepartmentUpdates,
  HrEmployeeUpdates,
  HrPage,
  HrRepository,
  NewHrDepartment,
  NewHrEmployee,
  NewHrImportReceipt,
  NewHrLeave,
  NewHrPayrollTotal,
} from '../src/services/repository.js';

/** The database handle the repository works on. */
export type HrDatabase = NodePgDatabase;

/** PostgreSQL error codes the repository reacts to. */
const PG_UNDEFINED_TABLE = '42P01';

function isMissingRelation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === PG_UNDEFINED_TABLE
  );
}

export class DrizzleHrRepository implements HrRepository {
  constructor(private readonly db: HrDatabase) {}

  // ── Transaction boundary ──────────────────────────────────────────────────

  async transaction<T>(fn: (tx: HrRepository) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      return fn(new DrizzleHrRepository(tx as unknown as HrDatabase));
    });
  }

  // ── Departments ───────────────────────────────────────────────────────────

  async getDepartmentById(id: string): Promise<HrDepartment | null> {
    const rows = await this.db
      .select()
      .from(erp5Departments)
      .where(eq(erp5Departments.id, id))
      .limit(1);
    return rows[0] ? toHrDepartment(rows[0]) : null;
  }

  async getDepartmentByCode(code: string): Promise<HrDepartment | null> {
    const rows = await this.db
      .select()
      .from(erp5Departments)
      .where(eq(erp5Departments.code, code))
      .limit(1);
    return rows[0] ? toHrDepartment(rows[0]) : null;
  }

  async createDepartment(data: NewHrDepartment): Promise<HrDepartment> {
    const rows = await this.db
      .insert(erp5Departments)
      .values({
        ...(data.id !== undefined && { id: data.id }),
        name: data.name,
        code: data.code,
        parent_id: data.parent_id ?? null,
      })
      .returning();
    return toHrDepartment(rows[0]!);
  }

  async updateDepartment(id: string, updates: HrDepartmentUpdates): Promise<HrDepartment> {
    const rows = await this.db
      .update(erp5Departments)
      .set({
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.code !== undefined && { code: updates.code }),
        ...(updates.parent_id !== undefined && { parent_id: updates.parent_id }),
        updated_at: new Date(),
      })
      .where(eq(erp5Departments.id, id))
      .returning();
    return toHrDepartment(rows[0]!);
  }

  async listDepartmentAncestors(id: string): Promise<HrDepartment[]> {
    // The hierarchy is walked one level at a time; the depth is bounded by
    // the number of departments and the cycle is broken by the visited set.
    const ancestors: HrDepartment[] = [];
    const visited = new Set<string>([id]);
    let currentId: string | null = id;

    while (currentId) {
      const current: HrDepartment | null = await this.getDepartmentById(currentId);
      if (!current || current.parent_id === null || visited.has(current.parent_id)) {
        break;
      }
      visited.add(current.parent_id);
      const parent = await this.getDepartmentById(current.parent_id);
      if (!parent) {
        break;
      }
      ancestors.push(parent);
      currentId = parent.id;
    }

    return ancestors;
  }

  // ── Employees ─────────────────────────────────────────────────────────────

  async getEmployeeById(id: string): Promise<HrEmployee | null> {
    const rows = await this.db
      .select()
      .from(erp5Employees)
      .where(eq(erp5Employees.id, id))
      .limit(1);
    return rows[0] ? toHrEmployee(rows[0]) : null;
  }

  async getEmployeeByEmployeeNo(employeeNo: string): Promise<HrEmployee | null> {
    const rows = await this.db
      .select()
      .from(erp5Employees)
      .where(eq(erp5Employees.employee_no, employeeNo))
      .limit(1);
    return rows[0] ? toHrEmployee(rows[0]) : null;
  }

  async getEmployeeBySourceIdentity(
    sourceSystem: string,
    sourceId: string
  ): Promise<HrEmployee | null> {
    const rows = await this.db
      .select()
      .from(erp5Employees)
      .where(
        and(
          eq(erp5Employees.source_system, sourceSystem),
          eq(erp5Employees.source_id, sourceId)
        )
      )
      .limit(1);
    return rows[0] ? toHrEmployee(rows[0]) : null;
  }

  async createEmployee(data: NewHrEmployee): Promise<HrEmployee> {
    const rows = await this.db
      .insert(erp5Employees)
      .values({
        ...(data.id !== undefined && { id: data.id }),
        employee_no: data.employee_no,
        first_name: data.first_name,
        last_name: data.last_name,
        birth_date: data.birth_date,
        join_date: data.join_date,
        department_id: data.department_id,
        job_title: data.job_title,
        salary: data.salary,
        currency_code: data.currency_code,
        source_system: data.source_system ?? null,
        source_id: data.source_id ?? null,
      })
      .returning();
    return toHrEmployee(rows[0]!);
  }

  async updateEmployee(id: string, updates: HrEmployeeUpdates): Promise<HrEmployee> {
    const rows = await this.db
      .update(erp5Employees)
      .set({
        ...(updates.employee_no !== undefined && { employee_no: updates.employee_no }),
        ...(updates.first_name !== undefined && { first_name: updates.first_name }),
        ...(updates.last_name !== undefined && { last_name: updates.last_name }),
        ...(updates.birth_date !== undefined && { birth_date: updates.birth_date }),
        ...(updates.join_date !== undefined && { join_date: updates.join_date }),
        ...(updates.department_id !== undefined && { department_id: updates.department_id }),
        ...(updates.job_title !== undefined && { job_title: updates.job_title }),
        ...(updates.salary !== undefined && { salary: updates.salary }),
        updated_at: new Date(),
      })
      .where(eq(erp5Employees.id, id))
      .returning();
    return toHrEmployee(rows[0]!);
  }

  // ── Leave ─────────────────────────────────────────────────────────────────

  async getLeaveById(id: string): Promise<HrLeave | null> {
    const rows = await this.db
      .select()
      .from(erp5Leave)
      .where(eq(erp5Leave.id, id))
      .limit(1);
    return rows[0] ? toHrLeave(rows[0]) : null;
  }

  async createLeave(data: NewHrLeave): Promise<HrLeave> {
    const rows = await this.db
      .insert(erp5Leave)
      .values({
        ...(data.id !== undefined && { id: data.id }),
        employee_id: data.employee_id,
        date_from: data.date_from,
        date_to: data.date_to,
        type: data.type,
        status: data.status,
      })
      .returning();
    return toHrLeave(rows[0]!);
  }

  async updateLeave(
    id: string,
    updates: Partial<Pick<HrLeave, 'status' | 'date_from' | 'date_to' | 'type'>>
  ): Promise<HrLeave> {
    const rows = await this.db
      .update(erp5Leave)
      .set({
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.date_from !== undefined && { date_from: updates.date_from }),
        ...(updates.date_to !== undefined && { date_to: updates.date_to }),
        ...(updates.type !== undefined && { type: updates.type }),
        updated_at: new Date(),
      })
      .where(eq(erp5Leave.id, id))
      .returning();
    return toHrLeave(rows[0]!);
  }

  // ── Payroll totals ────────────────────────────────────────────────────────

  async getPayrollTotalById(id: string): Promise<HrPayrollTotal | null> {
    const rows = await this.db
      .select()
      .from(erp5PayrollTotals)
      .where(eq(erp5PayrollTotals.id, id))
      .limit(1);
    return rows[0] ? toHrPayrollTotal(rows[0]) : null;
  }

  async getPayrollTotalByDepartmentMonth(
    departmentId: string,
    month: string
  ): Promise<HrPayrollTotal | null> {
    const rows = await this.db
      .select()
      .from(erp5PayrollTotals)
      .where(
        and(
          eq(erp5PayrollTotals.department_id, departmentId),
          eq(erp5PayrollTotals.month, month)
        )
      )
      .limit(1);
    return rows[0] ? toHrPayrollTotal(rows[0]) : null;
  }

  async createPayrollTotal(data: NewHrPayrollTotal): Promise<HrPayrollTotal> {
    const rows = await this.db
      .insert(erp5PayrollTotals)
      .values({
        ...(data.id !== undefined && { id: data.id }),
        department_id: data.department_id,
        month: data.month,
        total_amount: data.total_amount,
        currency_code: data.currency_code,
        headcount: data.headcount,
      })
      .returning();
    return toHrPayrollTotal(rows[0]!);
  }

  // ── Import receipts ───────────────────────────────────────────────────────

  async getImportReceiptByIdempotencyKey(key: string): Promise<HrImportReceipt | null> {
    const rows = await this.db
      .select()
      .from(erp5ImportReceipts)
      .where(eq(erp5ImportReceipts.idempotency_key, key))
      .limit(1);
    return rows[0] ? toHrImportReceipt(rows[0]) : null;
  }

  async createImportReceipt(receipt: NewHrImportReceipt): Promise<HrImportReceipt> {
    const rows = await this.db
      .insert(erp5ImportReceipts)
      .values({
        ...(receipt.id !== undefined && { id: receipt.id }),
        batch_id: receipt.batch_id,
        source_row: receipt.source_row,
        entity: receipt.entity,
        schema_version: receipt.schema_version ?? 1,
        idempotency_key: receipt.idempotency_key,
        request_hash: receipt.request_hash,
        target_id: receipt.target_id,
        kind: receipt.kind ?? 'created',
      })
      .returning();
    return toHrImportReceipt(rows[0]!);
  }

  // ── Query layer ───────────────────────────────────────────────────────────

  async listEmployees(query: HrEmployeeListQuery): Promise<HrPage<HrEmployee>> {
    const filters: SQL[] = [];

    if (query.search) {
      const term = `%${query.search}%`;
      filters.push(
        or(
          ilike(erp5Employees.first_name, term),
          ilike(erp5Employees.last_name, term),
          ilike(erp5Employees.employee_no, term)
        )!
      );
    }
    if (query.department_id) {
      filters.push(eq(erp5Employees.department_id, query.department_id));
    }

    const where = filters.length > 0 ? and(...filters) : undefined;
    const descSort = query.sort_dir === 'desc';
    const orderBy =
      query.sort === 'employee_no'
        ? descSort
          ? [desc(erp5Employees.employee_no), desc(erp5Employees.id)]
          : [asc(erp5Employees.employee_no), asc(erp5Employees.id)]
        : query.sort === 'join_date'
          ? descSort
            ? [desc(erp5Employees.join_date), desc(erp5Employees.id)]
            : [asc(erp5Employees.join_date), asc(erp5Employees.id)]
          : descSort
            ? [desc(erp5Employees.last_name), desc(erp5Employees.first_name), desc(erp5Employees.id)]
            : [asc(erp5Employees.last_name), asc(erp5Employees.first_name), asc(erp5Employees.id)];

    const rows = await this.db
      .select()
      .from(erp5Employees)
      .where(where)
      .orderBy(...orderBy)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [employeeCount] = await this.db
      .select({ total: count() })
      .from(erp5Employees)
      .where(where);
    const total = employeeCount?.total ?? 0;

    return { items: rows.map(toHrEmployee), total };
  }

  async listDepartments(query: HrDepartmentListQuery): Promise<HrPage<HrDepartment>> {
    const filters: SQL[] = [];

    if (query.search) {
      const term = `%${query.search}%`;
      filters.push(
        or(ilike(erp5Departments.name, term), ilike(erp5Departments.code, term))!
      );
    }
    if (query.parent_id) {
      filters.push(eq(erp5Departments.parent_id, query.parent_id));
    }

    const where = filters.length > 0 ? and(...filters) : undefined;
    const descSort = query.sort_dir === 'desc';
    const orderBy =
      query.sort === 'code'
        ? descSort
          ? [desc(erp5Departments.code), desc(erp5Departments.id)]
          : [asc(erp5Departments.code), asc(erp5Departments.id)]
        : descSort
          ? [desc(erp5Departments.name), desc(erp5Departments.id)]
          : [asc(erp5Departments.name), asc(erp5Departments.id)];

    const rows = await this.db
      .select()
      .from(erp5Departments)
      .where(where)
      .orderBy(...orderBy)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [departmentCount] = await this.db
      .select({ total: count() })
      .from(erp5Departments)
      .where(where);
    const total = departmentCount?.total ?? 0;

    return { items: rows.map(toHrDepartment), total };
  }

  async listLeave(query: HrLeaveListQuery): Promise<HrPage<HrLeave>> {
    const filters: SQL[] = [];

    if (query.employee_id) {
      filters.push(eq(erp5Leave.employee_id, query.employee_id));
    }
    if (query.type) {
      filters.push(eq(erp5Leave.type, query.type));
    }
    if (query.status) {
      filters.push(eq(erp5Leave.status, query.status));
    }

    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await this.db
      .select()
      .from(erp5Leave)
      .where(where)
      .orderBy(asc(erp5Leave.date_from), asc(erp5Leave.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [leaveCount] = await this.db
      .select({ total: count() })
      .from(erp5Leave)
      .where(where);
    const total = leaveCount?.total ?? 0;

    return { items: rows.map(toHrLeave), total };
  }

  async listPayrollTotals(query: HrPayrollTotalListQuery): Promise<HrPage<HrPayrollTotal>> {
    const filters: SQL[] = [];

    if (query.month) {
      filters.push(eq(erp5PayrollTotals.month, query.month));
    }
    if (query.department_id) {
      filters.push(eq(erp5PayrollTotals.department_id, query.department_id));
    }

    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await this.db
      .select()
      .from(erp5PayrollTotals)
      .where(where)
      .orderBy(asc(erp5PayrollTotals.month), asc(erp5PayrollTotals.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [payrollCount] = await this.db
      .select({ total: count() })
      .from(erp5PayrollTotals)
      .where(where);
    const total = payrollCount?.total ?? 0;

    return { items: rows.map(toHrPayrollTotal), total };
  }

  async listIdentityUsers(query: HrIdentityUserListQuery): Promise<HrPage<HrIdentityUser>> {
    // The projection is created only when `platform.hub_users` exists. When
    // it is absent the read degrades to an empty page instead of failing the
    // request — the HR module stays available.
    try {
      const filters: SQL[] = [];
      if (query.search) {
        filters.push(ilike(erp5IdentityUsers.username, `%${query.search}%`));
      }
      const where = filters.length > 0 ? and(...filters) : undefined;

      const rows = await this.db
        .select()
        .from(erp5IdentityUsers)
        .where(where)
        .orderBy(asc(erp5IdentityUsers.username), asc(erp5IdentityUsers.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      const [identityCount] = await this.db
        .select({ total: count() })
        .from(erp5IdentityUsers)
        .where(where);
      const total = identityCount?.total ?? 0;

      return {
        items: rows
          // The projection declares its columns as nullable; a row without an
          // id is not a Hub Identity user and is skipped.
          .filter((row) => row.id !== null && row.username !== null)
          .map((row) => ({
            id: row.id as string,
            username: row.username as string,
            roles: row.roles ?? [],
            employee_ref: row.employee_ref,
            status: row.status ?? 'active',
          })),
        total,
      };
    } catch (error) {
      if (isMissingRelation(error)) {
        return { items: [], total: 0 };
      }
      throw error;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Row mapping
// ─────────────────────────────────────────────────────────────────────────────

/** `NUMERIC` and `TIMESTAMPTZ` arrive as strings; the contract expects strings. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toHrDepartment(row: typeof erp5Departments.$inferSelect): HrDepartment {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    parent_id: row.parent_id,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

function toHrEmployee(row: typeof erp5Employees.$inferSelect): HrEmployee {
  return {
    id: row.id,
    employee_no: row.employee_no,
    first_name: row.first_name,
    last_name: row.last_name,
    birth_date: row.birth_date,
    join_date: row.join_date,
    department_id: row.department_id,
    job_title: row.job_title,
    salary: row.salary,
    currency_code: row.currency_code,
    source_system: row.source_system,
    source_id: row.source_id,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

function toHrLeave(row: typeof erp5Leave.$inferSelect): HrLeave {
  return {
    id: row.id,
    employee_id: row.employee_id,
    date_from: row.date_from,
    date_to: row.date_to,
    type: row.type,
    status: row.status,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

function toHrPayrollTotal(row: typeof erp5PayrollTotals.$inferSelect): HrPayrollTotal {
  return {
    id: row.id,
    department_id: row.department_id,
    month: row.month,
    total_amount: row.total_amount,
    currency_code: row.currency_code,
    headcount: row.headcount,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

function toHrImportReceipt(row: typeof erp5ImportReceipts.$inferSelect): HrImportReceipt {
  return {
    id: row.id,
    batch_id: row.batch_id,
    source_row: row.source_row,
    entity: row.entity,
    schema_version: row.schema_version,
    idempotency_key: row.idempotency_key,
    request_hash: row.request_hash,
    target_id: row.target_id,
    kind: row.kind as 'created' | 'linked',
    created_at: toIso(row.created_at),
  };
}
