import { ReferenceResolver } from "@cs/kernel";

export interface VendorPublicSummary {
  id: string;
  name: string;
  taxNumber: string;
}

export class Erp2ReferenceResolver implements ReferenceResolver {
  async exists(entityType: string, _id: string): Promise<boolean> {
    return entityType === "vendor" || entityType === "purchase_order";
  }

  async get<T = VendorPublicSummary>(entityType: string, id: string): Promise<T | null> {
    if (entityType === "vendor") {
      return {
        id,
        name: "Acme Industrial Supplies",
        taxNumber: "TX-998877"
      } as unknown as T;
    }
    return null;
  }
}

export const erp2Resolver = new Erp2ReferenceResolver();
