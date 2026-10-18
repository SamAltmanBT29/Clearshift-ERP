import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let dbInstance: NodePgDatabase | null = null;

export function getDatabasePool(connectionString?: string): pg.Pool {
  if (!pool) {
    const connStr =
      connectionString ||
      process.env.DATABASE_URL ||
      "postgresql://cs_app:app_secret_123@localhost:5432/clearshift";
    
    pool = new Pool({
      connectionString: connStr,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    });
  }
  return pool;
}

export function getDatabase(connectionString?: string): NodePgDatabase {
  if (!dbInstance) {
    const p = getDatabasePool(connectionString);
    dbInstance = drizzle(p);
  }
  return dbInstance;
}

export async function closeDatabasePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    dbInstance = null;
  }
}
