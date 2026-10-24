/**
 * ERP-5 HR and Employees — Web Migration Kit Metadata (KIT-14 / H2 / ERP5-22)
 *
 * Supplies ERP-5's target schema metadata to the shared Migration Kit wizard.
 * Strictly adheres to the "Zero duplicate wizards" architecture rule (H2).
 *
 * @module erp5/web/kit-metadata
 */

import type { ModuleKitMetadata } from '@cs/kit';
import {
  erp5KitMetadata,
  erp5DepartmentsMetadata,
  erp5EmployeesMetadata,
  erp5LeaveMetadata,
  erp5PayrollTotalsMetadata,
  erp5DepartmentsFields,
  erp5EmployeesFields,
  erp5LeaveFields,
  erp5PayrollTotalsFields,
} from '../../src/kit/field-registry.js';

export {
  erp5KitMetadata,
  erp5DepartmentsMetadata,
  erp5EmployeesMetadata,
  erp5LeaveMetadata,
  erp5PayrollTotalsMetadata,
  erp5DepartmentsFields,
  erp5EmployeesFields,
  erp5LeaveFields,
  erp5PayrollTotalsFields,
};

// Auto-register with the shared MigrationKitRegistry on module evaluation.
import { registerModuleKitMetadata } from '@cs/kit';
registerModuleKitMetadata(erp5KitMetadata);
