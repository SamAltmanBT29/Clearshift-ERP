/**
 * ERP-1 Products & Inventory — Domain Service
 *
 * Coordinates business operations, transactions, and invariants across
 * Products, Categories, Warehouses, and Stock levels.
 *
 * @module erp1/services/erp1.service
 */

import type { ReferenceResolver } from '@cs/kernel';
import type {
  Category,
  Warehouse,
  Product,
  StockLevel,
  ProductLinkedRecords,
  ProductListQuery,
  CreateProductInput,
  UpdateProductInput,
  CreateCategoryInput,
  UpdateCategoryInput,
  SetOpeningStockInput,
} from '@clearshift/contracts';
import type { Erp1Repository } from './repository.js';
import {
  validateUnitOfMeasure,
  validateCurrency,
  validateStockNonNegative,
  validateDecimalPrice,
  validateCategoryHierarchy,
  Erp1DomainError,
} from '../domain/rules.js';

export interface Erp1ServiceOptions {
  repository: Erp1Repository;
  referenceResolver?: ReferenceResolver | undefined;
}

export class Erp1Service {
  readonly repository: Erp1Repository;
  readonly referenceResolver?: ReferenceResolver | undefined;

  constructor(options: Erp1ServiceOptions) {
    this.repository = options.repository;
    this.referenceResolver = options.referenceResolver;
  }

  // ── Categories ─────────────────────────────────────────────────────────────

  async listCategories(): Promise<Category[]> {
    return this.repository.listCategories();
  }

  async getCategoryById(id: string): Promise<Category | null> {
    return this.repository.getCategoryById(id);
  }

  async createCategory(input: CreateCategoryInput & { id?: string }): Promise<Category> {
    // Check hierarchy: one level only (no parentId supported in V1)
    if ('parentId' in input && input['parentId']) {
      validateCategoryHierarchy(true);
    }
    return this.repository.createCategory(input);
  }

  async updateCategory(id: string, input: UpdateCategoryInput): Promise<Category> {
    const updated = await this.repository.updateCategory(id, input);
    if (!updated) {
      throw new Erp1DomainError(`Category "${id}" not found`, 'CATEGORY_NOT_FOUND', 404, 'id');
    }
    return updated;
  }

  // ── Warehouses ─────────────────────────────────────────────────────────────

  async getDefaultWarehouse(): Promise<Warehouse> {
    return this.repository.getDefaultWarehouse();
  }

  async getWarehouseById(id: string): Promise<Warehouse | null> {
    return this.repository.getWarehouseById(id);
  }

  // ── Products ───────────────────────────────────────────────────────────────

  async listProducts(query: ProductListQuery): Promise<{ items: Product[]; total: number; page: number; pageSize: number }> {
    return this.repository.listProducts(query);
  }

  async getProductById(id: string): Promise<Product> {
    const product = await this.repository.getProductById(id);
    if (!product) {
      throw new Erp1DomainError(`Product "${id}" not found`, 'PRODUCT_NOT_FOUND', 404, 'id');
    }
    return product;
  }

  async createProduct(input: CreateProductInput & { id?: string }): Promise<Product> {
    // Validate unit of measure
    validateUnitOfMeasure(input.unitOfMeasure);

    // Validate currency
    validateCurrency(input.currency);

    // Validate price
    validateDecimalPrice(input.price);

    // Check category exists if provided
    if (input.categoryId) {
      const cat = await this.repository.getCategoryById(input.categoryId);
      if (!cat) {
        throw new Erp1DomainError(`Referenced category "${input.categoryId}" does not exist`, 'CATEGORY_NOT_FOUND', 422, 'categoryId');
      }
    }

    return this.repository.createProduct(input);
  }

  async updateProduct(id: string, input: UpdateProductInput & { sku?: string }): Promise<Product> {
    if (input.unitOfMeasure) {
      validateUnitOfMeasure(input.unitOfMeasure);
    }
    if (input.currency) {
      validateCurrency(input.currency);
    }
    if (input.price !== undefined) {
      validateDecimalPrice(input.price);
    }
    if (input.categoryId) {
      const cat = await this.repository.getCategoryById(input.categoryId);
      if (!cat) {
        throw new Erp1DomainError(`Referenced category "${input.categoryId}" does not exist`, 'CATEGORY_NOT_FOUND', 422, 'categoryId');
      }
    }

    const updated = await this.repository.updateProduct(id, input);
    if (!updated) {
      throw new Erp1DomainError(`Product "${id}" not found`, 'PRODUCT_NOT_FOUND', 404, 'id');
    }
    return updated;
  }

  async getLinkedRecords(id: string): Promise<ProductLinkedRecords> {
    return this.repository.getLinkedRecords(id);
  }

  // ── Stock ──────────────────────────────────────────────────────────────────

  async listStock(query?: { productId?: string; warehouseId?: string }): Promise<StockLevel[]> {
    return this.repository.listStock(query);
  }

  async setOpeningStock(input: SetOpeningStockInput): Promise<StockLevel> {
    // Enforce non-negative stock (BR-ERP1-02)
    validateStockNonNegative(input.quantity);

    // Resolve warehouse: use default if not specified
    let warehouseId = input.warehouseId;
    if (!warehouseId) {
      const defaultWh = await this.repository.getDefaultWarehouse();
      warehouseId = defaultWh.id;
    }

    // Verify product exists
    const prod = await this.repository.getProductById(input.productId);
    if (!prod) {
      throw new Erp1DomainError(`Product "${input.productId}" not found`, 'PRODUCT_NOT_FOUND', 404, 'productId');
    }

    const stockInput: { productId: string; warehouseId: string; quantity: string; notes?: string } = {
      productId: input.productId,
      warehouseId,
      quantity: input.quantity,
    };
    const notes = (input as { notes?: string }).notes;
    if (notes !== undefined) {
      stockInput.notes = notes;
    }
    return this.repository.setOpeningStock(stockInput);
  }
}
