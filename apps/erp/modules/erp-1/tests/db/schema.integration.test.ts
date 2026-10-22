/**
 * ERP-1 Products & Inventory — Database Constraint Proofs (live PostgreSQL)
 *
 * These tests prove the ERP-1 invariants are enforced by PostgreSQL, not only
 * by Zod or UI validation:
 *
 *   1. A clean database applies every migration exactly once.
 *   2. Re-running the migration job does not reapply an applied migration.
 *   3. SKU uniqueness, normalized-SKU uniqueness and stock-pair uniqueness
 *      reject duplicates with SQLSTATE 23505.
 *   4. Price, tax, stock, currency, warehouse and receipt checks reject
 *      invalid values with SQLSTATE 23514.
 *   5. Foreign keys reject missing references with SQLSTATE 23503.
 *   6. The V1 one-warehouse rule rejects a second warehouse.
 *   7. The KIT-08 receipt key makes a repeated import row idempotent.
 *   8. Opening-stock upserts do not duplicate the product/warehouse row.
 *   9. The updated_at triggers keep audit columns current.
 *
 * The suite creates its own throwaway database and drops it afterwards; it
 * never touches a developer or production database.
 *
 * Run with:
 *   DATABASE_URL_TEST=postgresql://user:pass@localhost:5432/postgres \
 *     npx vitest run apps/erp/modules/erp-1
 *
 * @module erp1/tests/db/schema.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL('../../../../../..', import.meta.url));
const MIGRATION_RUNNER = fileURLToPath(
  new URL('../../../../../../packages/database/scripts/migrate.js', import.meta.url)
);

const ADMIN_URL = process.env['DATABASE_URL_TEST'];
const SCRATCH_NAME = `erp1_scratch_${Math.random().toString(36).slice(2, 10)}`;
const SCRATCH_URL = ADMIN_URL
  ? ADMIN_URL.replace(/\/([^/?]+)(\?|$)/, `/${SCRATCH_NAME}$2`)
  : undefined;

const SEEDED_CATEGORY_ID = '00000000-0000-4000-8000-000000000001';
const SEEDED_WAREHOUSE_ID = '00000000-0000-4000-8000-000000000002';

if (!ADMIN_URL) {
  console.warn(
    '[erp-1] DATABASE_URL_TEST is not set — the live PostgreSQL constraint proofs are skipped. ' +
      'Set DATABASE_URL_TEST to run them.'
  );
}

interface PgError extends Error {
  code?: string;
  constraint?: string;
}

async function expectViolation(
  client: pg.PoolClient,
  statement: string,
  params: unknown[],
  expectedCode: string
): Promise<PgError> {
  await client.query('SAVEPOINT violation_probe');
  let caught: PgError | null = null;
  try {
    await client.query(statement, params);
  } catch (error) {
    caught = error as PgError;
  }
  await client.query('ROLLBACK TO SAVEPOINT violation_probe');

  expect(caught, `expected ${expectedCode} while executing: ${statement}`).not.toBeNull();
  expect(caught?.code, `PostgreSQL said: ${caught?.message}`).toBe(expectedCode);
  return caught as PgError;
}

async function insertProduct(
  client: pg.PoolClient,
  overrides: Partial<{
    name: string;
    sku: string;
    normalizedSku: string;
    categoryId: string | null;
    unitOfMeasure: string;
    price: string;
    currency: string;
    taxRate: string;
  }> = {}
): Promise<string> {
  const values = {
    name: 'Synthetic Widget',
    sku: `SKU-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    normalizedSku: `NORM-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    categoryId: null as string | null,
    unitOfMeasure: 'pcs',
    price: '19.9900',
    currency: 'USD',
    taxRate: '5.00',
    ...overrides,
  };

  const result = await client.query<{ id: string }>(
    `INSERT INTO erp1.products
       (name, sku, normalized_sku, category_id, unit_of_measure, price, currency, tax_rate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      values.name,
      values.sku,
      values.normalizedSku,
      values.categoryId,
      values.unitOfMeasure,
      values.price,
      values.currency,
      values.taxRate,
    ]
  );
  return result.rows[0]!.id;
}

describe.skipIf(!ADMIN_URL)('ERP-1 database constraints (live PostgreSQL)', () => {
  let admin: pg.Pool;
  let db: pg.Pool;
  let runnerOutput = '';
  let secondRunnerOutput = '';

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: ADMIN_URL as string });
    await admin.query(`CREATE DATABASE "${SCRATCH_NAME}" TEMPLATE template0`);

    db = new pg.Pool({ connectionString: SCRATCH_URL as string });

    const first = await execFileAsync(process.execPath, [MIGRATION_RUNNER], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        DATABASE_URL: SCRATCH_URL as string,
      },
    });
    runnerOutput = `${first.stdout}${first.stderr}`;

    const second = await execFileAsync(process.execPath, [MIGRATION_RUNNER], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        DATABASE_URL: SCRATCH_URL as string,
      },
    });
    secondRunnerOutput = `${second.stdout}${second.stderr}`;
  }, 120_000);

  afterAll(async () => {
    if (db) await db.end();
    if (admin) {
      if (SCRATCH_NAME.startsWith('erp1_scratch_')) {
        await admin.query(`DROP DATABASE IF EXISTS "${SCRATCH_NAME}" WITH (FORCE)`);
      }
      await admin.end();
    }
  });

  describe('Migration application', () => {
    it('applies the ERP-1 migration to a clean database exactly once', () => {
      expect(runnerOutput).toContain('erp1_v1 applied successfully');
    });

    it('records the migration in the shared migration ledger', async () => {
      const { rows } = await db.query<{ migration: string }>(
        'SELECT migration FROM public.schema_migrations ORDER BY migration'
      );
      expect(rows.map((row) => row.migration)).toContain('erp1_v1');
    });

    it('does not reapply an already applied migration on a second run', () => {
      expect(secondRunnerOutput).toContain('Skipping erp1_v1 (already applied)');
    });

    it('creates every ERP-1 table and enum in the erp1 schema', async () => {
      const { rows } = await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'erp1' ORDER BY table_name`
      );
      expect(rows.map((row) => row.table_name)).toEqual([
        'categories',
        'import_receipts',
        'products',
        'stock_levels',
        'warehouses',
      ]);

      const { rows: enums } = await db.query<{ enumlabel: string }>(
        `SELECT e.enumlabel
           FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typnamespace = 'erp1'::regnamespace
            AND t.typname = 'unit_of_measure'
          ORDER BY e.enumsortorder`
      );
      expect(enums.map((row) => row.enumlabel)).toEqual([
        'pcs',
        'kg',
        'g',
        'litre',
        'metre',
        'box',
      ]);
    });

    it('uses numeric(19,4) for money and quantities and no implicit currency default', async () => {
      const { rows } = await db.query<{
        table_name: string;
        column_name: string;
        numeric_precision: number | null;
        numeric_scale: number | null;
        column_default: string | null;
        is_nullable: string;
      }>(
        `SELECT table_name, column_name, numeric_precision, numeric_scale,
                column_default, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'erp1'
            AND ((table_name = 'products' AND column_name IN ('price', 'currency'))
              OR (table_name = 'stock_levels' AND column_name = 'quantity'))
          ORDER BY table_name, column_name`
      );

      const price = rows.find((row) => row.column_name === 'price');
      const quantity = rows.find((row) => row.column_name === 'quantity');
      const currency = rows.find((row) => row.column_name === 'currency');

      expect(price?.numeric_precision).toBe(19);
      expect(price?.numeric_scale).toBe(4);
      expect(quantity?.numeric_precision).toBe(19);
      expect(quantity?.numeric_scale).toBe(4);
      expect(currency?.is_nullable).toBe('NO');
      expect(currency?.column_default).toBeNull();
    });

    it('seeds the V1 default warehouse and category with safe synthetic IDs', async () => {
      const warehouse = await db.query<{ id: string; code: string }>(
        'SELECT id, code FROM erp1.warehouses'
      );
      const category = await db.query<{ id: string; code: string }>(
        'SELECT id, code FROM erp1.categories'
      );

      expect(warehouse.rows).toEqual([{ id: SEEDED_WAREHOUSE_ID, code: 'WH-01' }]);
      expect(category.rows).toEqual([{ id: SEEDED_CATEGORY_ID, code: 'GEN' }]);
    });

    it('creates the one-warehouse and stock-pair unique indexes', async () => {
      const { rows } = await db.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
          WHERE schemaname = 'erp1' ORDER BY indexname`
      );
      const names = rows.map((row) => row.indexname);
      expect(names).toContain('erp1_warehouses_single_idx');
      expect(names).toContain('erp1_stock_levels_product_warehouse_idx');
    });
  });

  describe('Unique constraints', () => {
    it('rejects a duplicate SKU (23505)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await insertProduct(client, { sku: 'SKU-DUP', normalizedSku: 'NORM-DUP-A' });

        const error = await expectViolation(
          client,
          `INSERT INTO erp1.products
             (name, sku, normalized_sku, unit_of_measure, price, currency)
           VALUES ('Duplicate', 'SKU-DUP', 'NORM-DUP-B', 'pcs', 10.0000, 'USD')`,
          [],
          '23505'
        );
        expect(error.constraint).toBe('erp1_products_sku_idx');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects a duplicate normalized SKU (23505)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await insertProduct(client, { sku: 'SKU-NORM-A', normalizedSku: 'NORM-SAME' });

        const error = await expectViolation(
          client,
          `INSERT INTO erp1.products
             (name, sku, normalized_sku, unit_of_measure, price, currency)
           VALUES ('Duplicate', 'SKU-NORM-B', 'NORM-SAME', 'pcs', 10.0000, 'USD')`,
          [],
          '23505'
        );
        expect(error.constraint).toBe('erp1_products_normalized_sku_idx');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects a second warehouse in V1 (23505)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const error = await expectViolation(
          client,
          `INSERT INTO erp1.warehouses (name, code) VALUES ('Second', 'WH-02')`,
          [],
          '23505'
        );
        expect(error.constraint).toBe('erp1_warehouses_single_idx');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects duplicate stock rows for a product/warehouse pair (23505)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const productId = await insertProduct(client);

        await client.query(
          `INSERT INTO erp1.stock_levels (product_id, warehouse_id, quantity)
           VALUES ($1, $2, 10.0000)`,
          [productId, SEEDED_WAREHOUSE_ID]
        );

        const error = await expectViolation(
          client,
          `INSERT INTO erp1.stock_levels (product_id, warehouse_id, quantity)
           VALUES ($1, $2, 20.0000)`,
          [productId, SEEDED_WAREHOUSE_ID],
          '23505'
        );
        expect(error.constraint).toBe('erp1_stock_levels_product_warehouse_idx');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects a duplicate KIT-08 idempotency key (23505)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const batchId = '00000000-0000-4000-8000-000000000010';
        const targetId = '00000000-0000-4000-8000-000000000011';
        await client.query(
          `INSERT INTO erp1.import_receipts
             (batch_id, source_row, entity, idempotency_key, target_id)
           VALUES ($1, 1, 'product', 'receipt-key-1', $2)`,
          [batchId, targetId]
        );

        const error = await expectViolation(
          client,
          `INSERT INTO erp1.import_receipts
             (batch_id, source_row, entity, idempotency_key, target_id)
           VALUES ($1, 2, 'product', 'receipt-key-1', $2)`,
          [batchId, targetId],
          '23505'
        );
        expect(error.constraint).toBe('erp1_import_receipts_idempotency_key_unique');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });
  });

  describe('Check constraints', () => {
    it('rejects an unsupported unit of measure (22P02)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await expectViolation(
          client,
          `INSERT INTO erp1.products
             (name, sku, normalized_sku, unit_of_measure, price, currency)
           VALUES ('Bad Unit', 'SKU-UNIT', 'NORM-UNIT', 'dozen', 10.0000, 'USD')`,
          [],
          '22P02'
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects a negative price (23514)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const error = await expectViolation(
          client,
          `INSERT INTO erp1.products
             (name, sku, normalized_sku, unit_of_measure, price, currency)
           VALUES ('Negative', 'SKU-NEG-PRICE', 'NORM-NEG-PRICE', 'pcs', -0.0100, 'USD')`,
          [],
          '23514'
        );
        expect(error.constraint).toBe('check_erp1_products_price_non_negative');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects a negative tax rate (23514)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const error = await expectViolation(
          client,
          `INSERT INTO erp1.products
             (name, sku, normalized_sku, unit_of_measure, price, currency, tax_rate)
           VALUES ('Negative Tax', 'SKU-NEG-TAX', 'NORM-NEG-TAX', 'pcs', 10.0000, 'USD', -0.01)`,
          [],
          '23514'
        );
        expect(error.constraint).toBe('check_erp1_products_tax_rate_non_negative');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects a non-uppercase currency code (23514)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const error = await expectViolation(
          client,
          `INSERT INTO erp1.products
             (name, sku, normalized_sku, unit_of_measure, price, currency)
           VALUES ('Bad Currency', 'SKU-CUR', 'NORM-CUR', 'pcs', 10.0000, 'usd')`,
          [],
          '23514'
        );
        expect(error.constraint).toBe('check_erp1_products_currency_format');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects negative stock (23514)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const productId = await insertProduct(client);
        const error = await expectViolation(
          client,
          `INSERT INTO erp1.stock_levels (product_id, warehouse_id, quantity)
           VALUES ($1, $2, -0.0001)`,
          [productId, SEEDED_WAREHOUSE_ID],
          '23514'
        );
        expect(error.constraint).toBe('check_erp1_stock_quantity_non_negative');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects invalid import receipt row/version/kind values (23514)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const batchId = '00000000-0000-4000-8000-000000000020';
        const targetId = '00000000-0000-4000-8000-000000000021';

        const rowError = await expectViolation(
          client,
          `INSERT INTO erp1.import_receipts
             (batch_id, source_row, entity, idempotency_key, target_id)
           VALUES ($1, 0, 'product', 'receipt-row', $2)`,
          [batchId, targetId],
          '23514'
        );
        expect(rowError.constraint).toBe('check_erp1_import_receipts_source_row_positive');

        const versionError = await expectViolation(
          client,
          `INSERT INTO erp1.import_receipts
             (batch_id, source_row, entity, schema_version, idempotency_key, target_id)
           VALUES ($1, 1, 'product', 0, 'receipt-version', $2)`,
          [batchId, targetId],
          '23514'
        );
        expect(versionError.constraint).toBe(
          'check_erp1_import_receipts_schema_version_positive'
        );

        const kindError = await expectViolation(
          client,
          `INSERT INTO erp1.import_receipts
             (batch_id, source_row, entity, idempotency_key, target_id, kind)
           VALUES ($1, 1, 'product', 'receipt-kind', $2, 'updated')`,
          [batchId, targetId],
          '23514'
        );
        expect(kindError.constraint).toBe('check_erp1_import_receipts_kind_allowed');

        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });
  });

  describe('Foreign keys and cascade behaviour', () => {
    it('rejects a missing category reference (23503)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await expectViolation(
          client,
          `INSERT INTO erp1.products
             (name, sku, normalized_sku, category_id, unit_of_measure, price, currency)
           VALUES ('Bad Category', 'SKU-FK-CAT', 'NORM-FK-CAT', '00000000-0000-4000-8000-000000000099', 'pcs', 10.0000, 'USD')`,
          [],
          '23503'
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('rejects a missing product reference for stock (23503)', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await expectViolation(
          client,
          `INSERT INTO erp1.stock_levels (product_id, warehouse_id, quantity)
           VALUES ('00000000-0000-4000-8000-000000000099', $1, 1.0000)`,
          [SEEDED_WAREHOUSE_ID],
          '23503'
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('sets category_id to NULL when a category is deleted', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const category = await client.query<{ id: string }>(
          `INSERT INTO erp1.categories (name, code) VALUES ('Temporary', 'TMP') RETURNING id`
        );
        const productId = await insertProduct(client, { categoryId: category.rows[0]!.id });

        await client.query('DELETE FROM erp1.categories WHERE id = $1', [
          category.rows[0]!.id,
        ]);
        const product = await client.query<{ category_id: string | null }>(
          'SELECT category_id FROM erp1.products WHERE id = $1',
          [productId]
        );
        expect(product.rows[0]?.category_id).toBeNull();
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('cascades stock deletion when a product is deleted', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const productId = await insertProduct(client);
        await client.query(
          `INSERT INTO erp1.stock_levels (product_id, warehouse_id, quantity)
           VALUES ($1, $2, 5.0000)`,
          [productId, SEEDED_WAREHOUSE_ID]
        );

        await client.query('DELETE FROM erp1.products WHERE id = $1', [productId]);
        const stock = await client.query('SELECT 1 FROM erp1.stock_levels WHERE product_id = $1', [
          productId,
        ]);
        expect(stock.rows).toHaveLength(0);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });
  });

  describe('Opening stock and timestamp behaviour', () => {
    it('upserts opening stock without duplicating the product/warehouse row', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const productId = await insertProduct(client);

        await client.query(
          `INSERT INTO erp1.stock_levels (product_id, warehouse_id, quantity)
           VALUES ($1, $2, 10.0000)`,
          [productId, SEEDED_WAREHOUSE_ID]
        );
        await client.query(
          `INSERT INTO erp1.stock_levels (product_id, warehouse_id, quantity)
           VALUES ($1, $2, 25.5000)
           ON CONFLICT (product_id, warehouse_id)
           DO UPDATE SET quantity = EXCLUDED.quantity`,
          [productId, SEEDED_WAREHOUSE_ID]
        );

        const stock = await client.query<{ quantity: string; count: string }>(
          `SELECT quantity::text, count(*) OVER ()::text AS count
             FROM erp1.stock_levels WHERE product_id = $1`,
          [productId]
        );
        expect(stock.rows).toHaveLength(1);
        expect(stock.rows[0]?.quantity).toBe('25.5000');
        expect(stock.rows[0]?.count).toBe('1');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('updates updated_at automatically on product changes', async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const productId = await insertProduct(client);
        await client.query(
          `UPDATE erp1.products SET updated_at = '2000-01-01T00:00:00Z' WHERE id = $1`,
          [productId]
        );
        await client.query(`UPDATE erp1.products SET name = 'Renamed' WHERE id = $1`, [
          productId,
        ]);
        const product = await client.query<{ updated_at: Date }>(
          'SELECT updated_at FROM erp1.products WHERE id = $1',
          [productId]
        );
        expect(product.rows[0]!.updated_at.getUTCFullYear()).toBeGreaterThan(2000);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });
  });
});
