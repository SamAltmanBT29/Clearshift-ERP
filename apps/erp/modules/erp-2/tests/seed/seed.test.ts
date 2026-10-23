import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ReferenceResolver } from '@cs/kernel';
import { buildApp } from '../../src/app.js';
import { InMemoryErp2Repository } from '../../src/services/repository.js';
import {
  SEED_PURCHASE_ORDERS,
  SEED_VENDORS,
  runSeed,
  seedProductIds,
  type PostFn,
} from '../../../../../../sample-data/erp-2/seed.js';

const BASE = '/api/v1/erp-vendors';

function makeResolver(): ReferenceResolver {
  const products = new Set(seedProductIds());
  return {
    async exists(entity: string, id: string): Promise<boolean> {
      return entity === 'product' && products.has(id);
    },
    async get<T = unknown>(): Promise<T | null> {
      return null;
    },
  };
}

describe('ERP-2 deterministic seed (public API only)', () => {
  let app: FastifyInstance;
  let repo: InMemoryErp2Repository;
  let post: PostFn;

  beforeEach(() => {
    repo = new InMemoryErp2Repository(false); // clean slate == "reset"
    app = buildApp({ repository: repo, referenceResolver: makeResolver() });
    post = async (method, path, body) => {
      const res = await app.inject({ method, url: path, payload: body });
      return { status: res.statusCode, body: res.json() as Record<string, unknown> };
    };
  });

  it('creates the documented vendors and purchase orders', async () => {
    const r = await runSeed(post);
    expect(r.replayed).toBe(false);
    expect(r.vendorIds).toHaveLength(SEED_VENDORS.length);
    expect(r.purchaseOrderIds).toHaveLength(SEED_PURCHASE_ORDERS.length);
    expect(repo.vendors.size).toBe(3);
    expect(repo.purchaseOrders.size).toBe(3);
  });

  it('is idempotent: second run replays and creates nothing new', async () => {
    const first = await runSeed(post);
    const second = await runSeed(post);
    expect(second.replayed).toBe(true);
    expect(second.vendorIds).toEqual(first.vendorIds);
    expect(second.purchaseOrderIds).toEqual(first.purchaseOrderIds);
    expect(repo.vendors.size).toBe(3);
    expect(repo.purchaseOrders.size).toBe(3);
    expect(repo.receipts.size).toBe(6);
  });

  it('produces identical business data on a fresh reset (deterministic)', async () => {
    const strip = (po: { po_number: string; total: string; status: string; currency: string }) => ({
      po_number: po.po_number,
      total: po.total,
      status: po.status,
      currency: po.currency,
    });
    await runSeed(post);
    const a = [...repo.purchaseOrders.values()].map(strip).sort((x, y) => x.po_number.localeCompare(y.po_number));

    repo = new InMemoryErp2Repository(false);
    app = buildApp({ repository: repo, referenceResolver: makeResolver() });
    await runSeed(post);
    const b = [...repo.purchaseOrders.values()].map(strip).sort((x, y) => x.po_number.localeCompare(y.po_number));
    expect(b).toEqual(a);
  });

  it('seeded totals are server-computed with half-up rounding', async () => {
    await runSeed(post);
    const byNumber = new Map([...repo.purchaseOrders.values()].map((p) => [p.po_number, p]));
    expect(byNumber.get('PO-SEED-0001')?.total).toBe('215.75');
    expect(byNumber.get('PO-SEED-0002')?.total).toBe('1.36'); // 4 x 0.34 = 1.36
    expect(byNumber.get('PO-SEED-0003')?.total).toBe('1249.99');
  });

  it('seeded purchase orders end in their documented status', async () => {
    await runSeed(post);
    const byNumber = new Map([...repo.purchaseOrders.values()].map((p) => [p.po_number, p]));
    for (const po of SEED_PURCHASE_ORDERS) {
      expect(byNumber.get(po.po_number)?.status).toBe(po.finalStatus);
    }
  });

  it('never stores or returns raw bank details', async () => {
    await runSeed(post);
    for (const v of repo.vendors.values()) {
      expect(v.bank_masked).toMatch(/^XXXX-XXXX-\d{4}$/);
    }
    const res = await app.inject({ method: 'GET', url: `${BASE}/vendors` });
    expect(res.payload).not.toContain('123456787890');
    expect(res.payload).not.toContain('998877665544');
  });

  it('rejects the seed when ERP-1 does not know the products (BR-ERP2-01)', async () => {
    app = buildApp({
      repository: repo,
      referenceResolver: {
        async exists(): Promise<boolean> {
          return false;
        },
        async get<T = unknown>(): Promise<T | null> {
          return null;
        },
      },
    });
    await expect(runSeed(post)).rejects.toThrow(/HTTP 422/);
  });
});
