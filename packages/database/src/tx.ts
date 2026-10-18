import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getDatabase } from "./registry.js";

/**
 * Shared Transaction Helper (PLT-03 & Decision C4)
 * Guarantees that multi-table business mutations commit atomically.
 */
export async function withTransaction<T>(
  callback: (tx: Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0]) => Promise<T>,
  db: NodePgDatabase = getDatabase()
): Promise<T> {
  return db.transaction(async (tx) => {
    return callback(tx);
  });
}
