/**
 * ERP-1 Products & Inventory — Deterministic Mock Server & Contract Package
 *
 * Provides a production-grade, zero-external-dependency mock server and
 * deterministic fixture dataset for dependent teams (ERP-2, ERP-3, CRM-2,
 * and the Migration Kit).
 *
 * Conforms strictly to:
 *   - SDS ClearShift ERP v2.0 §4.2 (FR-ERP1-01..05, BR-ERP1-01)
 *   - ADR-002: Shared Zod/OpenAPI Contract & Error Envelope
 *   - PLT-04 / PLT-09: Bounded Pagination & Transactional Event Envelopes
 *   - Issue #110 ([ERP1-14])
 *
 * Interface:
 *   - createErp1MockServer()  → { app, store, reset, stop }
 *
 * @module contracts/erp-1-mock
 */

import fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  ERP1_DOMAIN_RULES,
  ERP1_UNITS_OF_MEASURE,
  ProductListQuerySchema,
  CreateProductInputSchema,
  UpdateProductInputSchema,
  CategoryListQuerySchema,
  CreateCategoryInputSchema,
  StockLevelListQuerySchema,
  SetOpeningStockInputSchema,
  normalizeSku,
  type Product,
  type Category,
  type Warehouse,
  type StockLevel,
} from './erp-1.js';
import { ImportRowRequestSchema } from './import-target.js';
import { ERP1_EVENT_TYPES, createErp1Event } from './erp-1-events.js';
import type { EventEnvelope } from './events.js';

export const ERP1_MOCK_DEFAULT_PORT = 4011;

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic Seed IDs
// Fixed UUIDs to guarantee reproducible integration and contract test assertions.
// ─────────────────────────────────────────────────────────────────────────────

export const SEED_WAREHOUSE_1 = 'aaaaaaaa-0001-4000-8000-000000000001';
export const SEED_CATEGORY_1 = 'bbbbbbbb-0001-4000-8000-000000000001';
export const SEED_CATEGORY_2 = 'bbbbbbbb-0001-4000-8000-000000000002';
export const SEED_PRODUCT_1 = 'cccccccc-0001-4000-8000-000000000001';
export const SEED_PRODUCT_2 = 'cccccccc-0001-4000-8000-000000000002';
export const SEED_PRODUCT_3 = 'cccccccc-0001-4000-8000-000000000003';
export const SEED_STOCK_1 = 'dddddddd-0001-4000-8000-000000000001';
export const SEED_STOCK_2 = 'dddddddd-0001-4000-8000-000000000002';
export const SEED_STOCK_3 = 'dddddddd-0001-4000-8000-000000000003';

const SEED_TS = '2026-04-01T00:00:00.000Z';

// ─────────────────────────────────────────────────────────────────────────────
// Mock Store Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Erp1MockStore {
  warehouses: Map<string, Warehouse>;
  categories: Map<string, Category>;
  products: Map<string, Product>;
  stockLevels: Map<string, StockLevel>;
  receipts: Map<string, { targetId: string; payloadHash: string; receipt: unknown }>;
  emittedEvents: EventEnvelope[];
}

export function createInitialErp1MockStore(): Erp1MockStore {
  const warehouses = new Map<string, Warehouse>();
  warehouses.set(SEED_WAREHOUSE_1, {
    id: SEED_WAREHOUSE_1,
    code: 'WH-MAIN',
    name: 'Primary Distribution Center',
    isDefault: true,
    createdAt: SEED_TS,
    updatedAt: SEED_TS,
  });

  const categories = new Map<string, Category>();
  categories.set(SEED_CATEGORY_1, {
    id: SEED_CATEGORY_1,
    code: 'TOOLS',
    name: 'Tools & Hardware',
    createdAt: SEED_TS,
    updatedAt: SEED_TS,
  });
  categories.set(SEED_CATEGORY_2, {
    id: SEED_CATEGORY_2,
    code: 'GEN',
    name: 'General Supplies',
    createdAt: SEED_TS,
    updatedAt: SEED_TS,
  });

  const products = new Map<string, Product>();
  products.set(SEED_PRODUCT_1, {
    id: SEED_PRODUCT_1,
    sku: 'TOOL-HEX-01',
    normalizedSku: normalizeSku('TOOL-HEX-01'),
    name: 'Metric Hex Key Set 9pc',
    categoryId: SEED_CATEGORY_1,
    unitOfMeasure: 'box',
    price: '18.5000',
    currency: 'USD',
    taxRate: '0.00',
    createdAt: SEED_TS,
    updatedAt: SEED_TS,
  });
  products.set(SEED_PRODUCT_2, {
    id: SEED_PRODUCT_2,
    sku: 'GEN-TIE-100',
    normalizedSku: normalizeSku('GEN-TIE-100'),
    name: 'Nylon Cable Ties 100pk',
    categoryId: SEED_CATEGORY_2,
    unitOfMeasure: 'box',
    price: '6.2500',
    currency: 'USD',
    taxRate: '0.00',
    createdAt: SEED_TS,
    updatedAt: SEED_TS,
  });
  products.set(SEED_PRODUCT_3, {
    id: SEED_PRODUCT_3,
    sku: 'LUB-GRS-500',
    normalizedSku: normalizeSku('LUB-GRS-500'),
    name: 'Industrial Lithium Grease 500g',
    categoryId: SEED_CATEGORY_2,
    unitOfMeasure: 'g',
    price: '12.0000',
    currency: 'USD',
    taxRate: '0.00',
    createdAt: SEED_TS,
    updatedAt: SEED_TS,
  });

  const stockLevels = new Map<string, StockLevel>();
  stockLevels.set(SEED_STOCK_1, {
    id: SEED_STOCK_1,
    productId: SEED_PRODUCT_1,
    warehouseId: SEED_WAREHOUSE_1,
    quantity: '150.0000',
    updatedAt: SEED_TS,
  });
  stockLevels.set(SEED_STOCK_2, {
    id: SEED_STOCK_2,
    productId: SEED_PRODUCT_2,
    warehouseId: SEED_WAREHOUSE_1,
    quantity: '25.0000',
    updatedAt: SEED_TS,
  });
  stockLevels.set(SEED_STOCK_3, {
    id: SEED_STOCK_3,
    productId: SEED_PRODUCT_3,
    warehouseId: SEED_WAREHOUSE_1,
    quantity: '0.0000',
    updatedAt: SEED_TS,
  });

  return {
    warehouses,
    categories,
    products,
    stockLevels,
    receipts: new Map(),
    emittedEvents: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Envelope Helper
// ─────────────────────────────────────────────────────────────────────────────

function standardError(
  reply: any,
  statusCode: number,
  code: string,
  message: string,
  details: Array<{ field?: string; message: string; code?: string }> = []
) {
  return reply.status(statusCode).send({
    code,
    message,
    details,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Server Factory
// ─────────────────────────────────────────────────────────────────────────────

export interface Erp1MockServerInstance {
  app: FastifyInstance;
  store: Erp1MockStore;
  reset: () => void;
  stop: () => Promise<void>;
}

export function createErp1MockServer(): Erp1MockServerInstance {
  let store = createInitialErp1MockStore();

  const app = fastify({ logger: false });

  // ── Products Endpoints ────────────────────────────────────────────────────

  // GET /api/v1/erp-products/products
  app.get('/api/v1/erp-products/products', async (request, reply) => {
    const parse = ProductListQuerySchema.safeParse(request.query);
    if (!parse.success) {
      return standardError(
        reply,
        400,
        'VALIDATION_ERROR',
        parse.error.issues[0]?.message ?? 'Invalid query parameters',
        parse.error.issues.map((i: { path: (string | number)[]; message: string }) => ({
          field: i.path.join('.'),
          message: i.message,
        }))
      );
    }

    const {
      page = 1,
      pageSize = 25,
      search,
      categoryId,
      unitOfMeasure,
      stockStatus,
      minPrice,
      maxPrice,
      sortBy = 'createdAt',
      sortDirection = 'asc',
    } = parse.data;

    let items = Array.from(store.products.values());

    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
      );
    }
    if (categoryId) {
      items = items.filter((p) => p.categoryId === categoryId);
    }
    if (unitOfMeasure) {
      items = items.filter((p) => p.unitOfMeasure === unitOfMeasure);
    }
    if (minPrice !== undefined) {
      items = items.filter((p) => Number(p.price) >= Number(minPrice));
    }
    if (maxPrice !== undefined) {
      items = items.filter((p) => Number(p.price) <= Number(maxPrice));
    }
    if (stockStatus && stockStatus !== 'all') {
      items = items.filter((p) => {
        const stock = Array.from(store.stockLevels.values()).find((s) => s.productId === p.id);
        const qty = stock ? Number(stock.quantity) : 0;
        let computedStatus: string;
        if (qty === 0) computedStatus = 'out_of_stock';
        else if (qty < 30) computedStatus = 'low_stock';
        else computedStatus = 'in_stock';
        return computedStatus === stockStatus;
      });
    }

    // Sort
    items.sort((a, b) => {
      let valA: string | number = a.createdAt;
      let valB: string | number = b.createdAt;
      if (sortBy === 'name') {
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
      } else if (sortBy === 'sku') {
        valA = a.sku.toLowerCase();
        valB = b.sku.toLowerCase();
      } else if (sortBy === 'price') {
        valA = Number(a.price);
        valB = Number(b.price);
      }
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = (page - 1) * pageSize;
    const paginatedItems = items.slice(offset, offset + pageSize);

    return reply.status(200).send({
      items: paginatedItems,
      page,
      pageSize,
      total,
      totalPages,
    });
  });

  // GET /api/v1/erp-products/products/:id
  app.get('/api/v1/erp-products/products/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const product = store.products.get(id);
    if (!product) {
      return standardError(reply, 404, 'NOT_FOUND', `Product with id ${id} not found`);
    }
    return reply.status(200).send(product);
  });

  // POST /api/v1/erp-products/products
  app.post('/api/v1/erp-products/products', async (request, reply) => {
    const parse = CreateProductInputSchema.safeParse(request.body);
    if (!parse.success) {
      return standardError(
        reply,
        400,
        'VALIDATION_ERROR',
        parse.error.issues[0]?.message ?? 'Invalid product input',
        parse.error.issues.map((i: { path: (string | number)[]; message: string }) => ({
          field: i.path.join('.'),
          message: i.message,
        }))
      );
    }

    const input = parse.data;
    const normalizedNewSku = normalizeSku(input.sku);

    // Check SKU duplicate rule
    for (const p of store.products.values()) {
      if (normalizeSku(p.sku) === normalizedNewSku) {
        return standardError(
          reply,
          409,
          ERP1_DOMAIN_RULES.SKU_DUPLICATE,
          `A product with normalized SKU '${normalizedNewSku}' already exists.`,
          [{ field: 'sku', message: 'SKU must be unique' }]
        );
      }
    }

    // Check category exists if supplied
    if (input.categoryId && !store.categories.has(input.categoryId)) {
      return standardError(
        reply,
        422,
        ERP1_DOMAIN_RULES.CATEGORY_REQUIRED,
        `Category '${input.categoryId}' does not exist.`,
        [{ field: 'categoryId', message: 'Referenced category does not exist' }]
      );
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const newProduct: Product = {
      id,
      sku: input.sku.trim(),
      normalizedSku: normalizedNewSku,
      name: input.name.trim(),
      categoryId: input.categoryId ?? null,
      unitOfMeasure: input.unitOfMeasure,
      price: Number(input.price).toFixed(4),
      currency: input.currency ?? 'USD',
      taxRate: input.taxRate ?? '0.00',
      notificationEmail: input.notificationEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      sourceSystem: input.sourceSystem ?? null,
      sourceId: input.sourceId ?? null,
      goldenId: null,
      createdAt: now,
      updatedAt: now,
    };

    store.products.set(id, newProduct);

    // Automatically initialize stock level record for default warehouse
    const stockId = randomUUID();
    store.stockLevels.set(stockId, {
      id: stockId,
      productId: id,
      warehouseId: SEED_WAREHOUSE_1,
      quantity: '0.0000',
      updatedAt: now,
    });

    // Emit domain event
    const event = createErp1Event({
      eventId: randomUUID(),
      eventType: ERP1_EVENT_TYPES.PRODUCT_CREATED,
      correlationId: (request.headers['x-correlation-id'] as string) ?? randomUUID(),
      entityType: 'product',
      entityId: id,
      payload: {
        id,
        sku: newProduct.sku,
        name: newProduct.name,
        categoryId: newProduct.categoryId,
        unitOfMeasure: newProduct.unitOfMeasure,
        price: newProduct.price,
        currency: newProduct.currency,
        createdAt: now,
      },
    });
    store.emittedEvents.push(event);

    return reply.status(201).send(newProduct);
  });

  // PATCH /api/v1/erp-products/products/:id
  app.patch('/api/v1/erp-products/products/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = store.products.get(id);
    if (!existing) {
      return standardError(reply, 404, 'NOT_FOUND', `Product with id ${id} not found`);
    }

    const parse = UpdateProductInputSchema.safeParse(request.body);
    if (!parse.success) {
      return standardError(
        reply,
        400,
        'VALIDATION_ERROR',
        parse.error.issues[0]?.message ?? 'Invalid update payload',
        parse.error.issues.map((i: { path: (string | number)[]; message: string }) => ({
          field: i.path.join('.'),
          message: i.message,
        }))
      );
    }

    const input = parse.data;

    // Check SKU conflict if updating sku
    if (input.sku) {
      const normalizedNewSku = normalizeSku(input.sku);
      for (const [pId, p] of store.products.entries()) {
        if (pId !== id && normalizeSku(p.sku) === normalizedNewSku) {
          return standardError(
            reply,
            409,
            ERP1_DOMAIN_RULES.SKU_DUPLICATE,
            `A product with normalized SKU '${normalizedNewSku}' already exists.`,
            [{ field: 'sku', message: 'SKU must be unique' }]
          );
        }
      }
    }

    const now = new Date().toISOString();
    const updatedProduct: Product = {
      ...existing,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.sku !== undefined ? { sku: input.sku.trim(), normalizedSku: normalizeSku(input.sku) } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.unitOfMeasure !== undefined ? { unitOfMeasure: input.unitOfMeasure } : {}),
      ...(input.price !== undefined ? { price: Number(input.price).toFixed(4) } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.taxRate !== undefined ? { taxRate: input.taxRate } : {}),
      updatedAt: now,
    };

    store.products.set(id, updatedProduct);

    // Emit domain event
    const event = createErp1Event({
      eventId: randomUUID(),
      eventType: ERP1_EVENT_TYPES.PRODUCT_UPDATED,
      correlationId: (request.headers['x-correlation-id'] as string) ?? randomUUID(),
      entityType: 'product',
      entityId: id,
      payload: {
        id,
        sku: updatedProduct.sku,
        name: updatedProduct.name,
        previousPrice: existing.price,
        newPrice: updatedProduct.price,
        categoryId: updatedProduct.categoryId,
        updatedAt: now,
      },
    });
    store.emittedEvents.push(event);

    return reply.status(200).send(updatedProduct);
  });

  // ── Categories Endpoints ──────────────────────────────────────────────────

  // GET /api/v1/erp-products/categories
  app.get('/api/v1/erp-products/categories', async (request, reply) => {
    const parse = CategoryListQuerySchema.safeParse(request.query);
    if (!parse.success) {
      return standardError(
        reply,
        400,
        'VALIDATION_ERROR',
        parse.error.issues[0]?.message ?? 'Invalid query',
        parse.error.issues.map((i: { path: (string | number)[]; message: string }) => ({
          field: i.path.join('.'),
          message: i.message,
        }))
      );
    }

    const { page = 1, pageSize = 25, search } = parse.data;
    let items = Array.from(store.categories.values());

    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
      );
    }

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = (page - 1) * pageSize;
    const paginatedItems = items.slice(offset, offset + pageSize);

    return reply.status(200).send({
      items: paginatedItems,
      page,
      pageSize,
      total,
      totalPages,
    });
  });

  // POST /api/v1/erp-products/categories
  app.post('/api/v1/erp-products/categories', async (request, reply) => {
    const parse = CreateCategoryInputSchema.safeParse(request.body);
    if (!parse.success) {
      return standardError(
        reply,
        400,
        'VALIDATION_ERROR',
        parse.error.issues[0]?.message ?? 'Invalid category input',
        parse.error.issues.map((i: { path: (string | number)[]; message: string }) => ({
          field: i.path.join('.'),
          message: i.message,
        }))
      );
    }

    const input = parse.data;
    const normalizedCode = input.code.trim().toUpperCase();

    for (const c of store.categories.values()) {
      if (c.code.trim().toUpperCase() === normalizedCode) {
        return standardError(
          reply,
          409,
          ERP1_DOMAIN_RULES.CATEGORY_CODE_DUPLICATE,
          `A category with code '${normalizedCode}' already exists.`,
          [{ field: 'code', message: 'Category code must be unique' }]
        );
      }
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const newCategory: Category = {
      id,
      code: normalizedCode,
      name: input.name.trim(),
      createdAt: now,
      updatedAt: now,
    };

    store.categories.set(id, newCategory);

    const event = createErp1Event({
      eventId: randomUUID(),
      eventType: ERP1_EVENT_TYPES.CATEGORY_CREATED,
      correlationId: (request.headers['x-correlation-id'] as string) ?? randomUUID(),
      entityType: 'category',
      entityId: id,
      payload: {
        id,
        code: newCategory.code,
        name: newCategory.name,
        createdAt: now,
      },
    });
    store.emittedEvents.push(event);

    return reply.status(201).send(newCategory);
  });

  // ── Warehouses Endpoints ──────────────────────────────────────────────────

  // GET /api/v1/erp-products/warehouses
  app.get('/api/v1/erp-products/warehouses', async (_request, reply) => {
    const items = Array.from(store.warehouses.values());
    return reply.status(200).send({
      items,
      total: items.length,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });
  });

  // ── Stock Levels Endpoints ────────────────────────────────────────────────

  // GET /api/v1/erp-products/stock-levels
  app.get('/api/v1/erp-products/stock-levels', async (request, reply) => {
    const parse = StockLevelListQuerySchema.safeParse(request.query);
    if (!parse.success) {
      return standardError(
        reply,
        400,
        'VALIDATION_ERROR',
        parse.error.issues[0]?.message ?? 'Invalid query',
        parse.error.issues.map((i: { path: (string | number)[]; message: string }) => ({
          field: i.path.join('.'),
          message: i.message,
        }))
      );
    }

    const { page = 1, pageSize = 20, productId, warehouseId } = parse.data;
    let items = Array.from(store.stockLevels.values());

    if (productId) {
      items = items.filter((s) => s.productId === productId);
    }
    if (warehouseId) {
      items = items.filter((s) => s.warehouseId === warehouseId);
    }

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = (page - 1) * pageSize;
    const paginatedItems = items.slice(offset, offset + pageSize);

    return reply.status(200).send({
      items: paginatedItems,
      page,
      pageSize,
      total,
      totalPages,
    });
  });

  // POST /api/v1/erp-products/stock-levels/opening
  app.post('/api/v1/erp-products/stock-levels/opening', async (request, reply) => {
    const parse = SetOpeningStockInputSchema.safeParse(request.body);
    if (!parse.success) {
      const isNegative = parse.error.issues.some(
        (i) => i.message.toLowerCase().includes('negative') || i.message.includes('BR-ERP1-02')
      );
      if (isNegative) {
        return standardError(
          reply,
          422,
          ERP1_DOMAIN_RULES.NEGATIVE_STOCK,
          'Stock quantity cannot become negative. Rule BR-ERP1-01 prohibits negative stock.',
          [{ field: 'quantity', message: 'Inventory balance cannot fall below zero' }]
        );
      }
      return standardError(
        reply,
        400,
        'VALIDATION_ERROR',
        parse.error.issues[0]?.message ?? 'Invalid opening stock payload',
        parse.error.issues.map((i: { path: (string | number)[]; message: string }) => ({
          field: i.path.join('.'),
          message: i.message,
        }))
      );
    }

    const { productId, warehouseId = SEED_WAREHOUSE_1, quantity } = parse.data;

    if (!store.products.has(productId)) {
      return standardError(reply, 422, ERP1_DOMAIN_RULES.PRODUCT_REQUIRED, `Product '${productId}' not found`);
    }
    if (!store.warehouses.has(warehouseId)) {
      return standardError(reply, 422, ERP1_DOMAIN_RULES.WAREHOUSE_REQUIRED, `Warehouse '${warehouseId}' not found`);
    }

    const qtyNumber = Number(quantity);
    if (qtyNumber < 0) {
      return standardError(
        reply,
        422,
        ERP1_DOMAIN_RULES.NEGATIVE_STOCK,
        `Stock quantity cannot become negative. Rule BR-ERP1-01 prohibits negative stock.`,
        [{ field: 'quantity', message: 'Inventory balance cannot fall below zero' }]
      );
    }

    let stockLevel = Array.from(store.stockLevels.values()).find(
      (s) => s.productId === productId && s.warehouseId === warehouseId
    );

    const now = new Date().toISOString();
    const prevQty = stockLevel ? stockLevel.quantity : '0.0000';

    if (stockLevel) {
      stockLevel.quantity = qtyNumber.toFixed(4);
      stockLevel.updatedAt = now;
    } else {
      const stockId = randomUUID();
      stockLevel = {
        id: stockId,
        productId,
        warehouseId,
        quantity: qtyNumber.toFixed(4),
        updatedAt: now,
      };
      store.stockLevels.set(stockId, stockLevel);
    }

    let status: 'in_stock' | 'low_stock' | 'out_of_stock' = 'in_stock';
    if (qtyNumber === 0) status = 'out_of_stock';
    else if (qtyNumber < 30) status = 'low_stock';

    // Emit domain event
    const event = createErp1Event({
      eventId: randomUUID(),
      eventType: ERP1_EVENT_TYPES.STOCK_ADJUSTED,
      correlationId: (request.headers['x-correlation-id'] as string) ?? randomUUID(),
      entityType: 'stock_level',
      entityId: stockLevel.id,
      payload: {
        productId,
        warehouseId,
        previousQuantity: prevQty,
        newQuantity: qtyNumber.toFixed(4),
        adjustmentQuantity: (qtyNumber - Number(prevQty)).toFixed(4),
        stockStatus: status,
        reason: 'Opening stock balance set',
        adjustedAt: now,
      },
    });
    store.emittedEvents.push(event);

    return reply.status(200).send(stockLevel);
  });

  // ── Import Endpoints ──────────────────────────────────────────────────────

  // POST /api/v1/erp-products/import
  app.post('/api/v1/erp-products/import', async (request, reply) => {
    const rawBody = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>;
    const idempotencyHeader = request.headers['idempotency-key'] as string | undefined;
    const bodyToValidate = {
      ...rawBody,
      idempotency_key: idempotencyHeader || rawBody['idempotency_key'],
    };

    const parse = ImportRowRequestSchema.safeParse(bodyToValidate);
    if (!parse.success) {
      return standardError(
        reply,
        400,
        'VALIDATION_ERROR',
        parse.error.issues[0]?.message ?? 'Invalid import row request',
        parse.error.issues.map((i: { path: (string | number)[]; message: string }) => ({
          field: i.path.join('.'),
          message: i.message,
        }))
      );
    }

    const { idempotency_key, entity, record, batch_id, source_row } = parse.data;
    const payloadHash = JSON.stringify(record);

    if (idempotency_key) {
      const existing = store.receipts.get(idempotency_key);
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          return standardError(
            reply,
            409,
            ERP1_DOMAIN_RULES.IDEMPOTENCY_CONFLICT,
            `Idempotency conflict: key '${idempotency_key}' previously recorded with different payload.`,
            [{ field: 'idempotency_key', message: 'Payload mismatch for existing idempotency key' }]
          );
        }
        return reply.status(200).send({
          target_id: existing.targetId,
          prior_result: true,
          receipt: existing.receipt,
        });
      }
    }

    // Process new record
    const targetId = randomUUID();
    const now = new Date().toISOString();

    if (entity === 'product') {
      const sku = String(record['sku'] ?? `SKU-IMP-${source_row ?? Date.now()}`).trim();
      const name = String(record['name'] ?? 'Imported Product').trim();
      const uom = String(record['unitOfMeasure'] ?? record['unit_of_measure'] ?? 'pcs');
      const price = String(record['price'] ?? '10.0000');

      const newProd: Product = {
        id: targetId,
        sku,
        normalizedSku: normalizeSku(sku),
        name,
        categoryId: (record['categoryId'] as string) ?? (record['category_id'] as string) ?? SEED_CATEGORY_2,
        unitOfMeasure: (ERP1_UNITS_OF_MEASURE.includes(uom as any) ? uom : 'pcs') as any,
        price: Number(price).toFixed(4),
        currency: 'USD',
        taxRate: '0.00',
        createdAt: now,
        updatedAt: now,
      };
      store.products.set(targetId, newProd);
    }

    const receipt = {
      batch_id: batch_id ?? randomUUID(),
      source_row: source_row ?? 0,
      entity,
      schema_version: 1,
      idempotency_key: idempotency_key ?? `auto-${targetId}`,
      target_id: targetId,
      kind: 'created',
      created_at: now,
    };

    if (idempotency_key) {
      store.receipts.set(idempotency_key, {
        targetId,
        payloadHash,
        receipt,
      });
    }

    return reply.status(201).send({
      target_id: targetId,
      prior_result: false,
      receipt,
    });
  });

  return {
    app,
    get store() {
      return store;
    },
    reset: () => {
      store = createInitialErp1MockStore();
    },
    stop: async () => {
      await app.close();
    },
  };
}
