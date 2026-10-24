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

  /**
   * Preflight conflict check for compensating rollback (KIT-12).
   * Verifies target record exists, current version matches post-load version,
   * and asserts no downstream child references or later edits exist.
   */
  checkRollbackConflict?(
    targetId: string,
    postLoadVersion: number
  ): Promise<RollbackConflictCheck>;

  /**
   * Compensates a loaded row in reverse dependency order (KIT-12).
   * For 'remove_created': removes the created business record.
   * For 'restore_updated': restores prior state if current version matches post-load version.
   */
  compensateRow?(
    targetId: string,
    action: RollbackActionType,
    options?: {
      beforeState?: Record<string, unknown> | null;
      expectedVersion?: number;
    }
  ): Promise<RollbackCompensationResult>;
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

// ============================================================================
// KIT-12: Resumable Compensating-Saga Rollback with Conflict Preflight
// ============================================================================

/**
 * Rollback Compensation Actions (KIT-12)
 * - remove_created: Removes a created record (permitted only if no child/later edits exist)
 * - restore_updated: Restores record to before-state (permitted only if target version still matches post-load version)
 */
export const RollbackAction = {
  REMOVE_CREATED: 'remove_created',
  RESTORE_UPDATED: 'restore_updated',
} as const;
export type RollbackActionType = (typeof RollbackAction)[keyof typeof RollbackAction];

export const RollbackActionSchema = z.enum([
  RollbackAction.REMOVE_CREATED,
  RollbackAction.RESTORE_UPDATED,
]);

/**
 * Status of individual compensation actions in the rollback saga
 */
export const RollbackItemStatus = {
  PENDING: 'pending',
  COMPENSATED: 'compensated',
  BLOCKED: 'blocked',
  FAILED: 'failed',
  RESUMED: 'resumed',
} as const;
export type RollbackItemStatusType = (typeof RollbackItemStatus)[keyof typeof RollbackItemStatus];

export const RollbackItemStatusSchema = z.enum([
  RollbackItemStatus.PENDING,
  RollbackItemStatus.COMPENSATED,
  RollbackItemStatus.BLOCKED,
  RollbackItemStatus.FAILED,
  RollbackItemStatus.RESUMED,
]);

/**
 * Status of the entire batch rollback saga
 */
export const RollbackBatchStatus = {
  IDLE: 'idle',
  PREFLIGHT_PASSED: 'preflight_passed',
  IN_PROGRESS: 'in_progress',
  ROLLED_BACK: 'rolled_back',
  ROLLBACK_BLOCKED: 'rollback_blocked',
  FAILED: 'failed',
} as const;
export type RollbackBatchStatusType = (typeof RollbackBatchStatus)[keyof typeof RollbackBatchStatus];

export const RollbackBatchStatusSchema = z.enum([
  RollbackBatchStatus.IDLE,
  RollbackBatchStatus.PREFLIGHT_PASSED,
  RollbackBatchStatus.IN_PROGRESS,
  RollbackBatchStatus.ROLLED_BACK,
  RollbackBatchStatus.ROLLBACK_BLOCKED,
  RollbackBatchStatus.FAILED,
]);

/**
 * Conflict reason codes for preflight and runtime conflict detection
 */
export const RollbackConflictReason = {
  CHILD_REFERENCES_EXIST: 'CHILD_REFERENCES_EXIST',
  TARGET_VERSION_MISMATCH: 'TARGET_VERSION_MISMATCH',
  RECEIPT_NOT_FOUND: 'RECEIPT_NOT_FOUND',
  LATER_EDITS_DETECTED: 'LATER_EDITS_DETECTED',
  RECORD_NOT_FOUND: 'RECORD_NOT_FOUND',
} as const;
export type RollbackConflictReasonType =
  (typeof RollbackConflictReason)[keyof typeof RollbackConflictReason];

/**
 * Structured diagnostic details when a rollback conflict is detected
 */
export interface RollbackConflictDetail {
  targetId: string;
  module: string;
  entity: string;
  sourceRow?: number | undefined;
  reasonCode: RollbackConflictReasonType;
  message: string;
  currentVersion?: number | undefined;
  postLoadVersion?: number | undefined;
  childReferences?: Array<{ childEntity: string; childId: string }> | undefined;
}

/**
 * Preflight conflict check result for an individual target record
 */
export interface RollbackConflictCheck {
  canRollback: boolean;
  currentVersion: number;
  expectedVersion: number;
  hasChildReferences: boolean;
  childReferences?: Array<{ childEntity: string; childId: string }> | undefined;
  reason?: string | undefined;
}

/**
 * Result of executing an individual compensation action
 */
export interface RollbackCompensationResult {
  ok: boolean;
  targetId: string;
  action: RollbackActionType;
  error?: string | undefined;
}

/**
 * Preflight check result evaluating an entire batch prior to saga execution
 */
export interface RollbackPreflightResult {
  batchId: string;
  passed: boolean;
  totalReceipts: number;
  conflictCount: number;
  conflicts: RollbackConflictDetail[];
}

/**
 * Schema for an entry in the append-only rollback journal (platform.kit_rollback_journal)
 */
export const RollbackJournalRecordSchema = z.object({
  id: z.string().uuid().optional(),
  batchId: z.string().min(1).max(128),
  module: z.string().min(1).max(64),
  entity: z.string().min(1).max(64),
  targetId: z.string().min(1).max(128),
  sourceRow: z.number().int().min(1).optional(),
  action: RollbackActionSchema,
  targetVersion: z.number().int().min(1).default(1),
  beforeState: z.record(z.unknown()).nullable().optional(),
  afterState: z.record(z.unknown()).nullable().optional(),
  actor: z.string().min(1).max(128),
  status: RollbackItemStatusSchema,
  idempotencyKey: z.string().min(1).max(128),
  errorReason: z.string().optional(),
  position: z.number().int().min(0),
  executedAt: z.date().optional(),
  createdAt: z.date().optional(),
});
export type RollbackJournalRecord = z.infer<typeof RollbackJournalRecordSchema>;

/**
 * Summary of a batch rollback saga execution
 */
export const RollbackBatchSummarySchema = z.object({
  batchId: z.string().min(1).max(128),
  status: RollbackBatchStatusSchema,
  requestedBy: z.string().min(1).max(128),
  reason: z.string().min(1),
  preflightPassed: z.boolean(),
  totalItems: z.number().int().min(0),
  compensatedItems: z.number().int().min(0),
  blockedItems: z.number().int().min(0),
  failedItems: z.number().int().min(0),
  conflicts: z.array(z.custom<RollbackConflictDetail>()).default([]),
  isExisting: z.boolean().optional(),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
});
export type RollbackBatchSummary = z.infer<typeof RollbackBatchSummarySchema>;

/**
 * Error raised when rollback preflight detects blocking conflicts (child references or later edits)
 */
export class RollbackBlockedError extends Error {
  public readonly statusCode = 409;
  public readonly code = 'ROLLBACK_BLOCKED';

  constructor(
    public readonly batchId: string,
    public readonly conflicts: RollbackConflictDetail[],
    public readonly reason: string = `Rollback blocked for batch '${batchId}' due to ${conflicts.length} conflict(s).`
  ) {
    super(reason);
    this.name = 'RollbackBlockedError';
  }
}

/**
 * Error raised when a rollback is already in progress for a batch
 */
export class RollbackInProgressError extends Error {
  public readonly statusCode = 423;
  public readonly code = 'ROLLBACK_IN_PROGRESS';

  constructor(
    public readonly batchId: string,
    public readonly reason: string = `Rollback is already in progress for batch '${batchId}'.`
  ) {
    super(reason);
    this.name = 'RollbackInProgressError';
  }
}

// ============================================================================
// KIT-16: Reject, Profiling and Reconciliation Reports with Formula-Safe CSV
// ============================================================================

export const ReportType = {
  PROFILE: 'profile',
  REJECT: 'reject',
  RECONCILIATION: 'reconciliation',
} as const;
export type ReportTypeValue = (typeof ReportType)[keyof typeof ReportType];
export const ReportTypeSchema = z.enum(['profile', 'reject', 'reconciliation']);

/**
 * Mathematical row conservation summary stamped on all reports (KIT-16)
 * Enforces: source = loaded + rejected + merged + skipped; unaccounted = 0
 */
export const ReportAccountingCountsSchema = z.object({
  sourceCount: z.number().int().min(0),
  loadedCount: z.number().int().min(0),
  rejectedCount: z.number().int().min(0),
  mergedCount: z.number().int().min(0),
  skippedCount: z.number().int().min(0),
  unaccountedCount: z.number().int().min(0),
  formulaHolds: z.boolean(),
});
export type ReportAccountingCounts = z.infer<typeof ReportAccountingCountsSchema>;

/**
 * Rejection report row record (KIT-16)
 * Includes source row, entity, reason code, and safe message.
 * Sensitive raw values are omitted/redacted by default.
 */
export const RejectReportRowSchema = z.object({
  sourceRow: z.number().int().min(1),
  entity: z.string().min(1).max(64),
  reasonCode: z.string().min(1).max(64),
  safeMessage: z.string(),
  ruleId: z.string().optional(),
  module: z.string().optional(),
  rawSnippet: z.string().optional(),
});
export type RejectReportRow = z.infer<typeof RejectReportRowSchema>;

/**
 * Column profiling metrics (KIT-16)
 */
export const ProfileColumnMetricSchema = z.object({
  columnName: z.string().min(1),
  inferredType: z.string().min(1),
  emptyCount: z.number().int().min(0),
  duplicateCandidateCount: z.number().int().min(0).default(0),
  formulaThreatCount: z.number().int().min(0).default(0),
  totalRows: z.number().int().min(0),
});
export type ProfileColumnMetric = z.infer<typeof ProfileColumnMetricSchema>;

/**
 * Profiling report data (KIT-16)
 */
export const ProfileReportDataSchema = z.object({
  batchId: z.string().min(1),
  module: z.string().min(1),
  entity: z.string().min(1),
  totalRows: z.number().int().min(0),
  duplicateCount: z.number().int().min(0),
  columns: z.array(ProfileColumnMetricSchema),
  counts: ReportAccountingCountsSchema.optional(),
  evaluatedAt: z.date().or(z.string()),
});
export type ProfileReportData = z.infer<typeof ProfileReportDataSchema>;

/**
 * Reconciliation report data (KIT-16)
 */
export const ReconciliationReportDataSchema = z.object({
  batchId: z.string().min(1),
  module: z.string().min(1).optional(),
  entity: z.string().min(1).optional(),
  sourceCount: z.number().int().min(0),
  loadedCount: z.number().int().min(0),
  rejectedCount: z.number().int().min(0),
  mergedCount: z.number().int().min(0),
  skippedCount: z.number().int().min(0),
  unaccountedCount: z.number().int().min(0),
  formulaHolds: z.boolean(),
  result: z.enum(['OK', 'reconciliation_failed']),
  signoffAllowed: z.boolean(),
  failureReasons: z.array(z.string()).optional(),
  evaluatedAt: z.date().or(z.string()),
});
export type ReconciliationReportData = z.infer<typeof ReconciliationReportDataSchema>;

// ============================================================================
// KIT-17: Canonical Dirty Data Pack & Seven-Step Regression Suite
// ============================================================================

export const CANONICAL_DIRTY_PACK_TOTAL_ROWS = 1000;
export const CANONICAL_DIRTY_PACK_DUPLICATES = 80;
export const CANONICAL_DIRTY_PACK_BAD_FORMATS = 60;
export const CANONICAL_DIRTY_PACK_EMPTY_REQUIRED = 50;
export const CANONICAL_DIRTY_PACK_LOADED = 810;
export const CANONICAL_DIRTY_PACK_REJECTED = 110;
export const CANONICAL_DIRTY_PACK_MERGED = 80;
export const CANONICAL_DIRTY_PACK_SKIPPED = 0;
export const CANONICAL_DIRTY_PACK_UNACCOUNTED = 0;

/**
 * Boundary Fixture Types (KIT-17)
 */
export const BoundaryFixtureType = {
  FORTY_PERCENT_INVALID: 'forty_percent_invalid',
  UNRESOLVED_TRANSIENT_FAILURE: 'unresolved_transient_failure',
  DUPLICATE_DELIVERY: 'duplicate_delivery',
  MISSING_PARENT: 'missing_parent',
  INVALID_ENUM: 'invalid_enum',
  PROTECTED_OPT_OUT: 'protected_opt_out',
} as const;
export type BoundaryFixtureTypeValue =
  (typeof BoundaryFixtureType)[keyof typeof BoundaryFixtureType];

export const BoundaryFixtureTypeSchema = z.enum([
  'forty_percent_invalid',
  'unresolved_transient_failure',
  'duplicate_delivery',
  'missing_parent',
  'invalid_enum',
  'protected_opt_out',
]);

/**
 * Expected defect profile in canonical Dirty Data Pack (SDS §4.14 TS-02)
 */
export const DirtyPackDefectProfileSchema = z.object({
  knownDuplicates: z.number().int().min(0),
  badFormats: z.number().int().min(0),
  emptyRequiredFields: z.number().int().min(0),
  totalDefectFindings: z.number().int().min(0),
});
export type DirtyPackDefectProfile = z.infer<typeof DirtyPackDefectProfileSchema>;

/**
 * Boundary Fixture Manifest Item Schema (KIT-17)
 */
export const BoundaryFixtureItemSchema = z.object({
  fixtureName: z.string().min(1),
  fileName: z.string().min(1),
  relativeFilePath: z.string().min(1),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  totalRows: z.number().int().min(1),
  invalidRows: z.number().int().min(0).optional(),
  description: z.string().min(1),
  expectedBehavior: z.string().min(1),
});
export type BoundaryFixtureItem = z.infer<typeof BoundaryFixtureItemSchema>;

/**
 * Canonical Dirty Data Pack Manifest Schema (KIT-17)
 */
export const DirtyDataPackManifestSchema = z.object({
  packName: z.string().min(1),
  version: z.string().min(1),
  catalogId: z.literal('KIT-17'),
  relativeFilePath: z.string().min(1),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  totalRows: z.literal(1000),
  rulesVersion: z.string().min(1),
  traceability: z.object({
    sds: z.string(),
    projectPlan: z.string(),
    issue: z.string(),
  }),
  defects: DirtyPackDefectProfileSchema,
  expectedReconciliation: z.object({
    source: z.literal(1000),
    loaded: z.literal(810),
    rejected: z.literal(110),
    merged: z.literal(80),
    skipped: z.literal(0),
    unaccounted: z.literal(0),
    formulaHolds: z.literal(true),
    status: z.literal('OK'),
  }),
  testScenariosProof: z.record(z.string()),
  boundaryFixtures: z.record(BoundaryFixtureTypeSchema, BoundaryFixtureItemSchema),
});
export type DirtyDataPackManifest = z.infer<typeof DirtyDataPackManifestSchema>;
