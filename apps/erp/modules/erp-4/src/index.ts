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
export * from './routes/index.js';
export * from './routes/guard.js';
export * from './interface/authz.js';

