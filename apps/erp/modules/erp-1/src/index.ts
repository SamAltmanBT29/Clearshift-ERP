/**
 * @cs/mod-erp1 (ERP-1 Products & Inventory) — Module Root
 *
 * @module @cs/mod-erp1
 */

import { createErp1Resolver, erp1Resolver } from './public.js';
import { erp1KitMetadata } from './kit/field-registry.js';

export * from './kit/field-registry.js';
export * from './kit/rejection-context.js';
export * from './migration/dirty-data-plan.js';
export * from './migration/profiling-config.js';

export const moduleDefinition = {
  id: 'erp1',
  schema: 'erp1',
  routePrefix: '/api/v1/erp-products',
  referenceResolvers: erp1Resolver,
  migrationMetadata: erp1KitMetadata,
};

export default moduleDefinition;

export * from './public.js';
export * from './app.js';
export * from './domain/rules.js';
export * from './domain/relationships.js';
export * from './domain/duplicate-policy.js';
export * from './services/errors.js';
export * from './services/erp1.service.js';
export * from './services/repository.js';
export * from './routes/index.js';
export * from './migration/target-adapter.js';
export * from '../db/import-receipts.js';

/**
 * Creates a module definition whose reference resolver is backed by the
 * supplied repository. The platform bootstrap uses this form so sibling
 * modules see persisted ERP-1 data.
 */
export function createErp1ModuleDefinition<R extends Parameters<typeof createErp1Resolver>[0]>(
  repository: R
) {
  return {
    ...moduleDefinition,
    referenceResolvers: createErp1Resolver(repository),
  };
}

export { createErp1Resolver };

/** Drizzle-backed repository for the platform bootstrap. */
export { DrizzleErp1Repository } from '../db/repository.js';
