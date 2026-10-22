/**
 * Controlled Database Migration Runner — ClearShift ERP (PLT-02)
 *
 * Enforces controlled, non-racing DDL migration execution across environments.
 * Idempotently tracks applied migrations in public.schema_migrations.
 *
 * Usage:
 *   node --experimental-strip-types infra/scripts/db-migrate.ts
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsDir = join(__dirname, '../../packages/database/migrations');

interface MigrationResult {
  applied: number;
  skipped: number;
  total: number;
}

export async function runMigrations(maxRetries = 10, delayMs = 1500): Promise<MigrationResult> {
  const databaseUrl =
    process.env['DATABASE_MIGRATOR_URL'] ||
    (process.env['NODE_ENV'] === 'test'
      ? process.env['DATABASE_URL_TEST']
      : process.env['DATABASE_URL']);

  if (!databaseUrl) {
    throw new Error(
      '❌ DATABASE_MIGRATOR_URL, DATABASE_URL, or DATABASE_URL_TEST environment variable is required.'
    );
  }

  // Dynamic import of pg
  const { default: pg } = await import('pg');
  const { Pool } = pg;

  let pool: InstanceType<typeof Pool> | null = null;
  let connected = false;

  console.log('⏳ Waiting for PostgreSQL to become healthy...');

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      pool = new Pool({ connectionString: databaseUrl });
      await pool.query('SELECT 1');
      connected = true;
      console.log(`✅ Connected to PostgreSQL on attempt ${attempt}`);
      break;
    } catch (err: unknown) {
      if (pool) {
        await pool.end().catch(() => {});
      }
      if (attempt === maxRetries) {
        throw new Error(`❌ Could not connect to PostgreSQL after ${maxRetries} attempts: ${(err as Error).message}`);
      }
      console.log(`   [Attempt ${attempt}/${maxRetries}] Database not ready, retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (!pool || !connected) {
    throw new Error('❌ Failed to establish PostgreSQL connection');
  }

  try {
    // 1. Ensure schema_migrations ledger exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        id SERIAL PRIMARY KEY,
        migration VARCHAR(256) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // 2. Discover ordered migrations
    if (!existsSync(migrationsDir)) {
      console.log(`ℹ️ No migrations directory found at ${migrationsDir}`);
      return { applied: 0, skipped: 0, total: 0 };
    }

    const migrationFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let applied = 0;
    let skipped = 0;

    for (const file of migrationFiles) {
      const migrationName = file.replace(/\.sql$/, '');

      const { rows } = await pool.query(
        'SELECT 1 FROM public.schema_migrations WHERE migration = $1',
        [migrationName]
      );

      if (rows.length > 0) {
        console.log(`⏭️  Skipping migration ${migrationName} (already applied)`);
        skipped++;
        continue;
      }

      console.log(`⚡ Applying migration: ${migrationName}...`);
      const sql = readFileSync(join(migrationsDir, file), 'utf-8');

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO public.schema_migrations (migration) VALUES ($1)',
          [migrationName]
        );
        await client.query('COMMIT');
        console.log(`✅ ${migrationName} successfully applied`);
        applied++;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`❌ Failed to apply ${migrationName}: ${(err as Error).message}`);
      } finally {
        client.release();
      }
    }

    console.log(`\n📊 Migration Summary:`);
    console.log(`   Applied: ${applied}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Total:   ${migrationFiles.length}`);

    return { applied, skipped, total: migrationFiles.length };
  } finally {
    await pool.end();
  }
}

// Direct execution entrypoint
if (process.argv[1] === __filename) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
