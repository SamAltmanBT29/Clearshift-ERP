/**
 * ERP-5 HR & Employees — Routes Plugin Index
 *
 * Exposes the V1 endpoints of the module under the approved API base path
 * `/api/v1/erp-hr`:
 *
 *   GET   /employees        POST  /employees
 *   GET   /employees/{id}   PATCH /employees/{id}
 *   GET   /departments      POST  /departments
 *   GET   /departments/{id} PATCH /departments/{id}
 *   GET   /leave            POST  /leave
 *   GET   /leave/{id}       PATCH /leave/{id}
 *   GET   /payroll-totals   POST  /payroll-totals
 *   GET   /payroll-totals/{id}
 *   GET   /identity-users
 *
 * @module erp5/routes
 */

import type { FastifyPluginAsync } from 'fastify';
import type { HrService } from '../services/hr.service.js';
import { employeesRoutes } from './employees.js';
import { departmentsRoutes } from './departments.js';
import { identityUsersRoutes } from './identity-users.js';
import { leaveRoutes } from './leave.js';
import { payrollTotalsRoutes } from './payroll-totals.js';
import { importRoutes } from './import.js';

export interface ErpHrRoutesOptions {
  hrService: HrService;
}

export const erpHrRoutes: FastifyPluginAsync<ErpHrRoutesOptions> = async (fastify, opts) => {
  const childOpts = { hrService: opts.hrService };
  await fastify.register(employeesRoutes, childOpts);
  await fastify.register(departmentsRoutes, childOpts);
  await fastify.register(leaveRoutes, childOpts);
  await fastify.register(payrollTotalsRoutes, childOpts);
  await fastify.register(identityUsersRoutes, childOpts);
  await fastify.register(importRoutes, childOpts);
};

export {
  employeesRoutes,
  departmentsRoutes,
  identityUsersRoutes,
  leaveRoutes,
  payrollTotalsRoutes,
  importRoutes,
};
