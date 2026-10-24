/**
 * ERP-1 Durable Import Receipts DB Layer
 *
 * Provides query helpers and receipt lifecycle management for KIT-08 / Decision C4.
 *
 * @module erp1/db/import-receipts
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  erp1ImportReceipts,
} from './schema.js';

export { erp1ImportReceipts };

export type Erp1DbImportReceipt = typeof erp1ImportReceipts.$inferSelect;
export type NewErp1DbImportReceipt = typeof erp1ImportReceipts.$inferInsert;

/**
 * Finds an existing import receipt by its idempotency key.
 */
export async function findReceiptByKey(
  db: NodePgDatabase,
  idempotencyKey: string
): Promise<Erp1DbImportReceipt | null> {
  const [record] = await db
    .select()
    .from(erp1ImportReceipts)
    .where(eq(erp1ImportReceipts.idempotencyKey, idempotencyKey))
    .limit(1);

  return record ?? null;
}

/**
 * Inserts a new durable import receipt.
 */
export async function insertReceipt(
  db: NodePgDatabase,
  receipt: NewErp1DbImportReceipt
): Promise<Erp1DbImportReceipt> {
  const [created] = await db
    .insert(erp1ImportReceipts)
    .values(receipt)
    .returning();

  if (!created) {
    throw new Error('Failed to insert durable import receipt');
  }

  return created;
}
