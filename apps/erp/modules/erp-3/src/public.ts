import { ReferenceResolver } from "@cs/kernel";

export interface SalesOrderPublicSummary {
  id: string;
  orderNumber: string;
  customerGoldenId: string;
  total: string;
}

export class Erp3ReferenceResolver implements ReferenceResolver {
  async exists(entityType: string, _id: string): Promise<boolean> {
    return entityType === "sales_order" || entityType === "invoice" || entityType === "payment";
  }

  async get<T = SalesOrderPublicSummary>(entityType: string, id: string): Promise<T | null> {
    if (entityType === "sales_order") {
      return {
        id,
        orderNumber: "SO-9001",
        customerGoldenId: "gid-1234",
        total: "1500.00"
      } as unknown as T;
    }
    return null;
  }
}

export const erp3Resolver = new Erp3ReferenceResolver();
