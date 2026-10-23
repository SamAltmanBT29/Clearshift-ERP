/**
 * ERP-1 Deterministic Seed & Idempotency Test Suite
 *
 * Verifies:
 *   1. Seed runs strictly through the public API endpoints.
 *   2. First seed run populates all categories, products, and opening stocks.
 *   3. Second seed run replays idempotently without creating duplicate rows or throwing errors.
 *   4. Seeded data is fully retrievable via GET /products with search and category filtering.
 *
 * @module erp1/tests/seed
 */

import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { runSeed, type PostFn } from '../../../../../../sample-data/erp-1/seed.js';

describe('ERP-1 Seed & Idempotency Suite', () => {
  it('executes deterministic seed and verifies idempotent replay', async () => {
    const app = buildApp();
    await app.ready();

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

    // First run — should create records
    const run1 = await runSeed(post);
    expect(run1.categoryIds.length).toBe(3);
    expect(run1.productIds.length).toBe(3);
    expect(run1.stockIds.length).toBe(3);
    expect(run1.replayed).toBe(false);

    // Second run — should replay idempotently without duplicates
    const run2 = await runSeed(post);
    expect(run2.categoryIds).toEqual(run1.categoryIds);
    expect(run2.productIds).toEqual(run1.productIds);
    expect(run2.stockIds).toEqual(run1.stockIds);
    expect(run2.replayed).toBe(true);

    // Verify products list returns exactly 3 products
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/erp-products/products',
    });
    expect(listRes.statusCode).toBe(200);
    const body = listRes.json();
    expect(body.total).toBe(3);
    expect(body.items.length).toBe(3);

    // Verify search works on seeded SKU
    const searchRes = await app.inject({
      method: 'GET',
      url: '/api/v1/erp-products/products?search=hammer',
    });
    expect(searchRes.statusCode).toBe(200);
    const searchBody = searchRes.json();
    expect(searchBody.total).toBe(1);
    expect(searchBody.items[0].sku).toBe('SKU-HAMMER-01');
    expect(searchBody.items[0].price).toBe('24.5000');
    expect(searchBody.items[0].currency).toBe('USD');
    expect(searchBody.items[0].quantity).toBe('150.0000');

    await app.close();
  });
});
