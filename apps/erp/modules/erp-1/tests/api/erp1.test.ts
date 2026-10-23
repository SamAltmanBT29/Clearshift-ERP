/**
 * ERP-1 Products & Inventory — API, auth, validation and idempotency suite.
 *






 * @module erp1/tests/api/erp1.test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ErrorEnvelopeSchema, ERP1_DOMAIN_RULES } from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import { Erp1Service } from '../../src/services/erp1.service.js';
import {
  ERP1_DEFAULT_CATEGORY_ID,
  ERP1_DEFAULT_WAREHOUSE_ID,
  InMemoryErp1Repository,
} from '../../src/services/repository.js';

const BASE = '/api/v1/erp-products';
const ADMIN = { authorization: 'Bearer role:admin' };
const EDITOR = { authorization: 'Bearer role:editor' };
const VIEWER = { authorization: 'Bearer role:viewer' };
const MIGRATION = { authorization: 'Bearer role:migration_runner' };

const PRODUCT = {
  name: 'Blue Widget',
  sku: 'wid-100',
  categoryId: ERP1_DEFAULT_CATEGORY_ID,
  unitOfMeasure: 'pcs',
  price: 12.5,
  currency: 'USD',
};

describe('ERP-1 Products & Inventory API', () => {
  let repository: InMemoryErp1Repository;
  let app: FastifyInstance;

  beforeEach(() => {
    repository = new InMemoryErp1Repository(true);
    app = buildApp({
      repository,
      erp1Service: new Erp1Service({ repository }),
      authRequired: true,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  async function createProduct(overrides: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/products`,
      headers: EDITOR,
      payload: { ...PRODUCT, ...overrides },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  describe('Authentication and authorization', () => {
    it('rejects an unauthenticated request with 401 and the shared envelope', async () => {
      const res = await app.inject({ method: 'GET', url: `${BASE}/products` });
      expect(res.statusCode).toBe(401);
      expect(ErrorEnvelopeSchema.safeParse(res.json()).success).toBe(true);
      expect(res.json().code).toBe('UNAUTHORIZED');
    });

    it('allows a viewer to read', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/products`,
        headers: VIEWER,
      });
      expect(res.statusCode).toBe(200);
    });

    it('denies a viewer mutation with 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: VIEWER,
        payload: PRODUCT,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    });

    it('allows the migration runner to ingest products through kit.run', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: MIGRATION,
        payload: PRODUCT,
      });
      expect(res.statusCode).toBe(201);
    });

    it('echoes a supplied correlation id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/products`,
        headers: { ...VIEWER, 'x-correlation-id': 'corr-erp1-1' },
      });
      expect(res.headers['x-correlation-id']).toBe('corr-erp1-1');
    });
  });

  describe('Product creation and editing', () => {
    it('normalizes SKU, currency, price and creates a zero-stock row', async () => {
      const body = await createProduct();
      expect(body.sku).toBe('wid-100');
      expect(body.normalizedSku).toBe('WID-100');
      expect(body.currency).toBe('USD');
      expect(body.price).toBe('12.5000');
      expect(body.taxRate).toBe('0.00');
      expect(body.prior_result).toBe(false);

      const stock = await repository.getStockLevel(
        body.id,
        ERP1_DEFAULT_WAREHOUSE_ID
      );
      expect(stock?.quantity).toBe('0.00');
    });

    it('rejects a duplicate SKU after case-normalization with 409', async () => {
      await createProduct();
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: EDITOR,
        payload: { ...PRODUCT, sku: '  WID-100  ', name: 'Other' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe(ERP1_DOMAIN_RULES.SKU_DUPLICATE);
    });

    it('rejects an unknown category with 422', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: EDITOR,
        payload: { ...PRODUCT, categoryId: randomUUID() },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(ERP1_DOMAIN_RULES.CATEGORY_REQUIRED);
    });

    it('rejects protected fields with ERP1_PROTECTED_FIELD', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: EDITOR,
        payload: { ...PRODUCT, id: randomUUID(), normalizedSku: 'EVIL' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(ERP1_DOMAIN_RULES.PROTECTED_FIELD);
      expect(res.json().details.map((d: { field: string }) => d.field)).toEqual(
        expect.arrayContaining(['id', 'normalizedSku'])
      );
    });

    it('rejects unknown non-protected fields with validation details', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: EDITOR,
        payload: { ...PRODUCT, nickname: 'blue' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('rejects negative prices and fixed-unit violations', async () => {
      const negative = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: EDITOR,
        payload: { ...PRODUCT, price: -1 },
      });
      expect(negative.statusCode).toBe(400);

      const unit = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: EDITOR,
        payload: { ...PRODUCT, unitOfMeasure: 'dozen' },
      });
      expect(unit.statusCode).toBe(400);
    });

    it('persists optional import provenance', async () => {
      const body = await createProduct({
        source_system: 'legacy_products_csv',
        source_id: 'row-42',
      });
      expect(body.sourceSystem).toBe('legacy_products_csv');
      expect(body.sourceId).toBe('row-42');
    });

    it('reads by id and returns 404 for unknown ids', async () => {
      const created = await createProduct();
      const found = await app.inject({
        method: 'GET',
        url: `${BASE}/products/${created.id}`,
        headers: VIEWER,
      });
      expect(found.statusCode).toBe(200);
      expect(found.json().id).toBe(created.id);

      const missing = await app.inject({
        method: 'GET',
        url: `${BASE}/products/${randomUUID()}`,
        headers: VIEWER,
      });
      expect(missing.statusCode).toBe(404);
    });

    it('edits a product and re-normalizes a changed SKU', async () => {
      const created = await createProduct();
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/products/${created.id}`,
        headers: EDITOR,
        payload: { sku: 'wid-200', price: 9.9 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().sku).toBe('wid-200');
      expect(res.json().normalizedSku).toBe('WID-200');
      expect(res.json().price).toBe('9.9000');
    });

    it('rejects a PATCH that collides with another SKU', async () => {
      const first = await createProduct();
      const second = await createProduct({ sku: 'wid-101', name: 'Second' });
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/products/${second.id}`,
        headers: EDITOR,
        payload: { sku: first.sku },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe(ERP1_DOMAIN_RULES.SKU_DUPLICATE);
    });
  });

  describe('Product listing', () => {
    it('paginates with a flat page envelope', async () => {
      await createProduct({ sku: 'A-1', name: 'Alpha' });
      await createProduct({ sku: 'B-1', name: 'Beta' });

      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/products?page=1&pageSize=1`,
        headers: VIEWER,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ total: 2, page: 1, pageSize: 1, totalPages: 2 });
      expect(res.json().items).toHaveLength(1);
      expect(res.json()).not.toHaveProperty('meta');
    });

    it('searches by name and SKU server-side', async () => {
      await createProduct({ sku: 'A-1', name: 'Alpha' });
      await createProduct({ sku: 'B-1', name: 'Beta' });

      const byName = await app.inject({
        method: 'GET',
        url: `${BASE}/products?search=alph`,
        headers: VIEWER,
      });
      expect(byName.json().items).toHaveLength(1);
      expect(byName.json().items[0].name).toBe('Alpha');

      const bySku = await app.inject({
        method: 'GET',
        url: `${BASE}/products?search=B-1`,
        headers: VIEWER,
      });
      expect(bySku.json().items).toHaveLength(1);
      expect(bySku.json().items[0].name).toBe('Beta');
    });

    it('rejects a page size above the hard cap', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/products?pageSize=101`,
        headers: VIEWER,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Categories', () => {
    it('creates categories, preserves code case and rejects case-insensitive duplicates', async () => {
      const created = await app.inject({
        method: 'POST',
        url: `${BASE}/categories`,
        headers: EDITOR,
        payload: { name: 'Raw Materials', code: 'Raw' },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().code).toBe('Raw');

      const duplicate = await app.inject({
        method: 'POST',
        url: `${BASE}/categories`,
        headers: EDITOR,
        payload: { name: 'Raw duplicate', code: 'RAW' },
      });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json().code).toBe(
        ERP1_DOMAIN_RULES.CATEGORY_CODE_DUPLICATE
      );
    });

    it('lists, reads and edits categories', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/categories`,
        headers: VIEWER,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(1);
      expect(res.json().total).toBe(1);

      const read = await app.inject({
        method: 'GET',
        url: `${BASE}/categories/${ERP1_DEFAULT_CATEGORY_ID}`,
        headers: VIEWER,
      });
      expect(read.statusCode).toBe(200);

      const patched = await app.inject({
        method: 'PATCH',
        url: `${BASE}/categories/${ERP1_DEFAULT_CATEGORY_ID}`,
        headers: EDITOR,
        payload: { name: 'General Supplies' },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().name).toBe('General Supplies');
    });
  });

  describe('Stock reads and opening loads', () => {
    it('lists stock levels and flattens a single product match', async () => {
      const product = await createProduct();
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/stock?productId=${product.id}`,
        headers: VIEWER,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(1);
      expect(res.json().productId).toBe(product.id);
      expect(res.json().quantity).toBe('0.00');
    });

    it('requires an idempotency key for opening stock', async () => {
      const product = await createProduct();
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/stock/opening`,
        headers: EDITOR,
        payload: { productId: product.id, quantity: '5' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(
        ERP1_DOMAIN_RULES.IMPORT_PROVENANCE_REQUIRED
      );
    });

    it('absolutely upserts opening stock and returns an import receipt', async () => {
      const product = await createProduct();
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/stock/opening`,
        headers: { ...EDITOR, 'idempotency-key': 'open-stock-1' },
        payload: { productId: product.id, quantity: 12.5 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        productId: product.id,
        warehouseId: ERP1_DEFAULT_WAREHOUSE_ID,
        quantity: '12.5000',
        prior_result: false,
      });
      expect(res.json().import_receipt).toMatchObject({
        idempotency_key: 'open-stock-1',
        target_entity: 'stock_level',
        outcome: 'loaded',
      });

      const stored = await repository.getStockLevel(
        product.id,
        ERP1_DEFAULT_WAREHOUSE_ID
      );
      expect(stored?.quantity).toBe('12.5000');
    });

    it('replays an identical opening load without double-applying', async () => {
      const product = await createProduct();
      const request = {
        method: 'POST' as const,
        url: `${BASE}/stock/opening`,
        headers: { ...EDITOR, 'idempotency-key': 'open-stock-replay' },
        payload: { productId: product.id, quantity: '7' },
      };

      const first = await app.inject(request);
      const second = await app.inject(request);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json().prior_result).toBe(true);
      expect(second.json().id).toBe(first.json().id);

      const stored = await repository.getStockLevel(
        product.id,
        ERP1_DEFAULT_WAREHOUSE_ID
      );
      expect(stored?.quantity).toBe('7.0000');
    });

    it('rejects reuse of an idempotency key with a different payload', async () => {
      const product = await createProduct();
      await app.inject({
        method: 'POST',
        url: `${BASE}/stock/opening`,
        headers: { ...EDITOR, 'idempotency-key': 'open-stock-conflict' },
        payload: { productId: product.id, quantity: '7' },
      });

      const conflict = await app.inject({
        method: 'POST',
        url: `${BASE}/stock/opening`,
        headers: { ...EDITOR, 'idempotency-key': 'open-stock-conflict' },
        payload: { productId: product.id, quantity: '8' },
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().code).toBe(
        ERP1_DOMAIN_RULES.IDEMPOTENCY_CONFLICT
      );
    });

    it('rejects negative stock with 422', async () => {
      const product = await createProduct();
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/stock/opening`,
        headers: { ...EDITOR, 'idempotency-key': 'negative-1' },
        payload: { productId: product.id, quantity: -1 },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(ERP1_DOMAIN_RULES.NEGATIVE_STOCK);
    });

    it('returns 404 for opening stock on an unknown product', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/stock/opening`,
        headers: { ...ADMIN, 'idempotency-key': 'missing-product' },
        payload: { productId: randomUUID(), quantity: '1' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('Idempotent product and category creates', () => {
    it('replays a product create with the same key and payload', async () => {
      const request = {
        method: 'POST' as const,
        url: `${BASE}/products`,
        headers: { ...EDITOR, 'idempotency-key': 'product-create-1' },
        payload: PRODUCT,
      };
      const first = await app.inject(request);
      const second = await app.inject(request);
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(200);
      expect(second.json().id).toBe(first.json().id);
      expect(second.json().prior_result).toBe(true);
    });

    it('conflicts when a product key is reused with different data', async () => {
      await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: { ...EDITOR, 'idempotency-key': 'product-create-2' },
        payload: PRODUCT,
      });
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: { ...EDITOR, 'idempotency-key': 'product-create-2' },
        payload: { ...PRODUCT, name: 'Different' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe(
        ERP1_DOMAIN_RULES.IDEMPOTENCY_CONFLICT
      );
    });

    it('replays a category create with the same key and payload', async () => {
      const request = {
        method: 'POST' as const,
        url: `${BASE}/categories`,
        headers: { ...EDITOR, 'idempotency-key': 'category-create-1' },
        payload: { name: 'Packaging', code: 'PKG' },
      };
      const first = await app.inject(request);
      const second = await app.inject(request);
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(200);
      expect(second.json().id).toBe(first.json().id);
    });

    it('rejects a header/body idempotency-key disagreement', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: { ...EDITOR, 'idempotency-key': 'header-key' },
        payload: { ...PRODUCT, idempotency_key: 'body-key' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(
        ERP1_DOMAIN_RULES.IMPORT_PROVENANCE_REQUIRED
      );
    });
  });
});
