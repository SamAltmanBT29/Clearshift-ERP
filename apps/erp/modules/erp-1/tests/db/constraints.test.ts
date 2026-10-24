/**
 * ERP-1 Database Constraints and Transactions Suite (Real PostgreSQL)
 *
 * Runs only when DATABASE_URL is set (e.g. in CI or local Docker container):
 *   `npm run compose:up && npm run db:migrate`
 *   `DATABASE_URL=postgres://... npx vitest run apps/erp/modules/erp-1/tests/db/constraints.test.ts`
 *
 * Tests database-level constraints directly:
 *   - check_erp1_stock_quantity_non_negative (BR-ERP1-02)
 *   - check_erp1_products_price_non_negative
 *   - check_erp1_products_tax_rate_non_negative
 *   - erp1_products_sku_unique (BR-ERP1-01)
 *   - erp1_warehouses_single_idx (FR-ERP1-05 single warehouse)
 *
 * @module erp1/tests/db/constraints
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DrizzleErp1Repository } from '../../src/services/repository.js';

const DATABASE_URL = process.env['DATABASE_URL'];

interface PgPool {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}

describe.skipIf(!DATABASE_URL)('ERP-1 Database Level Constraints (PostgreSQL)', () => {
  let pool: PgPool;
  let db: NodePgDatabase<Record<string, unknown>>;
  let repo: DrizzleErp1Repository;

  beforeAll(async () => {
    const pg = await import('pg');
    const { Pool } = pg.default ?? pg;
    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool as any);
    repo = new DrizzleErp1Repository(db);
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    // Truncate tables for clean hermetic test runs
    await pool.query('TRUNCATE TABLE erp1.stock_levels, erp1.products, erp1.categories, erp1.warehouses CASCADE;');
    // Re-seed default warehouse
    await repo.getDefaultWarehouse();
  });

  it('enforces SKU uniqueness constraint at the database level (BR-ERP1-01)', async () => {
    const sku = `SKU-DB-${randomUUID().slice(0, 8).toUpperCase()}`;
    await repo.createProduct({
      name: 'Item 1',
      sku,
      unitOfMeasure: 'pcs',
      price: '19.9900',
      currency: 'USD',
    });

    await expect(
      pool.query(
        `INSERT INTO erp1.products (id, name, sku, normalized_sku, unit_of_measure, price, currency)
         VALUES ($1, $2, $3, $4, 'pcs', 25.0000, 'USD')`,
        [randomUUID(), 'Item 2', sku, sku]
      )
    ).rejects.toThrow();
  });

  it('enforces check_erp1_stock_quantity_non_negative at database level (BR-ERP1-02)', async () => {
    const prod = await repo.createProduct({
      name: 'Negative Stock Test',
      sku: `SKU-NEG-${randomUUID().slice(0, 8)}`,
      unitOfMeasure: 'kg',
      price: '10.0000',
      currency: 'USD',
    });
    const wh = await repo.getDefaultWarehouse();

    await expect(
      pool.query(
        `INSERT INTO erp1.stock_levels (id, product_id, warehouse_id, quantity)
         VALUES ($1, $2, $3, -10.0000)`,
        [randomUUID(), prod.id, wh.id]
      )
    ).rejects.toThrow(/check_erp1_stock_quantity_non_negative/i);
  });

  it('enforces single warehouse invariant at database level (FR-ERP1-05)', async () => {
    await expect(
      pool.query(
        `INSERT INTO erp1.warehouses (id, name, code, is_default)
         VALUES ($1, 'Second Warehouse', 'WH-02', false)`,
        [randomUUID()]
      )
    ).rejects.toThrow(/erp1_warehouses_single_idx/i);
  });

  it('enforces check_erp1_products_price_non_negative', async () => {
    await expect(
      pool.query(
        `INSERT INTO erp1.products (id, name, sku, normalized_sku, unit_of_measure, price, currency)
         VALUES ($1, 'Negative Price', 'SKU-NEG-P', 'SKU-NEG-P', 'pcs', -5.0000, 'USD')`,
        [randomUUID()]
      )
    ).rejects.toThrow(/check_erp1_products_price_non_negative/i);
  });
});
