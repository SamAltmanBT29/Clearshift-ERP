/**
 * Scripted V1 demo journey (docs/demo-scripts/erp-2-v1.md) executed in-process:
 * no manual SQL, no fixture editing, public API only.
 */
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ReferenceResolver } from '@cs/kernel';
import { buildApp } from '../../src/app.js';
import { InMemoryErp2Repository } from '../../src/services/repository.js';

const BASE = '/api/v1/erp-vendors';
const PRODUCT_A = '5eed0000-0000-4000-8000-0000000000a1';
const PRODUCT_B = '5eed0000-0000-4000-8000-0000000000a2';

const resolver: ReferenceResolver = {
  async exists(entity: string, id: string): Promise<boolean> {
    return entity === 'product' && (id === PRODUCT_A || id === PRODUCT_B);
  },
  async get<T = unknown>(): Promise<T | null> {
    return null;
  },
};

describe('ERP-2 V1 demo journey', () => {
  it('vendor -> purchase order -> Sent -> Received -> Closed, with masking, totals and invariants', async () => {
    const app = buildApp({ repository: new InMemoryErp2Repository(false), referenceResolver: resolver });

    // 1. create vendor (bank details masked on the way out)
    const v = await app.inject({
      method: 'POST',
      url: `${BASE}/vendors`,
      payload: {
        name: 'Demo Vendor',
        tax_number: 'TX-DEMO-1',
        email: 'demo@vendor.example',
        bank_details: '123456787890',
        currency: 'USD',
      },
    });
    expect(v.statusCode).toBe(201);
    const vendor = v.json();
    expect(vendor.bank_masked).toBe('XXXX-XXXX-7890');
    expect(JSON.stringify(vendor)).not.toContain('123456787890');

    // 2. search finds it
    const s = await app.inject({ method: 'GET', url: `${BASE}/vendors?search=demo` });
    expect(s.statusCode).toBe(200);
    expect(s.json().items.map((i: { id: string }) => i.id)).toContain(vendor.id);

    // 3. PO with two lines; client-supplied total is ignored
    const po = await app.inject({
      method: 'POST',
      url: `${BASE}/purchase-orders`,
      payload: {
        vendor_id: vendor.id,
        order_date: '2026-10-23',
        currency: 'USD',
        total: '1.00',
        lines: [
          { product_id: PRODUCT_A, quantity: '10.00', price: '15.50' },
          { product_id: PRODUCT_B, quantity: '3.00', price: '20.25' },
        ],
      },
    });
    expect(po.statusCode).toBe(201);
    const created = po.json();
    expect(created.status).toBe('Draft');
    expect(created.total).toBe('215.75');

    // 4. skipping a state is refused
    const skip = await app.inject({
      method: 'PATCH',
      url: `${BASE}/purchase-orders/${created.id}`,
      payload: { status: 'Received' },
    });
    expect(skip.statusCode).toBe(422);
    expect(skip.json().code).toBe('INVALID_STATUS_TRANSITION');

    // 5. walk the allowed flow
    for (const next of ['Sent', 'Received', 'Closed']) {
      const r = await app.inject({
        method: 'PATCH',
        url: `${BASE}/purchase-orders/${created.id}`,
        payload: { status: next },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().status).toBe(next);
      // status changes never touch lines or total (no inventory effect in V1)
      expect(r.json().total).toBe('215.75');
      expect(r.json().lines).toHaveLength(2);
    }

    // 6. backwards / terminal transitions are refused
    const back = await app.inject({
      method: 'PATCH',
      url: `${BASE}/purchase-orders/${created.id}`,
      payload: { status: 'Draft' },
    });
    expect(back.statusCode).toBe(422);

    // 7. unknown product is refused
    const bad = await app.inject({
      method: 'POST',
      url: `${BASE}/purchase-orders`,
      payload: {
        vendor_id: vendor.id,
        order_date: '2026-10-23',
        lines: [{ product_id: randomUUID(), quantity: '1.00', price: '1.00' }],
      },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe('UNKNOWN_PRODUCT');

    // 8. list shows the Closed order
    const list = await app.inject({ method: 'GET', url: `${BASE}/purchase-orders?status=Closed` });
    expect(list.json().total).toBe(1);
    await app.close();
  });
});
