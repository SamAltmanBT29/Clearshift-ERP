/**
 * ERP-5 HR & Employees — Routes Plugin Index
 *
 * Exposes the V1 write endpoints of the module under the approved API base
 * path `/api/v1/erp-hr`:
 *
 *   POST  /employees
 *   PATCH /employees/{id}
 *   POST  /departments
 *   PATCH /departments/{id}
 *   POST  /leave
 *   POST  /payroll-totals
 *
 * The list/read endpoints are owned by **ERP5-02** (issue #47); this plugin
 * registers only the mutation slice so the two issues do not duplicate work.
 *
 * @module erp5/routes
 */

import type { FastifyPluginAsync } from 'fastify';
import type { HrService } from '../services/hr.service.js';
import { employeesRoutes } from './employees.js';
import { departmentsRoutes } from './departments.js';
import { leaveRoutes } from './leave.js';
import { payrollTotalsRoutes } from './payroll-totals.js';

export interface ErpHrRoutesOptions {
  hrService: HrService;
}

export const erpHrRoutes: FastifyPluginAsync<ErpHrRoutesOptions> = async (fastify, opts) => {
  const childOpts = { hrService: opts.hrService };
  await fastify.register(employeesRoutes, childOpts);
  await fastify.register(departmentsRoutes, childOpts);
  await fastify.register(leaveRoutes, childOpts);
  await fastify.register(payrollTotalsRoutes, childOpts);
};

export { employeesRoutes, departmentsRoutes, leaveRoutes, payrollTotalsRoutes };
