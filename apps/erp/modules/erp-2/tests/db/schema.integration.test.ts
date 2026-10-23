/**
 * ERP-2 Vendors and Purchasing — Database Constraint Proofs (Live PostgreSQL)
 *
 * Tests prove:
 *   1. A clean database applies every migration once and reaches the expected schema (AC-2)
 *   2. Re-running the migration job does not reapply an already-applied migration (idempotent)
 *   3. Unique constraints reject duplicates with SQLSTATE 23505 (AC-4)
 *   4. Check constraints reject invalid values with SQLSTATE 23514 (AC-4)
 *   5. Foreign keys reject missing references with SQLSTATE 23503
 *   6. The `updated_at` trigger automatically updates the timestamp
 *
 * When DATABASE_URL_TEST is unset, this suite is skipped gracefully.
 *
 * @module erp2/tests/db/schema.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';

const execFileAsync = promisify(execFile);

const ADMIN_URL = process.env['DATABASE_URL_TEST'];
const SCRATCH_NAME = `erp2_scratch_${Math.random().toString(36).slice(2, 10)}`;
const SCRATCH_URL = ADMIN_URL
  ? ADMIN_URL.replace(/\/([^/?]+)(\?|$)/, `/${SCRATCH_NAME}$2`)
  : undefined;

if (!ADMIN_URL) {
  console.warn(
    '[erp-2] DATABASE_URL_TEST is not set — live PostgreSQL constraint proofs are skipped.'
  );
}

interface PgError extends Error {
  code?: string;
  constraint?: string;
}

describe.skipIf(!ADMIN_URL)('ERP-2 database constraints & migration integration', () => {
  let adminPool: pg.Pool;
  let clientPool: pg.Pool;

  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString: ADMIN_URL });
    await adminPool.query(`CREATE DATABASE ${SCRATCH_NAME}`);
    clientPool = new pg.Pool({ connectionString: SCRATCH_URL });
  });

  afterAll(async () => {
    if (clientPool) {
      await clientPool.end().catch(() => {});
    }
    if (adminPool) {
      try {
        await adminPool.query(`DROP DATABASE IF EXISTS ${SCRATCH_NAME} WITH (FORCE)`);
      } catch {
        // Fallback for older PG without WITH (FORCE)
        await adminPool.query(`DROP DATABASE IF EXISTS ${SCRATCH_NAME}`);
      }
      await adminPool.end().catch(() => {});
    }
  });

  it('applies migrations cleanly and idempotently via migration runner', async () => {
    // First run — applies all migrations
    const run1 = await execFileAsync('node', ['packages/database/scripts/migrate.js'], {
      env: { ...process.env, DATABASE_URL: SCRATCH_URL },
    });
    expect(run1.stdout).toContain('Applied');

    // Second run — skips all already-applied migrations
    const run2 = await execFileAsync('node', ['packages/database/scripts/migrate.js'], {
      env: { ...process.env, DATABASE_URL: SCRATCH_URL },
    });
    expect(run2.stdout).toContain('Skipping erp2_v1');
  });

  describe('Unique Constraints (SQLSTATE 23505)', () => {
    it('rejects duplicate vendor tax_number', async () => {
      await clientPool.query(`
        INSERT INTO erp2.vendors (id, name, tax_number)
        VALUES ('11111111-1111-1111-1111-111111111111', 'Vendor A', 'TAX-12345')
      `);

      let err: PgError | null = null;
      try {
        await clientPool.query(`
          INSERT INTO erp2.vendors (id, name, tax_number)
          VALUES ('11111111-1111-1111-1111-111111111112', 'Vendor B', 'TAX-12345')
        `);
      } catch (e) {
        err = e as PgError;
      }
      expect(err).not.toBeNull();
      expect(err?.code).toBe('23505');
      expect(err?.constraint).toBe('vendors_tax_number_unique');
    });

    it('rejects duplicate purchase order po_number', async () => {
      await clientPool.query(`
        INSERT INTO erp2.purchase_orders (id, po_number, vendor_id, total)
        VALUES ('22222222-2222-2222-2222-222222222222', 'PO-999', '11111111-1111-1111-1111-111111111111', 100.00)
      `);

      let err: PgError | null = null;
      try {
        await clientPool.query(`
          INSERT INTO erp2.purchase_orders (id, po_number, vendor_id, total)
          VALUES ('22222222-2222-2222-2222-222222222223', 'PO-999', '11111111-1111-1111-1111-111111111111', 200.00)
        `);
      } catch (e) {
        err = e as PgError;
      }
      expect(err).not.toBeNull();
      expect(err?.code).toBe('23505');
      expect(err?.constraint).toBe('purchase_orders_po_number_unique');
    });

    it('rejects duplicate import receipt idempotency_key', async () => {
      await clientPool.query(`
        INSERT INTO erp2.import_receipts (batch_id, source_row, entity, idempotency_key, target_id)
        VALUES (
          '33333333-3333-3333-3333-333333333333',
          1,
          'vendor',
          'batch-1-row-1',
          '11111111-1111-1111-1111-111111111111'
        )
      `);

      let err: PgError | null = null;
      try {
        await clientPool.query(`
          INSERT INTO erp2.import_receipts (batch_id, source_row, entity, idempotency_key, target_id)
          VALUES (
            '33333333-3333-3333-3333-333333333333',
            2,
            'vendor',
            'batch-1-row-1',
            '11111111-1111-1111-1111-111111111112'
          )
        `);
      } catch (e) {
        err = e as PgError;
      }
      expect(err).not.toBeNull();
      expect(err?.code).toBe('23505');
      expect(err?.constraint).toBe('import_receipts_idempotency_key_unique');
    });
  });

  describe('Check Constraints (SQLSTATE 23514)', () => {
    it('rejects po_line with non-positive quantity', async () => {
      let err: PgError | null = null;
      try {
        await clientPool.query(`
          INSERT INTO erp2.po_lines (po_id, product_id, line_number, quantity, price, line_total)
          VALUES (
            '22222222-2222-2222-2222-222222222222',
            '44444444-4444-4444-4444-444444444444',
            1,
            0,
            10.00,
            0.00
          )
        `);
      } catch (e) {
        err = e as PgError;
      }
      expect(err).not.toBeNull();
      expect(err?.code).toBe('23514');
      expect(err?.constraint).toBe('po_lines_quantity_positive');
    });

    it('rejects po_line with negative price', async () => {
      let err: PgError | null = null;
      try {
        await clientPool.query(`
          INSERT INTO erp2.po_lines (po_id, product_id, line_number, quantity, price, line_total)
          VALUES (
            '22222222-2222-2222-2222-222222222222',
            '44444444-4444-4444-4444-444444444444',
            1,
            5,
            -10.00,
            -50.00
          )
        `);
      } catch (e) {
        err = e as PgError;
      }
      expect(err).not.toBeNull();
      expect(err?.code).toBe('23514');
      expect(err?.constraint).toBe('po_lines_price_non_negative');
    });

    it('rejects vendor with invalid bank_masked format', async () => {
      let err: PgError | null = null;
      try {
        await clientPool.query(`
          INSERT INTO erp2.vendors (name, tax_number, bank_masked)
          VALUES ('Bad Bank Vendor', 'TAX-BAD-BANK', 'UNMASKED-1234')
        `);
      } catch (e) {
        err = e as PgError;
      }
      expect(err).not.toBeNull();
      expect(err?.code).toBe('23514');
      expect(err?.constraint).toBe('vendors_bank_masked_format');
    });

    it('rejects purchase order with negative total', async () => {
      let err: PgError | null = null;
      try {
        await clientPool.query(`
          INSERT INTO erp2.purchase_orders (po_number, vendor_id, total)
          VALUES ('PO-NEG', '11111111-1111-1111-1111-111111111111', -50.00)
        `);
      } catch (e) {
        err = e as PgError;
      }
      expect(err).not.toBeNull();
      expect(err?.code).toBe('23514');
      expect(err?.constraint).toBe('purchase_orders_total_non_negative');
    });
  });

  describe('Foreign Key Constraints (SQLSTATE 23503)', () => {
    it('rejects purchase order referencing non-existent vendor', async () => {
      let err: PgError | null = null;
      try {
        await clientPool.query(`
          INSERT INTO erp2.purchase_orders (po_number, vendor_id, total)
          VALUES ('PO-NO-VENDOR', '99999999-9999-9999-9999-999999999999', 50.00)
        `);
      } catch (e) {
        err = e as PgError;
      }
      expect(err).not.toBeNull();
      expect(err?.code).toBe('23503');
    });
  });

  describe('Triggers', () => {
    it('auto-updates updated_at on vendor modification', async () => {
      const { rows: beforeRows } = await clientPool.query(`
        SELECT updated_at FROM erp2.vendors WHERE id = '11111111-1111-1111-1111-111111111111'
      `);
      const beforeTime = new Date(beforeRows[0].updated_at).getTime();

      // Delay briefly to verify timestamp increment
      await new Promise((r) => setTimeout(r, 50));

      await clientPool.query(`
        UPDATE erp2.vendors SET name = 'Vendor A Updated' WHERE id = '11111111-1111-1111-1111-111111111111'
      `);

      const { rows: afterRows } = await clientPool.query(`
        SELECT updated_at FROM erp2.vendors WHERE id = '11111111-1111-1111-1111-111111111111'
      `);
      const afterTime = new Date(afterRows[0].updated_at).getTime();

      expect(afterTime).toBeGreaterThan(beforeTime);
    });
  });
});
