/**
 * ERP-2 Vendors & Purchasing - deterministic seed / reset helper (synthetic data only).
 *
 * Writes ONLY through the public API (/api/v1/erp-vendors/*), never to private tables.
 * Deterministic: fixed batch id, fixed idempotency keys, fixed tax/PO numbers. Re-running is a no-op
 * (every request replays as HTTP 200 and returns the same ids).
 *
 * CLI (against a running API):
 *   ERP2_BASE_URL=http://localhost:3000 [ERP2_AUTH_TOKEN=...] node sample-data/erp-2/seed.ts
 * Reset = recreate the database (`npm run db:reset`); in-process tests reset by building a fresh app.
 *
 * ERP2_PRODUCT_IDS (comma separated UUIDs) overrides the fixture product ids so they match ERP-1 seed data.
 */

export const SEED_BATCH_ID = 'b4700000-0000-4000-8000-000000000001';

const DEFAULT_PRODUCTS = [
  '5eed0000-0000-4000-8000-0000000000a1',
  '5eed0000-0000-4000-8000-0000000000a2',
  '5eed0000-0000-4000-8000-0000000000a3',
];

export function seedProductIds(): string[] {
  const fromEnv = typeof process !== 'undefined' ? process.env['ERP2_PRODUCT_IDS'] : undefined;
  if (fromEnv) {
    const ids = fromEnv.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    if (ids.length >= 3) return ids;
  }
  return DEFAULT_PRODUCTS;
}

export const SEED_VENDORS = [
  { name: 'Northwind Industrial Supply', tax_number: 'TX-SEED-001', email: 'orders@northwind.example', phone: '+1-555-0101', address_line: '1 Harbor Road', city: 'Portland', country: 'USA', bank_details: '123456787890', currency: 'USD' },
  { name: 'Contoso Components GmbH', tax_number: 'TX-SEED-002', email: 'sales@contoso.example', phone: '+49-555-0102', address_line: '22 Werkstrasse', city: 'Stuttgart', country: 'DEU', bank_details: '998877665544', currency: 'EUR' },
  { name: 'Fabrikam Packaging Ltd', tax_number: 'TX-SEED-003', email: 'hello@fabrikam.example', phone: '+91-555-0103', address_line: '7 MIDC Estate', city: 'Navi Mumbai', country: 'IND', bank_details: '556677884321', currency: 'INR' },
] as const;

type Status = 'Draft' | 'Sent' | 'Received' | 'Closed';
const FLOW: Status[] = ['Draft', 'Sent', 'Received', 'Closed'];

export const SEED_PURCHASE_ORDERS = [
  { po_number: 'PO-SEED-0001', vendorIndex: 0, order_date: '2026-10-01', currency: 'USD', finalStatus: 'Draft' as Status,
    lines: [{ productIndex: 0, quantity: '10.00', price: '15.50' }, { productIndex: 1, quantity: '3.00', price: '20.25' }] },
  { po_number: 'PO-SEED-0002', vendorIndex: 1, order_date: '2026-10-05', currency: 'EUR', finalStatus: 'Sent' as Status,
    lines: [{ productIndex: 2, quantity: '4.00', price: '0.34' }] },
  { po_number: 'PO-SEED-0003', vendorIndex: 2, order_date: '2026-10-09', currency: 'INR', finalStatus: 'Received' as Status,
    lines: [{ productIndex: 0, quantity: '100.00', price: '2.50' }, { productIndex: 2, quantity: '1.00', price: '999.99' }] },
];

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}
export type PostFn = (
  method: 'POST' | 'PATCH',
  path: string,
  body: Record<string, unknown>
) => Promise<ApiResponse>;

export interface SeedResult {
  vendorIds: string[];
  purchaseOrderIds: string[];
  /** true when every row already existed (second run) */
  replayed: boolean;
}

const BASE = '/api/v1/erp-vendors';

function expectOk(res: ApiResponse, what: string): void {
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Seed step failed (${what}): HTTP ${res.status} ${JSON.stringify(res.body)}`);
  }
}

export async function runSeed(post: PostFn): Promise<SeedResult> {
  const products = seedProductIds();
  const vendorIds: string[] = [];
  const purchaseOrderIds: string[] = [];
  let allReplayed = true;

  for (let i = 0; i < SEED_VENDORS.length; i++) {
    const v = SEED_VENDORS[i]!;
    const res = await post('POST', `${BASE}/vendors`, {
      ...v,
      batch_id: SEED_BATCH_ID,
      source_row: i + 1,
      source_system: 'erp2-seed',
      source_id: `seed-vendor-${i + 1}`,
      idempotency_key: `erp2-seed-vendor-${i + 1}`,
    });
    expectOk(res, `vendor ${v.tax_number}`);
    if (res.status === 201) allReplayed = false;
    vendorIds.push(String(res.body['id']));
  }

  for (let i = 0; i < SEED_PURCHASE_ORDERS.length; i++) {
    const po = SEED_PURCHASE_ORDERS[i]!;
    const res = await post('POST', `${BASE}/purchase-orders`, {
      po_number: po.po_number,
      vendor_id: vendorIds[po.vendorIndex],
      order_date: po.order_date,
      currency: po.currency,
      lines: po.lines.map((l) => ({
        product_id: products[l.productIndex],
        quantity: l.quantity,
        price: l.price,
      })),
      batch_id: SEED_BATCH_ID,
      source_row: 100 + i,
      idempotency_key: `erp2-seed-po-${i + 1}`,
    });
    expectOk(res, `purchase order ${po.po_number}`);
    if (res.status === 201) allReplayed = false;
    const id = String(res.body['id']);
    purchaseOrderIds.push(id);

    // Walk forward only through steps that are still ahead (safe on re-run).
    let current = String(res.body['status']) as Status;
    while (FLOW.indexOf(current) < FLOW.indexOf(po.finalStatus)) {
      const next = FLOW[FLOW.indexOf(current) + 1]!;
      const patched = await post('PATCH', `${BASE}/purchase-orders/${id}`, { status: next });
      expectOk(patched, `${po.po_number} -> ${next}`);
      current = next;
    }
  }

  return { vendorIds, purchaseOrderIds, replayed: allReplayed };
}

// ---- CLI entry (only when run directly with node) -------------------------------------------
const isMain =
  typeof process !== 'undefined' && Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' && process.argv[1].endsWith('seed.ts') &&
  process.argv[1].includes('erp-2');

if (isMain) {
  const base = process.env['ERP2_BASE_URL'];
  if (!base) {
    console.error('Set ERP2_BASE_URL (e.g. http://localhost:3000). Seed writes only through the public API.');
    process.exit(1);
  }
  const token = process.env['ERP2_AUTH_TOKEN'];
  const post: PostFn = async (method, path, body) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers['authorization'] = `Bearer ${token}`;
    const r = await fetch(`${base}${path}`, { method, headers, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  runSeed(post)
    .then((r) => {
      console.log(`ERP-2 seed ok (${r.replayed ? 'already seeded, replayed' : 'created'}):`);
      console.log(`  vendors: ${r.vendorIds.length}, purchase orders: ${r.purchaseOrderIds.length}`);
    })
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
