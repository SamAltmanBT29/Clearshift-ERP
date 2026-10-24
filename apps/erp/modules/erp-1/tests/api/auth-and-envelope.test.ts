/**
 * ERP-1 Error Envelope, Correlation ID, and API Validation Test Suite
 *
 * Verifies compliance with PLT-04 and ADR-002:
 *   - Error responses adhere to { statusCode, error, code, message, details, correlation_id }
 *   - Correlation IDs are preserved from incoming request or generated dynamically
 *   - Validation errors (HTTP 400) detail specific field issues
 *   - Resource missing errors (HTTP 404) return uniform structure
 *   - Conflict errors (HTTP 409) return DUPLICATE_SKU / DUPLICATE_CATEGORY_CODE
 *   - Unprocessable entity errors (HTTP 422) return domain code and details
 *
 * @module erp1/tests/api/auth-and-envelope
 */

import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';

describe('ERP-1 Error Envelope & Correlation ID Suite', () => {
  it('propagates incoming x-correlation-id header', async () => {
    const app = buildApp();
    await app.ready();

    const testCorrelationId = 'test-corr-id-12345';
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/erp-products/products',
      headers: {
        'x-correlation-id': testCorrelationId,
      },
    });

    expect(res.headers['x-correlation-id']).toBe(testCorrelationId);
    await app.close();
  });

  it('generates x-correlation-id if not provided', async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/erp-products/products',
    });

    expect(res.headers['x-correlation-id']).toBeDefined();
    expect(typeof res.headers['x-correlation-id']).toBe('string');
    await app.close();
  });

  it('rejects unauthenticated request with standard 401 envelope when authRequired is true', async () => {
    const app = buildApp({ authRequired: true });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/erp-products/products',
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.code).toBe('UNAUTHORIZED');
    expect(body.correlation_id).toBeDefined();

    await app.close();
  });

  it('formats validation errors into standard 400 envelope with details array', async () => {
    const app = buildApp({ authRequired: false });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-products/products',
      payload: {
        // Missing name, sku, unitOfMeasure, currency, price
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.correlation_id).toBeDefined();
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details.length).toBeGreaterThan(0);
    expect(body.details[0]).toHaveProperty('field');
    expect(body.details[0]).toHaveProperty('message');

    await app.close();
  });

  it('formats missing entity into standard 404 envelope', async () => {
    const app = buildApp({ authRequired: false });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/erp-products/products/00000000-0000-4000-8000-999999999999',
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe('NOT_FOUND');
    expect(body.correlation_id).toBeDefined();

    await app.close();
  });

  it('formats duplicate conflict into standard 409 envelope', async () => {
    const app = buildApp({ authRequired: false });
    await app.ready();

    // Create product
    await app.inject({
      method: 'POST',
      url: '/api/v1/erp-products/products',
      payload: {
        name: 'Item 1',
        sku: 'SKU-ENV-01',
        unitOfMeasure: 'pcs',
        price: '10.0000',
        currency: 'USD',
        taxRate: '0.00',
      },
    });

    // Attempt duplicate
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-products/products',
      payload: {
        name: 'Item 2',
        sku: 'SKU-ENV-01',
        unitOfMeasure: 'pcs',
        price: '15.0000',
        currency: 'USD',
        taxRate: '0.00',
      },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe('DUPLICATE_SKU');
    expect(body.correlation_id).toBeDefined();

    await app.close();
  });

  it('formats domain rule violations into standard 422 envelope', async () => {
    const app = buildApp({ authRequired: false });
    await app.ready();

    // Create a product
    const prodRes = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-products/products',
      payload: {
        name: 'Item 3',
        sku: 'SKU-ENV-03',
        unitOfMeasure: 'pcs',
        price: '10.0000',
        currency: 'USD',
        taxRate: '0.00',
      },
    });
    const prod = prodRes.json();

    // Attempt negative opening stock
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-products/stock/opening',
      payload: {
        productId: prod.id,
        quantity: '-5.0000',
        idempotency_key: 'test-env-neg-stock',
      },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.code).toBe('NEGATIVE_STOCK');
    expect(body.correlation_id).toBeDefined();
    expect(body.details[0].field).toBe('quantity');

    await app.close();
  });
});
