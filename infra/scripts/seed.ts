/**
 * Synthetic Data Seeder — ClearShift ERP (PLT-02)
 *
 * Seeds deterministic synthetic data into the local development or test database.
 * Strictly uses synthetic test fixtures (BR-SEC-01).
 *
 * Usage:
 *   node --experimental-strip-types infra/scripts/seed.ts
 */

import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

export async function seedDatabase(): Promise<void> {
  const databaseUrl =
    process.env['DATABASE_URL'] ||
    (process.env['NODE_ENV'] === 'test'
      ? process.env['DATABASE_URL_TEST']
      : 'postgresql://cs_app:app_secret_123@localhost:5432/clearshift');

  const { default: pg } = await import('pg');
  const { Pool } = pg;

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    console.log('🌱 Seeding synthetic fixtures for ClearShift ERP...');

    // 1. Seed ERP-4 Chart of Accounts if erp_finance table exists
    const checkTable = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'erp_finance' AND table_name = 'accounts'
      );
    `);

    if (checkTable.rows[0]?.exists) {
      console.log('   ↳ Seeding standard Chart of Accounts...');
      const accounts = [
        ['1000', 'Cash and Cash Equivalents', 'asset', 'debit', true],
        ['1100', 'Accounts Receivable', 'asset', 'debit', true],
        ['2000', 'Accounts Payable', 'liability', 'credit', true],
        ['3000', 'Retained Earnings', 'equity', 'credit', true],
        ['4000', 'Operating Revenue', 'revenue', 'credit', true],
        ['5000', 'Cost of Goods Sold', 'expense', 'debit', true],
        ['6000', 'General & Administrative Expense', 'expense', 'debit', true],
      ];

      for (const [code, name, type, normalBalance, isActive] of accounts) {
        await pool.query(
          `
          INSERT INTO erp_finance.accounts (account_code, account_name, account_type, normal_balance, is_active)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (account_code) DO NOTHING;
          `,
          [code, name, type, normalBalance, isActive]
        );
      }
      console.log('   ✅ 7 Standard GL Accounts seeded.');
    } else {
      console.log('   ℹ️ erp_finance.accounts table not yet present; skipping GL account seed.');
    }

    console.log('✅ Synthetic seeding completed successfully.');
  } finally {
    await pool.end();
  }
}

// Direct execution entrypoint
if (process.argv[1] === __filename) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Seeder failed:', err.message);
      process.exit(1);
    });
}
