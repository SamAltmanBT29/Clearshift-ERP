/**
 * Controlled Migration Runner — ClearShift ERP
 *
 * Applies SQL migrations in order.  Each migration is recorded in
 * public.schema_migrations after a successful run.  Re-running the
 * runner will skip already-applied migrations (idempotent).
 *
 * Usage:
 *   node packages/database/scripts/migrate.js
 *
 * Environment variables:
 *   DATABASE_URL — PostgreSQL connection string (required)
 *                  e.g. postgresql://user:pass@localhost:5432/clearshift_dev
 *   NODE_ENV     — 'test' to use DATABASE_URL_TEST
 */

// @ts-check
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');

async function main() {
  const databaseUrl =
    process.env['NODE_ENV'] === 'test'
      ? process.env['DATABASE_URL_TEST']
      : process.env['DATABASE_URL'];

  if (!databaseUrl) {
    const envVar =
      process.env['NODE_ENV'] === 'test' ? 'DATABASE_URL_TEST' : 'DATABASE_URL';
    console.error(`❌ ${envVar} environment variable is required`);
    process.exit(1);
  }

  // Dynamically import pg to avoid issues in environments without it installed
  const { default: pg } = await import('pg');
  const { Pool } = pg;

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    console.log('🔌 Connected to database');

    // Ensure schema_migrations table exists (guard)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        id          SERIAL PRIMARY KEY,
        migration   VARCHAR(256) NOT NULL UNIQUE,
        applied_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `);

    // Discover migrations ordered alphabetically (erp4_v1.sql, etc.)
    const migrationFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let applied = 0;
    let skipped = 0;

    for (const file of migrationFiles) {
      const migrationName = file.replace(/\.sql$/, '');

      // Check if already applied
      const { rows } = await pool.query(
        'SELECT 1 FROM public.schema_migrations WHERE migration = $1',
        [migrationName]
      );

      if (rows.length > 0) {
        console.log(`⏭️  Skipping ${migrationName} (already applied)`);
        skipped++;
        continue;
      }

      console.log(`⚡ Applying migration: ${migrationName} ...`);
      const sql = readFileSync(join(migrationsDir, file), 'utf-8');

      try {
        await pool.query(sql);
        console.log(`✅ ${migrationName} applied successfully`);
        applied++;
      } catch (err) {
        console.error(`❌ Failed to apply ${migrationName}:`, err);
        process.exit(1);
      }
    }

    console.log(`\n📊 Migration summary:`);
    console.log(`   Applied : ${applied}`);
    console.log(`   Skipped : ${skipped}`);
    console.log(`   Total   : ${migrationFiles.length}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Migration runner failed:', err);
  process.exit(1);
});
