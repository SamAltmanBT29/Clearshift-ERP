/**
 * ClearShift Migration Kit — Target Adapter & Import Contract Types
 *
 * Defines Zod schemas and TypeScript types for the target adapter contract
 * used by KIT-08 and public module import endpoints.
 *
 * Decision C4 & KIT-08:
 * - Module local DB transaction writes domain mutation and receipt together.
 * - Same key + same canonical request returns prior result.
 * - Same key + different request returns HTTP 409 Conflict.
 * - Business validation reports rejected with stable reason code.
 * - Unexpected infrastructure failure (503) remains retryable and not misclassified as bad data.
 *
 * @module contracts/import-target
 */

import { z } from 'zod';
import { UuidSchema } from './erp-4.js';

/**
 * Migration row outcome classification (Section 4.3 & KIT-08).
 */
export const ImportOutcomeEnum = z.enum([
  'loaded',
  'rejected',
  'merged',
  'skipped',
]);
export type ImportOutcome = z.infer<typeof ImportOutcomeEnum>;

/**
 * Import receipt kind.
 */
export const ImportKindEnum = z.enum(['created', 'linked']);
export type ImportKind = z.infer<typeof ImportKindEnum>;

/**
 * Durable import receipt schema (Decision C4 & KIT-08).
 * Stored in <module>_import_receipts table.
 */
export const ImportReceiptRecordSchema = z.object({
  id: UuidSchema,
  batch_id: UuidSchema,
  source_row: z.number().int().nonnegative(),
  source_system: z.string().max(64).optional().nullable(),
  source_id: z.string().max(128).optional().nullable(),
  entity: z.string().min(1).max(64),
  schema_version: z.number().int().positive().default(1),
  idempotency_key: z.string().min(1).max(128),
  request_hash: z.string().max(64),
  target_id: UuidSchema,
  kind: ImportKindEnum.default('created'),
  outcome: ImportOutcomeEnum.default('loaded'),
  response_payload: z.unknown().optional().nullable(),
  created_at: z.string().datetime(),
});
export type ImportReceiptRecord = z.infer<typeof ImportReceiptRecordSchema>;

/**
 * Public row import request schema accepted by target adapter / import routes.
 */
export const ImportRowRequestSchema = z.object({
  batch_id: UuidSchema,
  source_row: z.number().int().nonnegative(),
  source_system: z.string().max(64).optional().nullable(),
  source_id: z.string().max(128).optional().nullable(),
  idempotency_key: z.string().min(1).max(128),
  correlation_id: z.string().max(128).optional().nullable(),
  entity: z.string().min(1).max(64),
  record: z.record(z.unknown()),
});
export type ImportRowRequest = z.infer<typeof ImportRowRequestSchema>;

/**
 * Successful target adapter response payload.
 */
export const ImportRowResponseSchema = z.object({
  target_id: UuidSchema,
  target_version: z.union([z.number(), z.string()]).default(1),
  outcome: ImportOutcomeEnum.default('loaded'),
  receipt: ImportReceiptRecordSchema,
  prior_result: z.boolean().default(false),
});
export type ImportRowResponse = z.infer<typeof ImportRowResponseSchema>;

/**
 * Target adapter error / rejection schema.
 */
export const TargetAdapterErrorSchema = z.object({
  reason_code: z.string(),
  message: z.string(),
  field: z.string().optional(),
  retryable: z.boolean().default(false),
});
export type TargetAdapterError = z.infer<typeof TargetAdapterErrorSchema>;
