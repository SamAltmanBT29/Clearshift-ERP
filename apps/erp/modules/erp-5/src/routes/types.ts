/**
 * ERP-5 HR & Employees — Shared Route Options
 *
 * Every route plugin of the module receives the same dependency: the domain
 * service. The type lives in its own file so the route plugins do not have to
 * import each other for a type.
 *
 * @module erp5/routes/types
 */

import type { HrService } from '../services/hr.service.js';

export interface HrRouteOptions {
  hrService: HrService;
}
