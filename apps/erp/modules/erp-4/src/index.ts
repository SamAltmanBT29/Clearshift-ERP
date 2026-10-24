/**
 * @cs/mod-erp4 (ERP-4 Finance & Accounting) — Module Root
 *
 * Public module definition and exports for ERP-4 Finance & Accounting.
 */

import { erp4Resolver } from './public.js';

export const moduleDefinition = {
  id: 'erp4',
  schema: 'erp4',
  routePrefix: '/api/v1/erp-finance',
  referenceResolvers: erp4Resolver,
};

export default moduleDefinition;

export * from './public.js';
export * from './app.js';
export * from './services/finance.service.js';
export * from './services/repository.js';
export * from './services/audit.js';
export * from './policies/index.js';
export * from './plugins/auth.js';
export * from './routes/index.js';
export * from './migration/target-adapter.js';
export {
  assertTenantAccess,
  assertObjectMutationAccess,
  registerEntityTenant,
  entityTenantRegistry,
  authenticateFinanceRequest,
  DISABLED_USER_IDS,
  type FinanceUserContext,
  type TenantScopedEntity,
  type UserScopedEntity,
} from './interface/authz.js';

