/**
 * ERP-2 Vendors & Purchasing Module Definition & Public Exports
 *
 * @module erp2
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
export * from './migration/target-adapter.js';
export * from './kit/field-registry.js';
export * from './routes/index.js';
export * from './domain/index.js';
export * from './client.js';

export const moduleDefinition = {
  id: 'erp2',
  name: 'Vendors & Purchasing',
  version: '1.0.0',
  description: 'Vendor management, purchase orders, duplicate detection, and migration ingest',
  routes: erpVendorsRoutes,
  resolver: erp2Resolver,
};

export const erp2Descriptor = moduleDefinition;
