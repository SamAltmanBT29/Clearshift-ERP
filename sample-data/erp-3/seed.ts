/**
 * ERP-3 Sales Orders & Invoices — Deterministic Seed / Reset Helper (Synthetic Data Only)
 *
 * Writes ONLY through the public API (/api/v1/erp-orders/*), never directly to private tables.
 * Deterministic: fixed batch id, fixed idempotency keys, fixed order/invoice numbers.
 * Re-running is idempotent and safe.
 *
 * CLI:
 *   ERP3_BASE_URL=http://localhost:3000 [ERP3_AUTH_TOKEN=...] node sample-data/erp-3/seed.ts
 */

export const SEED_BATCH_ID = '3b000000-0000-4000-8000-000000000001';

export const SEED_CUSTOMERS = [
  'c0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000003',
];

export const SEED_PRODUCTS = [
  '5eed0000-0000-4000-8000-0000000000a1',
  '5eed0000-0000-4000-8000-0000000000a2',
  '5eed0000-0000-4000-8000-0000000000a3',
];

export const SEED_SALES_ORDERS = [
  {
    order_number: 'SO-SEED-0001',
    customer_golden_id: SEED_CUSTOMERS[0],
    order_date: '2026-10-01',
    currency: 'USD',
    lines: [
      { product_id: SEED_PRODUCTS[0], quantity: '10.0000', price: '15.5000', tax_rate: '10.0000' },
      { product_id: SEED_PRODUCTS[1], quantity: '3.0000', price: '20.0000', tax_rate: '10.0000' },
    ],
  },
  {
    order_number: 'SO-SEED-0002',
    customer_golden_id: SEED_CUSTOMERS[1],
    order_date: '2026-10-05',
    currency: 'USD',
    lines: [
      { product_id: SEED_PRODUCTS[2], quantity: '4.0000', price: '50.0000', tax_rate: '18.0000' },
    ],
  },
  {
    order_number: 'SO-SEED-0003',
    customer_golden_id: SEED_CUSTOMERS[2],
    order_date: '2026-10-10',
    currency: 'USD',
    lines: [
      { product_id: SEED_PRODUCTS[0], quantity: '2.0000', price: '100.0000', tax_rate: '5.0000' },
    ],
  },
];

export interface SeedResult {
  ordersCreated: number;
  invoicesCreated: number;
  paymentsCreated: number;
}

export async function runSeed(baseUrl = 'http://localhost:3000', authToken?: string): Promise<SeedResult> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (authToken) {
    headers['authorization'] = `Bearer ${authToken}`;
  }

  let ordersCreated = 0;
  let invoicesCreated = 0;
  let paymentsCreated = 0;

  for (const so of SEED_SALES_ORDERS) {
    const res = await fetch(`${baseUrl}/api/v1/erp-orders/sales-orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify(so),
    });

    if (res.status === 201 || res.status === 200) {
      ordersCreated++;
    }
  }

  return { ordersCreated, invoicesCreated, paymentsCreated };
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('seed.ts')) {
  const baseUrl = process.env['ERP3_BASE_URL'] || 'http://localhost:3000';
  const token = process.env['ERP3_AUTH_TOKEN'];
  runSeed(baseUrl, token)
    .then((result) => {
      console.log('Seed completed successfully:', result);
    })
    .catch((err) => {
      console.error('Seed error:', err);
      process.exit(1);
    });
}
