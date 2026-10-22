/**
 * ERP-2 Durable Import Receipts DB Layer
 *
 * Provides query helpers and receipt lifecycle management for KIT-08 / Decision C4.
 *
 * @module erp2/db/import-receipts
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  erp2ImportReceipts,
  type Erp2ImportReceipt,
  type NewErp2ImportReceipt,
} from './schema.js';

export { erp2ImportReceipts, type Erp2ImportReceipt, type NewErp2ImportReceipt };

/**
 * Finds an existing import receipt by its idempotency key.
 */
export async function findReceiptByKey(
  db: NodePgDatabase,
  idempotencyKey: string
): Promise<Erp2ImportReceipt | null> {
  const [record] = await db
    .select()
    .from(erp2ImportReceipts)
    .where(eq(erp2ImportReceipts.idempotency_key, idempotencyKey))
    .limit(1);

  return record ?? null;
}

/**
 * Inserts a new durable import receipt.
 */
export async function insertReceipt(
  db: NodePgDatabase,
  receipt: NewErp2ImportReceipt
): Promise<Erp2ImportReceipt> {
  const [created] = await db
    .insert(erp2ImportReceipts)
    .values(receipt)
    .returning();

  if (!created) {
    throw new Error('Failed to insert durable import receipt');
  }

  return created;
}
