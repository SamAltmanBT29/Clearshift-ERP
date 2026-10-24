/**
 * ERP-3 Durable Import Receipts DB Layer
 *
 * Provides query helpers and receipt lifecycle management for KIT-08 / Decision C4.
 *
 * @module erp3/db/import-receipts
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  importReceipts,
  erp3ImportReceipts,
  type ImportReceiptRecord,
} from './schema.js';

export { importReceipts, erp3ImportReceipts };

export type Erp3ImportReceipt = ImportReceiptRecord;
export type NewErp3ImportReceipt = typeof importReceipts.$inferInsert;

/**
 * Finds an existing import receipt by its idempotency key.
 */
export async function findReceiptByKey(
  db: NodePgDatabase,
  idempotencyKey: string
): Promise<Erp3ImportReceipt | null> {
  const [record] = await db
    .select()
    .from(importReceipts)
    .where(eq(importReceipts.idempotency_key, idempotencyKey))
    .limit(1);

  return record ?? null;
}

/**
 * Inserts a new durable import receipt.
 */
export async function insertReceipt(
  db: NodePgDatabase,
  receipt: NewErp3ImportReceipt
): Promise<Erp3ImportReceipt> {
  const [created] = await db
    .insert(importReceipts)
    .values(receipt)
    .returning();

  if (!created) {
    throw new Error('Failed to insert durable import receipt');
  }

  return created;
}
