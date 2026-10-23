/**
 * ERP-1 Products & Inventory — Repository Contract and In-Memory Store
 *
 * The service layer talks to this contract, never to SQL directly. The
 * production Drizzle implementation lives in `db/repository.ts`; the
 * in-memory implementation below backs the fast API tests.
 *
 * @module erp1/services/repository
 */

import { createHash, randomUUID } from 'node:crypto';
import type {
  Category,
  CategoryListQuery,
  Product,
  ProductListQuery,
  StockLevel,
  StockLevelListQuery,
  Warehouse,
} from '@clearshift/contracts';

/** Deterministically canonicalizes a JSON structure (keys sorted recursively). */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`)
    .join(',')}}`;
}

/** SHA-256 hash used to detect idempotency-key reuse with another payload. */
export function computeRequestHash(payload: unknown): string {
  return createHash('sha256').update(canonicalizeJson(payload)).digest('hex');
}

export interface NewErp1Category {
  id?: string;
  name: string;
  code: string;
}

export type Erp1CategoryUpdates = Partial<Pick<Category, 'name' | 'code'>>;

export interface NewErp1Product {
  id?: string;
  name: string;
  sku: string;
  normalizedSku: string;
  categoryId?: string | null;
  unitOfMeasure: Product['unitOfMeasure'];
  price: string;
  currency: string;
  taxRate: string;
  sourceSystem?: string | null;
  sourceId?: string | null;
}

export type Erp1ProductUpdates = Partial<
  Pick<
    Product,
    | 'name'
    | 'sku'
    | 'normalizedSku'
    | 'categoryId'
    | 'unitOfMeasure'
    | 'price'
    | 'currency'
    | 'taxRate'
  >
>;

export interface NewErp1StockLevel {
  id?: string;
  productId: string;
  warehouseId: string;
  quantity: string;
}

export interface NewErp1ImportReceipt {
  id?: string;
  batchId: string;
  sourceRow: number;
  targetId: string;
  targetEntity: string;
  idempotencyKey: string;
  requestHash: string;
  sourceSystem?: string | null;
  sourceId?: string | null;
  outcome?: string;
  responsePayload?: string | null;
}

export interface Erp1ImportReceipt {
  id: string;
  batchId: string;
  sourceRow: number;
  targetId: string;
  targetEntity: string;
  idempotencyKey: string;
  requestHash: string;
  sourceSystem: string | null;
  sourceId: string | null;
  outcome: string;
  responsePayload: string | null;
  createdAt: string;
}

export interface Erp1Page<T> {
  items: T[];
  total: number;
}

export interface Erp1Repository {
  // Products
  listProducts(query: ProductListQuery): Promise<Erp1Page<Product>>;
  getProductById(id: string): Promise<Product | null>;
  getProductBySku(sku: string): Promise<Product | null>;
  getProductByNormalizedSku(normalizedSku: string): Promise<Product | null>;
  createProduct(data: NewErp1Product): Promise<Product>;
  updateProduct(id: string, updates: Erp1ProductUpdates): Promise<Product>;

  // Categories
  listCategories(query: CategoryListQuery): Promise<Erp1Page<Category>>;
  getCategoryById(id: string): Promise<Category | null>;
  getCategoryByCode(code: string): Promise<Category | null>;
  createCategory(data: NewErp1Category): Promise<Category>;
  updateCategory(id: string, updates: Erp1CategoryUpdates): Promise<Category>;

  // Warehouse (one default warehouse in V1)
  getWarehouseById(id: string): Promise<Warehouse | null>;
  getDefaultWarehouse(): Promise<Warehouse | null>;

  // Stock
  listStockLevels(query: StockLevelListQuery): Promise<Erp1Page<StockLevel>>;
  getStockLevelById(id: string): Promise<StockLevel | null>;
  getStockLevel(productId: string, warehouseId: string): Promise<StockLevel | null>;
  upsertStockLevel(data: NewErp1StockLevel): Promise<StockLevel>;

  // Durable import receipts
  getImportReceiptByKey(key: string): Promise<Erp1ImportReceipt | null>;
  createImportReceipt(receipt: NewErp1ImportReceipt): Promise<Erp1ImportReceipt>;

  // Atomic boundary: target mutation + receipt commit or roll back together.
  transaction<T>(work: (tx: Erp1Repository) => Promise<T>): Promise<T>;
}

export const ERP1_DEFAULT_CATEGORY_ID = '00000000-0000-4000-8000-000000000001';
export const ERP1_DEFAULT_WAREHOUSE_ID = '00000000-0000-4000-8000-000000000002';

interface Erp1Store {
  categories: Map<string, Category>;
  products: Map<string, Product>;
  warehouses: Map<string, Warehouse>;
  stockLevels: Map<string, StockLevel>;
  receipts: Map<string, Erp1ImportReceipt>;
}

function emptyStore(): Erp1Store {
  return {
    categories: new Map(),
    products: new Map(),
    warehouses: new Map(),
    stockLevels: new Map(),
    receipts: new Map(),
  };
}

function cloneStore(store: Erp1Store): Erp1Store {
  return {
    categories: new Map(store.categories),
    products: new Map(store.products),
    warehouses: new Map(store.warehouses),
    stockLevels: new Map(store.stockLevels),
    receipts: new Map(store.receipts),
  };
}

function compareText(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left < right) return -1;
  if (left > right) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function paginate<T>(rows: T[], page: number, pageSize: number): Erp1Page<T> {
  const offset = (page - 1) * pageSize;
  return { items: rows.slice(offset, offset + pageSize), total: rows.length };
}

export class InMemoryErp1Repository implements Erp1Repository {
  private store: Erp1Store = emptyStore();
  private transactionQueue: Promise<unknown> = Promise.resolve();

  constructor(seed = true) {
    if (seed) {
      this.seedDefaults();
    }
  }

  /** Seeds the one default warehouse and the General category only. */
  seedDefaults(): void {
    const now = new Date().toISOString();
    const category: Category = {
      id: ERP1_DEFAULT_CATEGORY_ID,
      name: 'General',
      code: 'GEN',
      createdAt: now,
      updatedAt: now,
    };
    const warehouse: Warehouse = {
      id: ERP1_DEFAULT_WAREHOUSE_ID,
      name: 'Main Warehouse',
      code: 'WH-01',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    };
    this.store.categories.set(category.id, category);
    this.store.warehouses.set(warehouse.id, warehouse);
  }

  async transaction<T>(work: (tx: Erp1Repository) => Promise<T>): Promise<T> {
    const run = this.transactionQueue.then(async () => {
      const snapshot = cloneStore(this.store);
      try {
        return await work(this);
      } catch (error) {
        this.store = snapshot;
        throw error;
      }
    });

    this.transactionQueue = run.then(
      () => undefined,
      () => undefined
    );

    return run;
  }

  // ── Products ──────────────────────────────────────────────────────────────

  async listProducts(query: ProductListQuery): Promise<Erp1Page<Product>> {
    const search = query.search?.toLowerCase();
    let rows = Array.from(this.store.products.values()).filter((product) => {
      if (query.categoryId !== undefined && product.categoryId !== query.categoryId) {
        return false;
      }
      if (search === undefined || search.length === 0) {
        return true;
      }
      return (
        product.name.toLowerCase().includes(search) ||
        product.sku.toLowerCase().includes(search) ||
        product.normalizedSku.toLowerCase().includes(search)
      );
    });

    rows = rows.sort(
      (a, b) => compareText(a.name, b.name) || compareText(a.id, b.id)
    );
    return paginate(rows, query.page, query.pageSize);
  }

  async getProductById(id: string): Promise<Product | null> {
    return this.store.products.get(id) ?? null;
  }

  async getProductBySku(sku: string): Promise<Product | null> {
    for (const product of this.store.products.values()) {
      if (product.sku === sku) return product;
    }
    return null;
  }

  async getProductByNormalizedSku(normalizedSku: string): Promise<Product | null> {
    for (const product of this.store.products.values()) {
      if (product.normalizedSku === normalizedSku) return product;
    }
    return null;
  }

  async createProduct(data: NewErp1Product): Promise<Product> {
    const now = new Date().toISOString();
    const product: Product = {
      id: data.id ?? randomUUID(),
      name: data.name,
      sku: data.sku,
      normalizedSku: data.normalizedSku,
      categoryId: data.categoryId ?? null,
      unitOfMeasure: data.unitOfMeasure,
      price: data.price,
      currency: data.currency,
      taxRate: data.taxRate,
      sourceSystem: data.sourceSystem ?? null,
      sourceId: data.sourceId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.products.set(product.id, product);
    return { ...product };
  }

  async updateProduct(id: string, updates: Erp1ProductUpdates): Promise<Product> {
    const existing = this.store.products.get(id);
    if (!existing) {
      throw new Error(`Product ${id} not found`);
    }
    const updated: Product = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.store.products.set(id, updated);
    return { ...updated };
  }

  // ── Categories ────────────────────────────────────────────────────────────

  async listCategories(query: CategoryListQuery): Promise<Erp1Page<Category>> {
    const search = query.search?.toLowerCase();
    const rows = Array.from(this.store.categories.values())
      .filter((category) => {
        if (search === undefined || search.length === 0) return true;
        return (
          category.name.toLowerCase().includes(search) ||
          category.code.toLowerCase().includes(search)
        );
      })
      .sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id));

    return paginate(rows, query.page, query.pageSize);
  }

  async getCategoryById(id: string): Promise<Category | null> {
    return this.store.categories.get(id) ?? null;
  }

  async getCategoryByCode(code: string): Promise<Category | null> {
    const normalized = code.trim().toLowerCase();
    for (const category of this.store.categories.values()) {
      if (category.code.toLowerCase() === normalized) return category;
    }
    return null;
  }

  async createCategory(data: NewErp1Category): Promise<Category> {
    const now = new Date().toISOString();
    const category: Category = {
      id: data.id ?? randomUUID(),
      name: data.name,
      code: data.code,
      createdAt: now,
      updatedAt: now,
    };
    this.store.categories.set(category.id, category);
    return { ...category };
  }

  async updateCategory(id: string, updates: Erp1CategoryUpdates): Promise<Category> {
    const existing = this.store.categories.get(id);
    if (!existing) {
      throw new Error(`Category ${id} not found`);
    }
    const updated: Category = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.store.categories.set(id, updated);
    return { ...updated };
  }

  // ── Warehouses ────────────────────────────────────────────────────────────

  async getWarehouseById(id: string): Promise<Warehouse | null> {
    return this.store.warehouses.get(id) ?? null;
  }

  async getDefaultWarehouse(): Promise<Warehouse | null> {
    for (const warehouse of this.store.warehouses.values()) {
      if (warehouse.isDefault) return warehouse;
    }
    return null;
  }

  // ── Stock ─────────────────────────────────────────────────────────────────

  async listStockLevels(query: StockLevelListQuery): Promise<Erp1Page<StockLevel>> {
    const rows = Array.from(this.store.stockLevels.values())
      .filter((level) => {
        if (query.productId !== undefined && level.productId !== query.productId) {
          return false;
        }
        if (query.warehouseId !== undefined && level.warehouseId !== query.warehouseId) {
          return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          compareText(a.productId, b.productId) ||
          compareText(a.warehouseId, b.warehouseId) ||
          compareText(a.id, b.id)
      );

    return paginate(rows, query.page, query.pageSize);
  }

  async getStockLevelById(id: string): Promise<StockLevel | null> {
    return this.store.stockLevels.get(id) ?? null;
  }

  async getStockLevel(productId: string, warehouseId: string): Promise<StockLevel | null> {
    for (const level of this.store.stockLevels.values()) {
      if (level.productId === productId && level.warehouseId === warehouseId) {
        return level;
      }
    }
    return null;
  }

  async upsertStockLevel(data: NewErp1StockLevel): Promise<StockLevel> {
    const existing = await this.getStockLevel(data.productId, data.warehouseId);
    if (existing) {
      const updated: StockLevel = {
        ...existing,
        quantity: data.quantity,
        updatedAt: new Date().toISOString(),
      };
      this.store.stockLevels.set(updated.id, updated);
      return { ...updated };
    }

    const level: StockLevel = {
      id: data.id ?? randomUUID(),
      productId: data.productId,
      warehouseId: data.warehouseId,
      quantity: data.quantity,
      updatedAt: new Date().toISOString(),
    };
    this.store.stockLevels.set(level.id, level);
    return { ...level };
  }

  // ── Receipts ──────────────────────────────────────────────────────────────

  async getImportReceiptByKey(key: string): Promise<Erp1ImportReceipt | null> {
    return this.store.receipts.get(key) ?? null;
  }

  async createImportReceipt(receipt: NewErp1ImportReceipt): Promise<Erp1ImportReceipt> {
    if (this.store.receipts.has(receipt.idempotencyKey)) {
      throw new Error(`Duplicate idempotency key: ${receipt.idempotencyKey}`);
    }
    const created: Erp1ImportReceipt = {
      id: receipt.id ?? randomUUID(),
      batchId: receipt.batchId,
      sourceRow: receipt.sourceRow,
      targetId: receipt.targetId,
      targetEntity: receipt.targetEntity,
      idempotencyKey: receipt.idempotencyKey,
      requestHash: receipt.requestHash,
      sourceSystem: receipt.sourceSystem ?? null,
      sourceId: receipt.sourceId ?? null,
      outcome: receipt.outcome ?? 'loaded',
      responsePayload: receipt.responsePayload ?? null,
      createdAt: new Date().toISOString(),
    };
    this.store.receipts.set(created.idempotencyKey, created);
    return { ...created };
  }
}
