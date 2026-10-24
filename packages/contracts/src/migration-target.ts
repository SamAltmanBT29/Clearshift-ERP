/**
 * ClearShift Migration Kit — Generic Target Adapter & Idempotency Contracts (KIT-08)
 *
 * Defines Zod schemas, TypeScript types, and idempotency derivation functions
 * for Step 5 (Load) and generic module target adapters.
 *
 * Decision C4 & KIT-08:
 * - Real load processes records in chunks of 500 rows by default.
 * - Stable idempotency key derived from batchId + sourceRow + module + entity + operationVersion.
 * - Module local DB transaction writes domain mutation and import receipt together.
 * - Same key + same canonical request returns prior result (isExisting: true).
 * - Same key + different request payload returns HTTP 409 Conflict.
 * - Receipts survive worker process crashes and restarts.
 * - Migration Kit worker role possesses zero target DB write privileges.
 *
 * @module contracts/migration-target
 */

import { z } from 'zod';
import { createHash } from 'node:crypto';

// ============================================================================
// KIT-08: Generic Target Adapter, Stable Idempotency & Import Receipts
// ============================================================================

/**
 * Idempotency Key Generation Parameters Schema (KIT-08)
 * Key is derived from: batchId + sourceRow + module + entity + operationVersion
 * (NOT mutable payload alone; SDS ClearShift Migration Kit v2.0 §11.4)
 */
export const IdempotencyKeyParamsSchema = z.object({
  batchId: z.string().min(1, 'batchId is required').max(128),
  sourceRow: z.number().int({ message: 'sourceRow must be an integer' }).min(1, 'sourceRow must be >= 1'),
  module: z.string().min(1, 'module is required').max(64),
  entity: z.string().min(1, 'entity is required').max(64),
  operationVersion: z.number().int().min(1).default(1),
});
export type IdempotencyKeyParams = z.infer<typeof IdempotencyKeyParamsSchema>;

/**
 * Derives a deterministic stable idempotency key for a source row.
 * Format: SHA256(batchId:sourceRow:module:entity:v{operationVersion})
 */
export function computeStableIdempotencyKey(params: IdempotencyKeyParams): string {
  const parsed = IdempotencyKeyParamsSchema.parse(params);
  const rawKey = `${parsed.batchId}:${parsed.sourceRow}:${parsed.module}:${parsed.entity}:v${parsed.operationVersion}`;
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

export const deriveStableIdempotencyKey = computeStableIdempotencyKey;

/**
 * Deterministically serialize any object with alphabetically sorted keys
 */
export function canonicalJsonStringify(data: unknown): string {
  if (data === null || typeof data !== 'object') {
    return JSON.stringify(data);
  }

  if (Array.isArray(data)) {
    return '[' + data.map((item) => canonicalJsonStringify(item)).join(',') + ']';
  }

  const record = data as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const entries = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJsonStringify(record[key])}`
  );
  return '{' + entries.join(',') + '}';
}

/**
 * Computes a deterministic SHA-256 hash of a payload
 */
export function computeCanonicalPayloadHash(data: unknown): string {
  const canonical = canonicalJsonStringify(data);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Idempotency Payload Conflict Error (HTTP 409)
 * Raised when the same idempotency key is submitted with a different payload.
 */
export class IdempotencyConflictError extends Error {
  public readonly statusCode = 409;
  public readonly code = 'IDEMPOTENCY_CONFLICT';

  constructor(
    public readonly idempotencyKey: string,
    public readonly reason: string = `Idempotency key '${idempotencyKey}' was already used with a different request payload.`
  ) {
    super(reason);
    this.name = 'IdempotencyConflictError';
  }
}

/**
 * Result returned by a MigrationTargetAdapter import operation.
 */
export interface MigrationTargetAdapterResult {
  targetId: string;
  receipt: {
    batchId: string;
    sourceRow: number;
    entity: string;
    schemaVersion: number;
    idempotencyKey: string;
    targetId: string;
    kind: 'created' | 'linked';
    createdAt: Date;
    payloadHash?: string | undefined;
  };
  isExisting?: boolean | undefined;
}

/**
 * Error detail returned by a MigrationTargetAdapter.
 */
export interface MigrationTargetAdapterError {
  reasonCode: string;
  message: string;
  field?: string | undefined;
  retryable?: boolean | undefined;
}

/**
 * Generic Target Adapter Contract (Decision C4 & KIT-08)
 * Executed in-process or via module adapter port to guarantee atomic transaction commits
 * between target business records and durable import receipts.
 */
export interface MigrationTargetAdapter<TRow = unknown> {
  readonly module: string;
  readonly entity: string;
  readonly schemaVersion: number;

  /**
   * Preflight validation during dry-run phase (zero database mutations).
   */
  preflight(
    batchId: string,
    rows: TRow[]
  ): Promise<{ validCount: number; rejectCount: number } | { error: MigrationTargetAdapterError }>;

  /**
   * Commits target business record and durable import receipt atomically in one local PG transaction.
   */
  importRow(
    batchId: string,
    sourceRow: number,
    idempotencyKey: string,
    cleanData: TRow
  ): Promise<
    | { ok: true; value: MigrationTargetAdapterResult }
    | { ok: false; error: MigrationTargetAdapterError }
  >;
}

// ============================================================================
// KIT-09: Terminal Outcome Ledger, Controlled Skip & Exact Reconciliation
// ============================================================================

/**
 * Terminal Row Outcomes (KIT-09 / SDS §11.1)
 * Exactly one outcome per source row: loaded | rejected | merged | skipped
 */
export const TerminalOutcome = {
  LOADED: 'loaded',
  REJECTED: 'rejected',
  MERGED: 'merged',
  SKIPPED: 'skipped',
} as const;
export type TerminalOutcomeType = (typeof TerminalOutcome)[keyof typeof TerminalOutcome];

export const TerminalOutcomeSchema = z.enum([
  TerminalOutcome.LOADED,
  TerminalOutcome.REJECTED,
  TerminalOutcome.MERGED,
  TerminalOutcome.SKIPPED,
]);

/**
 * Required policy code stamped on operator-approved skips
 */
export const SKIP_POLICY_CODE = 'operator_approved_skip' as const;

/**
 * Validates that a string has at least N non-whitespace characters
 */
export function hasMinNonWhitespaceChars(str: string, min = 10): boolean {
  if (!str) return false;
  return str.replace(/\s+/g, '').length >= min;
}

/**
 * Skip Row Request Schema (KIT-09)
 * Enforces:
 * - Allowed only before real load
 * - Editor or Admin role required
 * - Migration Runner cannot approve its own skip
 * - Reason of at least 10 non-whitespace characters
 * - Policy code operator_approved_skip stamped
 */
export const SkipRowRequestSchema = z.object({
  batchId: z.string().min(1, 'batchId is required').max(128),
  sourceRow: z.number().int().min(1, 'sourceRow must be >= 1'),
  actor: z.string().min(1, 'actor is required').max(128),
  actorRoles: z.array(z.string()).min(1, 'at least one actor role is required'),
  reason: z.string().refine(
    (val) => hasMinNonWhitespaceChars(val, 10),
    { message: 'Skip reason must contain at least 10 non-whitespace characters' }
  ),
  batchRunner: z.string().max(128).optional(),
});
export type SkipRowRequest = z.infer<typeof SkipRowRequestSchema>;

/**
 * Append-Only Terminal Outcome Record Schema
 */
export const KitRowOutcomeRecordSchema = z.object({
  id: z.string().uuid().optional(),
  batchId: z.string().min(1).max(128),
  sourceRow: z.number().int().min(1),
  outcome: TerminalOutcomeSchema,
  targetId: z.string().max(128).optional(),
  reasonCode: z.string().max(64).optional(),
  reasonText: z.string().optional(),
  operator: z.string().max(128).optional(),
  operatorRole: z.string().max(64).optional(),
  policyCode: z.string().max(64).optional(),
  idempotencyKey: z.string().max(128).optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.date().optional(),
});
export type KitRowOutcomeRecord = z.infer<typeof KitRowOutcomeRecordSchema>;

/**
 * Dry-Run Token Tracking Record (KIT-09)
 * Any skip after dry run invalidates the token and requires a re-run
 */
export interface DryRunTokenRecord {
  batchId: string;
  token: string;
  issuedAt: Date;
  invalidated: boolean;
  invalidatedAt?: Date | undefined;
  invalidatedReason?: string | undefined;
}

/**
 * Batch Reconciliation Result (KIT-09)
 * Evaluates equation: source = loaded + rejected + merged + skipped; unaccounted = 0
 */
export interface KitReconciliationSummary {
  batchId: string;
  sourceCount: number;
  loadedCount: number;
  rejectedCount: number;
  mergedCount: number;
  skippedCount: number;
  unaccountedCount: number;
  formulaHolds: boolean;
  result: 'OK' | 'reconciliation_failed';
  signoffAllowed: boolean;
  failureReasons?: string[] | undefined;
  evaluatedAt: Date;
}

/**
 * Error raised when attempting to write a second terminal outcome for the same source row
 */
export class SecondTerminalOutcomeError extends Error {
  public readonly statusCode = 409;
  public readonly code = 'SECOND_TERMINAL_OUTCOME';

  constructor(
    public readonly batchId: string,
    public readonly sourceRow: number,
    public readonly existingOutcome: string,
    public readonly attemptedOutcome: string
  ) {
    super(
      `Row ${sourceRow} in batch '${batchId}' already has terminal outcome '${existingOutcome}'. Cannot assign second outcome '${attemptedOutcome}'.`
    );
    this.name = 'SecondTerminalOutcomeError';
  }
}

/**
 * Error raised when skip authorization fails (RBAC or separation of duties)
 */
export class SkipApprovalForbiddenError extends Error {
  public readonly statusCode = 403;
  public readonly code = 'SKIP_APPROVAL_FORBIDDEN';

  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'SkipApprovalForbiddenError';
  }
}

/**
 * Error raised when skip reason is too short (< 10 non-whitespace characters)
 */
export class InvalidSkipReasonError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'INVALID_SKIP_REASON';

  constructor(
    public readonly charCount: number,
    public readonly reason: string = `Skip reason must contain at least 10 non-whitespace characters (received ${charCount}).`
  ) {
    super(reason);
    this.name = 'InvalidSkipReasonError';
  }
}

/**
 * Error raised when load is attempted with an invalidated or missing dry-run token
 */
export class DryRunTokenInvalidatedError extends Error {
  public readonly statusCode = 412;
  public readonly code = 'DRY_RUN_TOKEN_INVALIDATED';

  constructor(
    public readonly batchId: string,
    public readonly reason: string = `Dry-run token for batch '${batchId}' is invalidated or missing. A new dry-run is required before real load.`
  ) {
    super(reason);
    this.name = 'DryRunTokenInvalidatedError';
  }
}

/**
 * Error raised when reconciliation equation fails or unaccounted != 0
 */
export class ReconciliationFailedError extends Error {
  public readonly statusCode = 422;
  public readonly code = 'RECONCILIATION_FAILED';

  constructor(
    public readonly batchId: string,
    public readonly summary: KitReconciliationSummary,
    public readonly reason: string = `Reconciliation failed for batch '${batchId}': formula did not balance or unaccounted rows (${summary.unaccountedCount}) != 0.`
  ) {
    super(reason);
    this.name = 'ReconciliationFailedError';
  }
}
