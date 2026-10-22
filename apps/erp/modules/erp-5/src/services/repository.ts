/**
 * ERP-5 HR & Employees — Repository Contract
 *
 * The service layer never talks to a database directly; it talks to this
 * interface. The interface is the hand-over point with **ERP5-02** (issue
 * #47), which owns the Drizzle implementation of the same contract:
 *
 *   - ERP5-03 (this issue) owns the *contract* and the in-memory
 *     implementation used by the mutation tests.
 *   - ERP5-02 owns the *Drizzle* implementation (`erp5` schema) and the
 *     list/read queries.
 *
 * Every method is a single, parameterised data-access operation. No method
 * returns an unbounded collection, and no method exposes a raw SQL fragment.
 *
 * @module erp5/services/repository
 */

import type {
  HrDepartment,
  HrEmployee,
  HrImportReceipt,
  HrLeave,
  HrPayrollTotal,
} from '@clearshift/contracts';

/** Fields accepted when a department row is created. */
export interface NewHrDepartment {
  id?: string;
  name: string;
  code: string;
  parent_id?: string | null;
}

/** Mutable fields of a department row. */
export type HrDepartmentUpdates = Partial<
  Pick<HrDepartment, 'name' | 'code' | 'parent_id'>
>;

/** Fields accepted when an employee row is created. */
export interface NewHrEmployee {
  id?: string;
  employee_no: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  join_date: string;
  department_id: string;
  job_title: string;
  salary: string;
  currency_code: string;
  source_system?: string | null;
  source_id?: string | null;
}

/** Mutable fields of an employee row. */
export type HrEmployeeUpdates = Partial<
  Pick<
    HrEmployee,
    | 'employee_no'
    | 'first_name'
    | 'last_name'
    | 'birth_date'
    | 'join_date'
    | 'department_id'
    | 'job_title'
    | 'salary'
  >
>;

/** Fields accepted when a leave row is created. */
export interface NewHrLeave {
  id?: string;
  employee_id: string;
  date_from: string;
  date_to: string;
  type: HrLeave['type'];
  status: HrLeave['status'];
}

/** Fields accepted when a payroll aggregate row is created. */
export interface NewHrPayrollTotal {
  id?: string;
  department_id: string;
  month: string;
  total_amount: string;
  currency_code: string;
  headcount: number;
}

/** Fields accepted when an import receipt row is created. */
export interface NewHrImportReceipt {
  id?: string;
  batch_id: string;
  source_row: number;
  entity: string;
  schema_version?: number;
  idempotency_key: string;
  target_id: string;
  kind?: 'created' | 'linked';
}

/**
 * Data-access contract of the ERP-5 module.
 *
 * `transaction` is the atomic boundary used by the service layer: the target
 * mutation and its import receipt are written inside one call, so a failure
 * rolls both back (Master Architecture Spec §6.1 slot 01 / KIT-08).
 */
export interface HrRepository {
  // ── Departments ───────────────────────────────────────────────────────────
  getDepartmentById(id: string): Promise<HrDepartment | null>;
  /**
   * Looks a department up by its code. The comparison must be **case
   * sensitive** so that it mirrors the `departments_code_unique` constraint
   * of PostgreSQL exactly.
   */
  getDepartmentByCode(code: string): Promise<HrDepartment | null>;
  createDepartment(data: NewHrDepartment): Promise<HrDepartment>;
  updateDepartment(id: string, updates: HrDepartmentUpdates): Promise<HrDepartment>;
  /** Ancestors of a department, closest first. Empty for a root department. */
  listDepartmentAncestors(id: string): Promise<HrDepartment[]>;

  // ── Employees ─────────────────────────────────────────────────────────────
  getEmployeeById(id: string): Promise<HrEmployee | null>;
  /**
   * Looks an employee up by its employee number. The comparison must be
   * **case sensitive** so that it mirrors the `employees_employee_no_unique`
   * constraint of PostgreSQL exactly.
   */
  getEmployeeByEmployeeNo(employeeNo: string): Promise<HrEmployee | null>;
  getEmployeeBySourceIdentity(
    sourceSystem: string,
    sourceId: string
  ): Promise<HrEmployee | null>;
  createEmployee(data: NewHrEmployee): Promise<HrEmployee>;
  updateEmployee(id: string, updates: HrEmployeeUpdates): Promise<HrEmployee>;

  // ── Leave ─────────────────────────────────────────────────────────────────
  getLeaveById(id: string): Promise<HrLeave | null>;
  createLeave(data: NewHrLeave): Promise<HrLeave>;
  /** Mutable fields of a leave row — the recorded subject never changes. */
  updateLeave(
    id: string,
    updates: Partial<Pick<HrLeave, 'status' | 'date_from' | 'date_to' | 'type'>>
  ): Promise<HrLeave>;

  // ── Payroll totals ────────────────────────────────────────────────────────
  getPayrollTotalById(id: string): Promise<HrPayrollTotal | null>;
  getPayrollTotalByDepartmentMonth(
    departmentId: string,
    month: string
  ): Promise<HrPayrollTotal | null>;
  createPayrollTotal(data: NewHrPayrollTotal): Promise<HrPayrollTotal>;

  // ── Import receipts ───────────────────────────────────────────────────────
  getImportReceiptByIdempotencyKey(key: string): Promise<HrImportReceipt | null>;
  createImportReceipt(receipt: NewHrImportReceipt): Promise<HrImportReceipt>;

  // ── Transaction boundary ──────────────────────────────────────────────────
  /**
   * Runs `fn` inside one atomic boundary. A thrown error rolls every write
   * performed by `fn` back.
   */
  transaction<T>(fn: (tx: HrRepository) => Promise<T>): Promise<T>;
}
