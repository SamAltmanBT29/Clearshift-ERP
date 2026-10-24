/**
 * @cs/mod-erp5 (ERP-5 HR & Employees) — Module Root
 *
 * Public module definition and exports for ERP-5 HR & Employees.
 *
 * The write surface of the module (issue #48) is exported here so the
 * platform bootstrap can mount it. The list/read surface is owned by
 * ERP5-02 (issue #47) and is added on top of this facade.
 */

import { erp5Resolver } from './public.js';
import { erp5KitMetadata } from './kit/field-registry.js';

export const moduleDefinition = {
  id: 'erp5',
  schema: 'erp5',
  routePrefix: '/api/v1/erp-hr',
  referenceResolvers: erp5Resolver,
  migrationMetadata: erp5KitMetadata,
};

export default moduleDefinition;

export * from './kit/field-registry.js';
export * from './kit/rejection-context.js';
export * from './public.js';
export * from './app.js';
export * from './auth/authenticate.js';
export * from './domain/rules.js';
export * from './domain/relationships.js';
export * from './policies/permissions.js';
export * from './policies/guard.js';
export * from './services/errors.js';
export * from './services/hr.service.js';
export * from './services/repository.js';
export * from './routes/index.js';

/**
 * The Drizzle implementation of the repository contract (ERP5-02).
 *
 * It is exported so the platform bootstrap can mount the module against
 * PostgreSQL:
 *
 * ```ts
 * import { DrizzleHrRepository, buildHrApp } from '@cs/mod-erp5';
 * import { getDatabase } from '@cs/db';
 *
 * const app = buildHrApp({ repository: new DrizzleHrRepository(getDatabase()) });
 * ```
 */
export { DrizzleHrRepository } from '../db/repository.js';
