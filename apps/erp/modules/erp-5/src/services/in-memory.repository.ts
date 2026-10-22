/**
 * ERP-5 HR & Employees — In-Memory Repository
 *
 * A deterministic, fixture-seeded implementation of {@link HrRepository}.
 *
 * It exists so the mutation slice of this module can be exercised end to end
 * — service rules, error mapping, idempotency and the transaction boundary —
 * without a live database. The **Drizzle** implementation of the same
 * interface is owned by **ERP5-02** (issue #47).
 *
 * Two properties matter for the mutation API:
 *
 *   1. `transaction()` is a real atomic boundary. Every write performed
 *      inside the callback is rolled back when the callback throws, so the
 *      "target mutation + import receipt commit together" rule is observable
 *      in a test.
 *   2. Transactions are serialised, so two concurrent writes with the same
 *      idempotency key cannot both mutate — the second one observes the
 *      receipt of the first one.
 *
 * @module erp5/services/in-memory.repository
 */

import { randomUUID } from 'node:crypto';
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
  FIXTURE_DEPARTMENTS,
  FIXTURE_EMPLOYEES,
  FIXTURE_IDENTITY_USERS,
  FIXTURE_LEAVE_RECORDS,
  FIXTURE_PAYROLL_TOTALS,
} from '../../fixtures/index.js';
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
} from './repository.js';

/** Applies the bounded page window to an already ordered array. */
function paginate<T>(rows: T[], page: number, pageSize: number): HrPage<T> {
  const total = rows.length;
  const offset = (page - 1) * pageSize;
  return { items: rows.slice(offset, offset + pageSize), total };
}

interface HrStore {
  departments: Map<string, HrDepartment>;
  employees: Map<string, HrEmployee>;
  leave: Map<string, HrLeave>;
  payrollTotals: Map<string, HrPayrollTotal>;
  importReceipts: Map<string, HrImportReceipt>;
  identityUsers: Map<string, HrIdentityUser>;
}

function emptyStore(): HrStore {
  return {
    departments: new Map(),
    employees: new Map(),
    leave: new Map(),
    payrollTotals: new Map(),
    importReceipts: new Map(),
    identityUsers: new Map(),
  };
}

function cloneStore(store: HrStore): HrStore {
  return {
    departments: new Map(store.departments),
    employees: new Map(store.employees),
    leave: new Map(store.leave),
    payrollTotals: new Map(store.payrollTotals),
    importReceipts: new Map(store.importReceipts),
    identityUsers: new Map(store.identityUsers),
  };
}

export class InMemoryHrRepository implements HrRepository {
  private store: HrStore = emptyStore();
  /** Serialises transactions so a concurrent retry cannot double-mutate. */
  private transactionQueue: Promise<unknown> = Promise.resolve();

  constructor(seedWithFixtures: boolean = true) {
    if (seedWithFixtures) {
      this.seedFixtures();
    }
  }

  /** Loads the deterministic synthetic fixture rows. */
  public seedFixtures(): void {
    for (const department of FIXTURE_DEPARTMENTS) {
      this.store.departments.set(department.id, { ...department });
    }
    for (const employee of FIXTURE_EMPLOYEES) {
      this.store.employees.set(employee.id, { ...employee });
    }
    for (const record of FIXTURE_LEAVE_RECORDS) {
      this.store.leave.set(record.id, { ...record });
    }
    for (const total of FIXTURE_PAYROLL_TOTALS) {
      this.store.payrollTotals.set(total.id, { ...total });
    }
    for (const user of FIXTURE_IDENTITY_USERS) {
      this.store.identityUsers.set(user.id, { ...user });
    }
  }

  // ── Transaction boundary ──────────────────────────────────────────────────

  async transaction<T>(fn: (tx: HrRepository) => Promise<T>): Promise<T> {
    const run = this.transactionQueue.then(async () => {
      const snapshot = cloneStore(this.store);
      try {
        return await fn(this);
      } catch (error) {
        this.store = snapshot;
        throw error;
      }
    });

    // Keep the queue alive even when a transaction rejects.
    this.transactionQueue = run.then(
      () => undefined,
      () => undefined
    );

    return run;
  }

  // ── Departments ───────────────────────────────────────────────────────────

  async getDepartmentById(id: string): Promise<HrDepartment | null> {
    const found = this.store.departments.get(id);
    return found ? { ...found } : null;
  }

  /**
   * Looks a department up by its code.
   *
   * The comparison is **case sensitive** on purpose: it mirrors the
   * `departments_code_unique` UNIQUE constraint of PostgreSQL exactly, so the
   * service pre-check and the database constraint can never disagree. The
   * normalisation rules of the module are declared by ERP5-12, not here.
   */
  async getDepartmentByCode(code: string): Promise<HrDepartment | null> {
    for (const department of this.store.departments.values()) {
      if (department.code === code) {
        return { ...department };
      }
    }
    return null;
  }

  async createDepartment(data: NewHrDepartment): Promise<HrDepartment> {
    const now = new Date().toISOString();
    const department: HrDepartment = {
      id: data.id ?? randomUUID(),
      name: data.name,
      code: data.code,
      parent_id: data.parent_id ?? null,
      created_at: now,
      updated_at: now,
    };
    this.store.departments.set(department.id, department);
    return { ...department };
  }

  async updateDepartment(id: string, updates: HrDepartmentUpdates): Promise<HrDepartment> {
    const existing = this.store.departments.get(id);
    if (!existing) {
      throw new Error(`Department ${id} not found`);
    }
    const updated: HrDepartment = {
      ...existing,
      name: updates.name !== undefined ? updates.name : existing.name,
      code: updates.code !== undefined ? updates.code : existing.code,
      parent_id: updates.parent_id !== undefined ? updates.parent_id : existing.parent_id,
      updated_at: new Date().toISOString(),
    };
    this.store.departments.set(id, updated);
    return { ...updated };
  }

  async listDepartmentAncestors(id: string): Promise<HrDepartment[]> {
    const ancestors: HrDepartment[] = [];
    const visited = new Set<string>([id]);
    let current = this.store.departments.get(id);

    while (current && current.parent_id) {
      if (visited.has(current.parent_id)) {
        break;
      }
      visited.add(current.parent_id);
      const parent = this.store.departments.get(current.parent_id);
      if (!parent) {
        break;
      }
      ancestors.push({ ...parent });
      current = parent;
    }

    return ancestors;
  }

  // ── Employees ─────────────────────────────────────────────────────────────

  async getEmployeeById(id: string): Promise<HrEmployee | null> {
    const found = this.store.employees.get(id);
    return found ? { ...found } : null;
  }

  /**
   * Looks an employee up by its employee number.
   *
   * The comparison is **case sensitive** on purpose: it mirrors the
   * `employees_employee_no_unique` UNIQUE constraint of PostgreSQL exactly.
   */
  async getEmployeeByEmployeeNo(employeeNo: string): Promise<HrEmployee | null> {
    for (const employee of this.store.employees.values()) {
      if (employee.employee_no === employeeNo) {
        return { ...employee };
      }
    }
    return null;
  }

  async getEmployeeBySourceIdentity(
    sourceSystem: string,
    sourceId: string
  ): Promise<HrEmployee | null> {
    for (const employee of this.store.employees.values()) {
      if (employee.source_system === sourceSystem && employee.source_id === sourceId) {
        return { ...employee };
      }
    }
    return null;
  }

  async createEmployee(data: NewHrEmployee): Promise<HrEmployee> {
    const now = new Date().toISOString();
    const employee: HrEmployee = {
      id: data.id ?? randomUUID(),
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
      created_at: now,
      updated_at: now,
    };
    this.store.employees.set(employee.id, employee);
    return { ...employee };
  }

  async updateEmployee(id: string, updates: HrEmployeeUpdates): Promise<HrEmployee> {
    const existing = this.store.employees.get(id);
    if (!existing) {
      throw new Error(`Employee ${id} not found`);
    }
    const updated: HrEmployee = {
      ...existing,
      employee_no: updates.employee_no !== undefined ? updates.employee_no : existing.employee_no,
      first_name: updates.first_name !== undefined ? updates.first_name : existing.first_name,
      last_name: updates.last_name !== undefined ? updates.last_name : existing.last_name,
      birth_date: updates.birth_date !== undefined ? updates.birth_date : existing.birth_date,
      join_date: updates.join_date !== undefined ? updates.join_date : existing.join_date,
      department_id:
        updates.department_id !== undefined ? updates.department_id : existing.department_id,
      job_title: updates.job_title !== undefined ? updates.job_title : existing.job_title,
      salary: updates.salary !== undefined ? updates.salary : existing.salary,
      updated_at: new Date().toISOString(),
    };
    this.store.employees.set(id, updated);
    return { ...updated };
  }

  // ── Leave ─────────────────────────────────────────────────────────────────

  async getLeaveById(id: string): Promise<HrLeave | null> {
    const found = this.store.leave.get(id);
    return found ? { ...found } : null;
  }

  async createLeave(data: NewHrLeave): Promise<HrLeave> {
    const now = new Date().toISOString();
    const record: HrLeave = {
      id: data.id ?? randomUUID(),
      employee_id: data.employee_id,
      date_from: data.date_from,
      date_to: data.date_to,
      type: data.type,
      status: data.status,
      created_at: now,
      updated_at: now,
    };
    this.store.leave.set(record.id, record);
    return { ...record };
  }

  async updateLeave(
    id: string,
    updates: Partial<Pick<HrLeave, 'status' | 'date_from' | 'date_to' | 'type'>>
  ): Promise<HrLeave> {
    const existing = this.store.leave.get(id);
    if (!existing) {
      throw new Error(`Leave record ${id} not found`);
    }
    const updated: HrLeave = {
      ...existing,
      status: updates.status !== undefined ? updates.status : existing.status,
      date_from: updates.date_from !== undefined ? updates.date_from : existing.date_from,
      date_to: updates.date_to !== undefined ? updates.date_to : existing.date_to,
      type: updates.type !== undefined ? updates.type : existing.type,
      updated_at: new Date().toISOString(),
    };
    this.store.leave.set(id, updated);
    return { ...updated };
  }

  // ── Payroll totals ────────────────────────────────────────────────────────

  async getPayrollTotalById(id: string): Promise<HrPayrollTotal | null> {
    const found = this.store.payrollTotals.get(id);
    return found ? { ...found } : null;
  }

  async getPayrollTotalByDepartmentMonth(
    departmentId: string,
    month: string
  ): Promise<HrPayrollTotal | null> {
    for (const total of this.store.payrollTotals.values()) {
      if (total.department_id === departmentId && total.month === month) {
        return { ...total };
      }
    }
    return null;
  }

  async createPayrollTotal(data: NewHrPayrollTotal): Promise<HrPayrollTotal> {
    const now = new Date().toISOString();
    const total: HrPayrollTotal = {
      id: data.id ?? randomUUID(),
      department_id: data.department_id,
      month: data.month,
      total_amount: data.total_amount,
      currency_code: data.currency_code,
      headcount: data.headcount,
      created_at: now,
      updated_at: now,
    };
    this.store.payrollTotals.set(total.id, total);
    return { ...total };
  }

  // ── Query layer (ERP5-02) ────────────────────────────────────────────────

  async listEmployees(query: HrEmployeeListQuery): Promise<HrPage<HrEmployee>> {
    let rows = Array.from(this.store.employees.values());

    if (query.search) {
      const term = query.search.toLowerCase();
      rows = rows.filter(
        (employee) =>
          employee.first_name.toLowerCase().includes(term) ||
          employee.last_name.toLowerCase().includes(term) ||
          employee.employee_no.toLowerCase().includes(term)
      );
    }

    if (query.department_id) {
      rows = rows.filter((employee) => employee.department_id === query.department_id);
    }

    // Stable order with the `id` as the deterministic tie-breaker.
    rows.sort((a, b) => {
      switch (query.sort) {
        case 'employee_no':
          return a.employee_no.localeCompare(b.employee_no) || a.id.localeCompare(b.id);
        case 'join_date':
          return a.join_date.localeCompare(b.join_date) || a.id.localeCompare(b.id);
        case 'name':
        default:
          return (
            a.last_name.localeCompare(b.last_name) ||
            a.first_name.localeCompare(b.first_name) ||
            a.id.localeCompare(b.id)
          );
      }
    });

    return paginate(rows, query.page, query.pageSize);
  }

  async listDepartments(query: HrDepartmentListQuery): Promise<HrPage<HrDepartment>> {
    let rows = Array.from(this.store.departments.values());

    if (query.search) {
      const term = query.search.toLowerCase();
      rows = rows.filter(
        (department) =>
          department.name.toLowerCase().includes(term) ||
          department.code.toLowerCase().includes(term)
      );
    }

    if (query.parent_id) {
      rows = rows.filter((department) => department.parent_id === query.parent_id);
    }

    rows.sort((a, b) => {
      if (query.sort === 'code') {
        return a.code.localeCompare(b.code) || a.id.localeCompare(b.id);
      }
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });

    return paginate(rows, query.page, query.pageSize);
  }

  async listLeave(query: HrLeaveListQuery): Promise<HrPage<HrLeave>> {
    let rows = Array.from(this.store.leave.values());

    if (query.employee_id) {
      rows = rows.filter((record) => record.employee_id === query.employee_id);
    }
    if (query.type) {
      rows = rows.filter((record) => record.type === query.type);
    }
    if (query.status) {
      rows = rows.filter((record) => record.status === query.status);
    }

    rows.sort((a, b) => a.date_from.localeCompare(b.date_from) || a.id.localeCompare(b.id));

    return paginate(rows, query.page, query.pageSize);
  }

  async listPayrollTotals(query: HrPayrollTotalListQuery): Promise<HrPage<HrPayrollTotal>> {
    let rows = Array.from(this.store.payrollTotals.values());

    if (query.month) {
      rows = rows.filter((total) => total.month === query.month);
    }
    if (query.department_id) {
      rows = rows.filter((total) => total.department_id === query.department_id);
    }

    rows.sort((a, b) => a.month.localeCompare(b.month) || a.id.localeCompare(b.id));

    return paginate(rows, query.page, query.pageSize);
  }

  async listIdentityUsers(query: HrIdentityUserListQuery): Promise<HrPage<HrIdentityUser>> {
    let rows = Array.from(this.store.identityUsers.values());

    if (query.search) {
      const term = query.search.toLowerCase();
      rows = rows.filter((user) => user.username.toLowerCase().includes(term));
    }

    rows.sort((a, b) => a.username.localeCompare(b.username) || a.id.localeCompare(b.id));

    return paginate(rows, query.page, query.pageSize);
  }

  // ── Import receipts ───────────────────────────────────────────────────────

  async getImportReceiptByIdempotencyKey(key: string): Promise<HrImportReceipt | null> {
    for (const receipt of this.store.importReceipts.values()) {
      if (receipt.idempotency_key === key) {
        return { ...receipt };
      }
    }
    return null;
  }

  async createImportReceipt(receipt: NewHrImportReceipt): Promise<HrImportReceipt> {
    const existing = await this.getImportReceiptByIdempotencyKey(receipt.idempotency_key);
    if (existing) {
      // Mirrors the `import_receipts_idempotency_key_unique` constraint.
      throw new Error('Import receipt idempotency key already exists');
    }
    const now = new Date().toISOString();
    const created: HrImportReceipt = {
      id: receipt.id ?? randomUUID(),
      batch_id: receipt.batch_id,
      source_row: receipt.source_row,
      entity: receipt.entity,
      schema_version: receipt.schema_version ?? 1,
      idempotency_key: receipt.idempotency_key,
      target_id: receipt.target_id,
      kind: receipt.kind ?? 'created',
      created_at: now,
    };
    this.store.importReceipts.set(created.id, created);
    return { ...created };
  }
}
