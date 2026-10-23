/**
 * ERP-1 Products & Inventory — Repository Interfaces & Implementations
 *
 * Provides:
 *   - Erp1Repository interface for domain data access
 *   - InMemoryErp1Repository for hermetic, fast in-process tests & seeding
 *   - DrizzleErp1Repository for production PostgreSQL database persistence
 *
 * @module erp1/services/repository
 */

import { randomUUID } from 'node:crypto';
import { eq, sql, desc, asc, and, or, ilike } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  normalizeSku,
  type Category,
  type Warehouse,
  type Product,
  type StockLevel,
  type ProductLinkedRecords,
  type ProductListQuery,
  type CreateProductInput,
  type UpdateProductInput,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from '@clearshift/contracts';
import {
  erp1Categories,
  erp1Warehouses,
  erp1Products,
  erp1StockLevels,
} from '../../db/schema.js';
import { Erp1DomainError } from '../domain/rules.js';

export interface Erp1Repository {
  // Categories
  listCategories(): Promise<Category[]>;
  getCategoryById(id: string): Promise<Category | null>;
  getCategoryByCode(code: string): Promise<Category | null>;
  createCategory(input: CreateCategoryInput & { id?: string }): Promise<Category>;
  updateCategory(id: string, input: UpdateCategoryInput): Promise<Category | null>;

  // Warehouses
  getDefaultWarehouse(): Promise<Warehouse>;
  getWarehouseById(id: string): Promise<Warehouse | null>;
  createWarehouse(input: { name: string; code: string; isDefault?: boolean; id?: string }): Promise<Warehouse>;

  // Products
  listProducts(query: ProductListQuery): Promise<{ items: Product[]; total: number; page: number; pageSize: number }>;
  getProductById(id: string): Promise<Product | null>;
  getProductBySku(sku: string): Promise<Product | null>;
  createProduct(input: CreateProductInput & { id?: string; normalizedSku?: string }): Promise<Product>;
  updateProduct(id: string, input: UpdateProductInput & { sku?: string }): Promise<Product | null>;
  getLinkedRecords(id: string): Promise<ProductLinkedRecords>;

  // Stock
  getStock(productId: string, warehouseId: string): Promise<StockLevel | null>;
  listStock(query?: { productId?: string; warehouseId?: string }): Promise<StockLevel[]>;
  setOpeningStock(input: { productId: string; warehouseId: string; quantity: string; notes?: string | undefined }): Promise<StockLevel>;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Repository (Deterministic fixture & fast integration testing)
// ─────────────────────────────────────────────────────────────────────────────

export class InMemoryErp1Repository implements Erp1Repository {
  private categories: Map<string, Category> = new Map();
  private warehouses: Map<string, Warehouse> = new Map();
  private products: Map<string, Product> = new Map();
  private stockLevels: Map<string, StockLevel> = new Map(); // key: `${productId}:${warehouseId}`

  constructor(seedDefaultWarehouseAndCategory: boolean = true) {
    if (seedDefaultWarehouseAndCategory) {
      const now = new Date().toISOString();
      const defaultWarehouse: Warehouse = {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Main Distribution Center',
        code: 'WH-01',
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      };
      this.warehouses.set(defaultWarehouse.id, defaultWarehouse);

      const defaultCategory: Category = {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'General Goods',
        code: 'GEN',
        createdAt: now,
        updatedAt: now,
      };
      this.categories.set(defaultCategory.id, defaultCategory);
    }
  }

  async listCategories(): Promise<Category[]> {
    return Array.from(this.categories.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getCategoryById(id: string): Promise<Category | null> {
    return this.categories.get(id) ?? null;
  }

  async getCategoryByCode(code: string): Promise<Category | null> {
    const normalized = code.trim().toUpperCase();
    for (const cat of this.categories.values()) {
      if (cat.code.trim().toUpperCase() === normalized) return cat;
    }
    return null;
  }

  async createCategory(input: { name: string; code: string; id?: string }): Promise<Category> {
    const existing = await this.getCategoryByCode(input.code);
    if (existing) {
      throw new Erp1DomainError(`Category with code ${input.code} already exists`, 'DUPLICATE_CATEGORY_CODE', 409, 'code');
    }
    const now = new Date().toISOString();
    const cat: Category = {
      id: input.id ?? randomUUID(),
      name: input.name.trim(),
      code: input.code.trim().toUpperCase(),
      createdAt: now,
      updatedAt: now,
    };
    this.categories.set(cat.id, cat);
    return cat;
  }

  async updateCategory(id: string, input: UpdateCategoryInput): Promise<Category | null> {
    const cat = this.categories.get(id);
    if (!cat) return null;
    if (input.code) {
      const existing = await this.getCategoryByCode(input.code);
      if (existing && existing.id !== id) {
        throw new Erp1DomainError(`Category with code ${input.code} already exists`, 'DUPLICATE_CATEGORY_CODE', 409, 'code');
      }
    }
    const updated: Category = {
      ...cat,
      name: input.name ? input.name.trim() : cat.name,
      code: input.code ? input.code.trim().toUpperCase() : cat.code,
      updatedAt: new Date().toISOString(),
    };
    this.categories.set(id, updated);
    return updated;
  }

  async getDefaultWarehouse(): Promise<Warehouse> {
    for (const wh of this.warehouses.values()) {
      if (wh.isDefault) return wh;
    }
    const first = this.warehouses.values().next().value;
    if (first) return first;
    const now = new Date().toISOString();
    const created: Warehouse = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Default Warehouse',
      code: 'WH-01',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    };
    this.warehouses.set(created.id, created);
    return created;
  }

  async getWarehouseById(id: string): Promise<Warehouse | null> {
    return this.warehouses.get(id) ?? null;
  }

  async createWarehouse(input: { name: string; code: string; isDefault?: boolean; id?: string }): Promise<Warehouse> {
    const now = new Date().toISOString();
    const wh: Warehouse = {
      id: input.id ?? randomUUID(),
      name: input.name.trim(),
      code: input.code.trim().toUpperCase(),
      isDefault: input.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.warehouses.set(wh.id, wh);
    return wh;
  }

  async listProducts(query: ProductListQuery): Promise<{ items: Product[]; total: number; page: number; pageSize: number }> {
    let prods = Array.from(this.products.values());

    if (query.search) {
      const s = query.search.trim().toLowerCase();
      prods = prods.filter((p) => p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s));
    }
    if (query.categoryId) {
      prods = prods.filter((p) => p.categoryId === query.categoryId);
    }
    if (query.unitOfMeasure) {
      prods = prods.filter((p) => p.unitOfMeasure === query.unitOfMeasure);
    }
    if (query.minPrice) {
      const min = parseFloat(query.minPrice);
      prods = prods.filter((p) => parseFloat(p.price) >= min);
    }
    if (query.maxPrice) {
      const max = parseFloat(query.maxPrice);
      prods = prods.filter((p) => parseFloat(p.price) <= max);
    }

    const defaultWarehouse = await this.getDefaultWarehouse();

    if (query.stockStatus && query.stockStatus !== 'all') {
      if (query.stockStatus === 'in_stock') {
        prods = prods.filter((p) => {
          const s = this.stockLevels.get(`${p.id}:${defaultWarehouse.id}`);
          return s ? parseFloat(s.quantity) > 0 : false;
        });
      } else if (query.stockStatus === 'out_of_stock') {
        prods = prods.filter((p) => {
          const s = this.stockLevels.get(`${p.id}:${defaultWarehouse.id}`);
          return !s || parseFloat(s.quantity) === 0;
        });
      } else if (query.stockStatus === 'low_stock') {
        prods = prods.filter((p) => {
          const s = this.stockLevels.get(`${p.id}:${defaultWarehouse.id}`);
          const q = s ? parseFloat(s.quantity) : 0;
          return q > 0 && q < 10;
        });
      }
    }

    // Sort
    const sortBy = query.sortBy ?? 'createdAt';
    const sortDir = query.sortDirection ?? 'desc';
    prods.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'sku') cmp = a.sku.localeCompare(b.sku);
      else if (sortBy === 'price') cmp = parseFloat(a.price) - parseFloat(b.price);
      else if (sortBy === 'quantity') {
        const sa = this.stockLevels.get(`${a.id}:${defaultWarehouse.id}`);
        const sb = this.stockLevels.get(`${b.id}:${defaultWarehouse.id}`);
        cmp = parseFloat(sa?.quantity ?? '0') - parseFloat(sb?.quantity ?? '0');
      } else cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sortDir === 'asc' ? cmp : -cmp;
    });

    const total = prods.length;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const start = (page - 1) * pageSize;
    const items = prods.slice(start, start + pageSize).map((p) => {
      const cat = p.categoryId ? this.categories.get(p.categoryId) : undefined;
      const stock = this.stockLevels.get(`${p.id}:${defaultWarehouse.id}`);
      return {
        ...p,
        categoryName: cat?.name ?? null,
        warehouseId: defaultWarehouse.id,
        warehouseName: defaultWarehouse.name,
        quantity: stock ? stock.quantity : '0.0000',
      };
    });

    return { items, total, page, pageSize };
  }

  async getProductById(id: string): Promise<Product | null> {
    return this.products.get(id) ?? null;
  }

  async getProductBySku(sku: string): Promise<Product | null> {
    const normalized = normalizeSku(sku);
    for (const p of this.products.values()) {
      if (p.normalizedSku === normalized || normalizeSku(p.sku) === normalized) {
        return p;
      }
    }
    return null;
  }

  async createProduct(input: CreateProductInput & { id?: string; normalizedSku?: string }): Promise<Product> {
    const normalized = input.normalizedSku ?? normalizeSku(input.sku);
    const existing = await this.getProductBySku(normalized);
    if (existing) {
      throw new Erp1DomainError(
        `Product with SKU "${input.sku}" already exists in the database (BR-ERP1-01)`,
        'DUPLICATE_SKU',
        409,
        'sku'
      );
    }

    if (input.categoryId) {
      const cat = await this.getCategoryById(input.categoryId);
      if (!cat) {
        throw new Erp1DomainError(`Referenced category "${input.categoryId}" does not exist`, 'CATEGORY_NOT_FOUND', 422, 'categoryId');
      }
    }

    const now = new Date().toISOString();
    const product: Product = {
      id: input.id ?? randomUUID(),
      name: input.name.trim(),
      sku: input.sku.trim(),
      normalizedSku: normalized,
      categoryId: input.categoryId ?? null,
      unitOfMeasure: input.unitOfMeasure,
      price: input.price,
      currency: input.currency,
      taxRate: input.taxRate ?? '0.00',
      notificationEmail: input.notificationEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      sourceSystem: input.sourceSystem ?? null,
      sourceId: input.sourceId ?? null,
      goldenId: null,
      createdAt: now,
      updatedAt: now,
    };

    this.products.set(product.id, product);
    return product;
  }

  async updateProduct(id: string, input: UpdateProductInput & { sku?: string }): Promise<Product | null> {
    const prod = this.products.get(id);
    if (!prod) return null;

    let normalized = prod.normalizedSku;
    let sku = prod.sku;
    if (input.sku) {
      sku = input.sku.trim();
      normalized = normalizeSku(sku);
      const existing = await this.getProductBySku(normalized);
      if (existing && existing.id !== id) {
        throw new Erp1DomainError(
          `Product with SKU "${sku}" already exists in the database (BR-ERP1-01)`,
          'DUPLICATE_SKU',
          409,
          'sku'
        );
      }
    }

    if (input.categoryId !== undefined && input.categoryId !== null) {
      const cat = await this.getCategoryById(input.categoryId);
      if (!cat) {
        throw new Erp1DomainError(`Referenced category "${input.categoryId}" does not exist`, 'CATEGORY_NOT_FOUND', 422, 'categoryId');
      }
    }

    const now = new Date().toISOString();
    const updated: Product = {
      ...prod,
      name: input.name !== undefined ? input.name.trim() : prod.name,
      sku,
      normalizedSku: normalized,
      categoryId: input.categoryId !== undefined ? input.categoryId : prod.categoryId,
      unitOfMeasure: input.unitOfMeasure !== undefined ? input.unitOfMeasure : prod.unitOfMeasure,
      price: input.price !== undefined ? input.price : prod.price,
      currency: input.currency !== undefined ? input.currency : prod.currency,
      taxRate: input.taxRate !== undefined ? (input.taxRate ?? '0.00') : prod.taxRate,
      notificationEmail: input.notificationEmail !== undefined ? input.notificationEmail : prod.notificationEmail,
      contactPhone: input.contactPhone !== undefined ? input.contactPhone : prod.contactPhone,
      updatedAt: now,
    };

    this.products.set(id, updated);
    return updated;
  }

  async getLinkedRecords(id: string): Promise<ProductLinkedRecords> {
    const prod = await this.getProductById(id);
    if (!prod) {
      throw new Erp1DomainError(`Product with id "${id}" not found`, 'PRODUCT_NOT_FOUND', 404, 'id');
    }
    const stockList = await this.listStock({ productId: id });
    const stockLevels = stockList.map((s) => {
      const wh = this.warehouses.get(s.warehouseId);
      return {
        warehouseId: s.warehouseId,
        warehouseCode: wh?.code ?? 'WH-01',
        warehouseName: wh?.name ?? 'Main Distribution Center',
        quantity: s.quantity,
        unitOfMeasure: prod.unitOfMeasure,
        updatedAt: s.updatedAt,
      };
    });

    return {
      productId: id,
      stockLevels,
      purchaseOrders: [],
      salesOrders: [],
    };
  }

  async getStock(productId: string, warehouseId: string): Promise<StockLevel | null> {
    return this.stockLevels.get(`${productId}:${warehouseId}`) ?? null;
  }

  async listStock(query?: { productId?: string; warehouseId?: string }): Promise<StockLevel[]> {
    let list = Array.from(this.stockLevels.values());
    if (query?.productId) {
      list = list.filter((s) => s.productId === query.productId);
    }
    if (query?.warehouseId) {
      list = list.filter((s) => s.warehouseId === query.warehouseId);
    }
    return list;
  }

  async setOpeningStock(input: { productId: string; warehouseId: string; quantity: string; notes?: string | undefined }): Promise<StockLevel> {
    const prod = await this.getProductById(input.productId);
    if (!prod) {
      throw new Erp1DomainError(`Product "${input.productId}" does not exist`, 'PRODUCT_NOT_FOUND', 404, 'productId');
    }
    const wh = await this.getWarehouseById(input.warehouseId);
    if (!wh) {
      throw new Erp1DomainError(`Warehouse "${input.warehouseId}" does not exist`, 'WAREHOUSE_NOT_FOUND', 404, 'warehouseId');
    }

    const qty = parseFloat(input.quantity);
    if (isNaN(qty) || qty < 0) {
      throw new Erp1DomainError('Stock quantity cannot become negative (BR-ERP1-02)', 'NEGATIVE_STOCK', 422, 'quantity');
    }

    const key = `${input.productId}:${input.warehouseId}`;
    const now = new Date().toISOString();
    const existing = this.stockLevels.get(key);

    const stockLevel: StockLevel = {
      id: existing?.id ?? randomUUID(),
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantity: qty.toFixed(4),
      updatedAt: now,
    };

    this.stockLevels.set(key, stockLevel);
    return stockLevel;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Production Drizzle PostgreSQL Repository
// ─────────────────────────────────────────────────────────────────────────────

export class DrizzleErp1Repository implements Erp1Repository {
  constructor(private readonly db: NodePgDatabase<Record<string, unknown>>) {}

  async listCategories(): Promise<Category[]> {
    const rows = await this.db.select().from(erp1Categories).orderBy(asc(erp1Categories.name));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async getCategoryById(id: string): Promise<Category | null> {
    const rows = await this.db.select().from(erp1Categories).where(eq(erp1Categories.id, id)).limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      code: r.code,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async getCategoryByCode(code: string): Promise<Category | null> {
    const rows = await this.db.select().from(erp1Categories).where(eq(erp1Categories.code, code.trim().toUpperCase())).limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      code: r.code,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async createCategory(input: { name: string; code: string; id?: string }): Promise<Category> {
    const existing = await this.getCategoryByCode(input.code);
    if (existing) {
      throw new Erp1DomainError(`Category with code ${input.code} already exists`, 'DUPLICATE_CATEGORY_CODE', 409, 'code');
    }
    const [row] = await this.db
      .insert(erp1Categories)
      .values({
        id: input.id ?? randomUUID(),
        name: input.name.trim(),
        code: input.code.trim().toUpperCase(),
      })
      .returning();
    if (!row) throw new Error('Failed to insert category');
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async updateCategory(id: string, input: UpdateCategoryInput): Promise<Category | null> {
    const cat = await this.getCategoryById(id);
    if (!cat) return null;
    if (input.code) {
      const existing = await this.getCategoryByCode(input.code);
      if (existing && existing.id !== id) {
        throw new Erp1DomainError(`Category with code ${input.code} already exists`, 'DUPLICATE_CATEGORY_CODE', 409, 'code');
      }
    }
    const [row] = await this.db
      .update(erp1Categories)
      .set({
        name: input.name ? input.name.trim() : cat.name,
        code: input.code ? input.code.trim().toUpperCase() : cat.code,
        updatedAt: new Date(),
      })
      .where(eq(erp1Categories.id, id))
      .returning();
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getDefaultWarehouse(): Promise<Warehouse> {
    const rows = await this.db.select().from(erp1Warehouses).where(eq(erp1Warehouses.isDefault, true)).limit(1);
    const r = rows[0];
    if (r) {
      return {
        id: r.id,
        name: r.name,
        code: r.code,
        isDefault: r.isDefault,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    }
    const [created] = await this.db
      .insert(erp1Warehouses)
      .values({
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Default Warehouse',
        code: 'WH-01',
        isDefault: true,
      })
      .returning();
    if (!created) throw new Error('Failed to create default warehouse');
    return {
      id: created.id,
      name: created.name,
      code: created.code,
      isDefault: created.isDefault,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  async getWarehouseById(id: string): Promise<Warehouse | null> {
    const rows = await this.db.select().from(erp1Warehouses).where(eq(erp1Warehouses.id, id)).limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      code: r.code,
      isDefault: r.isDefault,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async createWarehouse(input: { name: string; code: string; isDefault?: boolean; id?: string }): Promise<Warehouse> {
    const [created] = await this.db
      .insert(erp1Warehouses)
      .values({
        id: input.id ?? randomUUID(),
        name: input.name.trim(),
        code: input.code.trim().toUpperCase(),
        isDefault: input.isDefault ?? false,
      })
      .returning();
    if (!created) throw new Error('Failed to create warehouse');
    return {
      id: created.id,
      name: created.name,
      code: created.code,
      isDefault: created.isDefault,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  async listProducts(query: ProductListQuery): Promise<{ items: Product[]; total: number; page: number; pageSize: number }> {
    const conditions = [];
    if (query.search) {
      const s = `%${query.search.trim()}%`;
      conditions.push(or(ilike(erp1Products.name, s), ilike(erp1Products.sku, s)));
    }
    if (query.categoryId) {
      conditions.push(eq(erp1Products.categoryId, query.categoryId));
    }
    if (query.unitOfMeasure) {
      conditions.push(eq(erp1Products.unitOfMeasure, query.unitOfMeasure as any));
    }
    if (query.minPrice) {
      conditions.push(sql`${erp1Products.price} >= ${query.minPrice}`);
    }
    if (query.maxPrice) {
      conditions.push(sql`${erp1Products.price} <= ${query.maxPrice}`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const countRes = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(erp1Products)
      .where(whereClause);
    const total = countRes[0]?.count ?? 0;

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const offset = (page - 1) * pageSize;

    const rows = await this.db
      .select()
      .from(erp1Products)
      .where(whereClause)
      .limit(pageSize)
      .offset(offset)
      .orderBy(desc(erp1Products.createdAt));

    const items: Product[] = rows.map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      normalizedSku: product.normalizedSku,
      categoryId: product.categoryId,
      unitOfMeasure: product.unitOfMeasure as any,
      price: product.price,
      currency: product.currency,
      taxRate: product.taxRate,
      notificationEmail: null,
      contactPhone: null,
      sourceSystem: product.sourceSystem,
      sourceId: product.sourceId,
      goldenId: null,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    }));

    return { items, total, page, pageSize };
  }

  async getProductById(id: string): Promise<Product | null> {
    const rows = await this.db.select().from(erp1Products).where(eq(erp1Products.id, id)).limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      sku: r.sku,
      normalizedSku: r.normalizedSku,
      categoryId: r.categoryId,
      unitOfMeasure: r.unitOfMeasure as any,
      price: r.price,
      currency: r.currency,
      taxRate: r.taxRate,
      notificationEmail: null,
      contactPhone: null,
      sourceSystem: r.sourceSystem,
      sourceId: r.sourceId,
      goldenId: null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async getProductBySku(sku: string): Promise<Product | null> {
    const normalized = normalizeSku(sku);
    const rows = await this.db.select().from(erp1Products).where(eq(erp1Products.normalizedSku, normalized)).limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      sku: r.sku,
      normalizedSku: r.normalizedSku,
      categoryId: r.categoryId,
      unitOfMeasure: r.unitOfMeasure as any,
      price: r.price,
      currency: r.currency,
      taxRate: r.taxRate,
      notificationEmail: null,
      contactPhone: null,
      sourceSystem: r.sourceSystem,
      sourceId: r.sourceId,
      goldenId: null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async createProduct(input: CreateProductInput & { id?: string; normalizedSku?: string }): Promise<Product> {
    const normalized = input.normalizedSku ?? normalizeSku(input.sku);
    const existing = await this.getProductBySku(normalized);
    if (existing) {
      throw new Erp1DomainError(
        `Product with SKU "${input.sku}" already exists in the database (BR-ERP1-01)`,
        'DUPLICATE_SKU',
        409,
        'sku'
      );
    }
    const [r] = await this.db
      .insert(erp1Products)
      .values({
        id: input.id ?? randomUUID(),
        name: input.name.trim(),
        sku: input.sku.trim(),
        normalizedSku: normalized,
        categoryId: input.categoryId ?? null,
        unitOfMeasure: input.unitOfMeasure as any,
        price: input.price,
        currency: input.currency,
        taxRate: input.taxRate ?? '0.00',
        sourceSystem: input.sourceSystem ?? null,
        sourceId: input.sourceId ?? null,
      })
      .returning();
    if (!r) throw new Error('Failed to create product');
    return {
      id: r.id,
      name: r.name,
      sku: r.sku,
      normalizedSku: r.normalizedSku,
      categoryId: r.categoryId,
      unitOfMeasure: r.unitOfMeasure as any,
      price: r.price,
      currency: r.currency,
      taxRate: r.taxRate,
      notificationEmail: input.notificationEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      sourceSystem: r.sourceSystem,
      sourceId: r.sourceId,
      goldenId: null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async updateProduct(id: string, input: UpdateProductInput & { sku?: string }): Promise<Product | null> {
    const prod = await this.getProductById(id);
    if (!prod) return null;

    let normalized = prod.normalizedSku;
    let sku = prod.sku;
    if (input.sku) {
      sku = input.sku.trim();
      normalized = normalizeSku(sku);
      const existing = await this.getProductBySku(normalized);
      if (existing && existing.id !== id) {
        throw new Erp1DomainError(
          `Product with SKU "${sku}" already exists in the database (BR-ERP1-01)`,
          'DUPLICATE_SKU',
          409,
          'sku'
        );
      }
    }

    const categoryId = input.categoryId !== undefined ? input.categoryId : (prod.categoryId ?? null);
    const [r] = await this.db
      .update(erp1Products)
      .set({
        name: input.name !== undefined ? input.name.trim() : prod.name,
        sku,
        normalizedSku: normalized,
        categoryId,
        unitOfMeasure: input.unitOfMeasure !== undefined ? (input.unitOfMeasure as any) : (prod.unitOfMeasure as any),
        price: input.price !== undefined ? input.price : prod.price,
        currency: input.currency !== undefined ? input.currency : prod.currency,
        taxRate: input.taxRate !== undefined ? (input.taxRate ?? '0.00') : prod.taxRate,
        updatedAt: new Date(),
      })
      .where(eq(erp1Products.id, id))
      .returning();
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      sku: r.sku,
      normalizedSku: r.normalizedSku,
      categoryId: r.categoryId,
      unitOfMeasure: r.unitOfMeasure as any,
      price: r.price,
      currency: r.currency,
      taxRate: r.taxRate,
      notificationEmail: input.notificationEmail !== undefined ? input.notificationEmail : prod.notificationEmail,
      contactPhone: input.contactPhone !== undefined ? input.contactPhone : prod.contactPhone,
      sourceSystem: r.sourceSystem,
      sourceId: r.sourceId,
      goldenId: prod.goldenId,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async getLinkedRecords(id: string): Promise<ProductLinkedRecords> {
    const prod = await this.getProductById(id);
    if (!prod) {
      throw new Erp1DomainError(`Product with id "${id}" not found`, 'PRODUCT_NOT_FOUND', 404, 'id');
    }
    const stockList = await this.listStock({ productId: id });
    const stockLevels = stockList.map((s) => ({
      warehouseId: s.warehouseId,
      warehouseCode: 'WH-01',
      warehouseName: 'Main Distribution Center',
      quantity: s.quantity,
      unitOfMeasure: prod.unitOfMeasure,
      updatedAt: s.updatedAt,
    }));

    return {
      productId: id,
      stockLevels,
      purchaseOrders: [],
      salesOrders: [],
    };
  }

  async getStock(productId: string, warehouseId: string): Promise<StockLevel | null> {
    const rows = await this.db
      .select()
      .from(erp1StockLevels)
      .where(and(eq(erp1StockLevels.productId, productId), eq(erp1StockLevels.warehouseId, warehouseId)))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      productId: r.productId,
      warehouseId: r.warehouseId,
      quantity: r.quantity,
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async listStock(query?: { productId?: string; warehouseId?: string }): Promise<StockLevel[]> {
    const conditions = [];
    if (query?.productId) conditions.push(eq(erp1StockLevels.productId, query.productId));
    if (query?.warehouseId) conditions.push(eq(erp1StockLevels.warehouseId, query.warehouseId));
    const rows = await this.db
      .select()
      .from(erp1StockLevels)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      warehouseId: r.warehouseId,
      quantity: r.quantity,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async setOpeningStock(input: { productId: string; warehouseId: string; quantity: string; notes?: string | undefined }): Promise<StockLevel> {
    const qty = parseFloat(input.quantity);
    if (isNaN(qty) || qty < 0) {
      throw new Erp1DomainError('Stock quantity cannot become negative (BR-ERP1-02)', 'NEGATIVE_STOCK', 422, 'quantity');
    }

    const [row] = await this.db
      .insert(erp1StockLevels)
      .values({
        id: randomUUID(),
        productId: input.productId,
        warehouseId: input.warehouseId,
        quantity: qty.toFixed(4),
      })
      .onConflictDoUpdate({
        target: [erp1StockLevels.productId, erp1StockLevels.warehouseId],
        set: {
          quantity: qty.toFixed(4),
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('Failed to update stock level');
    return {
      id: row.id,
      productId: row.productId,
      warehouseId: row.warehouseId,
      quantity: row.quantity,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
