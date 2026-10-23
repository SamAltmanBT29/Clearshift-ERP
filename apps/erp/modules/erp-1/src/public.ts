/**
 * ERP-1 Products & Inventory — Public Reference Resolver
 *
 * Sibling modules resolve ERP-1 references through this port instead of
 * reading the `erp1` tables directly (Decision C7). The resolver is backed by
 * the module repository; it never fabricates a product record.
 *
 * @module erp1/public
 */

import type { ReferenceResolver } from '@cs/kernel';
import type { Erp1Repository } from './services/repository.js';

export interface ProductPublicSummary {
  id: string;
  sku: string;
  normalizedSku: string;
  price: string;
  unitOfMeasure: string;
}

export interface PublicReferenceSummary {
  id: string;
  name: string;
  code: string;
}

export class Erp1ReferenceResolver implements ReferenceResolver {
  constructor(private readonly repository?: Erp1Repository) {}

  async exists(entityType: string, id: string): Promise<boolean> {
    return (await this.get(entityType, id)) !== null;
  }

  async get<T = ProductPublicSummary>(entityType: string, id: string): Promise<T | null> {
    if (!this.repository) return null;

    if (entityType === 'product') {
      const product = await this.repository.getProductById(id);
      if (!product) return null;
      return {
        id: product.id,
        sku: product.sku,
        normalizedSku: product.normalizedSku,
        price: product.price,
        unitOfMeasure: product.unitOfMeasure,
      } as T;
    }

    if (entityType === 'category') {
      const category = await this.repository.getCategoryById(id);
      if (!category) return null;
      return {
        id: category.id,
        name: category.name,
        code: category.code,
      } as T;
    }

    if (entityType === 'warehouse') {
      const warehouse = await this.repository.getWarehouseById(id);
      if (!warehouse) return null;
      return {
        id: warehouse.id,
        name: warehouse.name,
        code: warehouse.code,
      } as T;
    }

    return null;
  }
}

/**
 * The default resolver is intentionally empty. A deployment wires the real
 * resolver to the module repository through `createErp1Resolver`.
 */
export const erp1Resolver = new Erp1ReferenceResolver();

export function createErp1Resolver(repository: Erp1Repository): Erp1ReferenceResolver {
  return new Erp1ReferenceResolver(repository);
}
