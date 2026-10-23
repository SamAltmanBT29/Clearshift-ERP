/**
 * ERP-2 Vendors & Purchasing — Module Entrypoint
 *
 * @module @cs/mod-erp2
 */

import { erp2Resolver } from './public.js';
import { erpVendorsRoutes } from './routes/index.js';

export * from './public.js';
export * from './app.js';
export * from './services/repository.js';
export * from './services/vendor.service.js';
export * from './services/purchase-order.service.js';
export * from './services/erp2.service.js';
export * from './services/audit.js';
export { maskSalary, sanitizeForLogging } from './policies/field-masking.js';
export * from './policies/rbac.js';
export * from './policies/status-transitions.js';
export * from './plugins/auth.js';
export * from './routes/index.js';
export * from './migration/target-adapter.js';
export * from './domain/index.js';
export * from './client.js';

export const moduleDefinition = {
  id: 'erp2',
  schema: 'erp2',
  routePrefix: '/api/v1/erp-vendors',
  referenceResolvers: erp2Resolver,
  routes: erpVendorsRoutes,
};

export const erp2Descriptor = moduleDefinition;

export default moduleDefinition;
