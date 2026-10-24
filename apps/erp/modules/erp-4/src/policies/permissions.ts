/**
 * ERP-4 Finance & Accounting — Authorization & RBAC Policies (PLT-06 / ERP4-09)
 *
 * Implements strict server-side authorization matching the SDS endpoint matrix.
 * Policy Invariant: DEFAULT DENY.
 *
 * Matrix Traceability:
 *   - SDS ClearShift ERP v2.0 §4.8, §7.9, §9.3
 *   - docs/security/role-matrix.md
 *   - packages/core/src/auth/permissions.ts
 *
 * @module erp4/policies/permissions
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '@cs/kernel';
import { Roles, type RoleType } from '@cs/identity';

export const FinancePolicies = {
  // ── Accounts (Chart of Accounts) ───────────────────────────────────────────
  ACCOUNTS_READ: 'finance.accounts.read',
  ACCOUNTS_CREATE: 'finance.accounts.create',
  ACCOUNTS_UPDATE: 'finance.accounts.update',

  // ── Journal Entries ────────────────────────────────────────────────────────
  JOURNAL_READ: 'finance.journal.read',
  JOURNAL_CREATE: 'finance.journal.create',
  JOURNAL_UPDATE: 'finance.journal.update',
  JOURNAL_POST: 'finance.journal.post',
  JOURNAL_REVERSE: 'finance.journal.reverse',
  JOURNAL_VOID: 'finance.journal.void',

  // ── Reports & Balances ─────────────────────────────────────────────────────
  TRIAL_BALANCE_READ: 'finance.trial_balance.read',
  OPENING_BALANCES_READ: 'finance.opening_balances.read',
  OPENING_BALANCES_LOAD: 'finance.opening_balances.load',

  // ── Accounting Periods ─────────────────────────────────────────────────────
  PERIODS_READ: 'finance.periods.read',
  PERIODS_UPDATE: 'finance.periods.update',

  // ── Migration Profiling / Cleaning / Mapping (KIT-03 / KIT-04 / KIT-05 / ERP4-26..28) ──
  MIGRATION_PROFILE_READ: 'finance.migration.profile.read',
  MIGRATION_CLEAN_READ: 'finance.migration.clean.read',
  MIGRATION_CLEAN_RUN: 'finance.migration.clean.run',
  MIGRATION_MAPPING_READ: 'finance.migration.mapping.read',
  MIGRATION_MAPPING_RUN: 'finance.migration.mapping.run',
} as const;

export type FinancePolicy = typeof FinancePolicies[keyof typeof FinancePolicies];

/**
 * Endpoint Policy Definitions matching SDS §4.8 matrix exactly.
 * Non-negotiable invariant: DEFAULT DENY.
 */
export const FINANCE_ROUTE_POLICIES: Record<
  FinancePolicy,
  { policy: FinancePolicy; allowedRoles: readonly string[]; description: string }
> = {
  [FinancePolicies.ACCOUNTS_READ]: {
    policy: FinancePolicies.ACCOUNTS_READ,
    allowedRoles: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN, 'finance_admin', 'auditor'],
    description: 'List and view accounts in the Chart of Accounts',
  },
  [FinancePolicies.ACCOUNTS_CREATE]: {
    policy: FinancePolicies.ACCOUNTS_CREATE,
    allowedRoles: [Roles.EDITOR, Roles.ADMIN, 'seed', 'finance_admin', 'system'],
    description: 'Create new accounts in Chart of Accounts (Admin/Editor only)',
  },
  [FinancePolicies.ACCOUNTS_UPDATE]: {
    policy: FinancePolicies.ACCOUNTS_UPDATE,
    allowedRoles: [Roles.EDITOR, Roles.ADMIN, 'finance_admin'],
    description: 'Update account metadata and hierarchy',
  },
  [FinancePolicies.JOURNAL_READ]: {
    policy: FinancePolicies.JOURNAL_READ,
    allowedRoles: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN, 'finance_admin', 'auditor'],
    description: 'List and inspect journal entries and lines',
  },
  [FinancePolicies.JOURNAL_CREATE]: {
    policy: FinancePolicies.JOURNAL_CREATE,
    allowedRoles: [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN, 'finance_admin'],
    description: 'Create draft journal entry (Editor and Migration Runner per SDS)',
  },
  [FinancePolicies.JOURNAL_UPDATE]: {
    policy: FinancePolicies.JOURNAL_UPDATE,
    allowedRoles: [Roles.EDITOR, Roles.ADMIN, 'finance_admin'],
    description: 'Update draft journal entry lines or header',
  },
  [FinancePolicies.JOURNAL_POST]: {
    policy: FinancePolicies.JOURNAL_POST,
    allowedRoles: [Roles.EDITOR, Roles.ADMIN, 'finance_admin', 'staff'],
    description: 'Post and lock journal entry (Editor / Admin / staff in open periods)',
  },
  [FinancePolicies.JOURNAL_REVERSE]: {
    policy: FinancePolicies.JOURNAL_REVERSE,
    allowedRoles: [Roles.EDITOR, Roles.ADMIN, 'finance_admin'],
    description: 'Reverse posted journal entry via compensating reversal',
  },
  [FinancePolicies.JOURNAL_VOID]: {
    policy: FinancePolicies.JOURNAL_VOID,
    allowedRoles: [Roles.EDITOR, Roles.ADMIN, 'finance_admin'],
    description: 'Void draft journal entry',
  },
  [FinancePolicies.TRIAL_BALANCE_READ]: {
    policy: FinancePolicies.TRIAL_BALANCE_READ,
    allowedRoles: [Roles.VIEWER, Roles.ANALYST, Roles.EDITOR, Roles.ADMIN, 'finance_admin'],
    description: 'Generate and read trial balance reports',
  },
  [FinancePolicies.OPENING_BALANCES_READ]: {
    policy: FinancePolicies.OPENING_BALANCES_READ,
    allowedRoles: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.MIGRATION_RUNNER, Roles.ADMIN, 'finance_admin'],
    description: 'View one-time opening balance records',
  },
  [FinancePolicies.OPENING_BALANCES_LOAD]: {
    policy: FinancePolicies.OPENING_BALANCES_LOAD,
    allowedRoles: [Roles.MIGRATION_RUNNER, Roles.ADMIN, 'finance_admin'],
    description: 'Bulk load opening balances (Migration Runner only)',
  },
  [FinancePolicies.PERIODS_READ]: {
    policy: FinancePolicies.PERIODS_READ,
    allowedRoles: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN, 'finance_admin'],
    description: 'View fiscal accounting periods and status',
  },
  [FinancePolicies.PERIODS_UPDATE]: {
    policy: FinancePolicies.PERIODS_UPDATE,
    allowedRoles: [Roles.ADMIN, 'finance_admin'],
    description: 'Update accounting period state (open/soft_closed/locked)',
  },
  [FinancePolicies.MIGRATION_PROFILE_READ]: {
    policy: FinancePolicies.MIGRATION_PROFILE_READ,
    allowedRoles: [Roles.VIEWER, Roles.ANALYST, Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN, 'finance_admin', 'auditor'],
    description: 'Inspect migration column profiling and data health reports',
  },
  [FinancePolicies.MIGRATION_CLEAN_READ]: {
    policy: FinancePolicies.MIGRATION_CLEAN_READ,
    allowedRoles: [Roles.VIEWER, Roles.ANALYST, Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN, 'finance_admin', 'auditor'],
    description: 'Inspect cleaning rules, transformed data, and field-level audit reports',
  },
  [FinancePolicies.MIGRATION_CLEAN_RUN]: {
    policy: FinancePolicies.MIGRATION_CLEAN_RUN,
    allowedRoles: [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN, 'finance_admin'],
    description: 'Execute dataset cleaning with custom rule toggles',
  },
  [FinancePolicies.MIGRATION_MAPPING_READ]: {
    policy: FinancePolicies.MIGRATION_MAPPING_READ,
    allowedRoles: [Roles.VIEWER, Roles.ANALYST, Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN, 'finance_admin', 'auditor'],
    description: 'Inspect migration field mapping templates and schema targets',
  },
  [FinancePolicies.MIGRATION_MAPPING_RUN]: {
    policy: FinancePolicies.MIGRATION_MAPPING_RUN,
    allowedRoles: [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN, 'finance_admin'],
    description: 'Validate and execute source-to-target field mapping projections',
  },
};

/**
 * Validates whether user roles satisfy a given policy.
 * Non-negotiable invariant: DEFAULT DENY.
 */
export function isFinancePolicyAllowed(
  userRoles: readonly string[] | undefined,
  policy: FinancePolicy
): boolean {
  if (!userRoles || userRoles.length === 0) {
    return false;
  }
  const policyDef = FINANCE_ROUTE_POLICIES[policy];
  if (!policyDef) {
    // Unknown policy: DEFAULT DENY
    return false;
  }
  return policyDef.allowedRoles.some((allowedRole) => userRoles.includes(allowedRole));
}

/**
 * Creates a Fastify preHandler route policy guard.
 * Returns HTTP 401 when unauthenticated and HTTP 403 when forbidden.
 */
export function requireFinancePolicy(policy: FinancePolicy) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const user = request.user;
    if (!user) {
      throw new AppError('UNAUTHORIZED', 'Authentication required. Bearer token missing.', 401);
    }

    const roles = user.roles && user.roles.length > 0 ? user.roles : [];
    if (!isFinancePolicyAllowed(roles, policy)) {
      const policyDef = FINANCE_ROUTE_POLICIES[policy];
      throw new AppError(
        'INSUFFICIENT_PERMISSIONS',
        `Access denied. Role(s) [${roles.join(', ')}] lack permission for policy '${policy}'. Required roles: [${policyDef?.allowedRoles.join(', ')}]`,
        403
      );
    }
  };
}
