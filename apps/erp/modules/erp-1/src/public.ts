import { ReferenceResolver } from "@cs/kernel";

export interface ProductPublicSummary {
  id: string;
  sku: string;
  normalizedSku: string;
  price: string;
  unitOfMeasure: string;
}

export class Erp1ReferenceResolver implements ReferenceResolver {
  async exists(entityType: string, _id: string): Promise<boolean> {
    return entityType === "product" || entityType === "category" || entityType === "warehouse";
  }

  async get<T = ProductPublicSummary>(entityType: string, id: string): Promise<T | null> {
    if (entityType === "product") {
      return {
        id,
        sku: "PROD-101",
        normalizedSku: "PROD-101",
        price: "199.99",
        unitOfMeasure: "pcs"
      } as unknown as T;
    }
    return null;
  }
}

export const erp1Resolver = new Erp1ReferenceResolver();
