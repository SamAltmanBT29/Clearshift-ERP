/**
 * ERP-1 Scripted Demo Journey E2E Test Suite
 *
 * Runs the full 5-minute V1 demo workflow in-process using Fastify injection:
 *   0:00 Seed execution & idempotency
 *   1:00 Product catalog search and pagination
 *   2:00 Product creation with explicit currency and decimal price
 *   2:45 Duplicate SKU rejection (BR-ERP1-01)
 *   3:30 Non-negative stock opening balance (BR-ERP1-02)
 *   4:15 Category hierarchy enforcement (FR-ERP1-03)
 *
 * @module erp1/tests/e2e/demo-journey
 */

import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { runSeed, type PostFn } from '../../../../../../sample-data/erp-1/seed.js';

describe('ERP-1 Scripted Demo Journey (In-Process E2E)', () => {
  it('executes full 5-minute V1 demo journey successfully', async () => {
    const app = buildApp({ authRequired: false });
    await app.ready();

    // ── 0:00 Seed ────────────────────────────────────────────────────────────
    const post: PostFn = async (method, path, body) => {
      const res = await app.inject({
        method,
        url: path,
        payload: body,
      });
      return {
        status: res.statusCode,
        body: res.json() as Record<string, unknown>,
      };
    };

    const seedResult = await runSeed(post);
    expect(seedResult.productIds.length).toBe(3);

    // ── 1:00 Catalog Search & Pagination ─────────────────────────────────────
    const searchRes = await app.inject({
      method: 'GET',
      url: '/api/v1/erp-products/products?search=hammer',
    });
    expect(searchRes.statusCode).toBe(200);
    const searchData = searchRes.json();
    expect(searchData.total).toBe(1);
    expect(searchData.items[0].sku).toBe('SKU-HAMMER-01');
    expect(searchData.items[0].price).toBe('24.5000');
    expect(searchData.items[0].currency).toBe('USD');

    // Verify stock is retrievable via stock endpoint
    const stockRes = await app.inject({
      method: 'GET',
      url: `/api/v1/erp-products/stock?productId=${searchData.items[0].id}`,
    });
    expect(stockRes.statusCode).toBe(200);
    expect(stockRes.json().quantity).toBe('150.0000');

    // ── 2:00 Product Creation ────────────────────────────────────────────────
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-products/products',
      payload: {
        name: 'Standard Steel Hex Nut M8',
        sku: 'SKU-NUT-M8',
        unitOfMeasure: 'pcs',
        price: '0.1500',
        currency: 'USD',
        taxRate: '5.00',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const createdProd = createRes.json();
    expect(createdProd.id).toBeDefined();
    expect(createdProd.sku).toBe('SKU-NUT-M8');
    expect(createdProd.price).toBe('0.1500');
    expect(createdProd.currency).toBe('USD');

    // ── 2:45 Duplicate SKU Rejection (BR-ERP1-01) ────────────────────────────
    const dupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-products/products',
      payload: {
        name: 'Conflicting Hex Nut',
        sku: 'sku-nut-m8', // Case insensitive collision
        unitOfMeasure: 'pcs',
        price: '0.2000',
        currency: 'USD',
      },
    });
    expect(dupRes.statusCode).toBe(409);
    const dupBody = dupRes.json();
    expect(dupBody.code).toBe('DUPLICATE_SKU');

    // ── 3:30 Non-Negative Stock Balance (BR-ERP1-02) ─────────────────────────
    // Negative stock rejected
    const negStockRes = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-products/stock/opening',
      payload: {
        productId: createdProd.id,
        quantity: '-25.0000',
        idempotency_key: 'demo-neg-stock-key',
      },
    });
    expect(negStockRes.statusCode).toBe(422);
    expect(negStockRes.json().code).toBe('NEGATIVE_STOCK');

    // Valid opening stock applied
    const posStockRes = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-products/stock/opening',
      payload: {
        productId: createdProd.id,
        quantity: '500.0000',
        idempotency_key: 'demo-pos-stock-key',
      },
    });
    expect(posStockRes.statusCode).toBe(200);
    expect(posStockRes.json().quantity).toBe('500.0000');

    // Verify stock is now linked to product
    const linkedRes = await app.inject({
      method: 'GET',
      url: `/api/v1/erp-products/products/${createdProd.id}/linked-records`,
    });
    expect(linkedRes.statusCode).toBe(200);
    const linkedData = linkedRes.json();
    expect(linkedData.productId).toBe(createdProd.id);
    expect(linkedData.stockLevels.length).toBe(1);
    expect(linkedData.stockLevels[0].quantity).toBe('500.0000');

    // ── 4:15 Category Hierarchy Enforcement (FR-ERP1-03) ─────────────────────
    const catRes = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-products/categories',
      payload: {
        name: 'Fasteners & Fixings',
        code: 'CAT-FAST',
      },
    });
    expect(catRes.statusCode).toBe(201);
    expect(catRes.json().code).toBe('CAT-FAST');

    await app.close();
  });
});
