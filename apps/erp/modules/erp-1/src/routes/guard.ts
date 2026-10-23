/**
 * ERP-1 Products & Inventory — Route Guards
 *
 * Authorization consumes the platform RBAC matrix (PLT-03). The Migration Kit
 * loads data through the module API, so `kit.run` may create products,
 * categories and opening stock; ordinary browser edits require
 * `module.write`.
 *
 * @module erp1/routes/guard
 */

import { AppError } from '@cs/kernel';
import { Capabilities, hasCapability, requireCapability } from '@cs/rbac';

export const erp1ReadGuard = requireCapability(Capabilities.MODULE_READ);
export const erp1WriteGuard = requireCapability(Capabilities.MODULE_WRITE);

/** Create/load writes may also be executed by the Migration Kit. */
export async function erp1IngestGuard(request: Parameters<typeof erp1WriteGuard>[0]): Promise<void> {
  if (!request.user) {
    throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
  }

  const roles = request.user.roles ?? [];
  if (
    !hasCapability(roles, Capabilities.MODULE_WRITE) &&
    !hasCapability(roles, Capabilities.KIT_RUN)
  ) {
    throw new AppError(
      'FORBIDDEN',
      "Access denied. Required capability: 'module.write' or 'kit.run'",
      403
    );
  }
}
