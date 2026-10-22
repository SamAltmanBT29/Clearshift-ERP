/**
 * ERP-5 HR & Employees — Authorization Policy (PLT-06 / ERP5-15)
 *
 * The **declared** authorization policy of the module: one entry per route
 * group, with the roles that may perform it. The policy is the single source
 * of truth for the route guards — the routes never decide a role set on their
 * own.
 *
 * The role sets are **not invented here**: they mirror the central matrix
 * that PLT-06 merged (`packages/core/src/auth/permissions.ts` and
 * `apps/hub/src/policies/route-policy.ts`):
 *
 *   - `hr.read`        → Viewer, Editor, Analyst, Admin
 *   - `hr.mutate`      → Editor, Admin
 *   - `hr.payroll_bulk`→ Migration Runner, Admin
 *
 * Invariant: **DEFAULT DENY**. A route without a policy entry is refused.
 *
 * @module erp5/policies/permissions
 */

import { Roles, type RoleType } from '@cs/identity';

/** The policy identifiers of the module. */
export const HrPolicies = {
  // ── Employees (FR-ERP5-01/02) ─────────────────────────────────────────────
  EMPLOYEES_READ: 'hr.employees.read',
  EMPLOYEES_CREATE: 'hr.employees.create',
  EMPLOYEES_UPDATE: 'hr.employees.update',

  // ── Departments (FR-ERP5-03) ──────────────────────────────────────────────
  DEPARTMENTS_READ: 'hr.departments.read',
  DEPARTMENTS_CREATE: 'hr.departments.create',
  DEPARTMENTS_UPDATE: 'hr.departments.update',

  // ── Leave (FR-ERP5-04) ────────────────────────────────────────────────────
  LEAVE_READ: 'hr.leave.read',
  LEAVE_CREATE: 'hr.leave.create',
  LEAVE_UPDATE: 'hr.leave.update',

  // ── Payroll aggregates (FR-ERP5-06) ───────────────────────────────────────
  PAYROLL_READ: 'hr.payroll.read',
  PAYROLL_LOAD: 'hr.payroll.load',

  // ── Hub Identity projection (FR-ERP5-05) — read only ─────────────────────
  IDENTITY_USERS_READ: 'hr.identity_users.read',
} as const;

export type HrPolicy = (typeof HrPolicies)[keyof typeof HrPolicies];

/** The role set of the central `hr.read` policy (PLT-06). */
const HR_READ_ROLES: readonly RoleType[] = [
  Roles.VIEWER,
  Roles.EDITOR,
  Roles.ANALYST,
  Roles.ADMIN,
];

/** The role set of the central `hr.mutate` policy (PLT-06). */
const HR_MUTATE_ROLES: readonly RoleType[] = [Roles.EDITOR, Roles.ADMIN];

/** The role set of the central `hr.payroll_bulk` policy (PLT-06). */
const HR_PAYROLL_LOAD_ROLES: readonly RoleType[] = [Roles.MIGRATION_RUNNER, Roles.ADMIN];

/** One declared policy: the roles that may perform it and what it covers. */
export interface HrPolicyDefinition {
  policy: HrPolicy;
  /** The roles the central matrix grants this policy to. */
  allowedRoles: readonly RoleType[];
  /** The entity kind the policy guards — the object-level dimension. */
  entity: 'employee' | 'department' | 'leave' | 'payroll_total' | 'identity_user';
  description: string;
}

/**
 * The ERP-5 authorization matrix.
 *
 * Every route of the module is bound to exactly one entry. The guard refuses
 * a request whose roles are not listed — the default is **deny**.
 */
export const HR_ROUTE_POLICIES: Record<HrPolicy, HrPolicyDefinition> = {
  [HrPolicies.EMPLOYEES_READ]: {
    policy: HrPolicies.EMPLOYEES_READ,
    allowedRoles: HR_READ_ROLES,
    entity: 'employee',
    description: 'List and read employee records (the salary is never disclosed in full)',
  },
  [HrPolicies.EMPLOYEES_CREATE]: {
    policy: HrPolicies.EMPLOYEES_CREATE,
    allowedRoles: HR_MUTATE_ROLES,
    entity: 'employee',
    description: 'Create an employee',
  },
  [HrPolicies.EMPLOYEES_UPDATE]: {
    policy: HrPolicies.EMPLOYEES_UPDATE,
    allowedRoles: HR_MUTATE_ROLES,
    entity: 'employee',
    description: 'Edit an employee',
  },
  [HrPolicies.DEPARTMENTS_READ]: {
    policy: HrPolicies.DEPARTMENTS_READ,
    allowedRoles: HR_READ_ROLES,
    entity: 'department',
    description: 'List and read departments',
  },
  [HrPolicies.DEPARTMENTS_CREATE]: {
    policy: HrPolicies.DEPARTMENTS_CREATE,
    allowedRoles: HR_MUTATE_ROLES,
    entity: 'department',
    description: 'Create a department',
  },
  [HrPolicies.DEPARTMENTS_UPDATE]: {
    policy: HrPolicies.DEPARTMENTS_UPDATE,
    allowedRoles: HR_MUTATE_ROLES,
    entity: 'department',
    description: 'Edit a department',
  },
  [HrPolicies.LEAVE_READ]: {
    policy: HrPolicies.LEAVE_READ,
    allowedRoles: HR_READ_ROLES,
    entity: 'leave',
    description: 'List and read leave records',
  },
  [HrPolicies.LEAVE_CREATE]: {
    policy: HrPolicies.LEAVE_CREATE,
    allowedRoles: HR_MUTATE_ROLES,
    entity: 'leave',
    description: 'Create a leave record',
  },
  [HrPolicies.LEAVE_UPDATE]: {
    policy: HrPolicies.LEAVE_UPDATE,
    allowedRoles: HR_MUTATE_ROLES,
    entity: 'leave',
    description: 'Edit a leave record and apply the V1 state transition',
  },
  [HrPolicies.PAYROLL_READ]: {
    policy: HrPolicies.PAYROLL_READ,
    allowedRoles: HR_READ_ROLES,
    entity: 'payroll_total',
    description: 'List and read department/month payroll aggregates',
  },
  [HrPolicies.PAYROLL_LOAD]: {
    policy: HrPolicies.PAYROLL_LOAD,
    allowedRoles: HR_PAYROLL_LOAD_ROLES,
    entity: 'payroll_total',
    description: 'Load one department/month payroll aggregate (the Migration Kit load path)',
  },
  [HrPolicies.IDENTITY_USERS_READ]: {
    policy: HrPolicies.IDENTITY_USERS_READ,
    allowedRoles: HR_READ_ROLES,
    entity: 'identity_user',
    description: 'Read the Hub Identity projection (read only, no credential field)',
  },
};

/** True when the roles satisfy the policy. */
export function isPolicySatisfied(policy: HrPolicy, roles: readonly string[]): boolean {
  const definition = HR_ROUTE_POLICIES[policy];
  if (!definition) {
    // DEFAULT DENY — an unknown policy is never granted.
    return false;
  }
  return definition.allowedRoles.some((role) => roles.includes(role));
}

/** The policy that guards one entity kind for one action. */
export function policyForEntity(
  entity: HrPolicyDefinition['entity'],
  action: 'read' | 'create' | 'update' | 'load'
): HrPolicy | undefined {
  const entry = (Object.values(HR_ROUTE_POLICIES) as HrPolicyDefinition[]).find(
    (definition) => definition.entity === entity && definition.policy.endsWith(`.${action}`)
  );
  return entry?.policy;
}
