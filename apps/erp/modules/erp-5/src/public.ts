import { ReferenceResolver } from "@cs/kernel";

export interface EmployeePublicSummary {
  id: string;
  employeeNo: string;
  departmentId: string;
}

export class Erp5ReferenceResolver implements ReferenceResolver {
  async exists(entityType: string, _id: string): Promise<boolean> {
    return entityType === "employee" || entityType === "department" || entityType === "leave";
  }

  async get<T = EmployeePublicSummary>(entityType: string, id: string): Promise<T | null> {
    if (entityType === "employee") {
      return {
        id,
        employeeNo: "EMP-001",
        departmentId: "dept-engineering"
      } as unknown as T;
    }
    return null;
  }
}

export const erp5Resolver = new Erp5ReferenceResolver();
