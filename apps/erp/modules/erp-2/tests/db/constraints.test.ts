/**
 * ERP-2 DB tests against a REAL PostgreSQL (constraints, transactions, idempotent receipts).
 * Runs only when DATABASE_URL is set (CI sets it; locally: `npm run compose:up`, then
 * DATABASE_URL=postgres://... npx vitest run apps/erp/modules/erp-2/tests/db).
 * The suite creates the erp2 schema/tables IF NOT EXISTS, then TRUNCATEs erp2.* before every test,
 * so point it at a throw-away test database only.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DrizzleErp2Repository } from '../../src/services/repository.js';
import { Erp2Service, ConflictError } from '../../src/services/erp2.service.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const PG_MODULE = 'pg'; // variable on purpose: avoids a hard type dependency on @types/pg

interface PgPool {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}

const DDL = `
CREATE SCHEMA IF NOT EXISTS erp2;
DO $$ BEGIN CREATE TYPE erp2.po_status AS ENUM ('Draft','Sent','Received','Closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS erp2.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL, tax_number varchar(64) NOT NULL, email varchar(255) NOT NULL,
  phone varchar(32), address_line varchar(255), city varchar(100), country varchar(64),
  bank_masked varchar(64), currency varchar(3) NOT NULL DEFAULT 'USD',
  source_system varchar(64), source_id varchar(128),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS vendors_tax_number_unique ON erp2.vendors (tax_number);
CREATE TABLE IF NOT EXISTS erp2.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number varchar(64) NOT NULL, vendor_id uuid NOT NULL REFERENCES erp2.vendors(id),
  order_date date NOT NULL, status erp2.po_status NOT NULL DEFAULT 'Draft',
  currency varchar(3) NOT NULL DEFAULT 'USD', total numeric(18,2) NOT NULL DEFAULT 0.00,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_po_number_unique ON erp2.purchase_orders (po_number);
CREATE TABLE IF NOT EXISTS erp2.po_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES erp2.purchase_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL, quantity numeric(12,2) NOT NULL, price numeric(18,2) NOT NULL,
  line_total numeric(18,2) NOT NULL);
CREATE TABLE IF NOT EXISTS erp2.import_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL, source_row integer NOT NULL, source_system varchar(64), source_id varchar(128),
  entity varchar(64) NOT NULL, schema_version integer NOT NULL DEFAULT 1,
  idempotency_key varchar(128) NOT NULL, request_hash varchar(64) NOT NULL, target_id uuid NOT NULL,
  kind varchar(16) NOT NULL DEFAULT 'created', outcome varchar(16) NOT NULL DEFAULT 'loaded',
  response_payload text, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS erp2_import_receipts_key_unique ON erp2.import_receipts (idempotency_key);
`;

const PRODUCT = '5eed0000-0000-4000-8000-0000000000a1';
const BATCH = 'b4700000-0000-4000-8000-0000000000ff';

describe.skipIf(!DATABASE_URL)('ERP-2 database constraints and transactions (PostgreSQL)', () => {
  let pool: PgPool;
  let db: NodePgDatabase;
  let repo: DrizzleErp2Repository;
  let service: Erp2Service;

  beforeAll(async () => {
    const pg = (await import(PG_MODULE)) as { default?: { Pool: new (o: unknown) => PgPool }; Pool?: new (o: unknown) => PgPool };
    const Pool = pg.default?.Pool ?? pg.Pool;
    if (!Pool) throw new Error('pg.Pool not found');
    pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query(DDL);
    db = drizzle(pool as never);
    repo = new DrizzleErp2Repository(db);
    service = new Erp2Service({
      repository: repo,
      referenceResolver: {
        async exists(entity: string, id: string): Promise<boolean> {
          return entity === 'product' && id === PRODUCT;
        },
        async get<T = unknown>(): Promise<T | null> {
          return null;
        },
      },
    });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE erp2.po_lines, erp2.purchase_orders, erp2.vendors, erp2.import_receipts RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function insertVendor(tax: string, name = 'V ' + tax): Promise<string> {
    const r = await pool.query(
      `INSERT INTO erp2.vendors (name, tax_number, email) VALUES ($1,$2,'a@b.example') RETURNING id`,
      [name, tax]
    );
    return String(r.rows[0]?.['id']);
  }
  async function insertPo(vendorId: string, number: string): Promise<string> {
    const r = await pool.query(
      `INSERT INTO erp2.purchase_orders (po_number, vendor_id, order_date) VALUES ($1,$2,'2026-10-01') RETURNING id`,
      [number, vendorId]
    );
    return String(r.rows[0]?.['id']);
  }
  const count = async (table: string): Promise<number> =>
    Number((await pool.query(`SELECT count(*)::int AS c FROM erp2.${table}`)).rows[0]?.['c']);

  // ---------------- constraints ----------------
  it('rejects a duplicate vendor tax number (unique)', async () => {
    await insertVendor('TX-1');
    await expect(insertVendor('TX-1')).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects a duplicate purchase order number (unique)', async () => {
    const v = await insertVendor('TX-1');
    await insertPo(v, 'PO-1');
    await expect(insertPo(v, 'PO-1')).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects a purchase order for an unknown vendor (FK)', async () => {
    await expect(insertPo(randomUUID(), 'PO-X')).rejects.toMatchObject({ code: '23503' });
  });

  it('rejects an invalid status value (enum has no Cancelled in V1)', async () => {
    const v = await insertVendor('TX-1');
    await expect(
      pool.query(`INSERT INTO erp2.purchase_orders (po_number, vendor_id, order_date, status) VALUES ('PO-C',$1,'2026-10-01','Cancelled')`, [v])
    ).rejects.toMatchObject({ code: '22P02' });
  });

  it('stores money as NUMERIC(18,2): exact decimals, overflow rejected', async () => {
    const v = await insertVendor('TX-1');
    await pool.query(`INSERT INTO erp2.purchase_orders (po_number, vendor_id, order_date, total) VALUES ('PO-M',$1,'2026-10-01', 0.10 + 0.20)`, [v]);
    const r = await pool.query(`SELECT total::text AS t FROM erp2.purchase_orders WHERE po_number='PO-M'`);
    expect(r.rows[0]?.['t']).toBe('0.30');
    await expect(
      pool.query(`INSERT INTO erp2.purchase_orders (po_number, vendor_id, order_date, total) VALUES ('PO-O',$1,'2026-10-01', 10000000000000000.00)`, [v])
    ).rejects.toMatchObject({ code: '22003' });
  });

  it('deleting a purchase order cascades to its lines', async () => {
    const v = await insertVendor('TX-1');
    const po = await insertPo(v, 'PO-1');
    await pool.query(`INSERT INTO erp2.po_lines (po_id, product_id, quantity, price, line_total) VALUES ($1,$2,1,1,1)`, [po, PRODUCT]);
    await pool.query('DELETE FROM erp2.purchase_orders WHERE id=$1', [po]);
    expect(await count('po_lines')).toBe(0);
  });

  it('has no FK from lines to ERP-1 products (cross-module integrity is via the resolver, Decision C7)', async () => {
    const v = await insertVendor('TX-1');
    const po = await insertPo(v, 'PO-1');
    await expect(
      pool.query(`INSERT INTO erp2.po_lines (po_id, product_id, quantity, price, line_total) VALUES ($1,$2,1,1,1)`, [po, randomUUID()])
    ).resolves.toBeDefined();
  });

  it('enforces one import receipt per idempotency key (unique)', async () => {
    const ins = () =>
      pool.query(
        `INSERT INTO erp2.import_receipts (batch_id, source_row, entity, idempotency_key, request_hash, target_id) VALUES ($1,1,'vendor','K1','h',$2)`,
        [BATCH, randomUUID()]
      );
    await ins();
    await expect(ins()).rejects.toMatchObject({ code: '23505' });
  });

  // ---------------- transactions ----------------
  it('rolls back a vendor created inside a failing transaction', async () => {
    await expect(
      repo.executeTransactional(async (tx) => {
        await tx.createVendor({ name: 'Ghost', tax_number: 'TX-G', email: 'g@x.example' } as never, null);
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(await count('vendors')).toBe(0);
  });

  it('purchase order header and lines are atomic: a bad line leaves no orphan header', async () => {
    const v = await insertVendor('TX-1');
    await expect(
      repo.createPurchaseOrder({
        id: randomUUID(),
        po_number: 'PO-ATOMIC',
        vendor_id: v,
        order_date: '2026-10-01',
        status: 'Draft',
        currency: 'USD',
        total: '1.00',
        lines: [{ id: randomUUID(), po_id: 'x', product_id: 'not-a-uuid', quantity: '1.00', price: '1.00', line_total: '1.00' }],
      } as never)
    ).rejects.toBeDefined();
    expect(await count('purchase_orders')).toBe(0);
  });

  it('import: same key + same payload 3x gives exactly 1 vendor and 1 receipt', async () => {
    const req = {
      batch_id: BATCH, source_row: 1, source_system: null, source_id: null,
      idempotency_key: 'KEY-A', entity: 'vendor' as const,
      record: { name: 'Idem Co', tax_number: 'TX-IDEM', email: 'i@x.example', bank_details: '123456787890' },
    };
    const a = await service.importRow(req as never);
    const b = await service.importRow(req as never);
    const c = await service.importRow(req as never);
    expect(a.prior_result).toBe(false);
    expect(b.prior_result).toBe(true);
    expect(c.target_id).toBe(a.target_id);
    expect(await count('vendors')).toBe(1);
    expect(await count('import_receipts')).toBe(1);
  });

  it('import: same key + different payload is a 409 and writes nothing new', async () => {
    const base = { batch_id: BATCH, source_row: 1, source_system: null, source_id: null, idempotency_key: 'KEY-B', entity: 'vendor' as const };
    await service.importRow({ ...base, record: { name: 'One', tax_number: 'TX-1', email: 'a@x.example' } } as never);
    await expect(
      service.importRow({ ...base, record: { name: 'Two', tax_number: 'TX-2', email: 'a@x.example' } } as never)
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await count('vendors')).toBe(1);
    expect(await count('import_receipts')).toBe(1);
  });

  it('import: a rejected row (duplicate tax number) leaves no vendor and no receipt', async () => {
    await insertVendor('TX-DUP');
    await expect(
      service.importRow({
        batch_id: BATCH, source_row: 2, source_system: null, source_id: null, idempotency_key: 'KEY-C', entity: 'vendor',
        record: { name: 'Dup', tax_number: 'TX-DUP', email: 'd@x.example' },
      } as never)
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await count('vendors')).toBe(1);
    expect(await count('import_receipts')).toBe(0);
  });

  // ---------------- repository query correctness ----------------
  it('vendor list: search is case-insensitive on name and tax number, and total honours the filter', async () => {
    await insertVendor('TX-A', 'Alpha Steel');
    await insertVendor('TX-B', 'Beta Steel');
    await insertVendor('TX-C', 'Gamma Plastics');
    const byName = await repo.listVendors({ search: 'steel', page: 1, pageSize: 10 } as never);
    expect(byName.vendors.map((x) => x.name)).toEqual(['Alpha Steel', 'Beta Steel']);
    expect(byName.total).toBe(2);
    const byTax = await repo.listVendors({ search: 'tx-c', page: 1, pageSize: 10 } as never);
    expect(byTax.total).toBe(1);
  });

  it('vendor list: LIKE wildcards in search text are matched literally', async () => {
    await insertVendor('TX-A', 'Alpha 100% Steel');
    await insertVendor('TX-B', 'Beta Steel');
    const r = await repo.listVendors({ search: '100%', page: 1, pageSize: 10 } as never);
    expect(r.total).toBe(1);
  });

  it('purchase order list: vendor AND status filters combine, total honours both', async () => {
    const v1 = await insertVendor('TX-1');
    const v2 = await insertVendor('TX-2');
    const p1 = await insertPo(v1, 'PO-1');
    await insertPo(v1, 'PO-2');
    await insertPo(v2, 'PO-3');
    await pool.query(`UPDATE erp2.purchase_orders SET status='Sent' WHERE id=$1`, [p1]);
    const r = await repo.listPurchaseOrders({ vendor_id: v1, status: 'Sent', page: 1, pageSize: 10 } as never);
    expect(r.purchaseOrders.map((p) => p.po_number)).toEqual(['PO-1']);
    expect(r.total).toBe(1);
  });
});
