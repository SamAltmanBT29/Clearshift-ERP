/**
 * ERP-4 Durable Import Receipts DB Layer
 *
 * Provides query helpers and receipt lifecycle management for KIT-08 / Decision C4.
 *
 * @module erp4/db/import-receipts
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  erp4ImportReceipts,
  type Erp4ImportReceipt,
  type NewErp4ImportReceipt,
} from './schema.js';

export { erp4ImportReceipts, type Erp4ImportReceipt, type NewErp4ImportReceipt };

/**
 * Finds an existing import receipt by its idempotency key.
 */
export async function findReceiptByKey(
  db: NodePgDatabase,
  idempotencyKey: string
): Promise<Erp4ImportReceipt | null> {
  const [record] = await db
    .select()
    .from(erp4ImportReceipts)
    .where(eq(erp4ImportReceipts.idempotency_key, idempotencyKey))
    .limit(1);

  return record ?? null;
}

/**
 * Inserts a new durable import receipt.
 */
export async function insertReceipt(
  db: NodePgDatabase,
  receipt: NewErp4ImportReceipt
): Promise<Erp4ImportReceipt> {
  const [created] = await db
    .insert(erp4ImportReceipts)
    .values(receipt)
    .returning();

  if (!created) {
    throw new Error('Failed to insert durable import receipt');
  }

  return created;
}
