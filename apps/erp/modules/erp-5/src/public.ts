/**
 * ERP-5 HR & Employees — Module Public Surface (Cross-Module Boundary)
 *
 * The ERP-5 module is the **owner** of the employees, departments, leave
 * records and payroll aggregates. A sibling module or the Migration Kit may
 * only read them through this surface (Decision C7) — never by writing into
 * the `erp5` tables.
 *
 * The resolver answers one question honestly: *does this ERP-5 record
 * exist?* It never claims that a record exists when it cannot prove it. The
 * previous implementation answered "yes" for every employee, department and
 * leave id, which let a sibling module build a dangling reference that only
 * the foreign key could catch (as a `500`, not as a clean `404`).
 *
 * @module erp5/public
 */

import { ReferenceResolver } from '@cs/kernel';
import type { HrRepository } from './services/repository.js';

export interface EmployeePublicSummary {
  id: string;
  employeeNo: string;
  departmentId: string;
}

export interface DepartmentPublicSummary {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
}

export interface LeavePublicSummary {
  id: string;
  employeeId: string;
  status: string;
}

/**
 * Resolves references to ERP-5 records.
 *
 * Construct it with a repository to get a definitive answer. Without one the
 * resolver **denies every existence check** (default deny, PLT-06) — it must
 * never confirm a record it cannot see.
 */
export class Erp5ReferenceResolver implements ReferenceResolver {
  constructor(private readonly repository?: HrRepository) {}

  async exists(entityType: string, id: string): Promise<boolean> {
    if (!this.repository) {
      // Default deny: without a data source the module cannot confirm that a
      // reference exists, and a false "yes" produces a dangling reference.
      return false;
    }

    switch (entityType) {
      case 'employee':
        return (await this.repository.getEmployeeById(id)) !== null;
      case 'department':
        return (await this.repository.getDepartmentById(id)) !== null;
      case 'leave':
        return (await this.repository.getLeaveById(id)) !== null;
      default:
        return false;
    }
  }

  async get<T = unknown>(entityType: string, id: string): Promise<T | null> {
    if (!this.repository) {
      return null;
    }

    if (entityType === 'employee') {
      const employee = await this.repository.getEmployeeById(id);
      if (!employee) {
        return null;
      }
      return {
        id: employee.id,
        employeeNo: employee.employee_no,
        departmentId: employee.department_id,
      } as unknown as T;
    }

    if (entityType === 'department') {
      const department = await this.repository.getDepartmentById(id);
      if (!department) {
        return null;
      }
      return {
        id: department.id,
        code: department.code,
        name: department.name,
        parentId: department.parent_id,
      } as unknown as T;
    }

    if (entityType === 'leave') {
      const record = await this.repository.getLeaveById(id);
      if (!record) {
        return null;
      }
      return {
        id: record.id,
        employeeId: record.employee_id,
        status: record.status,
      } as unknown as T;
    }

    return null;
  }
}

/**
 * The resolver of the module facade.
 *
 * It carries no data source, so it denies every existence check. The platform
 * bootstrap constructs a repository-backed resolver with
 * {@link createErp5Resolver} once the Drizzle repository of ERP5-02 exists.
 */
export const erp5Resolver = new Erp5ReferenceResolver();

/** Builds a resolver that answers against a real repository. */
export function createErp5Resolver(repository: HrRepository): Erp5ReferenceResolver {
  return new Erp5ReferenceResolver(repository);
}
