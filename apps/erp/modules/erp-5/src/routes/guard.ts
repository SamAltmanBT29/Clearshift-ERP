/**
 * ERP-5 HR & Employees — Shared Route Guards
 *
 * The module does not own an authorization matrix. It consumes the platform
 * primitives:
 *
 *   - `packages/rbac` (PLT-03) — the shared **capability** matrix. The
 *     `module.write` capability is granted to Editor and Admin, which is
 *     exactly the role set of the central matrix's `hr.mutate` policy
 *     (PLT-06).
 *   - `packages/core` (PLT-06) — the central **role / action / resource**
 *     matrix. `hr.payroll_bulk` (MIGRATION_RUNNER, ADMIN) is expressed there
 *     as `EXECUTE_BULK` / `UPDATE` on the `payroll` resource.
 *
 * The Migration Kit therefore loads a payroll aggregate as MIGRATION_RUNNER
 * and can never write into the `erp5` tables directly (Decision C7) — it
 * goes through this module's public API.
 *
 * @module erp5/routes/guard
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@cs/kernel';
import { Capabilities, requireCapability } from '@cs/rbac';
import { hasPermission } from '@cs/core';
import { Actions, Resources } from '@clearshift/contracts';

/**
 * Employees, departments and leave — the HR master records.
 *
 * `module.write` is held by Editor and Admin, which is the role set of the
 * central matrix's `hr.mutate` policy.
 */
export const hrWriteGuard = requireCapability(Capabilities.MODULE_WRITE);

/**
 * Payroll aggregates — the department/month bulk load.
 *
 * The central matrix (PLT-06) declares `hr.payroll_bulk` for MIGRATION_RUNNER
 * and Admin. The check is expressed with the shared matrix itself instead of
 * a local role list, so the module can never drift from the platform policy.
 */
export const hrPayrollWriteGuard = async (
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> => {
  const user = request.user;
  if (!user) {
    throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
  }

  const roles = user.roles ?? [];
  const allowed =
    hasPermission(roles, Actions.CREATE, Resources.PAYROLL) ||
    hasPermission(roles, Actions.UPDATE, Resources.PAYROLL) ||
    hasPermission(roles, Actions.EXECUTE_BULK, Resources.PAYROLL);

  if (!allowed) {
    throw new AppError(
      'FORBIDDEN',
      'Access denied. Loading a payroll aggregate requires the central matrix role set (MIGRATION_RUNNER, ADMIN).',
      403
    );
  }
};
