/**
 * Controlled Migration Runner — ClearShift ERP
 *
 * Applies SQL migrations in order.  Each migration is recorded in
 * public.schema_migrations after a successful run.  Re-running the
 * runner will skip already-applied migrations (idempotent).
 *
 * The runner holds a session-level PostgreSQL advisory lock for the whole
 * migration run, so two deploy jobs cannot race: the second waits, then sees
 * the ledger row written by the first and skips.
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
const MIGRATION_LOCK_KEY = 'clearshift:db:migrate';

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
  /** @type {import('pg').PoolClient | null} */
  let client = null;

  try {
    client = await pool.connect();
    console.log('🔌 Connected to database');

    // Serialize migration jobs. Session-level lock survives the explicit
    // BEGIN/COMMIT blocks inside the migration files.
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [
      MIGRATION_LOCK_KEY,
    ]);

    // Ensure schema_migrations table exists (guard)
    await client.query(`
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

      // Check again while holding the lock; a concurrent runner may have
      // recorded this migration while we were waiting for the lock.
      const { rows } = await client.query(
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
        await client.query(sql);

        // Every current migration records itself, but verify the ledger so a
        // future migration cannot silently run repeatedly on every deploy.
        const ledger = await client.query(
          'SELECT 1 FROM public.schema_migrations WHERE migration = $1',
          [migrationName]
        );
        if (ledger.rows.length === 0) {
          await client.query(
            'INSERT INTO public.schema_migrations (migration) VALUES ($1) ON CONFLICT (migration) DO NOTHING',
            [migrationName]
          );
        }

        console.log(`✅ ${migrationName} applied successfully`);
        applied++;
      } catch (err) {
        // A failed migration must never leave a ledger row behind. The SQL
        // files use their own transaction, so roll back any open transaction
        // before surfacing the failure.
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(
          `❌ Failed to apply ${migrationName}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    console.log(`\n📊 Migration summary:`);
    console.log(`   Applied : ${applied}`);
    console.log(`   Skipped : ${skipped}`);
    console.log(`   Total   : ${migrationFiles.length}`);
  } finally {
    if (client) {
      await client
        .query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_KEY])
        .catch(() => {});
      client.release();
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
