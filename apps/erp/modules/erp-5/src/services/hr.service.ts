/**
 * ERP-5 HR & Employees — Domain Service
 *
 * Owns every business rule of the ERP-5 write path:
 *   - FR-ERP5-01/02  employee master, unique employee number, masked salary
 *   - FR-ERP5-03     departments with an optional, acyclic parent hierarchy
 *   - FR-ERP5-04     leave records with a valid date range
 *   - FR-ERP5-05     no credentials, no application roles (Hub Identity owns them)
 *   - FR-ERP5-06     one department/month payroll aggregate, no employee rows
 *   - BR-ERP5-01     join date can never precede the birth date
 *   - BR-ERP5-02     salary is masked before it leaves the service
 *   - KIT-08         the import receipt commits in the same transaction as the
 *                    target mutation, and a repeated idempotency key performs
 *                    no second mutation
 *
 * The service returns the **public projection** of an employee — the raw
 * `salary` column never leaves this layer, so a careless route cannot leak
 * it (BR-ERP5-02).
 *
 * @module erp5/services/hr.service
 */

import {
  HR_DEFAULT_CURRENCY,
  HR_DOMAIN_RULES,
  HR_IMPORT_ONLY_FIELDS,
  HR_PAGE_SIZE_DEFAULT,
  maskHrSalary,
  type CreateHrDepartmentRequest,
  type CreateHrEmployeeRequest,
  type CreateHrLeaveRequest,
  type CreateHrPayrollTotalRequest,
  type HrDepartment,
  type HrDepartmentListQuery,
  type HrEmployee,
  type HrEmployeeListQuery,
  type HrEmployeeView,
  type HrIdentityUser,
  type HrIdentityUserListQuery,
  type HrImportReceipt,
  type HrLeave,
  type HrLeaveListQuery,
  type HrListMeta,
  type HrPayrollTotal,
  type HrPayrollTotalListQuery,
  type HrRelationshipWarning,
  type LeaveStatus,
  type UpdateHrDepartmentRequest,
  type UpdateHrEmployeeRequest,
  type UpdateHrLeaveRequest,
} from '@clearshift/contracts';

import { AuditService, InMemoryAuditRepository } from '@cs/core';
import {
  HrDomainError,
  assertDepartmentHierarchyAcyclic,
  assertJoinDateNotBeforeBirthDate,
  assertLeaveDateRange,
  assertNoIdentityCredentials,
  assertPayrollAggregateHasNoEmployeeRows,
  assertPayrollAmountNotNegative,
  assertSalaryNotNegative,
} from '../domain/rules.js';
import {
  assertHrDepartmentReadConsistency,
  assertHrEmployeeReadConsistency,
  assertHrLeaveReadConsistency,
  assertHrPayrollTotalReadConsistency,
  assertLeaveStatusTransition,
  assertSourceIdentityIsComplete,
  assertValidLeaveStatus,
  assertValidLeaveType,
  handleOptionalRelationship,
} from '../domain/relationships.js';
import {
  HrBadRequestError,
  HrConflictError,
  HrIdempotencyConflictError,
  HrNotFoundError,
  HrServiceError,
  HrUnprocessableError,
} from './errors.js';
import type { HrRepository } from './repository.js';
import { HrTargetAdapter } from '../migration/target-adapter.js';

/** Result of a create operation. `created` is false for an idempotent replay. */
export interface HrMutationResult<T> {
  entity: T;
  created: boolean;
  receipt?: HrImportReceipt;
  /** Absent optional relationships — no synthetic record was created. */
  warnings?: HrRelationshipWarning[];
}

/** The import provenance of a write, once it has been validated. */
export interface HrImportProvenance {
  batch_id: string;
  source_row: number;
  idempotency_key: string;
}

/** Target entity names stored on `erp5.import_receipts.entity`. */
export const HR_IMPORT_ENTITIES = {
  DEPARTMENT: 'department',
  EMPLOYEE: 'employee',
  LEAVE: 'leave',
  PAYROLL_TOTAL: 'payroll_total',
} as const;

/** Schema version of the ERP-5 target entities (KIT-08 receipt column). */
const HR_TARGET_SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalises a decimal string so two numerically equal amounts compare equal
 * regardless of their scale (`125000` ≡ `125000.0000`).
 */
export function normalizeHrAmount(value: string): string {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!match) {
    return value.trim();
  }
  const whole = match[1] ?? '0';
  const fraction = (match[2] ?? '').padEnd(4, '0').slice(0, 4);
  return `${whole}.${fraction}`;
}

/**
 * Resolves the import provenance of a write.
 *
 * The three fields travel together: an idempotency key without a batch and a
 * source row cannot produce a durable receipt, so a partial triple is
 * rejected instead of being silently ignored.
 */
export function resolveImportProvenance(input: {
  batch_id?: string | undefined;
  source_row?: number | undefined;
  idempotency_key?: string | undefined;
}): HrImportProvenance | null {
  const present = [input.batch_id, input.source_row, input.idempotency_key].filter(
    (value) => value !== undefined
  );

  if (present.length === 0) {
    return null;
  }

  if (present.length !== 3) {
    throw new HrBadRequestError(
      'Import provenance requires batch_id, source_row and an idempotency key together.',
      [
        {
          field: 'idempotency_key',
          message:
            'batch_id, source_row and idempotency_key must be supplied together',
          code: HR_DOMAIN_RULES.IMPORT_PROVENANCE_REQUIRED,
        },
      ],
      HR_DOMAIN_RULES.IMPORT_PROVENANCE_REQUIRED
    );
  }

  return {
    batch_id: input.batch_id as string,
    source_row: input.source_row as number,
    idempotency_key: input.idempotency_key as string,
  };
}

/**
 * Rejects source-identity fields on a write that carries no import
 * provenance — a browser may never set them.
 */
function assertImportOnlyFieldsAllowed(
  input: Readonly<Record<string, unknown>>,
  provenance: HrImportProvenance | null
): void {
  if (provenance !== null) {
    return;
  }
  const offending = HR_IMPORT_ONLY_FIELDS.find((field) => input[field] !== undefined);
  if (offending !== undefined) {
    throw new HrBadRequestError(
      `The field "${offending}" is system-maintained and may only be set by an import write.`,
      [
        {
          field: offending,
          message: 'Field is system-maintained and cannot be set by a user write',
          code: HR_DOMAIN_RULES.PROTECTED_FIELD,
        },
      ],
      HR_DOMAIN_RULES.PROTECTED_FIELD
    );
  }
}

/**
 * Rejects a payload that carries an identity credential.
 *
 * C3 — HR stores no credentials and grants no application roles.
 */
function assertPayloadHasNoCredentials(payload: Readonly<Record<string, unknown>>): void {
  try {
    assertNoIdentityCredentials(payload);
  } catch (error) {
    if (error instanceof HrDomainError) {
      throw new HrBadRequestError(
        error.message,
        [
          {
            field: String(error.context['field'] ?? 'payload'),
            message: error.message,
            code: error.code,
          },
        ],
        error.code
      );
    }
    throw error;
  }
}

/** Builds the masked public projection of an employee (BR-ERP5-02). */
export function toHrEmployeeView(
  employee: HrEmployee,
  roles: readonly string[]
): HrEmployeeView {
  // Salary masking is strictly enforced for all callers (BR-ERP5-02 / DR-5).
  // The raw value never leaves the module, regardless of role.
  return {
    id: employee.id,
    employee_no: employee.employee_no,
    first_name: employee.first_name,
    last_name: employee.last_name,
    birth_date: employee.birth_date,
    join_date: employee.join_date,
    department_id: employee.department_id,
    job_title: employee.job_title,
    salary_display: maskHrSalary(),
    currency_code: employee.currency_code,
    created_at: employee.created_at,
    updated_at: employee.updated_at,
  };
}

/**
 * Maps a domain rule violation onto the shared error envelope.
 *
 * A business-rule violation is `422`; a structurally impossible payload (a
 * half-set source identity, a credential field) is `400`.
 */
function toServiceError(error: HrDomainError): HrServiceError {
  const field = typeof error.context['field'] === 'string' ? error.context['field'] : undefined;
  const details =
    field !== undefined
      ? [{ field, message: error.message, code: error.code }]
      : [{ message: error.message, code: error.code }];

  if (error.code === HR_DOMAIN_RULES.SOURCE_IDENTITY_INCOMPLETE) {
    return new HrBadRequestError(error.message, details, error.code);
  }

  return new HrUnprocessableError(error.message, details, error.code);
}

/** Runs a domain rule and converts its failure into a service error. */
function guard(rule: () => void): void {
  try {
    rule();
  } catch (error) {
    if (error instanceof HrDomainError) {
      throw toServiceError(error);
    }
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class HrService {
  readonly repository: HrRepository;
  private readonly auditService: AuditService;

  constructor(repository: HrRepository, auditService: AuditService) {
    this.repository = repository;
    this.auditService = auditService;
  }

  // ── Departments (FR-ERP5-03) ─────────────────────────────────────────────

  async createDepartment(
    input: CreateHrDepartmentRequest,
    actor: { sub: string; roles: string[] },
    correlationId: string
  ): Promise<HrMutationResult<HrDepartment>> {
    assertPayloadHasNoCredentials(input as unknown as Record<string, unknown>);
    const provenance = resolveImportProvenance(input);
    assertImportOnlyFieldsAllowed(input as unknown as Record<string, unknown>, provenance);

    const result = await this.repository.transaction(async (tx) => {
      if (provenance !== null) {
        const replay = await this.replayDepartment(tx, provenance, input);
        if (replay) {
          return replay;
        }
      }

      const duplicate = await tx.getDepartmentByCode(input.code);
      if (duplicate) {
        throw new HrConflictError(
          `A department with the code "${input.code}" already exists.`,
          [
            {
              field: 'code',
              message: `Department code "${input.code}" is already in use`,
              code: HR_DOMAIN_RULES.DEPARTMENT_CODE_DUPLICATE,
            },
          ],
          HR_DOMAIN_RULES.DEPARTMENT_CODE_DUPLICATE
        );
      }

      // The parent is an *optional* relationship: an absent parent means a
      // root department and is reported as an approved warning — no synthetic
      // parent is ever created.
      const parent = handleOptionalRelationship(input.parent_id, 'parent_id', 'DEPARTMENT_PARENT');

      if (parent.value !== null) {
        const existingParent = await tx.getDepartmentById(parent.value);
        if (!existingParent) {
          throw new HrNotFoundError(
            'Parent department',
            parent.value,
            HR_DOMAIN_RULES.DEPARTMENT_REQUIRED,
            [
              {
                field: 'parent_id',
                message: 'The referenced parent department does not exist',
                code: HR_DOMAIN_RULES.DEPARTMENT_REQUIRED,
              },
            ]
          );
        }
      }

      const created = await tx.createDepartment({
        name: input.name,
        code: input.code,
        parent_id: parent.value,
      });

      const department = await this.readBack(
        tx,
        () => tx.getDepartmentById(created.id),
        assertHrDepartmentReadConsistency,
        'department'
      );

      const receipt = await this.writeReceipt(
        tx,
        provenance,
        HR_IMPORT_ENTITIES.DEPARTMENT,
        department.id
      );

      return {
        entity: department,
        created: true,
        ...(receipt !== null && { receipt }),
        ...(parent.warning !== undefined && { warnings: [parent.warning] }),
      };
    });

    await this.auditService.log({
      actor: actor.sub,
      actorRole: actor.roles[0],
      action: 'department.created',
      targetEntity: 'department',
      targetId: result.entity.id,
      correlationId,
      result: 'success',
      metadata: { department_code: result.entity.code },
    });

    return result;
  }

  async updateDepartment(
    id: string,
    input: UpdateHrDepartmentRequest,
    actor: { sub: string; roles: string[] },
    correlationId: string
  ): Promise<HrDepartment> {
    assertPayloadHasNoCredentials(input as unknown as Record<string, unknown>);

    const result = await this.repository.transaction(async (tx) => {
      const existing = await tx.getDepartmentById(id);
      if (!existing) {
        throw new HrNotFoundError('Department', id);
      }

      if (input.parent_id !== undefined && input.parent_id !== null) {
        if (input.parent_id === id) {
          throw new HrUnprocessableError(
            'A department cannot be its own parent.',
            [
              {
                field: 'parent_id',
                message: 'A department cannot be its own parent',
                code: HR_DOMAIN_RULES.DEPARTMENT_SELF_PARENT,
              },
            ],
            HR_DOMAIN_RULES.DEPARTMENT_SELF_PARENT
          );
        }

        const parent = await tx.getDepartmentById(input.parent_id);
        if (!parent) {
          throw new HrNotFoundError('Parent department', input.parent_id, HR_DOMAIN_RULES.DEPARTMENT_REQUIRED, [
            {
              field: 'parent_id',
              message: 'The referenced parent department does not exist',
              code: HR_DOMAIN_RULES.DEPARTMENT_REQUIRED,
            },
          ]);
        }

        const ancestors = await tx.listDepartmentAncestors(input.parent_id);
        guard(() =>
          assertDepartmentHierarchyAcyclic(
            id,
            input.parent_id,
            ancestors.map((ancestor) => ancestor.id)
          )
        );
      }

      if (input.code !== undefined && input.code !== existing.code) {
        const duplicate = await tx.getDepartmentByCode(input.code);
        if (duplicate) {
          throw new HrConflictError(
            `A department with the code "${input.code}" already exists.`,
            [
              {
                field: 'code',
                message: `Department code "${input.code}" is already in use`,
                code: HR_DOMAIN_RULES.DEPARTMENT_CODE_DUPLICATE,
              },
            ],
            HR_DOMAIN_RULES.DEPARTMENT_CODE_DUPLICATE
          );
        }
      }

      const updates: {
        name?: string;
        code?: string;
        parent_id?: string | null;
      } = {};
      if (input.name !== undefined) {
        updates.name = input.name;
      }
      if (input.code !== undefined) {
        updates.code = input.code;
      }
      if (input.parent_id !== undefined) {
        updates.parent_id = input.parent_id;
      }

      await tx.updateDepartment(id, updates);

      // The response is built from the persisted row, never from the request.
      return this.readBack(
        tx,
        () => tx.getDepartmentById(id),
        assertHrDepartmentReadConsistency,
        'department'
      );
    });

    await this.auditService.log({
      actor: actor.sub,
      actorRole: actor.roles[0],
      action: 'department.updated',
      targetEntity: 'department',
      targetId: id,
      correlationId,
      result: 'success',
      metadata: { department_code: result.code },
    });

    return result;
  }

    async importRow(
    input: {
      batch_id: string;
      source_row: number;
      entity: string;
      idempotency_key: string;
      record: Record<string, unknown>;
      upsert?: boolean;
    }
  ): Promise<{
    prior_result: boolean;
    entity: any;
    receipt: any;
  }> {
    const adapter = new HrTargetAdapter(this.repository);
    adapter.setEntity(input.entity);

    const result = await adapter.importRow(
      input.batch_id,
      input.source_row,
      input.idempotency_key,
      input.record
    );

    if (!result.ok) {
      if (result.error?.reasonCode === 'IDEMPOTENCY_CONFLICT') {
        const conflictError = new Error('Idempotency conflict');
        (conflictError as any).reasonCode = 'IDEMPOTENCY_CONFLICT';
        throw conflictError;
      }
      throw new Error(result.error?.message || 'Import failed');
    }

    return {
      prior_result: result.value.isExisting ?? false,
      entity: result.value.targetId, // Returning ID for simplicity in this shim
      receipt: result.value.receipt,
    };
  }


  async createEmployee(
    input: CreateHrEmployeeRequest,
    actor: { sub: string; roles: string[] },
    correlationId: string
  ): Promise<HrMutationResult<HrEmployeeView>> {
    assertPayloadHasNoCredentials(input as unknown as Record<string, unknown>);
    const provenance = resolveImportProvenance(input);
    assertImportOnlyFieldsAllowed(input as unknown as Record<string, unknown>, provenance);

    guard(() => assertJoinDateNotBeforeBirthDate(input.birth_date, input.join_date));
    guard(() => assertSalaryNotNegative(input.salary));
    // The source identity is a pair — half of it is not a valid state.
    guard(() => assertSourceIdentityIsComplete(input.source_system, input.source_id));

    const result = await this.repository.transaction(async (tx) => {
      if (provenance !== null) {
        const replay = await this.replayEmployee(tx, provenance, input);
        if (replay) {
          return replay;
        }
      }

      const duplicate = await tx.getEmployeeByEmployeeNo(input.employee_no);
      if (duplicate) {
        throw new HrConflictError(
          `An employee with the employee number "${input.employee_no}" already exists.`,
          [
            {
              field: 'employee_no',
              message: `Employee number "${input.employee_no}" is already in use`,
              code: HR_DOMAIN_RULES.EMPLOYEE_NO_DUPLICATE,
            },
          ],
          HR_DOMAIN_RULES.EMPLOYEE_NO_DUPLICATE
        );
      }

      if (input.source_system !== undefined && input.source_id !== undefined) {
        const duplicateSource = await tx.getEmployeeBySourceIdentity(
          input.source_system,
          input.source_id
        );
        if (duplicateSource) {
          throw new HrConflictError(
            'An employee with the same source identity already exists.',
            [
              {
                field: 'source_id',
                message: 'The source identity is already in use',
                code: HR_DOMAIN_RULES.SOURCE_IDENTITY_DUPLICATE,
              },
            ],
            HR_DOMAIN_RULES.SOURCE_IDENTITY_DUPLICATE
          );
        }
      }

      const department = await tx.getDepartmentById(input.department_id);
      if (!department) {
        throw new HrNotFoundError('Department', input.department_id, HR_DOMAIN_RULES.DEPARTMENT_REQUIRED, [
          {
            field: 'department_id',
            message: 'The referenced department does not exist',
            code: HR_DOMAIN_RULES.DEPARTMENT_REQUIRED,
          },
        ]);
      }

      const created = await tx.createEmployee({
        employee_no: input.employee_no,
        first_name: input.first_name,
        last_name: input.last_name,
        birth_date: input.birth_date,
        join_date: input.join_date,
        department_id: input.department_id,
        job_title: input.job_title,
        salary: input.salary,
        currency_code: input.currency_code ?? HR_DEFAULT_CURRENCY,
        source_system: input.source_system ?? null,
        source_id: input.source_id ?? null,
      });

      // The response is built from the persisted row, never from the request.
      const employee = await this.readBack(
        tx,
        () => tx.getEmployeeById(created.id),
        assertHrEmployeeReadConsistency,
        'employee'
      );

      const receipt = await this.writeReceipt(
        tx,
        provenance,
        HR_IMPORT_ENTITIES.EMPLOYEE,
        employee.id
      );

      return {
        entity: toHrEmployeeView(employee, actor.roles),
        created: true,
        ...(receipt !== null && { receipt }),
      };
    });

    await this.auditService.log({
      actor: actor.sub,
      actorRole: actor.roles[0],
      action: 'employee.created',
      targetEntity: 'employee',
      targetId: result.entity.id,
      correlationId,
      result: 'success',
      metadata: { employee_no: result.entity.employee_no },
    });

    return result;
  }

  async updateEmployee(
    id: string,
    input: UpdateHrEmployeeRequest,
    actor: { sub: string; roles: string[] },
    correlationId: string
  ): Promise<HrEmployeeView> {
    assertPayloadHasNoCredentials(input as unknown as Record<string, unknown>);

    const result = await this.repository.transaction(async (tx) => {
      const existing = await tx.getEmployeeById(id);
      if (!existing) {
        throw new HrNotFoundError('Employee', id);
      }

      const birthDate = input.birth_date ?? existing.birth_date;
      const joinDate = input.join_date ?? existing.join_date;
      guard(() => assertJoinDateNotBeforeBirthDate(birthDate, joinDate));

      if (input.salary !== undefined) {
        const salary = input.salary;
        guard(() => assertSalaryNotNegative(salary));
      }

      if (input.department_id !== undefined && input.department_id !== existing.department_id) {
        const department = await tx.getDepartmentById(input.department_id);
        if (!department) {
          throw new HrNotFoundError('Department', input.department_id, HR_DOMAIN_RULES.DEPARTMENT_REQUIRED, [
            {
              field: 'department_id',
              message: 'The referenced department does not exist',
              code: HR_DOMAIN_RULES.DEPARTMENT_REQUIRED,
            },
          ]);
        }
      }

      if (input.employee_no !== undefined && input.employee_no !== existing.employee_no) {
        const duplicate = await tx.getEmployeeByEmployeeNo(input.employee_no);
        if (duplicate) {
          throw new HrConflictError(
            `An employee with the employee number "${input.employee_no}" already exists.`,
            [
              {
                field: 'employee_no',
                message: `Employee number "${input.employee_no}" is already in use`,
                code: HR_DOMAIN_RULES.EMPLOYEE_NO_DUPLICATE,
              },
            ],
            HR_DOMAIN_RULES.EMPLOYEE_NO_DUPLICATE
          );
        }
      }

      const updates: {
        employee_no?: string;
        first_name?: string;
        last_name?: string;
        birth_date?: string;
        join_date?: string;
        department_id?: string;
        job_title?: string;
        salary?: string;
      } = {};
      if (input.employee_no !== undefined) {
        updates.employee_no = input.employee_no;
      }
      if (input.first_name !== undefined) {
        updates.first_name = input.first_name;
      }
      if (input.last_name !== undefined) {
        updates.last_name = input.last_name;
      }
      if (input.birth_date !== undefined) {
        updates.birth_date = input.birth_date;
      }
      if (input.join_date !== undefined) {
        updates.join_date = input.join_date;
      }
      if (input.department_id !== undefined) {
        updates.department_id = input.department_id;
      }
      if (input.job_title !== undefined) {
        updates.job_title = input.job_title;
      }
      if (input.salary !== undefined) {
        updates.salary = input.salary;
      }

      const updated = await tx.updateEmployee(id, updates);
      const persisted = await this.readBack(
        tx,
        () => tx.getEmployeeById(id),
        assertHrEmployeeReadConsistency,
        'employee'
      );
      return toHrEmployeeView(persisted, actor.roles);
    });

    await this.auditService.log({
      actor: actor.sub,
      actorRole: actor.roles[0],
      action: 'employee.updated',
      targetEntity: 'employee',
      targetId: id,
      correlationId,
      result: 'success',
      metadata: { employee_no: result.employee_no },
    });

    return result;
  }

  // ── Leave (FR-ERP5-04) ───────────────────────────────────────────────────

  async createLeave(
    input: CreateHrLeaveRequest,
    actor: { sub: string; roles: string[] },
    correlationId: string
  ): Promise<HrMutationResult<HrLeave>> {
    assertPayloadHasNoCredentials(input as unknown as Record<string, unknown>);
    const provenance = resolveImportProvenance(input);
    assertImportOnlyFieldsAllowed(input as unknown as Record<string, unknown>, provenance);

    const leaveType = input.type;
    const leaveStatus = input.status;
    guard(() => assertLeaveDateRange(input.date_from, input.date_to));
    guard(() => assertValidLeaveType(leaveType));
    if (leaveStatus !== undefined) {
      guard(() => assertValidLeaveStatus(leaveStatus));
    }

    const result = await this.repository.transaction(async (tx) => {
      if (provenance !== null) {
        const replay = await this.replayLeave(tx, provenance, input);
        if (replay) {
          return replay;
        }
      }

      const employee = await tx.getEmployeeById(input.employee_id);
      if (!employee) {
        throw new HrNotFoundError('Employee', input.employee_id, HR_DOMAIN_RULES.EMPLOYEE_REQUIRED, [
          {
            field: 'employee_id',
            message: 'The referenced employee does not exist',
            code: HR_DOMAIN_RULES.EMPLOYEE_REQUIRED,
          },
        ]);
      }

      const created = await tx.createLeave({
        employee_id: input.employee_id,
        date_from: input.date_from,
        date_to: input.date_to,
        type: input.type,
        status: input.status ?? 'pending',
      });

      const record = await this.readBack(
        tx,
        () => tx.getLeaveById(created.id),
        assertHrLeaveReadConsistency,
        'leave'
      );

      const receipt = await this.writeReceipt(tx, provenance, HR_IMPORT_ENTITIES.LEAVE, record.id);

      return {
        entity: record,
        created: true,
        ...(receipt !== null && { receipt }),
      };
    });

    await this.auditService.log({
      actor: actor.sub,
      actorRole: actor.roles[0],
      action: 'leave.created',
      targetEntity: 'leave',
      targetId: result.entity.id,
      correlationId,
      result: 'success',
      metadata: { employee_id: result.entity.employee_id },
    });

    return result;
  }

  /**
   * PATCH /api/v1/erp-hr/leave/{id}
   *
   * `status` is the state transition and is checked against the V1 leave
   * state matrix. The recorded subject (`employee_id`) is immutable — a leave
   * is a fact about one employee and is never re-parented.
   */
  async updateLeave(
    id: string,
    input: UpdateHrLeaveRequest,
    actor: { sub: string; roles: string[] },
    correlationId: string
  ): Promise<HrLeave> {
    assertPayloadHasNoCredentials(input as unknown as Record<string, unknown>);

    const result = await this.repository.transaction(async (tx) => {
      const existing = await tx.getLeaveById(id);
      if (!existing) {
        throw new HrNotFoundError('Leave record', id);
      }

      const dateFrom = input.date_from ?? existing.date_from;
      const dateTo = input.date_to ?? existing.date_to;
      guard(() => assertLeaveDateRange(dateFrom, dateTo));

      const nextType = input.type;
      const nextStatus = input.status;
      if (nextType !== undefined) {
        guard(() => assertValidLeaveType(nextType));
      }

      if (nextStatus !== undefined) {
        guard(() => assertValidLeaveStatus(nextStatus));
        // The state matrix — a decision is never reversed and a leave is never
        // un-decided (DR-10).
        guard(() => assertLeaveStatusTransition(existing.status, nextStatus));
      }

      const updates: {
        status?: LeaveStatus;
        date_from?: string;
        date_to?: string;
        type?: HrLeave['type'];
      } = {};
      if (nextStatus !== undefined) {
        updates.status = nextStatus;
      }
      if (input.date_from !== undefined) {
        updates.date_from = input.date_from;
      }
      if (input.date_to !== undefined) {
        updates.date_to = input.date_to;
      }
      if (nextType !== undefined) {
        updates.type = nextType;
      }

      await tx.updateLeave(id, updates);

      return this.readBack(
        tx,
        () => tx.getLeaveById(id),
        assertHrLeaveReadConsistency,
        'leave'
      );
    });

    await this.auditService.log({
      actor: actor.sub,
      actorRole: actor.roles[0],
      action: 'leave.updated',
      targetEntity: 'leave',
      targetId: id,
      correlationId,
      result: 'success',
      metadata: { employee_id: result.employee_id },
    });

    return result;
  }

  // ── Payroll totals (FR-ERP5-06) ───────────────────────────────────────────

  async createPayrollTotal(
    input: CreateHrPayrollTotalRequest,
    actor: { sub: string; roles: string[] },
    correlationId: string
  ): Promise<HrMutationResult<HrPayrollTotal>> {
    assertPayloadHasNoCredentials(input as unknown as Record<string, unknown>);
    try {
      assertPayrollAggregateHasNoEmployeeRows(input as unknown as Record<string, unknown>);
    } catch (error) {
      if (error instanceof HrDomainError) {
        throw new HrBadRequestError(
          error.message,
          [
            {
              field: String(error.context['field'] ?? 'payload'),
              message: error.message,
              code: error.code,
            },
          ],
          error.code
        );
      }
      throw error;
    }

    const provenance = resolveImportProvenance(input);
    assertImportOnlyFieldsAllowed(input as unknown as Record<string, unknown>, provenance);

    guard(() => assertPayrollAmountNotNegative(input.total_amount));
    const result = await this.repository.transaction(async (tx) => {
      if (provenance !== null) {
        const replay = await this.replayPayrollTotal(tx, provenance, input);
        if (replay) {
          return replay;
        }
      }

      const department = await tx.getDepartmentById(input.department_id);
      if (!department) {
        throw new HrNotFoundError('Department', input.department_id, HR_DOMAIN_RULES.DEPARTMENT_REQUIRED, [
          {
            field: 'department_id',
            message: 'The referenced department does not exist',
            code: HR_DOMAIN_RULES.DEPARTMENT_REQUIRED,
          },
        ]);
      }

      const duplicate = await tx.getPayrollTotalByDepartmentMonth(input.department_id, input.month);
      if (duplicate) {
        throw new HrConflictError(
          `A payroll aggregate already exists for department "${input.department_id}" and month "${input.month}".`,
          [
            {
              field: 'month',
              message: 'One payroll aggregate per department and month already exists',
              code: HR_DOMAIN_RULES.PAYROLL_TOTAL_DUPLICATE,
            },
          ],
          HR_DOMAIN_RULES.PAYROLL_TOTAL_DUPLICATE
        );
      }

      const created = await tx.createPayrollTotal({
        department_id: input.department_id,
        month: input.month,
        total_amount: input.total_amount,
        currency_code: input.currency_code ?? HR_DEFAULT_CURRENCY,
        headcount: input.headcount ?? 0,
      });

      // The aggregate is authoritative as loaded (DR-11): the module validates
      // it against its own invariants and reads the persisted row back, but it
      // never recomputes the amount from the employee rows.
      const total = await this.readBack(
        tx,
        () => tx.getPayrollTotalById(created.id),
        assertHrPayrollTotalReadConsistency,
        'payroll_total'
      );

      const receipt = await this.writeReceipt(
        tx,
        provenance,
        HR_IMPORT_ENTITIES.PAYROLL_TOTAL,
        total.id
      );

      return {
        entity: total,
        created: true,
        ...(receipt !== null && { receipt }),
      };
    });

    await this.auditService.log({
      actor: actor.sub,
      actorRole: actor.roles[0],
      action: 'payroll_total.loaded',
      targetEntity: 'payroll_total',
      targetId: result.entity.id,
      correlationId,
      result: 'success',
      metadata: { department_id: result.entity.department_id, month: result.entity.month },
    });

    return result;
  }

  // ── Query layer (ERP5-02) ────────────────────────────────────────────────

  /**
   * The bounded page metadata of a collection.
   *
   * `totalPages` is `0` for an empty collection — the honest answer, and
   * within the published `HrListMeta` contract.
   */
  private static toListMeta(page: number, pageSize: number, total: number): HrListMeta {
    return {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Lists the employees.
   *
   * The result is the **masked** projection — the raw `salary` column never
   * leaves the module (BR-ERP5-02).
   */
  async listEmployees(
    query: HrEmployeeListQuery,
    roles: readonly string[]
  ): Promise<{ data: HrEmployeeView[]; meta: HrListMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? HR_PAGE_SIZE_DEFAULT;
    const result = await this.repository.listEmployees({ ...query, page, pageSize });

    return {
      data: result.items.map((emp) => toHrEmployeeView(emp, roles)),
      meta: HrService.toListMeta(page, pageSize, result.total),
    };
  }

  async listDepartments(
    query: HrDepartmentListQuery
  ): Promise<{ data: HrDepartment[]; meta: HrListMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? HR_PAGE_SIZE_DEFAULT;
    const result = await this.repository.listDepartments({ ...query, page, pageSize });

    return {
      data: result.items,
      meta: HrService.toListMeta(page, pageSize, result.total),
    };
  }

  async listLeave(query: HrLeaveListQuery): Promise<{ data: HrLeave[]; meta: HrListMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? HR_PAGE_SIZE_DEFAULT;
    const result = await this.repository.listLeave({ ...query, page, pageSize });

    return {
      data: result.items,
      meta: HrService.toListMeta(page, pageSize, result.total),
    };
  }

  async listPayrollTotals(
    query: HrPayrollTotalListQuery
  ): Promise<{ data: HrPayrollTotal[]; meta: HrListMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? HR_PAGE_SIZE_DEFAULT;
    const result = await this.repository.listPayrollTotals({ ...query, page, pageSize });

    return {
      data: result.items,
      meta: HrService.toListMeta(page, pageSize, result.total),
    };
  }

  /**
   * Lists the read-only Hub Identity projection.
   *
   * The projection is owned by the platform and exposes identity attributes
   * only — no credential, hash, token or refresh-token field. It is empty
   * when the platform has not created it yet.
   */
  async listIdentityUsers(
    query: HrIdentityUserListQuery
  ): Promise<{ data: HrIdentityUser[]; meta: HrListMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? HR_PAGE_SIZE_DEFAULT;
    const result = await this.repository.listIdentityUsers({ ...query, page, pageSize });

    return {
      data: result.items,
      meta: HrService.toListMeta(page, pageSize, result.total),
    };
  }

  async getEmployeeById(
    id: string,
    roles: readonly string[]
  ): Promise<HrEmployeeView> {
    const employee = await this.repository.getEmployeeById(id);
    if (!employee) {
      throw new HrNotFoundError('Employee', id);
    }
    return toHrEmployeeView(employee, roles);
  }

  async getDepartmentById(id: string): Promise<HrDepartment> {
    const department = await this.repository.getDepartmentById(id);
    if (!department) {
      throw new HrNotFoundError('Department', id);
    }
    return department;
  }

  async getLeaveById(id: string): Promise<HrLeave> {
    const record = await this.repository.getLeaveById(id);
    if (!record) {
      throw new HrNotFoundError('Leave record', id);
    }
    return record;
  }

  async getPayrollTotalById(id: string): Promise<HrPayrollTotal> {
    const total = await this.repository.getPayrollTotalById(id);
    if (!total) {
      throw new HrNotFoundError('Payroll aggregate', id);
    }
    return total;
  }

  // ── Idempotency helpers ──────────────────────────────────────────────────

  /**
   * Reads a row back after the write and asserts the read model.
   *
   * The response is built from the **persisted** row, never from the request
   * payload, so the UI and the read API can never show a status, a link or a
   * derived total that the database does not hold (ERP5-06).
   */
  private async readBack<T>(
    tx: HrRepository,
    load: () => Promise<T | null>,
    assert: (entity: T) => void,
    entity: string
  ): Promise<T> {
    const persisted = await load();
    if (!persisted) {
      throw new HrUnprocessableError(
        `The ${entity} could not be read back after the write.`,
        [
          {
            field: entity,
            message: 'The persisted row is not readable after the write',
            code: HR_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
          },
        ],
        HR_DOMAIN_RULES.READ_MODEL_INCONSISTENT
      );
    }

    guard(() => assert(persisted));
    return persisted;
  }

  /**
   * Writes the import receipt inside the caller's transaction.
   *
   * The receipt and the target mutation therefore commit together — a failure
   * of either rolls both back (KIT-08).
   */
  private async writeReceipt(
    tx: HrRepository,
    provenance: HrImportProvenance | null,
    entity: string,
    targetId: string
  ): Promise<HrImportReceipt | null> {
    if (provenance === null) {
      return null;
    }
    return tx.createImportReceipt({
      batch_id: provenance.batch_id,
      source_row: provenance.source_row,
      entity,
      schema_version: HR_TARGET_SCHEMA_VERSION,
      idempotency_key: provenance.idempotency_key,
      request_hash: '',
      target_id: targetId,
      kind: 'created',
    });
  }

  /**
   * Resolves a repeated import.
   *
   * Returns the original result when the same idempotency key is replayed
   * with the same payload, `null` when the key is new, and throws
   * `409` when the key was already used for a different payload.
   */
  private async replay<T>(
    tx: HrRepository,
    provenance: HrImportProvenance,
    loadTarget: (targetId: string) => Promise<T | null>,
    fingerprint: (entity: T) => string,
    requestedFingerprint: string
  ): Promise<HrMutationResult<T> | null> {
    const receipt = await tx.getImportReceiptByIdempotencyKey(provenance.idempotency_key);
    if (!receipt) {
      return null;
    }

    const target = await loadTarget(receipt.target_id);
    if (!target) {
      throw new HrIdempotencyConflictError(
        'The idempotency key was already used but the target record no longer exists.',
        [
          {
            field: 'idempotency_key',
            message: 'The idempotency key refers to a record that no longer exists',
            code: HR_DOMAIN_RULES.IDEMPOTENCY_CONFLICT,
          },
        ]
      );
    }

    if (fingerprint(target) !== requestedFingerprint) {
      throw new HrIdempotencyConflictError(
        'The idempotency key was already used with a different payload.',
        [
          {
            field: 'idempotency_key',
            message: 'The idempotency key was used with a different payload',
            code: HR_DOMAIN_RULES.IDEMPOTENCY_CONFLICT,
          },
        ]
      );
    }

    return { entity: target, created: false, receipt };
  }

  private async replayEmployee(
    tx: HrRepository,
    provenance: HrImportProvenance,
    input: CreateHrEmployeeRequest
  ): Promise<HrMutationResult<HrEmployeeView> | null> {
    const result = await this.replay<HrEmployee>(
      tx,
      provenance,
      (targetId) => tx.getEmployeeById(targetId),
      (employee) => this.employeeFingerprint(employee),
      this.employeeFingerprintFromRequest(input)
    );

    if (!result) {
      return null;
    }

    return {
      entity: toHrEmployeeView(result.entity, []), // Force masked projection for replays per BR-ERP5-02
      created: false,
      ...(result.receipt !== undefined && { receipt: result.receipt }),
    };
  }

  private async replayDepartment(
    tx: HrRepository,
    provenance: HrImportProvenance,
    input: CreateHrDepartmentRequest
  ): Promise<HrMutationResult<HrDepartment> | null> {
    return this.replay<HrDepartment>(
      tx,
      provenance,
      (targetId) => tx.getDepartmentById(targetId),
      (department) =>
        [department.name, department.code, department.parent_id ?? ''].join('|'),
      [input.name, input.code, input.parent_id ?? ''].join('|')
    );
  }

  private async replayLeave(
    tx: HrRepository,
    provenance: HrImportProvenance,
    input: CreateHrLeaveRequest
  ): Promise<HrMutationResult<HrLeave> | null> {
    return this.replay<HrLeave>(
      tx,
      provenance,
      (targetId) => tx.getLeaveById(targetId),
      (record) =>
        [
          record.employee_id,
          record.date_from,
          record.date_to,
          record.type,
          record.status,
        ].join('|'),
      [
        input.employee_id,
        input.date_from,
        input.date_to,
        input.type,
        input.status ?? 'pending',
      ].join('|')
    );
  }

  private async replayPayrollTotal(
    tx: HrRepository,
    provenance: HrImportProvenance,
    input: CreateHrPayrollTotalRequest
  ): Promise<HrMutationResult<HrPayrollTotal> | null> {
    return this.replay<HrPayrollTotal>(
      tx,
      provenance,
      (targetId) => tx.getPayrollTotalById(targetId),
      (total) =>
        [
          total.department_id,
          total.month,
          normalizeHrAmount(total.total_amount),
          total.currency_code,
          String(total.headcount),
        ].join('|'),
      [
        input.department_id,
        input.month,
        normalizeHrAmount(input.total_amount),
        input.currency_code ?? HR_DEFAULT_CURRENCY,
        String(input.headcount ?? 0),
      ].join('|')
    );
  }

  /** Canonical fingerprint of an employee payload, used to detect replays. */
  private employeeFingerprint(employee: HrEmployee): string {
    return [
      employee.employee_no,
      employee.first_name,
      employee.last_name,
      employee.birth_date,
      employee.join_date,
      employee.department_id,
      employee.job_title,
      normalizeHrAmount(employee.salary),
      employee.currency_code,
    ].join('|');
  }

  /** The same fingerprint, computed from an incoming create request. */
  private employeeFingerprintFromRequest(input: CreateHrEmployeeRequest): string {
    return [
      input.employee_no,
      input.first_name,
      input.last_name,
      input.birth_date,
      input.join_date,
      input.department_id,
      input.job_title,
      normalizeHrAmount(input.salary),
      input.currency_code ?? HR_DEFAULT_CURRENCY,
    ].join('|');
  }
}
