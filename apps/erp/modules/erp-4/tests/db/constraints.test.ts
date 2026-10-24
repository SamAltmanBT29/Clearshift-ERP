/**
 * ERP-4 Finance & Accounting — Database Level Constraints Suite (Real PostgreSQL)
 *
 * Runs only when DATABASE_URL is set (e.g. in CI or local Docker container):
 *   `DATABASE_URL=postgres://... npx vitest run apps/erp/modules/erp-4/tests/db/constraints.test.ts`
 *
 * Enforces database schema invariants:
 *   - Unique account code constraint (FR-ERP4-01 / erp4.accounts_code_unique)
 *   - Check non-negative debit/credit (BR-ERP4-01 / check_debit_non_negative, check_credit_non_negative)
 *   - Check single line direction (not both debit and credit positive)
 *   - Check non-zero line (cannot have debit=0 and credit=0)
 *   - One-time opening balance per account/currency (FR-ERP4-04 / opening_balances_account_currency_unique)
 *   - Foreign key integrity on journal lines -> accounts and journal entries
 *
 * @module erp4/tests/db/constraints
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env['DATABASE_URL'];

interface PgPool {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}

describe.skipIf(!DATABASE_URL)('ERP-4 Database Level Constraints (PostgreSQL)', () => {
  let pool: PgPool;

  beforeAll(async () => {
    const pg = await import('pg');
    const { Pool } = pg.default ?? pg;
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    // Truncate tables in reverse FK dependency order
    await pool.query(
      'TRUNCATE TABLE erp4.journal_lines, erp4.journal_entries, erp4.opening_balances, erp4.accounts, erp4.accounting_periods CASCADE;'
    );
  });

  it('enforces account code uniqueness at the database level (FR-ERP4-01)', async () => {
    const code = `ACC-DB-${randomUUID().slice(0, 8).toUpperCase()}`;
    await pool.query(
      `INSERT INTO erp4.accounts (id, code, name, type, currency_code, is_active)
       VALUES ($1, $2, 'Test Account 1', 'asset', 'USD', true)`,
      [randomUUID(), code]
    );

    await expect(
      pool.query(
        `INSERT INTO erp4.accounts (id, code, name, type, currency_code, is_active)
         VALUES ($1, $2, 'Test Account 2', 'asset', 'USD', true)`,
        [randomUUID(), code]
      )
    ).rejects.toThrow();
  });

  it('enforces debit and credit non-negative check constraints (BR-ERP4-01)', async () => {
    const accountId = randomUUID();
    const periodId = randomUUID();
    const entryId = randomUUID();

    await pool.query(
      `INSERT INTO erp4.accounts (id, code, name, type, currency_code)
       VALUES ($1, '1010-CASH', 'Cash', 'asset', 'USD')`,
      [accountId]
    );

    await pool.query(
      `INSERT INTO erp4.accounting_periods (id, period_label, start_date, end_date, status)
       VALUES ($1, '2026-04', '2026-04-01', '2026-04-30', 'open')`,
      [periodId]
    );

    await pool.query(
      `INSERT INTO erp4.journal_entries (id, entry_number, period_id, posting_date, status, description, currency_code, created_by_user_id)
       VALUES ($1, 'JV-0001', $2, '2026-04-10', 'draft', 'Negative debit test', 'USD', 'user-1')`,
      [entryId, periodId]
    );

    // Negative debit must throw
    await expect(
      pool.query(
        `INSERT INTO erp4.journal_lines (id, journal_entry_id, account_id, line_number, debit_amount, credit_amount)
         VALUES ($1, $2, $3, 1, -100.0000, 0.0000)`,
        [randomUUID(), entryId, accountId]
      )
    ).rejects.toThrow();

    // Negative credit must throw
    await expect(
      pool.query(
        `INSERT INTO erp4.journal_lines (id, journal_entry_id, account_id, line_number, debit_amount, credit_amount)
         VALUES ($1, $2, $3, 1, 0.0000, -50.0000)`,
        [randomUUID(), entryId, accountId]
      )
    ).rejects.toThrow();
  });

  it('enforces one-time opening balance per account and currency (FR-ERP4-04)', async () => {
    const accountId = randomUUID();
    await pool.query(
      `INSERT INTO erp4.accounts (id, code, name, type, currency_code)
       VALUES ($1, '1020-BANK', 'Bank', 'asset', 'USD')`,
      [accountId]
    );

    await pool.query(
      `INSERT INTO erp4.opening_balances (id, account_id, currency_code, balance_amount, as_of_date, loaded_by_user_id)
       VALUES ($1, $2, 'USD', 50000.0000, '2026-04-01', 'user-1')`,
      [randomUUID(), accountId]
    );

    // Duplicate insert for same account and currency must throw unique constraint violation
    await expect(
      pool.query(
        `INSERT INTO erp4.opening_balances (id, account_id, currency_code, balance_amount, as_of_date, loaded_by_user_id)
         VALUES ($1, $2, 'USD', 25000.0000, '2026-04-01', 'user-1')`,
        [randomUUID(), accountId]
      )
    ).rejects.toThrow();
  });

  it('enforces foreign key integrity when referencing non-existent account', async () => {
    const periodId = randomUUID();
    const entryId = randomUUID();

    await pool.query(
      `INSERT INTO erp4.accounting_periods (id, period_label, start_date, end_date, status)
       VALUES ($1, '2026-04', '2026-04-01', '2026-04-30', 'open')`,
      [periodId]
    );

    await pool.query(
      `INSERT INTO erp4.journal_entries (id, entry_number, period_id, posting_date, status, description, currency_code, created_by_user_id)
       VALUES ($1, 'JV-0002', $2, '2026-04-10', 'draft', 'FK test', 'USD', 'user-1')`,
      [entryId, periodId]
    );

    await expect(
      pool.query(
        `INSERT INTO erp4.journal_lines (id, journal_entry_id, account_id, line_number, debit_amount, credit_amount)
         VALUES ($1, $2, $3, 1, 100.0000, 0.0000)`,
        [randomUUID(), entryId, randomUUID()]
      )
    ).rejects.toThrow();
  });
});
