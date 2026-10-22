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

export const moduleDefinition = {
  id: 'erp5',
  schema: 'erp5',
  routePrefix: '/api/v1/erp-hr',
  referenceResolvers: erp5Resolver,
};

export default moduleDefinition;

export * from './public.js';
export * from './app.js';
export * from './domain/rules.js';
export * from './services/errors.js';
export * from './services/hr.service.js';
export * from './services/repository.js';
export * from './routes/index.js';
