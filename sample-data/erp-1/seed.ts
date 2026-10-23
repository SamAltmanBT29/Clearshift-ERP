/**
 * ERP-1 Products & Inventory — Deterministic Seed / Reset Helper (Synthetic Data Only)
 *
 * Writes ONLY through the public API (/api/v1/erp-products/*), never to private tables.
 * Deterministic: fixed batch id, fixed category codes, fixed SKUs.
 * Re-running is a clean no-op / replay (every request returns the same ids without duplicate insertion).
 *
 * CLI usage (against a running API):
 *   ERP1_BASE_URL=http://localhost:3000 node sample-data/erp-1/seed.ts
 *
 * In-process usage (e.g. Vitest):
 *   import { runSeed } from './seed.js';
 *   await runSeed(postFn);
 *
 * @module sample-data/erp-1/seed
 */

export const SEED_BATCH_ID = 'b1000000-0000-4000-8000-000000000001';
export const DEFAULT_WAREHOUSE_ID = '00000000-0000-4000-8000-000000000001';

export const SEED_CATEGORIES = [
  { name: 'Hardware & Tools', code: 'CAT-TOOL' },
  { name: 'Office Supplies', code: 'CAT-OFFICE' },
  { name: 'Packaging Materials', code: 'CAT-PACK' },
] as const;

export const SEED_PRODUCTS = [
  {
    name: 'Professional Claw Hammer 16oz',
    sku: 'SKU-HAMMER-01',
    categoryIndex: 0,
    unitOfMeasure: 'pcs',
    price: '24.5000',
    currency: 'USD',
    taxRate: '5.00',
    description: 'Forged steel head with ergonomic vibration-damping grip',
    openingStock: '150.0000',
  },
  {
    name: 'Premium A4 Copier Paper 80gsm',
    sku: 'SKU-PAPER-A4',
    categoryIndex: 1,
    unitOfMeasure: 'box',
    price: '32.0000',
    currency: 'USD',
    taxRate: '8.00',
    description: 'Box of 5 reams (2500 sheets) high-brightness multipurpose paper',
    openingStock: '50.0000',
  },
  {
    name: 'Synthetic Industrial Lubricant 1L',
    sku: 'SKU-LUBE-01',
    categoryIndex: 2,
    unitOfMeasure: 'litre',
    price: '15.7500',
    currency: 'USD',
    taxRate: '5.00',
    description: 'High-viscosity multi-grade lubricant for warehouse machinery',
    openingStock: '75.0000',
  },
] as const;

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

export type PostFn = (
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: Record<string, unknown>
) => Promise<ApiResponse>;

export interface SeedResult {
  categoryIds: string[];
  productIds: string[];
  stockIds: string[];
  /** true when all entities were already present and replayed */
  replayed: boolean;
}

const BASE = '/api/v1/erp-products';

function expectOk(res: ApiResponse, what: string): void {
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Seed step failed (${what}): HTTP ${res.status} ${JSON.stringify(res.body)}`);
  }
}

export async function runSeed(post: PostFn): Promise<SeedResult> {
  const categoryIds: string[] = [];
  const productIds: string[] = [];
  const stockIds: string[] = [];
  let allReplayed = true;

  // 1. Seed Categories
  for (let i = 0; i < SEED_CATEGORIES.length; i++) {
    const cat = SEED_CATEGORIES[i]!;
    const res = await post('POST', `${BASE}/categories`, {
      name: cat.name,
      code: cat.code,
    });

    if (res.status === 201) {
      allReplayed = false;
      categoryIds.push(String(res.body['id']));
    } else if (res.status === 409) {
      // Already exists - fetch category by code or list
      const listRes = await post('GET', `${BASE}/categories`);
      expectOk(listRes, 'fetch categories');
      const items = (listRes.body['items'] as Array<{ id: string; code: string }>) ?? [];
      const match = items.find((c) => c.code === cat.code);
      if (!match) throw new Error(`Category ${cat.code} conflict but not found in list`);
      categoryIds.push(match.id);
    } else {
      expectOk(res, `category ${cat.code}`);
    }
  }

  // 2. Seed Products
  for (let i = 0; i < SEED_PRODUCTS.length; i++) {
    const prod = SEED_PRODUCTS[i]!;
    const catId = categoryIds[prod.categoryIndex];
    const res = await post('POST', `${BASE}/products`, {
      name: prod.name,
      sku: prod.sku,
      categoryId: catId,
      unitOfMeasure: prod.unitOfMeasure,
      price: prod.price,
      currency: prod.currency,
      taxRate: prod.taxRate,
      description: prod.description,
    });

    if (res.status === 201) {
      allReplayed = false;
      productIds.push(String(res.body['id']));
    } else if (res.status === 409) {
      // Already exists - fetch product by SKU
      const listRes = await post('GET', `${BASE}/products?search=${encodeURIComponent(prod.sku)}`);
      expectOk(listRes, `search product ${prod.sku}`);
      const items = (listRes.body['items'] as Array<{ id: string; sku: string }>) ?? [];
      const match = items.find((p) => p.sku === prod.sku);
      if (!match) throw new Error(`Product ${prod.sku} conflict but not found in search`);
      productIds.push(match.id);
    } else {
      expectOk(res, `product ${prod.sku}`);
    }
  }

  // 3. Seed Opening Stock
  for (let i = 0; i < SEED_PRODUCTS.length; i++) {
    const prod = SEED_PRODUCTS[i]!;
    const prodId = productIds[i]!;
    const res = await post('POST', `${BASE}/stock/opening`, {
      productId: prodId,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      quantity: prod.openingStock,
      notes: `V1 initial opening stock balance: ${prod.name}`,
    });

    if (res.status === 201) {
      allReplayed = false;
    }
    expectOk(res, `stock for product ${prod.sku}`);
    stockIds.push(String(res.body['id']));
  }

  return {
    categoryIds,
    productIds,
    stockIds,
    replayed: allReplayed,
  };
}

// CLI runner
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('seed.ts')) {
  const baseUrl = process.env['ERP1_BASE_URL'] ?? 'http://localhost:3000';
  const post: PostFn = async (method, path, body) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(process.env['ERP1_AUTH_TOKEN']
          ? { authorization: `Bearer ${process.env['ERP1_AUTH_TOKEN']}` }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
    return { status: res.status, body: parsed };
  };

  runSeed(post)
    .then((result) => {
      console.log('✅ ERP-1 seed complete:', {
        categories: result.categoryIds.length,
        products: result.productIds.length,
        stockLevels: result.stockIds.length,
        replayed: result.replayed,
      });
    })
    .catch((err) => {
      console.error('❌ ERP-1 seed failed:', err);
      process.exit(1);
    });
}
