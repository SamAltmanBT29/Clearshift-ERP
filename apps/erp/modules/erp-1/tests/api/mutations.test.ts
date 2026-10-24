/**
 * ERP-1 Products & Inventory — Mutation API and Domain Validation Test Suite
 *
 * Exhaustively validates the write surface for Issue #8 (ERP1-03):
 *   - AC-1: Route-boundary Zod validation & authorization (400, 401, 403)
 *   - AC-2: Domain invariant enforcement at service and API level (404, 409, 422)
 *   - AC-3: Invalid business values return 422; duplicate SKU / key conflicts return 409
 *   - AC-4: Repeated import request with same idempotency key returns original receipt (200, prior_result: true)
 *   - AC-5: Unexpected failures return correlation ID and do not leak SQL, secrets, or internal rows
 *   - AC-6: Non-negative stock quantity enforcement (BR-ERP1-02)
 *   - AC-7: Single warehouse boundary enforcement (FR-ERP1-05 / BR-ERP1-03)
 *   - AC-8: Protected and system-maintained fields are strictly rejected from browser edits
 *
 * @module erp1/tests/api/mutations.test
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

const PRODUCT_PAYLOAD = {
  name: 'Industrial Valve M10',
  sku: 'vlv-100',
  categoryId: ERP1_DEFAULT_CATEGORY_ID,
  unitOfMeasure: 'pcs',
  price: 49.95,
  currency: 'USD',
};

describe('[ERP1-03] ERP-1 Products and Inventory Mutation API and Domain Validation (#8)', () => {
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
      payload: { ...PRODUCT_PAYLOAD, ...overrides },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  describe('AC-1: Route-Boundary Authorization & Role Handling', () => {
    it('rejects unauthenticated mutation requests with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        payload: PRODUCT_PAYLOAD,
      });
      expect(res.statusCode).toBe(401);
      const parsed = ErrorEnvelopeSchema.safeParse(res.json());
      expect(parsed.success).toBe(true);
      expect(res.json().code).toBe('UNAUTHORIZED');
    });

    it('denies viewer mutation attempts with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: VIEWER,
        payload: PRODUCT_PAYLOAD,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    });

    it('allows editor role to create and update products', async () => {
      const created = await createProduct({ sku: 'ed-001' });
      expect(created.id).toBeDefined();

      const updateRes = await app.inject({
        method: 'PATCH',
        url: `${BASE}/products/${created.id}`,
        headers: EDITOR,
        payload: { name: 'Updated Valve Name' },
      });
      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.json().name).toBe('Updated Valve Name');
    });

    it('allows migration runner role with kit.run capability to ingest products', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: MIGRATION,
        payload: { ...PRODUCT_PAYLOAD, sku: 'mig-001' },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe('AC-2 & AC-3: Product Mutation Invariants and Error Codes', () => {
    it('normalizes SKU to uppercase, formats 4-decimal price, and creates zero-stock record', async () => {
      const body = await createProduct();
      expect(body.sku).toBe('vlv-100');
      expect(body.normalizedSku).toBe('VLV-100');
      expect(body.currency).toBe('USD');
      expect(body.price).toBe('49.9500');
      expect(body.taxRate).toBe('0.00');
      expect(body.prior_result).toBe(false);

      const stock = await repository.getStockLevel(body.id, ERP1_DEFAULT_WAREHOUSE_ID);
      expect(stock?.quantity).toBe('0.00');
    });

    it('rejects duplicate SKU after case-folding with 409 DUPLICATE_SKU', async () => {
      await createProduct({ sku: 'DUPL-01' });
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: EDITOR,
        payload: { ...PRODUCT_PAYLOAD, sku: '  dupl-01  ' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe(ERP1_DOMAIN_RULES.SKU_DUPLICATE);
    });

    it('rejects unknown category reference with 422 UNKNOWN_CATEGORY', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: EDITOR,
        payload: { ...PRODUCT_PAYLOAD, categoryId: randomUUID() },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(ERP1_DOMAIN_RULES.CATEGORY_REQUIRED);
    });

    it('rejects protected fields in creation payload with 400 ERP1_PROTECTED_FIELD', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: EDITOR,
        payload: { ...PRODUCT_PAYLOAD, createdAt: new Date().toISOString() },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(ERP1_DOMAIN_RULES.PROTECTED_FIELD);
    });

    it('rejects negative price and invalid unit of measure at route boundary', async () => {
      const negPriceRes = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: EDITOR,
        payload: { ...PRODUCT_PAYLOAD, price: -5.0 },
      });
      expect(negPriceRes.statusCode).toBe(400);

      const invalidUnitRes = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: EDITOR,
        payload: { ...PRODUCT_PAYLOAD, unitOfMeasure: 'invalid_uom' },
      });
      expect(invalidUnitRes.statusCode).toBe(400);
    });

    it('updates product and re-normalizes updated SKU', async () => {
      const created = await createProduct({ sku: 'patch-vlv' });
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `${BASE}/products/${created.id}`,
        headers: EDITOR,
        payload: { sku: 'patch-vlv-updated', price: 55.5 },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().sku).toBe('patch-vlv-updated');
      expect(patchRes.json().normalizedSku).toBe('PATCH-VLV-UPDATED');
      expect(patchRes.json().price).toBe('55.5000');
    });

    it('rejects a PATCH that causes SKU collision with 409', async () => {
      const first = await createProduct({ sku: 'first-item' });
      await createProduct({ sku: 'second-item' });

      const collisionRes = await app.inject({
        method: 'PATCH',
        url: `${BASE}/products/${first.id}`,
        headers: EDITOR,
        payload: { sku: 'SECOND-ITEM' },
      });
      expect(collisionRes.statusCode).toBe(409);
      expect(collisionRes.json().code).toBe(ERP1_DOMAIN_RULES.SKU_DUPLICATE);
    });
  });

  describe('AC-2 & AC-3: Category Mutation Invariants', () => {
    it('creates product category with valid code and name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/categories`,
        headers: EDITOR,
        payload: { name: 'Electrical Components', code: 'ELEC-01' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().name).toBe('Electrical Components');
      expect(res.json().code).toBe('ELEC-01');
    });

    it('rejects duplicate category code with 409 DUPLICATE_CATEGORY_CODE', async () => {
      await app.inject({
        method: 'POST',
        url: `${BASE}/categories`,
        headers: EDITOR,
        payload: { name: 'Cat A', code: 'CAT-DUP' },
      });
      const dupRes = await app.inject({
        method: 'POST',
        url: `${BASE}/categories`,
        headers: EDITOR,
        payload: { name: 'Cat B', code: 'cat-dup' },
      });
      expect(dupRes.statusCode).toBe(409);
      expect(dupRes.json().code).toBe(ERP1_DOMAIN_RULES.CATEGORY_CODE_DUPLICATE);
    });

    it('updates editable category fields and rejects protected field mutations', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/categories`,
        headers: EDITOR,
        payload: { name: 'Original Category', code: 'ORIG' },
      });
      const categoryId = res.json().id;

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `${BASE}/categories/${categoryId}`,
        headers: EDITOR,
        payload: { name: 'Renamed Category' },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().name).toBe('Renamed Category');

      const protectedRes = await app.inject({
        method: 'PATCH',
        url: `${BASE}/categories/${categoryId}`,
        headers: EDITOR,
        payload: { id: randomUUID() },
      });
      expect(protectedRes.statusCode).toBe(400);
      expect(protectedRes.json().code).toBe(ERP1_DOMAIN_RULES.PROTECTED_FIELD);
    });
  });

  describe('AC-4: Idempotency & Durable Import Receipts (KIT-08)', () => {
    it('absolutely upserts opening stock and persists durable import receipt', async () => {
      const product = await createProduct({ sku: 'stk-001' });
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/stock/opening`,
        headers: { ...EDITOR, 'idempotency-key': 'open-key-101' },
        payload: { productId: product.id, quantity: 25.5 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        productId: product.id,
        warehouseId: ERP1_DEFAULT_WAREHOUSE_ID,
        quantity: '25.5000',
        prior_result: false,
      });
      expect(res.json().import_receipt).toMatchObject({
        idempotency_key: 'open-key-101',
        target_entity: 'stock_level',
        outcome: 'loaded',
      });

      const stored = await repository.getStockLevel(product.id, ERP1_DEFAULT_WAREHOUSE_ID);
      expect(stored?.quantity).toBe('25.5000');
    });

    it('replays identical opening stock request returning original result with prior_result: true', async () => {
      const product = await createProduct({ sku: 'replay-01' });
      const req = {
        method: 'POST' as const,
        url: `${BASE}/stock/opening`,
        headers: { ...EDITOR, 'idempotency-key': 'replay-key-001' },
        payload: { productId: product.id, quantity: '10' },
      };

      const first = await app.inject(req);
      const second = await app.inject(req);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json().prior_result).toBe(true);
      expect(second.json().id).toBe(first.json().id);
    });

    it('rejects reuse of idempotency key with conflicting payload (409)', async () => {
      const product = await createProduct({ sku: 'conf-01' });
      await app.inject({
        method: 'POST',
        url: `${BASE}/stock/opening`,
        headers: { ...EDITOR, 'idempotency-key': 'conflict-key' },
        payload: { productId: product.id, quantity: '10' },
      });

      const conflict = await app.inject({
        method: 'POST',
        url: `${BASE}/stock/opening`,
        headers: { ...EDITOR, 'idempotency-key': 'conflict-key' },
        payload: { productId: product.id, quantity: '20' },
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().code).toBe(ERP1_DOMAIN_RULES.IDEMPOTENCY_CONFLICT);
    });

    it('requires idempotency key for opening stock mutations (400)', async () => {
      const product = await createProduct({ sku: 'no-key-01' });
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/stock/opening`,
        headers: EDITOR,
        payload: { productId: product.id, quantity: '5' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(ERP1_DOMAIN_RULES.IMPORT_PROVENANCE_REQUIRED);
    });
  });

  describe('AC-6 & AC-7: Negative Stock & Single Warehouse Invariants', () => {
    it('rejects negative opening stock with 422 NEGATIVE_STOCK (BR-ERP1-02)', async () => {
      const product = await createProduct({ sku: 'neg-stk' });
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/stock/opening`,
        headers: { ...EDITOR, 'idempotency-key': 'neg-key-1' },
        payload: { productId: product.id, quantity: -10 },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(ERP1_DOMAIN_RULES.NEGATIVE_STOCK);
    });

    it('rejects unknown warehouse reference with 422 UNKNOWN_WAREHOUSE', async () => {
      const product = await createProduct({ sku: 'unk-wh' });
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/stock/opening`,
        headers: { ...EDITOR, 'idempotency-key': 'unk-wh-key' },
        payload: {
          productId: product.id,
          warehouseId: randomUUID(),
          quantity: '5',
        },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(ERP1_DOMAIN_RULES.WAREHOUSE_REQUIRED);
    });

    it('rejects non-default secondary warehouse assignment with 422 SINGLE_WAREHOUSE_V1', async () => {
      const product = await createProduct({ sku: 'sec-wh' });
      const secondaryWhId = randomUUID();
      (repository as unknown as { store: { warehouses: Map<string, unknown> } }).store.warehouses.set(
        secondaryWhId,
        {
          id: secondaryWhId,
          name: 'Secondary Warehouse',
          code: 'WH-02',
          isDefault: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      );
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/stock/opening`,
        headers: { ...EDITOR, 'idempotency-key': 'sec-wh-key' },
        payload: {
          productId: product.id,
          warehouseId: secondaryWhId,
          quantity: '5',
        },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(ERP1_DOMAIN_RULES.SINGLE_WAREHOUSE);
    });
  });

  describe('AC-5: Traceability & Safe Error Envelope', () => {
    it('echoes client-supplied x-correlation-id in response headers', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: { ...EDITOR, 'x-correlation-id': 'corr-mut-001' },
        payload: { ...PRODUCT_PAYLOAD, sku: 'corr-001' },
      });
      expect(res.headers['x-correlation-id']).toBe('corr-mut-001');
    });

    it('returns standardized safe error envelope on validation failure without leaking stack or SQL', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: EDITOR,
        payload: { ...PRODUCT_PAYLOAD, price: 'not-a-number' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBeDefined();
      expect(body.message).toBeDefined();
      expect(body.stack).toBeUndefined();
      expect(body.sql).toBeUndefined();
    });
  });
});
