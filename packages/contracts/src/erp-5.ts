/**
 * ERP-5 HR & Employees — Public API Contract Types
 *
 * These Zod schemas are the single source of truth for:
 *   - Request/response validation (Fastify + Zod)
 *   - OpenAPI spec generation
 *   - TypeScript type inference (no separate type files needed)
 *
 * Module API base: /api/v1/erp-hr
 *
 * Schema owner: ERP-5 (Group 10). The shared error envelope
 * (`{ code, message, details, correlation_id }`) is owned by the platform
 * package `@cs/kernel` (ErrorEnvelopeSchema) and is NOT redefined here.
 *
 * @module contracts/erp-5
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Shared primitives (module-scoped names — other module contracts export
// `CurrencyCode`, `UuidSchema`, `MoneyAmount`, `PeriodLabel`)
// ─────────────────────────────────────────────────────────────────────────────

/** UUID primary key. */
export const HrUuid = z.string().uuid('Must be a valid UUID');

/** ISO 4217 currency code — exactly 3 uppercase letters. */
export const HrCurrencyCode = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 currency code (e.g. INR, USD)');

/** Calendar date — YYYY-MM-DD. */
export const HrIsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

/** Payroll month — YYYY-MM. */
export const HrMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be in YYYY-MM format');

/** Monetary amount: string-encoded decimal, non-negative, up to 4 decimal places. */
export const HrMoneyAmount = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'Amount must be a non-negative decimal with up to 4 decimal places');

/** Declared employee identifier, e.g. "EMP-0001". */
export const HrEmployeeNo = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9_-]+$/, 'Employee number may contain letters, digits, hyphen and underscore only');

/** Department code, e.g. "ENG". */
export const HrDepartmentCode = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9_-]+$/, 'Department code may contain letters, digits, hyphen and underscore only');

/** Person name component. */
export const HrPersonName = z.string().min(1).max(120);

/** Job title. */
export const HrJobTitle = z.string().min(1).max(120);

// ─────────────────────────────────────────────────────────────────────────────
// Enum schemas
// ─────────────────────────────────────────────────────────────────────────────

/** FR-ERP5-04: leave type is sick / holiday / other. */
export const LeaveTypeEnum = z.enum(['sick', 'holiday', 'other']);
export type LeaveType = z.infer<typeof LeaveTypeEnum>;

/** Leave record status. V1 records the status; V2 adds the approval workflow. */
export const LeaveStatusEnum = z.enum(['pending', 'approved', 'rejected']);
export type LeaveStatus = z.infer<typeof LeaveStatusEnum>;

// ─────────────────────────────────────────────────────────────────────────────
// Domain rule identifiers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stable error codes emitted by the ERP-5 domain layer. The database enforces
 * the same invariants; these codes are the API-facing representation.
 */
export const HR_DOMAIN_RULES = {
  /** BR-ERP5-01: join date must not be before birth date. */
  JOIN_DATE_AFTER_BIRTH_DATE: 'HR_JOIN_DATE_AFTER_BIRTH_DATE',
  /** Leave end date must not precede the start date. */
  LEAVE_DATE_RANGE_VALID: 'HR_LEAVE_DATE_RANGE_VALID',
  /** Salary must not be negative. */
  SALARY_NON_NEGATIVE: 'HR_SALARY_NON_NEGATIVE',
  /** Declared employee number must be unique. */
  EMPLOYEE_NO_DUPLICATE: 'HR_EMPLOYEE_NO_DUPLICATE',
  /** Department code must be unique. */
  DEPARTMENT_CODE_DUPLICATE: 'HR_DEPARTMENT_CODE_DUPLICATE',
  /** Referenced department must exist. */
  DEPARTMENT_REQUIRED: 'HR_DEPARTMENT_REQUIRED',
  /** Referenced employee must exist. */
  EMPLOYEE_REQUIRED: 'HR_EMPLOYEE_REQUIRED',
  /** Only one payroll aggregate per department and month. */
  PAYROLL_TOTAL_DUPLICATE: 'HR_PAYROLL_TOTAL_DUPLICATE',
  /** BR-ERP5-02: salary is never returned in full. */
  SALARY_MASKED: 'HR_SALARY_MASKED',
} as const;

export type HrDomainRule = (typeof HR_DOMAIN_RULES)[keyof typeof HR_DOMAIN_RULES];

// ─────────────────────────────────────────────────────────────────────────────
// Salary masking (BR-ERP5-02)
// ─────────────────────────────────────────────────────────────────────────────

/** The only salary representation a non-privileged viewer may receive. */
export const HR_SALARY_MASK = 'XX,XXX';

/** The representation used when salary is not disclosed at all. */
export const HR_SALARY_HIDDEN = 'salary hidden';

/**
 * Masks a salary value for serialization.
 *
 * BR-ERP5-02: salary is never shown in full to viewers and never appears in a
 * log. The masked form carries no part of the underlying value.
 */
export function maskHrSalary(): string {
  return HR_SALARY_MASK;
}

/** Hides salary entirely (field withheld from the payload). */
export function hideHrSalary(): string {
  return HR_SALARY_HIDDEN;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity schemas
// ─────────────────────────────────────────────────────────────────────────────

/** FR-ERP5-03 — department. */
export const HrDepartmentSchema = z.object({
  id: HrUuid,
  name: z.string(),
  code: z.string(),
  parent_id: HrUuid.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type HrDepartment = z.infer<typeof HrDepartmentSchema>;

/** FR-ERP5-01 / FR-ERP5-02 — employee (privileged/internal representation). */
export const HrEmployeeSchema = z.object({
  id: HrUuid,
  employee_no: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  birth_date: z.string(),
  join_date: z.string(),
  department_id: HrUuid,
  job_title: z.string(),
  salary: HrMoneyAmount,
  currency_code: HrCurrencyCode,
  source_system: z.string().nullable(),
  source_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type HrEmployee = z.infer<typeof HrEmployeeSchema>;

/**
 * Employee projection returned to viewers — the raw salary column is absent
 * and replaced by a masked display value (BR-ERP5-02).
 */
export const HrEmployeeViewSchema = z.object({
  id: HrUuid,
  employee_no: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  birth_date: z.string(),
  join_date: z.string(),
  department_id: HrUuid,
  job_title: z.string(),
  salary_display: z.string(),
  currency_code: HrCurrencyCode,
  created_at: z.string(),
  updated_at: z.string(),
});
export type HrEmployeeView = z.infer<typeof HrEmployeeViewSchema>;

/** FR-ERP5-04 — leave record. */
export const HrLeaveSchema = z.object({
  id: HrUuid,
  employee_id: HrUuid,
  date_from: z.string(),
  date_to: z.string(),
  type: LeaveTypeEnum,
  status: LeaveStatusEnum,
  created_at: z.string(),
  updated_at: z.string(),
});
export type HrLeave = z.infer<typeof HrLeaveSchema>;

/** FR-ERP5-06 — department/month payroll aggregate. No employee rows. */
export const HrPayrollTotalSchema = z.object({
  id: HrUuid,
  department_id: HrUuid,
  month: HrMonth,
  total_amount: HrMoneyAmount,
  currency_code: HrCurrencyCode,
  headcount: z.number().int().min(0),
  created_at: z.string(),
  updated_at: z.string(),
});
export type HrPayrollTotal = z.infer<typeof HrPayrollTotalSchema>;

/**
 * Read-only Hub Identity projection (Master Architecture Spec C3).
 * Deliberately carries NO password, hash, token or refresh-token field.
 */
export const HrIdentityUserSchema = z.object({
  id: HrUuid,
  username: z.string(),
  roles: z.array(z.string()),
  employee_ref: HrUuid.nullable(),
  status: z.string(),
});
export type HrIdentityUser = z.infer<typeof HrIdentityUserSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Request schemas
// ─────────────────────────────────────────────────────────────────────────────

/** POST /api/v1/erp-hr/departments */
export const CreateHrDepartmentRequestSchema = z.object({
  name: z.string().min(1).max(255),
  code: HrDepartmentCode,
  parent_id: HrUuid.nullish(),
});
export type CreateHrDepartmentRequest = z.infer<typeof CreateHrDepartmentRequestSchema>;

/** PATCH /api/v1/erp-hr/departments/{id} */
export const UpdateHrDepartmentRequestSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    code: HrDepartmentCode.optional(),
    parent_id: HrUuid.nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateHrDepartmentRequest = z.infer<typeof UpdateHrDepartmentRequestSchema>;

/**
 * POST /api/v1/erp-hr/employees
 * BR-ERP5-01 is asserted here and again by the database constraint.
 */
export const CreateHrEmployeeRequestSchema = z
  .object({
    employee_no: HrEmployeeNo,
    first_name: HrPersonName,
    last_name: HrPersonName,
    birth_date: HrIsoDate,
    join_date: HrIsoDate,
    department_id: HrUuid,
    job_title: HrJobTitle,
    salary: HrMoneyAmount,
    currency_code: HrCurrencyCode.optional(),
    source_system: z.string().max(64).optional(),
    source_id: z.string().max(128).optional(),
  })
  .refine((value) => value.join_date >= value.birth_date, {
    message: 'join_date must not be before birth_date',
    path: ['join_date'],
  });
export type CreateHrEmployeeRequest = z.infer<typeof CreateHrEmployeeRequestSchema>;

/** PATCH /api/v1/erp-hr/employees/{id} */
export const UpdateHrEmployeeRequestSchema = z
  .object({
    employee_no: HrEmployeeNo.optional(),
    first_name: HrPersonName.optional(),
    last_name: HrPersonName.optional(),
    birth_date: HrIsoDate.optional(),
    join_date: HrIsoDate.optional(),
    department_id: HrUuid.optional(),
    job_title: HrJobTitle.optional(),
    salary: HrMoneyAmount.optional(),
    currency_code: HrCurrencyCode.optional(),
  })
  .refine(
    (value) =>
      value.join_date === undefined ||
      value.birth_date === undefined ||
      value.join_date >= value.birth_date,
    {
      message: 'join_date must not be before birth_date',
      path: ['join_date'],
    }
  )
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateHrEmployeeRequest = z.infer<typeof UpdateHrEmployeeRequestSchema>;

/**
 * POST /api/v1/erp-hr/leave
 * The leave end date can never precede the start date.
 */
export const CreateHrLeaveRequestSchema = z
  .object({
    employee_id: HrUuid,
    date_from: HrIsoDate,
    date_to: HrIsoDate,
    type: LeaveTypeEnum,
    status: LeaveStatusEnum.optional(),
  })
  .refine((value) => value.date_to >= value.date_from, {
    message: 'date_to must not be before date_from',
    path: ['date_to'],
  });
export type CreateHrLeaveRequest = z.infer<typeof CreateHrLeaveRequestSchema>;

/** POST /api/v1/erp-hr/payroll-totals */
export const CreateHrPayrollTotalRequestSchema = z.object({
  department_id: HrUuid,
  month: HrMonth,
  total_amount: HrMoneyAmount,
  currency_code: HrCurrencyCode.optional(),
  headcount: z.number().int().min(0).optional(),
});
export type CreateHrPayrollTotalRequest = z.infer<typeof CreateHrPayrollTotalRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Bounded pagination + list responses
// ─────────────────────────────────────────────────────────────────────────────

/** Default page size for every ERP-5 collection endpoint. */
export const HR_PAGE_SIZE_DEFAULT = 25;

/** Hard page-size ceiling — a larger request is rejected with 400. */
export const HR_PAGE_SIZE_MAX = 100;

/** Bounded pagination — `page` starts at 1, `pageSize` is 1..100. */
export const HrPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(HR_PAGE_SIZE_MAX).default(HR_PAGE_SIZE_DEFAULT),
});
export type HrPaginationQuery = z.infer<typeof HrPaginationQuerySchema>;

/** GET /api/v1/erp-hr/employees */
export const HrEmployeeListQuerySchema = HrPaginationQuerySchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  department_id: HrUuid.optional(),
  sort: z.enum(['name', 'employee_no', 'join_date']).default('name'),
});
export type HrEmployeeListQuery = z.infer<typeof HrEmployeeListQuerySchema>;

/** GET /api/v1/erp-hr/departments */
export const HrDepartmentListQuerySchema = HrPaginationQuerySchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  parent_id: HrUuid.optional(),
  sort: z.enum(['name', 'code']).default('name'),
});
export type HrDepartmentListQuery = z.infer<typeof HrDepartmentListQuerySchema>;

/** GET /api/v1/erp-hr/leave */
export const HrLeaveListQuerySchema = HrPaginationQuerySchema.extend({
  employee_id: HrUuid.optional(),
  type: LeaveTypeEnum.optional(),
  status: LeaveStatusEnum.optional(),
});
export type HrLeaveListQuery = z.infer<typeof HrLeaveListQuerySchema>;

/** GET /api/v1/erp-hr/payroll-totals?month=YYYY-MM */
export const HrPayrollTotalListQuerySchema = z.object({
  month: HrMonth.optional(),
  department_id: HrUuid.optional(),
});
export type HrPayrollTotalListQuery = z.infer<typeof HrPayrollTotalListQuerySchema>;

/** Collection metadata returned with every list response. */
export const HrListMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(HR_PAGE_SIZE_MAX),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});
export type HrListMeta = z.infer<typeof HrListMetaSchema>;

/** Generic bounded list response. */
export function hrListResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    meta: HrListMetaSchema,
  });
}
