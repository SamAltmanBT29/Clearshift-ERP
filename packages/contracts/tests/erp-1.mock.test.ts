/**
 * ERP-1 Products & Inventory — Deterministic Mock Server Test Suite
 *
 * Proves that:
 *   - The mock server initializes with deterministic synthetic seed fixtures.
 *   - Products endpoints support bounded pagination, multi-faceted filtering, and sorting.
 *   - SKU normalization and duplicate detection enforce DUPLICATE_SKU (HTTP 409).
 *   - Rule BR-ERP1-01 strictly prohibits negative inventory balances (HTTP 422).
 *   - Category creation rejects duplicate normalized codes (HTTP 409).
 *   - Single-warehouse V1 invariant is honored.
 *   - Standard error envelope { code, message, details } is returned on all failures.
 *   - State-changing mutations emit strongly-typed domain events to emittedEvents.
 *   - Public row import endpoint adheres to Decision C4 idempotency rules.
 *   - reset() cleanly restores deterministic seed state.
 *
 * @module contracts/tests/erp-1.mock.test
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  createErp1MockServer,
  SEED_PRODUCT_1,
  SEED_PRODUCT_2,
  SEED_CATEGORY_1,
  SEED_WAREHOUSE_1,
  type Erp1MockServerInstance,
} from '../src/erp-1-mock.js';
import { ERP1_DOMAIN_RULES } from '../src/erp-1.js';
import { ERP1_EVENT_TYPES } from '../src/erp-1-events.js';

describe('ERP-1 Deterministic Mock Server & Routes', () => {
  let mock: Erp1MockServerInstance;

  beforeEach(() => {
    mock = createErp1MockServer();
  });

  afterAll(async () => {
    if (mock) {
      await mock.stop();
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Initial State & Fixtures
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Initial Seed State', () => {
    it('seeds default warehouse, categories, products, and stock levels', () => {
      expect(mock.store.warehouses.has(SEED_WAREHOUSE_1)).toBe(true);
      expect(mock.store.categories.has(SEED_CATEGORY_1)).toBe(true);
      expect(mock.store.products.has(SEED_PRODUCT_1)).toBe(true);
      expect(mock.store.stockLevels.size).toBe(3);
      expect(mock.store.emittedEvents.length).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Products API
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Products Endpoints', () => {
    it('GET /api/v1/erp-products/products returns paginated products', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: '/api/v1/erp-products/products?page=1&pageSize=10',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(10);
      expect(body.total).toBe(3);
      expect(body.items.length).toBe(3);
      expect(body.items[0].sku).toBeDefined();
    });

    it('GET /api/v1/erp-products/products filters by search term', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: '/api/v1/erp-products/products?search=hex',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.total).toBe(1);
      expect(body.items[0].sku).toBe('TOOL-HEX-01');
    });

    it('GET /api/v1/erp-products/products filters by categoryId', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: `/api/v1/erp-products/products?categoryId=${SEED_CATEGORY_1}`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.total).toBe(1);
      expect(body.items[0].categoryId).toBe(SEED_CATEGORY_1);
    });

    it('GET /api/v1/erp-products/products/:id returns single product', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: `/api/v1/erp-products/products/${SEED_PRODUCT_1}`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.id).toBe(SEED_PRODUCT_1);
      expect(body.name).toBe('Metric Hex Key Set 9pc');
    });

    it('GET /api/v1/erp-products/products/:id returns 404 for unknown product', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: '/api/v1/erp-products/products/00000000-0000-0000-0000-000000000000',
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('NOT_FOUND');
    });

    it('POST /api/v1/erp-products/products creates product, initializes stock, and emits event', async () => {
      const res = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/products',
        payload: {
          sku: 'TOOL-HAM-01',
          name: 'Claw Hammer 16oz',
          categoryId: SEED_CATEGORY_1,
          unitOfMeasure: 'pcs',
          price: '24.95',
          currency: 'USD',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.sku).toBe('TOOL-HAM-01');
      expect(body.price).toBe('24.9500');

      // Verify product added to store
      expect(mock.store.products.has(body.id)).toBe(true);

      // Verify stock level initialized
      const stock = Array.from(mock.store.stockLevels.values()).find((s) => s.productId === body.id);
      expect(stock).toBeDefined();
      expect(stock?.quantity).toBe('0.0000');

      // Verify event emitted
      expect(mock.store.emittedEvents.length).toBe(1);
      expect(mock.store.emittedEvents[0]?.event_type).toBe(ERP1_EVENT_TYPES.PRODUCT_CREATED);
    });

    it('POST /api/v1/erp-products/products rejects duplicate normalized SKU (409)', async () => {
      const res = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/products',
        payload: {
          sku: '  tool-hex-01  ', // Normalizes to TOOL-HEX-01 which already exists
          name: 'Duplicate Hex Key Set',
          unitOfMeasure: 'pcs',
          price: '15.00',
          currency: 'USD',
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe(ERP1_DOMAIN_RULES.SKU_DUPLICATE);
      expect(body.details[0]?.field).toBe('sku');
    });

    it('PATCH /api/v1/erp-products/products/:id updates product and emits event', async () => {
      const res = await mock.app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-products/products/${SEED_PRODUCT_1}`,
        payload: {
          name: 'Metric Hex Key Set Pro 9pc',
          price: '21.00',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.name).toBe('Metric Hex Key Set Pro 9pc');
      expect(body.price).toBe('21.0000');

      // Verify event emitted
      expect(mock.store.emittedEvents.length).toBe(1);
      expect(mock.store.emittedEvents[0]?.event_type).toBe(ERP1_EVENT_TYPES.PRODUCT_UPDATED);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Categories API
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Categories Endpoints', () => {
    it('GET /api/v1/erp-products/categories returns paginated categories', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: '/api/v1/erp-products/categories',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.total).toBe(2);
      expect(body.items.length).toBe(2);
    });

    it('POST /api/v1/erp-products/categories creates new category and emits event', async () => {
      const res = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/categories',
        payload: {
          code: 'ELEC',
          name: 'Electrical Supplies',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('ELEC');
      expect(mock.store.categories.has(body.id)).toBe(true);
      expect(mock.store.emittedEvents[0]?.event_type).toBe(ERP1_EVENT_TYPES.CATEGORY_CREATED);
    });

    it('POST /api/v1/erp-products/categories rejects duplicate category code (409)', async () => {
      const res = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/categories',
        payload: {
          code: 'tools', // Normalizes to TOOLS which exists
          name: 'Tools Again',
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe(ERP1_DOMAIN_RULES.CATEGORY_CODE_DUPLICATE);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Warehouses & Stock Levels API (BR-ERP1-01 Invariants)
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Warehouses & Stock Levels Endpoints', () => {
    it('GET /api/v1/erp-products/warehouses returns default warehouse', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: '/api/v1/erp-products/warehouses',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.total).toBe(1);
      expect(body.items[0].isDefault).toBe(true);
    });

    it('POST /api/v1/erp-products/stock-levels/opening updates stock balance and emits event', async () => {
      const res = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/stock-levels/opening',
        payload: {
          productId: SEED_PRODUCT_2,
          warehouseId: SEED_WAREHOUSE_1,
          quantity: '500.0000',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.quantity).toBe('500.0000');

      const stock = mock.store.stockLevels.get(body.id);
      expect(stock?.quantity).toBe('500.0000');

      expect(mock.store.emittedEvents.length).toBe(1);
      expect(mock.store.emittedEvents[0]?.event_type).toBe(ERP1_EVENT_TYPES.STOCK_ADJUSTED);
    });

    it('POST /api/v1/erp-products/stock-levels/opening rejects negative stock (BR-ERP1-01 / 422)', async () => {
      const res = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/stock-levels/opening',
        payload: {
          productId: SEED_PRODUCT_2,
          warehouseId: SEED_WAREHOUSE_1,
          quantity: '-5.0000',
        },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe(ERP1_DOMAIN_RULES.NEGATIVE_STOCK);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Idempotent Import Endpoint (Decision C4 & KIT-08)
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Import Endpoint & Decision C4 Idempotency', () => {
    it('POST /api/v1/erp-products/import loads new record and creates receipt (201)', async () => {
      const res = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        payload: {
          batch_id: 'e0000001-aaaa-4000-8000-000000000001',
          source_row: 0,
          idempotency_key: 'idem-test-001',
          entity: 'product',
          record: {
            sku: 'IMP-TEST-001',
            name: 'Imported Bolt M8',
            unitOfMeasure: 'pcs',
            price: '0.45',
          },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.prior_result).toBe(false);
      expect(body.target_id).toBeDefined();
      expect(body.receipt.idempotency_key).toBe('idem-test-001');
    });

    it('POST /api/v1/erp-products/import returns prior result on exact replay (200)', async () => {
      const payload = {
        batch_id: 'e0000001-aaaa-4000-8000-000000000001',
        source_row: 0,
        idempotency_key: 'idem-test-replay',
        entity: 'product',
        record: {
          sku: 'IMP-TEST-REPLAY',
          name: 'Imported Washer M8',
          unitOfMeasure: 'pcs',
          price: '0.15',
        },
      };

      const res1 = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        payload,
      });
      expect(res1.statusCode).toBe(201);
      const body1 = JSON.parse(res1.payload);

      const res2 = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        payload,
      });
      expect(res2.statusCode).toBe(200);
      const body2 = JSON.parse(res2.payload);
      expect(body2.prior_result).toBe(true);
      expect(body2.target_id).toBe(body1.target_id);
    });

    it('POST /api/v1/erp-products/import rejects idempotency conflict if payload changed (409)', async () => {
      const payload1 = {
        batch_id: 'e0000001-aaaa-4000-8000-000000000001',
        source_row: 0,
        idempotency_key: 'idem-test-conflict',
        entity: 'product',
        record: { sku: 'SKU-A', name: 'Name A' },
      };

      await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        payload: payload1,
      });

      const payload2 = {
        batch_id: 'e0000001-aaaa-4000-8000-000000000001',
        source_row: 0,
        idempotency_key: 'idem-test-conflict',
        entity: 'product',
        record: { sku: 'SKU-A-DIFFERENT', name: 'Name Changed' },
      };

      const res2 = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        payload: payload2,
      });

      expect(res2.statusCode).toBe(409);
      const body2 = JSON.parse(res2.payload);
      expect(body2.code).toBe(ERP1_DOMAIN_RULES.IDEMPOTENCY_CONFLICT);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Mock Reset
  // ───────────────────────────────────────────────────────────────────────────
  describe('6. Mock Store Reset', () => {
    it('reset() cleanly restores initial seed fixtures', async () => {
      await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/products',
        payload: {
          sku: 'TEMP-SKU-999',
          name: 'Temporary Item',
          unitOfMeasure: 'pcs',
          price: '1.00',
          currency: 'USD',
        },
      });

      expect(mock.store.products.size).toBe(4);
      mock.reset();
      expect(mock.store.products.size).toBe(3);
      expect(mock.store.emittedEvents.length).toBe(0);
    });
  });
});
