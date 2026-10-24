/**
 * ERP-1 Products & Inventory — Drizzle Repository
 *
 * Production implementation of {@link Erp1Repository}. Every query is
 * parameterized, bounded and deterministically ordered.
 *
 * @module erp1/db/repository
 */

import { and, asc, count, eq, ilike, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type {
  Category,
  CategoryListQuery,
  Product,
  ProductListQuery,
  StockLevel,
  StockLevelListQuery,
  Warehouse,
} from '@clearshift/contracts';
import type {
  Erp1CategoryUpdates,
  Erp1ImportReceipt,
  Erp1Page,
  Erp1ProductUpdates,
  Erp1Repository,
  NewErp1Category,
  NewErp1ImportReceipt,
  NewErp1Product,
  NewErp1StockLevel,
} from '../src/services/repository.js';
import {
  erp1Categories,
  erp1ImportReceipts,
  erp1Products,
  erp1StockLevels,
  erp1Warehouses,
  type Erp1Category,
  type Erp1ImportReceipt as Erp1ImportReceiptRow,
  type Erp1Product as Erp1ProductRow,
  type Erp1StockLevel as Erp1StockLevelRow,
  type Erp1Warehouse as Erp1WarehouseRow,
} from './schema.js';

function toProduct(row: Erp1ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    normalizedSku: row.normalizedSku,
    categoryId: row.categoryId ?? null,
    unitOfMeasure: row.unitOfMeasure,
    price: row.price,
    currency: row.currency,
    taxRate: row.taxRate,
    sourceSystem: row.sourceSystem ?? null,
    sourceId: row.sourceId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCategory(row: Erp1Category): Category {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toWarehouse(row: Erp1WarehouseRow): Warehouse {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toStockLevel(row: Erp1StockLevelRow): StockLevel {
  return {
    id: row.id,
    productId: row.productId,
    warehouseId: row.warehouseId,
    quantity: row.quantity,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toReceipt(row: Erp1ImportReceiptRow): Erp1ImportReceipt {
  return {
    id: row.id,
    batchId: row.batchId,
    sourceRow: row.sourceRow,
    targetId: row.targetId,
    targetEntity: row.targetEntity,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    sourceSystem: row.sourceSystem ?? null,
    sourceId: row.sourceId ?? null,
    kind: (row.kind as 'created' | 'linked') ?? 'created',
    outcome: row.outcome,
    responsePayload: row.responsePayload ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export class DrizzleErp1Repository implements Erp1Repository {
  constructor(private readonly db: NodePgDatabase) {}

  // ── Products ──────────────────────────────────────────────────────────────

  async listProducts(query: ProductListQuery): Promise<Erp1Page<Product>> {
    const filters = [];
    if (query.categoryId !== undefined) {
      filters.push(eq(erp1Products.categoryId, query.categoryId));
    }
    if (query.search !== undefined && query.search.length > 0) {
      const term = `%${escapeLike(query.search)}%`;
      filters.push(
        or(
          ilike(erp1Products.name, term),
          ilike(erp1Products.sku, term),
          ilike(erp1Products.normalizedSku, term)
        )
      );
    }
    const where = filters.length > 0 ? and(...filters) : undefined;
    const offset = (query.page - 1) * query.pageSize;

    const rows = await this.db
      .select()
      .from(erp1Products)
      .where(where)
      .orderBy(asc(erp1Products.name), asc(erp1Products.id))
      .limit(query.pageSize)
      .offset(offset);

    const totalRows = await this.db
      .select({ value: count() })
      .from(erp1Products)
      .where(where);

    return { items: rows.map(toProduct), total: Number(totalRows[0]?.value ?? 0) };
  }

  async getProductById(id: string): Promise<Product | null> {
    const [row] = await this.db
      .select()
      .from(erp1Products)
      .where(eq(erp1Products.id, id))
      .limit(1);
    return row ? toProduct(row) : null;
  }

  async getProductBySku(sku: string): Promise<Product | null> {
    const [row] = await this.db
      .select()
      .from(erp1Products)
      .where(eq(erp1Products.sku, sku))
      .limit(1);
    return row ? toProduct(row) : null;
  }

  async getProductByNormalizedSku(normalizedSku: string): Promise<Product | null> {
    const [row] = await this.db
      .select()
      .from(erp1Products)
      .where(eq(erp1Products.normalizedSku, normalizedSku))
      .limit(1);
    return row ? toProduct(row) : null;
  }

  async createProduct(data: NewErp1Product): Promise<Product> {
    const [row] = await this.db
      .insert(erp1Products)
      .values({
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
      })
      .returning();

    if (!row) throw new Error('Failed to create product');
    return toProduct(row);
  }

  async updateProduct(id: string, updates: Erp1ProductUpdates): Promise<Product> {
    const values: Record<string, unknown> = { updatedAt: sql`now()` };
    if (updates.name !== undefined) values['name'] = updates.name;
    if (updates.sku !== undefined) values['sku'] = updates.sku;
    if (updates.normalizedSku !== undefined) values['normalizedSku'] = updates.normalizedSku;
    if (updates.categoryId !== undefined) values['categoryId'] = updates.categoryId;
    if (updates.unitOfMeasure !== undefined) values['unitOfMeasure'] = updates.unitOfMeasure;
    if (updates.price !== undefined) values['price'] = updates.price;
    if (updates.currency !== undefined) values['currency'] = updates.currency;
    if (updates.taxRate !== undefined) values['taxRate'] = updates.taxRate;

    const [row] = await this.db
      .update(erp1Products)
      .set(values)
      .where(eq(erp1Products.id, id))
      .returning();

    if (!row) throw new Error(`Product ${id} not found`);
    return toProduct(row);
  }

  // ── Categories ────────────────────────────────────────────────────────────

  async listCategories(query: CategoryListQuery): Promise<Erp1Page<Category>> {
    const where =
      query.search !== undefined && query.search.length > 0
        ? or(
            ilike(erp1Categories.name, `%${escapeLike(query.search)}%`),
            ilike(erp1Categories.code, `%${escapeLike(query.search)}%`)
          )
        : undefined;

    const offset = (query.page - 1) * query.pageSize;
    const rows = await this.db
      .select()
      .from(erp1Categories)
      .where(where)
      .orderBy(asc(erp1Categories.name), asc(erp1Categories.id))
      .limit(query.pageSize)
      .offset(offset);

    const totalRows = await this.db
      .select({ value: count() })
      .from(erp1Categories)
      .where(where);

    return { items: rows.map(toCategory), total: Number(totalRows[0]?.value ?? 0) };
  }

  async getCategoryById(id: string): Promise<Category | null> {
    const [row] = await this.db
      .select()
      .from(erp1Categories)
      .where(eq(erp1Categories.id, id))
      .limit(1);
    return row ? toCategory(row) : null;
  }

  async getCategoryByCode(code: string): Promise<Category | null> {
    const [row] = await this.db
      .select()
      .from(erp1Categories)
      .where(sql`lower(${erp1Categories.code}) = lower(${code.trim()})`)
      .limit(1);
    return row ? toCategory(row) : null;
  }

  async createCategory(data: NewErp1Category): Promise<Category> {
    const [row] = await this.db
      .insert(erp1Categories)
      .values({ name: data.name, code: data.code })
      .returning();
    if (!row) throw new Error('Failed to create category');
    return toCategory(row);
  }

  async updateCategory(id: string, updates: Erp1CategoryUpdates): Promise<Category> {
    const values: Record<string, unknown> = { updatedAt: sql`now()` };
    if (updates.name !== undefined) values['name'] = updates.name;
    if (updates.code !== undefined) values['code'] = updates.code;

    const [row] = await this.db
      .update(erp1Categories)
      .set(values)
      .where(eq(erp1Categories.id, id))
      .returning();

    if (!row) throw new Error(`Category ${id} not found`);
    return toCategory(row);
  }

  // ── Warehouses ────────────────────────────────────────────────────────────

  async getWarehouseById(id: string): Promise<Warehouse | null> {
    const [row] = await this.db
      .select()
      .from(erp1Warehouses)
      .where(eq(erp1Warehouses.id, id))
      .limit(1);
    return row ? toWarehouse(row) : null;
  }

  async getDefaultWarehouse(): Promise<Warehouse | null> {
    const [row] = await this.db
      .select()
      .from(erp1Warehouses)
      .where(eq(erp1Warehouses.isDefault, true))
      .limit(1);
    return row ? toWarehouse(row) : null;
  }

  // ── Stock ─────────────────────────────────────────────────────────────────

  async listStockLevels(query: StockLevelListQuery): Promise<Erp1Page<StockLevel>> {
    const filters = [];
    if (query.productId !== undefined) {
      filters.push(eq(erp1StockLevels.productId, query.productId));
    }
    if (query.warehouseId !== undefined) {
      filters.push(eq(erp1StockLevels.warehouseId, query.warehouseId));
    }
    const where = filters.length > 0 ? and(...filters) : undefined;
    const offset = (query.page - 1) * query.pageSize;

    const rows = await this.db
      .select()
      .from(erp1StockLevels)
      .where(where)
      .orderBy(
        asc(erp1StockLevels.productId),
        asc(erp1StockLevels.warehouseId),
        asc(erp1StockLevels.id)
      )
      .limit(query.pageSize)
      .offset(offset);

    const totalRows = await this.db
      .select({ value: count() })
      .from(erp1StockLevels)
      .where(where);

    return { items: rows.map(toStockLevel), total: Number(totalRows[0]?.value ?? 0) };
  }

  async getStockLevelById(id: string): Promise<StockLevel | null> {
    const [row] = await this.db
      .select()
      .from(erp1StockLevels)
      .where(eq(erp1StockLevels.id, id))
      .limit(1);
    return row ? toStockLevel(row) : null;
  }

  async getStockLevel(productId: string, warehouseId: string): Promise<StockLevel | null> {
    const [row] = await this.db
      .select()
      .from(erp1StockLevels)
      .where(
        and(
          eq(erp1StockLevels.productId, productId),
          eq(erp1StockLevels.warehouseId, warehouseId)
        )
      )
      .limit(1);
    return row ? toStockLevel(row) : null;
  }

  async upsertStockLevel(data: NewErp1StockLevel): Promise<StockLevel> {
    const [row] = await this.db
      .insert(erp1StockLevels)
      .values({
        ...(data.id !== undefined && { id: data.id }),
        productId: data.productId,
        warehouseId: data.warehouseId,
        quantity: data.quantity,
      })
      .onConflictDoUpdate({
        target: [erp1StockLevels.productId, erp1StockLevels.warehouseId],
        set: { quantity: data.quantity, updatedAt: sql`now()` },
      })
      .returning();

    if (!row) throw new Error('Failed to upsert stock level');
    return toStockLevel(row);
  }

  // ── Receipts ──────────────────────────────────────────────────────────────

  async getImportReceiptByKey(key: string): Promise<Erp1ImportReceipt | null> {
    const [row] = await this.db
      .select()
      .from(erp1ImportReceipts)
      .where(eq(erp1ImportReceipts.idempotencyKey, key))
      .limit(1);
    return row ? toReceipt(row) : null;
  }

  async createImportReceipt(receipt: NewErp1ImportReceipt): Promise<Erp1ImportReceipt> {
    const [row] = await this.db
      .insert(erp1ImportReceipts)
      .values({
        ...(receipt.id !== undefined && { id: receipt.id }),
        batchId: receipt.batchId,
        sourceRow: receipt.sourceRow,
        targetId: receipt.targetId,
        targetEntity: receipt.targetEntity,
        idempotencyKey: receipt.idempotencyKey,
        requestHash: receipt.requestHash,
        sourceSystem: receipt.sourceSystem ?? null,
        sourceId: receipt.sourceId ?? null,
        kind: receipt.kind ?? 'created',
        outcome: receipt.outcome ?? 'loaded',
        responsePayload: receipt.responsePayload ?? null,
      })
      .returning();

    if (!row) throw new Error('Failed to create import receipt');
    return toReceipt(row);
  }

  async transaction<T>(work: (tx: Erp1Repository) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      return work(new DrizzleErp1Repository(tx as unknown as NodePgDatabase));
    });
  }
}
