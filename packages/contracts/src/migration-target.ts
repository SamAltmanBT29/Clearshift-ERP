import { z } from 'zod';
import { createHash } from 'node:crypto';

/**
 * Migration Kit Batch Statuses (KIT-01)
 *
 * Valid success path:
 * created -> extracting -> extracted -> profiled -> cleaned -> mapped -> dry_run_passed -> loading -> loaded -> validating -> validated -> reconciled
 *
 * Side states:
 * failed, load_failed_partial, rollback_pending, rollback_blocked, rolled_back
 */
export const KitBatchSuccessStatusSchema = z.enum([
  'created',
  'extracting',
  'extracted',
  'profiled',
  'cleaned',
  'mapped',
  'dry_run_passed',
  'loading',
  'loaded',
  'validating',
  'validated',
  'reconciled',
]);
export type KitBatchSuccessStatus = z.infer<typeof KitBatchSuccessStatusSchema>;

export const KitBatchSideStatusSchema = z.enum([
  'failed',
  'load_failed_partial',
  'rollback_pending',
  'rollback_blocked',
  'rolled_back',
]);
export type KitBatchSideStatus = z.infer<typeof KitBatchSideStatusSchema>;

export const KitBatchStatusSchema = z.enum([
  // Success path
  'created',
  'extracting',
  'extracted',
  'profiled',
  'cleaned',
  'mapped',
  'dry_run_passed',
  'loading',
  'loaded',
  'validating',
  'validated',
  'reconciled',
  // Side states
  'failed',
  'load_failed_partial',
  'rollback_pending',
  'rollback_blocked',
  'rolled_back',
]);
export type KitBatchStatus = z.infer<typeof KitBatchStatusSchema>;

/**
 * Seven-step pipeline step names
 */
export const KitBatchStepNameSchema = z.enum([
  'extract',
  'profile',
  'clean',
  'map',
  'dry_run',
  'load',
  'validate',
  'reconcile',
]);
export type KitBatchStepName = z.infer<typeof KitBatchStepNameSchema>;

/**
 * Custom Error for illegal state transitions
 */
export class IllegalBatchStateTransitionError extends Error {
  public readonly statusCode = 409;
  public readonly code = 'CONFLICT';

  constructor(
    public readonly fromStatus: string,
    public readonly toStatus: string,
    public readonly batchId?: string,
    additionalMessage?: string
  ) {
    const baseMsg = batchId
      ? `Illegal batch state transition from '${fromStatus}' to '${toStatus}' for batch '${batchId}'`
      : `Illegal batch state transition from '${fromStatus}' to '${toStatus}'`;
    super(additionalMessage ? `${baseMsg}: ${additionalMessage}` : baseMsg);
    this.name = 'IllegalBatchStateTransitionError';
  }
}

/**
 * Custom Error when trying to mutate an immutable ledger entry
 */
export class ImmutableStepLedgerError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'LEDGER_IMMUTABLE';

  constructor(message: string = 'Step ledger entries are append-only and cannot be modified or deleted') {
    super(message);
    this.name = 'ImmutableStepLedgerError';
  }
}

/**
 * State Transition Guard Mapping
 * Defines all allowable transitions for Migration Kit Batches.
 */
export const KIT_BATCH_TRANSITIONS_MAP: Record<KitBatchStatus, readonly KitBatchStatus[]> = {
  // Step 1: Ingestion / Extraction
  created: ['extracting', 'failed'],
  extracting: ['extracted', 'failed'],

  // Step 2: Profiling
  extracted: ['profiled', 'failed'],

  // Step 3: Cleaning
  profiled: ['cleaned', 'failed'],

  // Step 4: Mapping
  cleaned: ['mapped', 'failed'],

  // Step 5: Dry-Run
  mapped: ['dry_run_passed', 'failed'],

  // Step 6: Loading
  dry_run_passed: ['loading', 'failed'],
  loading: ['loaded', 'failed', 'load_failed_partial'],
  load_failed_partial: ['loading', 'failed', 'rollback_pending'],

  // Step 7: Validation
  loaded: ['validating', 'failed'],
  validating: ['validated', 'failed'],

  // Step 8: Reconciliation
  validated: ['reconciled', 'failed'],

  // Terminal states
  reconciled: [],
  rolled_back: [],

  // Rollback flow states
  rollback_pending: ['rolled_back', 'rollback_blocked', 'failed'],
  rollback_blocked: ['failed'],

  // Resumable failure state:
  // Cannot restart from created implicitly; must resume from a committed checkpoint
  failed: [
    'extracting',
    'profiled',
    'cleaned',
    'mapped',
    'dry_run_passed',
    'loading',
    'validating',
    'reconciled',
    'rollback_pending',
  ],
};

/**
 * Maps terminal step status to the step name
 */
export const STATUS_TO_STEP_NAME: Partial<Record<KitBatchStatus, KitBatchStepName>> = {
  extracting: 'extract',
  extracted: 'extract',
  profiled: 'profile',
  cleaned: 'clean',
  mapped: 'map',
  dry_run_passed: 'dry_run',
  loading: 'load',
  loaded: 'load',
  load_failed_partial: 'load',
  validating: 'validate',
  validated: 'validate',
  reconciled: 'reconcile',
};

/**
 * Status to Checkpoint mapping
 */
export const STATUS_TO_CHECKPOINT: Record<KitBatchStatus, string> = {
  created: 'created',
  extracting: 'extracting',
  extracted: 'extracted',
  profiled: 'profiled',
  cleaned: 'cleaned',
  mapped: 'mapped',
  dry_run_passed: 'dry_run_passed',
  loading: 'loading',
  loaded: 'loaded',
  load_failed_partial: 'load_checkpoint',
  validating: 'validating',
  validated: 'validated',
  reconciled: 'reconciled',
  failed: 'failed',
  rollback_pending: 'rollback_pending',
  rollback_blocked: 'rollback_blocked',
  rolled_back: 'rolled_back',
};

/**
 * Computes the durable checkpoint associated with moving to a target status.
 */
export function computeNextCheckpoint(
  targetStatus: KitBatchStatus,
  previousCheckpoint: string
): string {
  if (targetStatus === 'load_failed_partial') {
    return 'load_checkpoint';
  }

  if (targetStatus === 'failed' || targetStatus === 'rollback_pending' || targetStatus === 'rollback_blocked') {
    return previousCheckpoint;
  }

  return STATUS_TO_CHECKPOINT[targetStatus] || previousCheckpoint;
}

/**
 * Resolves the step name for a target state
 */
export function resolveStepName(
  targetStatus: KitBatchStatus,
  overrideName?: KitBatchStepName
): KitBatchStepName {
  if (overrideName) {
    return overrideName;
  }
  const inferred = STATUS_TO_STEP_NAME[targetStatus];
  if (inferred) {
    return inferred;
  }
  return 'extract';
}

/**
 * Checks if a transition between two batch states is allowed.
 * Idempotent transitions (from === to) are always permitted.
 */
export function canKitBatchTransition(from: KitBatchStatus, to: KitBatchStatus): boolean {
  if (from === to) {
    return true;
  }
  const allowed = KIT_BATCH_TRANSITIONS_MAP[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Asserts that a state transition is legal, throwing IllegalBatchStateTransitionError if forbidden.
 * Also verifies that retries cannot restart from 'created' implicitly when attempt > 1 or prior steps exist.
 */
export function assertValidKitBatchTransition(
  from: KitBatchStatus,
  to: KitBatchStatus,
  batchId?: string,
  currentCheckpoint?: string,
  attempt: number = 1
): void {
  if (from === to) {
    return;
  }

  // Explicit check: retries cannot restart from 'created' implicitly
  if (to === 'created') {
    throw new IllegalBatchStateTransitionError(
      from,
      to,
      batchId,
      'Batch cannot restart from created implicitly; must resume from committed checkpoint'
    );
  }

  // Guard against illegal transitions from terminal states
  if (isKitBatchTerminalStatus(from)) {
    throw new IllegalBatchStateTransitionError(
      from,
      to,
      batchId,
      `Cannot transition from terminal status '${from}'`
    );
  }

  if (!canKitBatchTransition(from, to)) {
    throw new IllegalBatchStateTransitionError(from, to, batchId);
  }

  // If retrying from failed, ensure we don't jump arbitrarily to uncheckpointed state
  if (from === 'failed' && currentCheckpoint) {
    // When resuming from failed, the destination must match or advance beyond the checkpoint
    const allowedResumeTarget = getValidResumeTarget(currentCheckpoint);
    if (allowedResumeTarget && to !== allowedResumeTarget && to !== 'rollback_pending') {
      throw new IllegalBatchStateTransitionError(
        from,
        to,
        batchId,
        `Retry must resume from committed checkpoint '${currentCheckpoint}' (expected target '${allowedResumeTarget}')`
      );
    }
  }
}

/**
 * Gets the valid resume target state given a committed checkpoint
 */
export function getValidResumeTarget(checkpoint: string): KitBatchStatus | null {
  switch (checkpoint) {
    case 'created':
    case 'extracting':
      return 'extracting';
    case 'extracted':
      return 'profiled';
    case 'profiled':
      return 'cleaned';
    case 'cleaned':
      return 'mapped';
    case 'mapped':
      return 'dry_run_passed';
    case 'dry_run_passed':
      return 'loading';
    case 'load_checkpoint':
    case 'loading':
      return 'loading';
    case 'loaded':
    case 'validating':
      return 'validating';
    case 'validated':
      return 'reconciled';
    default:
      return null;
  }
}

/**
 * Identifies terminal states for Migration Kit batches
 */
export function isKitBatchTerminalStatus(status: KitBatchStatus): boolean {
  return status === 'reconciled' || status === 'rolled_back';
}

/**
 * Identifies resumable / retryable states
 */
export function isKitBatchResumableStatus(status: KitBatchStatus): boolean {
  return status === 'failed' || status === 'load_failed_partial';
}

/**
 * Returns allowed next states from the transition matrix
 */
export function getAllowedNextKitBatchStates(status: KitBatchStatus): KitBatchStatus[] {
  return [...(KIT_BATCH_TRANSITIONS_MAP[status] || [])];
}

/**
 * Kit Batch Schema
 */
export const KitBatchSchema = z.object({
  id: z.string().uuid(),
  batchNumber: z.string().min(1).max(64),
  module: z.string().min(1).max(64),
  sourceSystem: z.string().max(64).nullable().optional(),
  fileName: z.string().max(255).nullable().optional(),
  fileSizeBytes: z.number().int().nonnegative().nullable().optional(),
  checksum: z.string().length(64),
  status: KitBatchStatusSchema,
  previousStatus: KitBatchStatusSchema.nullable().optional(),
  checkpoint: z.string().max(64),
  attempt: z.number().int().min(1),
  maxAttempts: z.number().int().min(1).default(3),
  totalRows: z.number().int().nonnegative().default(0),
  loadedRows: z.number().int().nonnegative().default(0),
  rejectedRows: z.number().int().nonnegative().default(0),
  mergedRows: z.number().int().nonnegative().default(0),
  skippedRows: z.number().int().nonnegative().default(0),
  unaccountedRows: z.number().int().nonnegative().default(0),
  ruleVersion: z.string().max(32).default('1.0.0'),
  codeVersion: z.string().max(32).default('1.0.0'),
  errorCode: z.string().max(64).nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  correlationId: z.string().max(128),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdBy: z.string().max(128).default('system'),
  startedAt: z.coerce.date().nullable().optional(),
  finishedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type KitBatch = z.infer<typeof KitBatchSchema>;

/**
 * Kit Batch Step Ledger Schema (Immutable)
 */
export const KitBatchStepSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().uuid(),
  stepNumber: z.number().int().min(1),
  stepName: KitBatchStepNameSchema,
  fromStatus: KitBatchStatusSchema,
  toStatus: KitBatchStatusSchema,
  attempt: z.number().int().min(1),
  checkpoint: z.string().max(64),
  recordsIn: z.number().int().nonnegative().default(0),
  recordsOut: z.number().int().nonnegative().default(0),
  recordsRejected: z.number().int().nonnegative().default(0),
  recordsMerged: z.number().int().nonnegative().default(0),
  recordsSkipped: z.number().int().nonnegative().default(0),
  ruleVersion: z.string().max(32).default('1.0.0'),
  codeVersion: z.string().max(32).default('1.0.0'),
  errorCode: z.string().max(64).nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  correlationId: z.string().max(128),
  actor: z.string().max(128).default('system'),
  durationMs: z.number().int().nonnegative().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
});
export type KitBatchStep = z.infer<typeof KitBatchStepSchema>;

/**
 * Creation Input
 */
export const CreateKitBatchInputSchema = z.object({
  id: z.string().uuid().optional(),
  batchNumber: z.string().min(1).max(64).optional(),
  module: z.string().min(1).max(64),
  sourceSystem: z.string().max(64).optional(),
  fileName: z.string().max(255).optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  checksum: z.string().length(64),
  totalRows: z.number().int().nonnegative().default(0),
  ruleVersion: z.string().max(32).default('1.0.0'),
  codeVersion: z.string().max(32).default('1.0.0'),
  correlationId: z.string().max(128).optional(),
  createdBy: z.string().max(128).default('system'),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type CreateKitBatchInput = z.input<typeof CreateKitBatchInputSchema>;

/**
 * State Transition Input
 */
export const TransitionKitBatchInputSchema = z.object({
  targetStatus: KitBatchStatusSchema,
  stepName: KitBatchStepNameSchema.optional(),
  checkpoint: z.string().max(64).optional(),
  recordsIn: z.number().int().nonnegative().optional(),
  recordsOut: z.number().int().nonnegative().optional(),
  recordsRejected: z.number().int().nonnegative().optional(),
  recordsMerged: z.number().int().nonnegative().optional(),
  recordsSkipped: z.number().int().nonnegative().optional(),
  errorCode: z.string().max(64).nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  correlationId: z.string().max(128).optional(),
  actor: z.string().max(128).default('system'),
  durationMs: z.number().int().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type TransitionKitBatchInput = z.input<typeof TransitionKitBatchInputSchema>;

/**
 * Resume Input
 */
export const ResumeKitBatchInputSchema = z.object({
  correlationId: z.string().max(128).optional(),
  actor: z.string().max(128).default('system'),
  reason: z.string().optional(),
});
export type ResumeKitBatchInput = z.input<typeof ResumeKitBatchInputSchema>;

/**
 * Row reconciliation verification helper
 * Enforces: source = loaded + rejected + merged + skipped; unaccounted = 0
 */
export function verifyReconciliationCounts(counts: {
  totalRows: number;
  loadedRows: number;
  rejectedRows: number;
  mergedRows: number;
  skippedRows: number;
}): { ok: boolean; unaccounted: number } {
  const sum = counts.loadedRows + counts.rejectedRows + counts.mergedRows + counts.skippedRows;
  const unaccounted = counts.totalRows - sum;
  return {
    ok: unaccounted === 0,
    unaccounted,
  };
}

/**
 * ---------------------------------------------------------------------------
 * KIT-02: Streamed Source Upload, Parser Limits & Raw Immutability Contracts
 * ---------------------------------------------------------------------------
 */

/**
 * Ingestion and Parser Resource Limits (KIT-02)
 */
export const INGESTION_LIMITS = {
  MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024, // 50 MiB = 52,428,800 bytes
  MAX_EXPANDED_ARCHIVE_SIZE_BYTES: 250 * 1024 * 1024, // 250 MiB = 262,144,000 bytes
  MAX_COLUMNS: 100,
  MAX_DATA_ROWS: 100_000,
  MAX_CELL_SIZE_BYTES: 64 * 1024, // 64 KiB = 65,536 bytes
} as const;

export const FileFormatSchema = z.enum(['csv', 'xlsx']);
export type FileFormat = z.infer<typeof FileFormatSchema>;

export const CsvDelimiterSchema = z.enum([',', ';']);
export type CsvDelimiter = z.infer<typeof CsvDelimiterSchema>;

/**
 * Parser Diagnostics Schema (Tracks blank physical rows, BOM, column counts)
 */
export const ParserDiagnosticsSchema = z.object({
  totalPhysicalLines: z.number().int().nonnegative(),
  blankRowsCount: z.number().int().nonnegative(),
  headerRowIndex: z.number().int().nonnegative(),
  dataRowsCount: z.number().int().nonnegative(),
  columnsCount: z.number().int().nonnegative(),
  detectedDelimiter: z.string(),
  hasBom: z.boolean(),
  warnings: z.array(z.string()).default([]),
});
export type ParserDiagnostics = z.infer<typeof ParserDiagnosticsSchema>;

/**
 * Raw Row Schema (Stored in raw_rows with ordered headers, cells, and checksum)
 */
export const RawRowSchema = z.object({
  id: z.string().uuid().optional(),
  batchId: z.string().uuid(),
  sourceRow: z.number().int().min(1),
  headers: z.array(z.string()),
  cells: z.array(z.string()),
  payload: z.record(z.string(), z.string()),
  rowHash: z.string().length(64),
  createdAt: z.coerce.date().optional(),
});
export type RawRow = z.infer<typeof RawRowSchema>;

/**
 * Options when uploading/streaming a source file
 */
export const UploadSourceOptionsSchema = z.object({
  module: z.string().min(1).max(64),
  sourceSystem: z.string().max(64).optional(),
  format: FileFormatSchema.default('csv'),
  delimiter: CsvDelimiterSchema.default(','),
  dateFormat: z.string().max(32).optional(),
  phoneCountry: z.string().max(16).optional(),
  correlationId: z.string().max(128).optional(),
  actor: z.string().max(128).default('system'),
});
export type UploadSourceOptions = z.infer<typeof UploadSourceOptionsSchema>;

/**
 * Ingestion Result Contract
 */
export const IngestResultSchema = z.object({
  batchId: z.string().uuid(),
  batchNumber: z.string(),
  fileName: z.string(),
  fileSizeBytes: z.number().int().nonnegative(),
  checksum: z.string().length(64),
  storagePath: z.string(),
  headers: z.array(z.string()),
  totalDataRows: z.number().int().nonnegative(),
  diagnostics: ParserDiagnosticsSchema,
});
export type IngestResult = z.infer<typeof IngestResultSchema>;

/**
 * Custom Errors for Ingestion and Parser Limit Violations
 */
export type IngestionLimitType =
  | 'MAX_FILE_SIZE'
  | 'MAX_COLUMNS'
  | 'MAX_DATA_ROWS'
  | 'MAX_CELL_SIZE'
  | 'MAX_EXPANDED_ARCHIVE';

export class IngestionLimitError extends Error {
  public readonly statusCode: number;
  public readonly code = 'LIMIT_EXCEEDED';

  constructor(
    public readonly limitName: IngestionLimitType,
    public readonly limitValue: number,
    public readonly actualValue: number,
    customMessage?: string
  ) {
    const defaultMsg = `Ingestion limit exceeded: ${limitName} limit is ${limitValue}, received ${actualValue}`;
    super(customMessage || defaultMsg);
    this.name = 'IngestionLimitError';
    this.statusCode = limitName === 'MAX_FILE_SIZE' ? 413 : 400;
  }
}

export class InvalidEncodingError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'INVALID_ENCODING';

  constructor(message: string = 'Input file contains invalid non-UTF-8 byte sequences') {
    super(message);
    this.name = 'InvalidEncodingError';
  }
}

export class SecurityRejectedError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'SECURITY_REJECTED';

  constructor(public readonly securityReason: string) {
    super(`Security policy rejected file: ${securityReason}`);
    this.name = 'SecurityRejectedError';
  }
}

export class MalformedFileError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'MALFORMED_FILE';

  constructor(message: string) {
    super(`Malformed file: ${message}`);
    this.name = 'MalformedFileError';
  }
}

/**
 * ---------------------------------------------------------------------------
 * KIT-03: Column Profiling, Data Health Report & Export Contracts
 * ---------------------------------------------------------------------------
 */

export const InferredDataTypeSchema = z.enum([
  'string',
  'integer',
  'decimal',
  'date',
  'email',
  'phone',
  'uuid',
  'boolean',
  'json',
]);
export type InferredDataType = z.infer<typeof InferredDataTypeSchema>;

export const TopValueSchema = z.object({
  value: z.string(),
  count: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100),
});
export type TopValue = z.infer<typeof TopValueSchema>;

export const ColumnProfileSchema = z.object({
  columnName: z.string().min(1),
  totalRows: z.number().int().nonnegative(),
  emptyCount: z.number().int().nonnegative(),
  distinctCount: z.number().int().nonnegative(),
  invalidCount: z.number().int().nonnegative(),
  inferredType: InferredDataTypeSchema,
  topValues: z.array(TopValueSchema),
  minValue: z.string().nullable().optional(),
  maxValue: z.string().nullable().optional(),
});
export type ColumnProfile = z.infer<typeof ColumnProfileSchema>;

export const DuplicateCandidateReportSchema = z.object({
  keyFields: z.array(z.string()),
  totalDuplicates: z.number().int().nonnegative(),
  uniqueDuplicateKeys: z.number().int().nonnegative(),
  sampleDuplicateKeys: z.array(z.string()).default([]),
});
export type DuplicateCandidateReport = z.infer<typeof DuplicateCandidateReportSchema>;

export const ProfileReportSummarySchema = z.object({
  emptyCount: z.number().int().nonnegative(),
  invalidCount: z.number().int().nonnegative(),
  duplicateCount: z.number().int().nonnegative(),
});
export type ProfileReportSummary = z.infer<typeof ProfileReportSummarySchema>;

export const ProfileReportSchema = z.object({
  batchId: z.string().uuid(),
  module: z.string().min(1),
  rulesetVersion: z.number().int().positive().default(1),
  totalRows: z.number().int().nonnegative(),
  totalColumns: z.number().int().nonnegative(),
  columns: z.array(ColumnProfileSchema),
  duplicates: DuplicateCandidateReportSchema,
  summary: ProfileReportSummarySchema,
  generatedAt: z.coerce.date(),
});
export type ProfileReport = z.infer<typeof ProfileReportSchema>;

export const BatchProfiledPayloadSchema = z.object({
  batchId: z.string().uuid(),
  module: z.string().min(1),
  emptyCount: z.number().int().nonnegative(),
  invalidCount: z.number().int().nonnegative(),
  duplicateCount: z.number().int().nonnegative(),
  totalRows: z.number().int().nonnegative(),
  columnsCount: z.number().int().nonnegative(),
  rulesetVersion: z.number().int().positive().default(1),
});
export type BatchProfiledPayload = z.infer<typeof BatchProfiledPayloadSchema>;

/**
 * ---------------------------------------------------------------------------
 * KIT-04: V1 Cleaning Rule Registry, Rejection & Audit Log Contracts
 * ---------------------------------------------------------------------------
 */

export const CleaningRuleIdSchema = z.enum([
  'RL-TEXT-01',
  'RL-TEXT-02',
  'RL-NAME-01',
  'RL-EMAIL-01',
  'RL-PHONE-01',
  'RL-DATE-01',
  'RL-CURRENCY-01',
  'RL-ADDR-01',
  'RL-REQ-01',
  'RL-FORMAT-01',
  'RL-DUP-01',
  'RL-TAX-01',
]);
export type CleaningRuleId = z.infer<typeof CleaningRuleIdSchema>;

export const V1_CLEANING_RULES: readonly CleaningRuleId[] = [
  'RL-TEXT-01',
  'RL-TEXT-02',
  'RL-NAME-01',
  'RL-EMAIL-01',
  'RL-PHONE-01',
  'RL-DATE-01',
  'RL-CURRENCY-01',
  'RL-ADDR-01',
  'RL-REQ-01',
  'RL-FORMAT-01',
  'RL-DUP-01',
  'RL-TAX-01',
] as const;

export const CleanLogEntrySchema = z.object({
  id: z.string().uuid().optional(),
  batchId: z.string().uuid(),
  sourceRow: z.number().int().positive(),
  fieldName: z.string().min(1),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  ruleId: CleaningRuleIdSchema,
  ruleVersion: z.string().min(1).default('1.0.0'),
  createdAt: z.coerce.date().optional(),
});
export type CleanLogEntry = z.infer<typeof CleanLogEntrySchema>;

export const KitRejectSchema = z.object({
  id: z.string().uuid().optional(),
  batchId: z.string().uuid(),
  sourceRow: z.number().int().positive(),
  entity: z.string().min(1),
  reasonCode: z.string().min(1),
  reasonText: z.string().min(1),
  rawJson: z.record(z.unknown()).default({}),
  createdAt: z.coerce.date().optional(),
});
export type KitReject = z.infer<typeof KitRejectSchema>;

export const StgRowStatusSchema = z.enum(['cleaned', 'rejected']);
export type StgRowStatus = z.infer<typeof StgRowStatusSchema>;

export const StgRowSchema = z.object({
  id: z.string().uuid().optional(),
  batchId: z.string().uuid(),
  sourceRow: z.number().int().positive(),
  status: StgRowStatusSchema,
  cleanedPayload: z.record(z.unknown()).default({}),
  rejectReason: z.string().nullable().optional(),
  goldenId: z.string().nullable().optional(),
  createdAt: z.coerce.date().optional(),
});
export type StgRow = z.infer<typeof StgRowSchema>;

export const CleaningRuleConfigSchema = z.object({
  enabledRules: z.array(CleaningRuleIdSchema).optional(),
  disabledRules: z.array(CleaningRuleIdSchema).optional(),
  dateFormat: z.string().default('YYYY-MM-DD'),
  phoneCountry: z.string().default('+1'),
  requiredFields: z.array(z.string()).default([]),
  addressDictionary: z.record(z.string()).optional(),
});
export type CleaningRuleConfig = z.infer<typeof CleaningRuleConfigSchema>;

export const BatchCleanedPayloadSchema = z.object({
  batchId: z.string().uuid(),
  module: z.string().min(1),
  cleanedRows: z.number().int().nonnegative(),
  rejectedRows: z.number().int().nonnegative(),
  totalRows: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional(),
  ruleVersion: z.string().default('1.0.0'),
});
export type BatchCleanedPayload = z.infer<typeof BatchCleanedPayloadSchema>;

/**
 * Migration Kit Mapping & Value Conversion Contracts (KIT-05 / SDS §4.5 & §4.10)
 */

export const MappingTransformationSchema = z.enum([
  'identity',
  'trim',
  'uppercase',
  'lowercase',
]);
export type MappingTransformation = z.infer<typeof MappingTransformationSchema>;

export const FieldMappingDefinitionSchema = z.object({
  sourceColumn: z.string().min(1),
  targetField: z.string().min(1),
  required: z.boolean().default(false),
  transformation: MappingTransformationSchema.default('identity'),
  defaultValue: z.string().nullable().optional(),
});
export type FieldMappingDefinition = z.infer<typeof FieldMappingDefinitionSchema>;

export const ValueConversionUnmappedActionSchema = z.enum([
  'reject',
  'flag_warning',
  'use_default',
  'pass_through',
]);
export type ValueConversionUnmappedAction = z.infer<typeof ValueConversionUnmappedActionSchema>;

export const ValueConversionRuleSchema = z.object({
  targetField: z.string().min(1),
  mappings: z.record(z.string()),
  unmappedAction: ValueConversionUnmappedActionSchema.default('reject'),
  defaultValue: z.string().nullable().optional(),
});
export type ValueConversionRule = z.infer<typeof ValueConversionRuleSchema>;

export const MappingTemplateSchema = z.object({
  id: z.string().uuid().optional(),
  module: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1).default('1.0.0'),
  targetEntity: z.string().min(1).default('contacts'),
  fieldMappings: z.array(FieldMappingDefinitionSchema),
  valueConversions: z.array(ValueConversionRuleSchema).default([]),
  createdBy: z.string().min(1).default('system'),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});
export type MappingTemplate = z.infer<typeof MappingTemplateSchema>;

export const CreateMappingTemplateInputSchema = z.object({
  module: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1).default('1.0.0'),
  targetEntity: z.string().min(1).default('contacts'),
  fieldMappings: z.array(FieldMappingDefinitionSchema),
  valueConversions: z.array(ValueConversionRuleSchema).default([]),
  createdBy: z.string().min(1).optional(),
});
export type CreateMappingTemplateInput = z.infer<typeof CreateMappingTemplateInputSchema>;

export const UpdateMappingTemplateInputSchema = z.object({
  name: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  targetEntity: z.string().min(1).optional(),
  fieldMappings: z.array(FieldMappingDefinitionSchema).optional(),
  valueConversions: z.array(ValueConversionRuleSchema).optional(),
});
export type UpdateMappingTemplateInput = z.infer<typeof UpdateMappingTemplateInputSchema>;

export const TargetFieldDefinitionSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean(),
  dataType: z.enum(['string', 'email', 'phone', 'date', 'number', 'enum', 'uuid', 'boolean']),
  allowedValues: z.array(z.string()).optional(),
  description: z.string().optional(),
});
export type TargetFieldDefinition = z.infer<typeof TargetFieldDefinitionSchema>;

export const TargetEntityDefinitionSchema = z.object({
  entity: z.string().min(1),
  module: z.string().min(1),
  label: z.string().min(1),
  fields: z.array(TargetFieldDefinitionSchema),
});
export type TargetEntityDefinition = z.infer<typeof TargetEntityDefinitionSchema>;

export const TypeIncompatibilityWarningSchema = z.object({
  targetField: z.string(),
  targetLabel: z.string(),
  targetType: z.string(),
  sourceColumn: z.string(),
  sourceType: z.string(),
  warning: z.string(),
});
export type TypeIncompatibilityWarning = z.infer<typeof TypeIncompatibilityWarningSchema>;

export const MappingValidationResultSchema = z.object({
  valid: z.boolean(),
  missingRequiredFields: z.array(z.string()),
  invalidEnumConversions: z.array(
    z.object({
      field: z.string(),
      sourceValue: z.string(),
      reason: z.string(),
    })
  ),
  errors: z.array(z.string()),
  warnings: z.array(z.string()).optional(),
  typeIncompatibilities: z.array(TypeIncompatibilityWarningSchema).optional(),
});
export type MappingValidationResult = z.infer<typeof MappingValidationResultSchema>;

export const CleanCrmRowSchema = z.object({
  id: z.string().uuid().optional(),
  batchId: z.string().uuid(),
  sourceRow: z.number().int().positive(),
  payload: z.record(z.unknown()),
  createdAt: z.coerce.date().optional(),
});
export type CleanCrmRow = z.infer<typeof CleanCrmRowSchema>;

export const BatchMappedPayloadSchema = z.object({
  batchId: z.string().uuid(),
  module: z.string().min(1),
  mappedRows: z.number().int().nonnegative(),
  missingRequired: z.number().int().nonnegative(),
  templateId: z.string().optional(),
  templateName: z.string().optional(),
  targetEntity: z.string().min(1),
  totalRows: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional(),
});
export type BatchMappedPayload = z.infer<typeof BatchMappedPayloadSchema>;

/**
 * Standard CRM Target Entity Registries
 */
export const CRM_CONTACTS_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'firstName', label: 'First Name', required: true, dataType: 'string' },
  { name: 'lastName', label: 'Last Name', required: true, dataType: 'string' },
  { name: 'email', label: 'Email Address', required: true, dataType: 'email' },
  { name: 'phone', label: 'Phone Number', required: false, dataType: 'phone' },
  { name: 'company', label: 'Company Name', required: false, dataType: 'string' },
  { name: 'country', label: 'Country', required: false, dataType: 'string' },
  {
    name: 'leadStatus',
    label: 'Lead Status',
    required: false,
    dataType: 'enum',
    allowedValues: ['New', 'Working', 'Qualified', 'Closed'],
  },
];

export const CRM_LEADS_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'firstName', label: 'First Name', required: true, dataType: 'string' },
  { name: 'lastName', label: 'Last Name', required: true, dataType: 'string' },
  { name: 'email', label: 'Email Address', required: true, dataType: 'email' },
  { name: 'phone', label: 'Phone Number', required: false, dataType: 'phone' },
  { name: 'company', label: 'Company Name', required: false, dataType: 'string' },
  {
    name: 'leadStatus',
    label: 'Lead Status',
    required: true,
    dataType: 'enum',
    allowedValues: ['New', 'Working', 'Qualified', 'Closed'],
  },
];

export const CRM1_CONTACTS_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'firstName', label: 'First Name', required: true, dataType: 'string', description: 'Contact given name' },
  { name: 'lastName', label: 'Last Name', required: true, dataType: 'string', description: 'Contact family name' },
  { name: 'email', label: 'Email Address', required: true, dataType: 'email', description: 'Canonical primary email' },
  { name: 'phone', label: 'Phone Number', required: false, dataType: 'phone', description: 'E.164 phone number' },
  { name: 'address', label: 'Mailing Address', required: false, dataType: 'string', description: 'Contact physical address' },
  { name: 'companyId', label: 'Company ID', required: false, dataType: 'uuid', description: 'Associated company UUID' },
  {
    name: 'leadStatus',
    label: 'Lead Status',
    required: false,
    dataType: 'enum',
    allowedValues: ['New', 'Working', 'Qualified', 'Closed'],
    description: 'Current lifecycle lead status',
  },
  {
    name: 'consentStatus',
    label: 'Consent Status',
    required: false,
    dataType: 'enum',
    allowedValues: ['unknown', 'granted', 'withdrawn'],
    description: 'GDPR/marketing consent state',
  },
  { name: 'unsubscribed', label: 'Unsubscribed Flag', required: false, dataType: 'boolean', description: 'Opt-out status flag' },
];

export const CRM1_COMPANIES_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'name', label: 'Company Name', required: true, dataType: 'string', description: 'Official organization name' },
  { name: 'taxNumber', label: 'Tax Identification Number', required: false, dataType: 'string', description: 'Tax or VAT number' },
  { name: 'email', label: 'Corporate Email', required: false, dataType: 'email', description: 'Primary corporate email address' },
  { name: 'phone', label: 'Phone Number', required: false, dataType: 'phone', description: 'Company main switchboard phone' },
  { name: 'address', label: 'Headquarters Address', required: false, dataType: 'string', description: 'Registered business address' },
  { name: 'sourceSystem', label: 'Source System', required: false, dataType: 'string', description: 'Legacy source system origin' },
  { name: 'sourceId', label: 'Source ID', required: false, dataType: 'string', description: 'External source system record ID' },
];

export const CRM1_LEADS_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'contactId', label: 'Associated Contact ID', required: true, dataType: 'uuid', description: 'Target contact master record UUID' },
  {
    name: 'status',
    label: 'Pipeline Status',
    required: true,
    dataType: 'enum',
    allowedValues: ['New', 'Working', 'Qualified', 'Closed'],
    description: 'Lifecycle lead status allowlist',
  },
  { name: 'sourceSystem', label: 'Source System', required: false, dataType: 'string', description: 'Legacy source system origin' },
  { name: 'sourceId', label: 'Source ID', required: false, dataType: 'string', description: 'External source system record ID' },
];

export const CRM1_TARGET_ENTITIES: Record<string, TargetEntityDefinition> = {
  crm1_contacts: {
    entity: 'crm1_contacts',
    module: 'crm-1',
    label: 'CRM-1 Contacts',
    fields: CRM1_CONTACTS_TARGET_FIELDS,
  },
  crm1_companies: {
    entity: 'crm1_companies',
    module: 'crm-1',
    label: 'CRM-1 Companies',
    fields: CRM1_COMPANIES_TARGET_FIELDS,
  },
  crm1_leads: {
    entity: 'crm1_leads',
    module: 'crm-1',
    label: 'CRM-1 Leads',
    fields: CRM1_LEADS_TARGET_FIELDS,
  },
};

export const CRM5_RUNS_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'batchId', label: 'Batch ID', required: true, dataType: 'string', description: 'Unique batch execution identifier' },
  {
    name: 'module',
    label: 'Module Identifier',
    required: true,
    dataType: 'enum',
    allowedValues: ['crm-1', 'crm-2', 'crm-3', 'crm-4', 'crm-5'],
    description: 'Target ClearShift CRM module',
  },
  {
    name: 'step',
    label: 'Pipeline Step',
    required: true,
    dataType: 'enum',
    allowedValues: ['extract', 'profile', 'clean', 'map', 'load', 'validate', 'reconcile'],
    description: 'Active migration pipeline execution phase',
  },
  {
    name: 'status',
    label: 'Execution Status',
    required: true,
    dataType: 'enum',
    allowedValues: ['pending', 'running', 'completed', 'failed', 'halted'],
    description: 'Lifecycle run execution status',
  },
  { name: 'recordsIn', label: 'Source Records In', required: false, dataType: 'number', description: 'Total source records processed' },
  { name: 'recordsOut', label: 'Loaded Records Out', required: false, dataType: 'number', description: 'Records successfully loaded' },
  { name: 'recordsRejected', label: 'Rejected Records', required: false, dataType: 'number', description: 'Count of rejected rows' },
  { name: 'startedAt', label: 'Started Timestamp', required: false, dataType: 'date', description: 'Run initiation timestamp' },
  { name: 'completedAt', label: 'Completed Timestamp', required: false, dataType: 'date', description: 'Run finish timestamp' },
];

export const CRM5_SCORES_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'batchId', label: 'Batch ID', required: true, dataType: 'string', description: 'Unique batch execution identifier' },
  {
    name: 'module',
    label: 'Module Identifier',
    required: true,
    dataType: 'enum',
    allowedValues: ['crm-1', 'crm-2', 'crm-3', 'crm-4', 'crm-5'],
    description: 'Target ClearShift CRM module',
  },
  { name: 'completeness', label: 'Completeness Ratio', required: false, dataType: 'number', description: 'Completeness score between 0 and 1' },
  { name: 'validity', label: 'Validity Ratio', required: false, dataType: 'number', description: 'Validity score between 0 and 1' },
  { name: 'duplicateRate', label: 'Duplicate Rate', required: false, dataType: 'number', description: 'Exact duplicate rate between 0 and 1' },
  { name: 'rejectRate', label: 'Reject Rate', required: false, dataType: 'number', description: 'Rejection rate between 0 and 1' },
  { name: 'linkIntegrity', label: 'Link Integrity', required: false, dataType: 'number', description: 'Linkage score between 0 and 1' },
  { name: 'score', label: 'Overall Quality Score', required: true, dataType: 'number', description: 'Composite data quality score between 0 and 100' },
];

export const CRM5_REJECTS_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'batchId', label: 'Batch ID', required: true, dataType: 'string', description: 'Unique batch execution identifier' },
  {
    name: 'module',
    label: 'Module Identifier',
    required: true,
    dataType: 'enum',
    allowedValues: ['crm-1', 'crm-2', 'crm-3', 'crm-4', 'crm-5'],
    description: 'Target module where rejection occurred',
  },
  { name: 'rowIndex', label: 'Source Row Index', required: true, dataType: 'number', description: '1-based source row index' },
  { name: 'errorCode', label: 'Rejection Error Code', required: true, dataType: 'string', description: 'Machine error code' },
  { name: 'errorMessage', label: 'Error Message', required: true, dataType: 'string', description: 'Human-readable failure reason' },
  { name: 'rawPayloadHash', label: 'Raw Payload Hash', required: true, dataType: 'string', description: 'Deterministic SHA-256 hash of raw row payload' },
];

export const CRM5_RECONCILIATION_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'batchId', label: 'Batch ID', required: true, dataType: 'string', description: 'Unique batch execution identifier' },
  {
    name: 'module',
    label: 'Module Identifier',
    required: true,
    dataType: 'enum',
    allowedValues: ['crm-1', 'crm-2', 'crm-3', 'crm-4', 'crm-5'],
    description: 'Target ClearShift module',
  },
  { name: 'sourceCount', label: 'Source Count', required: true, dataType: 'number', description: 'Total source records ingested' },
  { name: 'loadedCount', label: 'Loaded Count', required: true, dataType: 'number', description: 'Total records written to target' },
  { name: 'rejectedCount', label: 'Rejected Count', required: true, dataType: 'number', description: 'Total records rejected to audit table' },
  { name: 'mergedCount', label: 'Merged Count', required: false, dataType: 'number', description: 'Total records merged into golden entities' },
  { name: 'skippedCount', label: 'Skipped Count', required: false, dataType: 'number', description: 'Total records explicitly skipped' },
  {
    name: 'status',
    label: 'Conservation Status',
    required: true,
    dataType: 'enum',
    allowedValues: ['OK', 'UNBALANCED'],
    description: 'Reconciliation conservation audit status',
  },
];

export const CRM5_TARGET_ENTITIES: Record<string, TargetEntityDefinition> = {
  crm5_runs: {
    entity: 'crm5_runs',
    module: 'crm-5',
    label: 'CRM-5 Run Projections',
    fields: CRM5_RUNS_TARGET_FIELDS,
  },
  crm5_scores: {
    entity: 'crm5_scores',
    module: 'crm-5',
    label: 'CRM-5 Data Quality Scores',
    fields: CRM5_SCORES_TARGET_FIELDS,
  },
  crm5_rejects: {
    entity: 'crm5_rejects',
    module: 'crm-5',
    label: 'CRM-5 Migration Rejections',
    fields: CRM5_REJECTS_TARGET_FIELDS,
  },
  crm5_reconciliation_reports: {
    entity: 'crm5_reconciliation_reports',
    module: 'crm-5',
    label: 'CRM-5 Reconciliation Reports',
    fields: CRM5_RECONCILIATION_TARGET_FIELDS,
  },
};

export const CRM2_DEALS_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'name', label: 'Deal Name', required: true, dataType: 'string', description: 'Opportunity title; non-empty trimmed string' },
  { name: 'value', label: 'Deal Value', required: true, dataType: 'number', description: 'Monetary opportunity value in fixed decimal precision (non-negative)' },
  { name: 'currency', label: 'Currency Code', required: true, dataType: 'string', description: 'ISO 4217 three-letter currency code (e.g. USD, EUR, GBP)' },
  {
    name: 'stage_name',
    label: 'Stage Name',
    required: true,
    dataType: 'enum',
    allowedValues: ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'],
    description: 'Sales pipeline stage name conforming to canonical 6 stages',
  },
  { name: 'contact_id', label: 'Contact ID', required: false, dataType: 'uuid', description: 'Link to CRM-1 contact (nullable for orphan deals)' },
  { name: 'close_date', label: 'Close Date', required: false, dataType: 'date', description: 'Expected or actual close date (YYYY-MM-DD)' },
  { name: 'source_id', label: 'Source Record ID', required: false, dataType: 'string', description: 'Legacy record identifier for migration traceability' },
  { name: 'source_system', label: 'Source System', required: false, dataType: 'string', description: 'Legacy origin system identifier' },
];

export const CRM2_QUOTES_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'quote_number', label: 'Quote Number', required: true, dataType: 'string', description: 'Unique human-readable quote reference identifier' },
  { name: 'deal_id', label: 'Parent Deal ID', required: true, dataType: 'uuid', description: 'Parent deal UUID reference' },
  { name: 'quote_date', label: 'Quote Date', required: true, dataType: 'date', description: 'Issuance date of the quote (YYYY-MM-DD)' },
  { name: 'amount', label: 'Quote Amount', required: true, dataType: 'number', description: 'Total quote monetary value (non-negative decimal)' },
  { name: 'currency', label: 'Currency Code', required: true, dataType: 'string', description: 'ISO 4217 currency code' },
  { name: 'note', label: 'Quote Note', required: false, dataType: 'string', description: 'Commercial notes, terms and payment schedules' },
  { name: 'source_id', label: 'Source Record ID', required: false, dataType: 'string', description: 'Legacy primary key in source system' },
  { name: 'source_system', label: 'Source System', required: false, dataType: 'string', description: 'Origin system tag for migration traceability' },
];

export const CRM2_STAGES_TARGET_FIELDS: TargetFieldDefinition[] = [
  {
    name: 'name',
    label: 'Stage Name',
    required: true,
    dataType: 'enum',
    allowedValues: ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'],
    description: 'Fixed pipeline stage name',
  },
  { name: 'position', label: 'Position Order', required: true, dataType: 'number', description: 'Display ordering integer in sales pipeline (1-6)' },
  { name: 'is_won', label: 'Is Won Stage', required: true, dataType: 'boolean', description: 'Indicates terminal won stage (strictly true only for Won)' },
];

export const CRM2_QUOTE_LINES_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'quote_id', label: 'Parent Quote ID', required: true, dataType: 'uuid', description: 'Parent quote UUID reference' },
  { name: 'line_number', label: 'Line Number', required: true, dataType: 'number', description: '1-indexed line order within the quote' },
  { name: 'description', label: 'Item Description', required: true, dataType: 'string', description: 'Product or service line description' },
  { name: 'quantity', label: 'Quantity', required: true, dataType: 'number', description: 'Order quantity strictly positive' },
  { name: 'unit_price', label: 'Unit Price', required: true, dataType: 'number', description: 'Unit price in deal currency (non-negative)' },
  { name: 'line_total', label: 'Line Total', required: false, dataType: 'number', description: 'Server-computed line amount (quantity * unit_price)' },
  { name: 'product_id', label: 'Product ID', required: false, dataType: 'uuid', description: 'Reference to ERP-1 product catalog item' },
];

export const CRM2_TARGET_ENTITIES: Record<string, TargetEntityDefinition> = {
  crm2_deals: {
    entity: 'crm2_deals',
    module: 'crm-2',
    label: 'CRM-2 Deals',
    fields: CRM2_DEALS_TARGET_FIELDS,
  },
  crm2_quotes: {
    entity: 'crm2_quotes',
    module: 'crm-2',
    label: 'CRM-2 Quotes',
    fields: CRM2_QUOTES_TARGET_FIELDS,
  },
  crm2_stages: {
    entity: 'crm2_stages',
    module: 'crm-2',
    label: 'CRM-2 Pipeline Stages',
    fields: CRM2_STAGES_TARGET_FIELDS,
  },
  crm2_quote_lines: {
    entity: 'crm2_quote_lines',
    module: 'crm-2',
    label: 'CRM-2 Quote Lines',
    fields: CRM2_QUOTE_LINES_TARGET_FIELDS,
  },
};

export const CRM3_TICKETS_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'subject', label: 'Ticket Subject', required: true, dataType: 'string', description: 'Brief summary or title of the ticket' },
  { name: 'contactId', label: 'Contact UUID', required: true, dataType: 'uuid', description: 'Identifier of the customer contact linked to this ticket' },
  {
    name: 'status',
    label: 'Ticket Status',
    required: true,
    dataType: 'enum',
    allowedValues: ['New', 'Open', 'Waiting', 'Solved', 'Closed'],
    description: 'Ticket resolution state',
  },
  {
    name: 'priority',
    label: 'Priority Level',
    required: true,
    dataType: 'enum',
    allowedValues: ['Low', 'Normal', 'High', 'Urgent'],
    description: 'Ticket priority level',
  },
  { name: 'orderRef', label: 'Order Reference', required: false, dataType: 'string', description: 'Optional commercial order reference number (text in V1)' },
  { name: 'customerEmail', label: 'Customer Email', required: false, dataType: 'email', description: 'Customer contact email for correspondence and verification' },
  { name: 'text', label: 'Initial Note Text', required: false, dataType: 'string', description: 'Optional first note recorded on ticket creation' },
  { name: 'sourceSystem', label: 'Source System', required: false, dataType: 'string', description: 'Legacy source system origin' },
  { name: 'sourceId', label: 'Source ID', required: false, dataType: 'string', description: 'External source system record ID' },
];

export const CRM3_NOTES_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'ticketId', label: 'Ticket ID', required: true, dataType: 'uuid', description: 'Foreign key referencing the parent ticket' },
  { name: 'authorId', label: 'Author ID', required: true, dataType: 'string', description: 'Identifier of the note author (user or system agent)' },
  { name: 'noteText', label: 'Note Content', required: true, dataType: 'string', description: 'Append-only internal note text' },
  { name: 'sourceSystem', label: 'Source System', required: false, dataType: 'string', description: 'Legacy source system origin' },
  { name: 'sourceId', label: 'Source ID', required: false, dataType: 'string', description: 'External source system record ID' },
];

export const CRM3_ACTIVITIES_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'ticketId', label: 'Ticket ID', required: true, dataType: 'uuid', description: 'Parent ticket UUID' },
  {
    name: 'activityType',
    label: 'Activity Type',
    required: true,
    dataType: 'enum',
    allowedValues: ['status_change', 'priority_change', 'note_added', 'assigned', 'system_event'],
    description: 'Type of activity recorded',
  },
  { name: 'actorId', label: 'Actor ID', required: true, dataType: 'string', description: 'User or system actor identifier' },
  { name: 'timestamp', label: 'Timestamp', required: true, dataType: 'date', description: 'ISO-8601 UTC activity timestamp' },
  { name: 'details', label: 'Activity Details', required: false, dataType: 'string', description: 'Optional activity summary or details' },
];

export const CRM3_TARGET_ENTITIES: Record<string, TargetEntityDefinition> = {
  crm3_tickets: {
    entity: 'crm3_tickets',
    module: 'crm-3',
    label: 'CRM-3 Support Tickets',
    fields: CRM3_TICKETS_TARGET_FIELDS,
  },
  crm3_notes: {
    entity: 'crm3_notes',
    module: 'crm-3',
    label: 'CRM-3 Ticket Notes',
    fields: CRM3_NOTES_TARGET_FIELDS,
  },
  crm3_ticket_notes: {
    entity: 'crm3_notes',
    module: 'crm-3',
    label: 'CRM-3 Ticket Notes',
    fields: CRM3_NOTES_TARGET_FIELDS,
  },
  crm3_activities: {
    entity: 'crm3_activities',
    module: 'crm-3',
    label: 'CRM-3 Support Activities',
    fields: CRM3_ACTIVITIES_TARGET_FIELDS,
  },
};

export const CRM_TARGET_ENTITIES: Record<string, TargetEntityDefinition> = {
  contacts: {
    entity: 'contacts',
    module: 'crm',
    label: 'CRM Contacts',
    fields: CRM_CONTACTS_TARGET_FIELDS,
  },
  leads: {
    entity: 'leads',
    module: 'crm',
    label: 'CRM Leads',
    fields: CRM_LEADS_TARGET_FIELDS,
  },
  companies: {
    entity: 'companies',
    module: 'crm-1',
    label: 'CRM-1 Companies',
    fields: CRM1_COMPANIES_TARGET_FIELDS,
  },
  ...CRM1_TARGET_ENTITIES,
  ...CRM2_TARGET_ENTITIES,
  ...CRM3_TARGET_ENTITIES,
  ...CRM5_TARGET_ENTITIES,
};

/**
 * ---------------------------------------------------------------------------
 * KIT-07: Dry-Run Planner with Strict No-Target-Mutation Guarantee Contracts
 * SDS §§3-4, §4.8, §§11.1-11.9; Project Plan v3.0 §§9, 11, 17; Decision C9
 * ---------------------------------------------------------------------------
 */

export const DryRunRowOutcomeSchema = z.enum([
  'loaded',
  'rejected',
  'merged',
  'skipped',
]);
export type DryRunRowOutcome = z.infer<typeof DryRunRowOutcomeSchema>;

export const DryRunPlannedRowSchema = z.object({
  sourceRow: z.number().int().min(1),
  entity: z.string().min(1),
  plannedOutcome: DryRunRowOutcomeSchema,
  targetId: z.string().uuid().optional(),
  existingTargetId: z.string().uuid().optional(),
  reasonCode: z.string().optional(),
  reasonMessage: z.string().optional(),
  field: z.string().optional(),
  validationErrors: z.array(z.string()).default([]),
  duplicateOfRow: z.number().int().min(1).optional(),
  duplicateOfTargetId: z.string().optional(),
  payloadHash: z.string().length(64).optional(),
});
export type DryRunPlannedRow = z.infer<typeof DryRunPlannedRowSchema>;

export const DryRunPlannedCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  loaded: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  unaccounted: z.literal(0),
});
export type DryRunPlannedCounts = z.infer<typeof DryRunPlannedCountsSchema>;

export const DryRunPolicyConfigSchema = z.object({
  maxFailureRate: z.number().min(0).max(1).default(0.10), // Default 10% halt threshold (Decision C9)
  minAttemptedRows: z.number().int().nonnegative().default(1),
  allowPartial: z.boolean().default(false),
  strictNoMutation: z.boolean().default(true),
});
export type DryRunPolicyConfig = z.infer<typeof DryRunPolicyConfigSchema>;

export const DryRunRejectionDetailSchema = z.object({
  sourceRow: z.number().int().min(1),
  reasonCode: z.string().min(1),
  message: z.string().min(1),
  field: z.string().optional(),
});
export type DryRunRejectionDetail = z.infer<typeof DryRunRejectionDetailSchema>;

export const DryRunPlanReportSchema = z.object({
  planId: z.string().uuid(),
  batchId: z.string().uuid(),
  module: z.string().min(1),
  targetEntity: z.string().min(1),
  token: z.string().length(64), // Deterministic SHA-256 fingerprint
  planVersion: z.string().min(1).default('1.0.0'),
  ruleVersion: z.string().min(1).default('1.0.0'),
  codeVersion: z.string().min(1).default('1.0.0'),
  mappingChecksum: z.string().length(64),
  targetBaselineHash: z.string().length(64),
  policyConfig: DryRunPolicyConfigSchema,
  policyPassed: z.boolean(),
  failureRate: z.number().min(0).max(1),
  canProceedToLoad: z.boolean(),
  plannedCounts: DryRunPlannedCountsSchema,
  plannedRows: z.array(DryRunPlannedRowSchema),
  rejections: z.array(DryRunRejectionDetailSchema),
  targetWriteCalls: z.literal(0), // Non-negotiable invariant: 0 mutation calls
  targetReceiptsCreated: z.literal(0), // Non-negotiable invariant: 0 receipts created
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.coerce.date(),
});
export type DryRunPlanReport = z.infer<typeof DryRunPlanReportSchema>;

export const DryRunLoadPreconditionSchema = z.object({
  batchId: z.string().uuid(),
  token: z.string().length(64),
  currentTargetBaselineHash: z.string().length(64),
  currentMappingChecksum: z.string().length(64),
  currentRuleVersion: z.string().min(1).default('1.0.0'),
});
export type DryRunLoadPrecondition = z.infer<typeof DryRunLoadPreconditionSchema>;

/**
 * Custom Error: Dry-Run Policy Violation (e.g. 40% invalid fixture exceeds max 10% failure rate)
 */
export class DryRunPolicyViolationError extends Error {
  public readonly statusCode = 422;
  public readonly code = 'DRY_RUN_POLICY_VIOLATION';

  constructor(
    public readonly failureRate: number,
    public readonly maxAllowedRate: number,
    message?: string
  ) {
    const defaultMsg = `Dry-run policy violation: failure rate ${(failureRate * 100).toFixed(1)}% exceeds maximum allowable threshold ${(maxAllowedRate * 100).toFixed(1)}%`;
    super(message || defaultMsg);
    this.name = 'DryRunPolicyViolationError';
  }
}

/**
 * Custom Error: Load Precondition Check Failure (e.g. invalid token, target baseline drift, mapping changed)
 */
export class DryRunPreconditionError extends Error {
  public readonly statusCode = 412; // Precondition Failed
  public readonly code = 'PRECONDITION_FAILED';

  constructor(
    public readonly reason: 'TOKEN_INVALID' | 'BASELINE_DRIFT' | 'MAPPING_CHANGED' | 'RULE_VERSION_CHANGED' | 'POLICY_FAILED' | 'CONSERVATION_VIOLATION',
    message: string
  ) {
    super(message);
    this.name = 'DryRunPreconditionError';
  }
}

/**
 * Custom Error: Target Mutation Forbidden during Dry-Run
 */
export class DryRunTargetMutationForbiddenError extends Error {
  public readonly statusCode = 403;
  public readonly code = 'TARGET_MUTATION_FORBIDDEN';

  constructor(operation: string = 'mutation') {
    super(`Forbidden: dry-run planner strictly forbids target write operation '${operation}'`);
    this.name = 'DryRunTargetMutationForbiddenError';
  }
}

/**
 * Asserts dry-run row count conservation equation:
 * source = loaded + rejected + merged + skipped; unaccounted = 0
 */
export function assertDryRunConservation(counts: {
  total: number;
  loaded: number;
  rejected: number;
  merged: number;
  skipped: number;
}): { ok: boolean; unaccounted: number } {
  const sum = counts.loaded + counts.rejected + counts.merged + counts.skipped;
  const unaccounted = counts.total - sum;
  if (unaccounted !== 0) {
    throw new DryRunPreconditionError(
      'CONSERVATION_VIOLATION',
      `Row conservation violated: total ${counts.total} != accounted ${sum} (unaccounted: ${unaccounted})`
    );
  }
  return { ok: true, unaccounted: 0 };
}

/**
 * Computes deterministic SHA-256 dry-run token from plan parameters
 */
export function computeDryRunToken(params: {
  batchId: string;
  mappingChecksum: string;
  ruleVersion: string;
  targetBaselineHash: string;
  plannedCounts: {
    total: number;
    loaded: number;
    rejected: number;
    merged: number;
    skipped: number;
  };
  policyConfig: {
    maxFailureRate: number;
  };
}): string {
  const payload = [
    params.batchId,
    params.mappingChecksum,
    params.ruleVersion,
    params.targetBaselineHash,
    `total:${params.plannedCounts.total}`,
    `loaded:${params.plannedCounts.loaded}`,
    `rejected:${params.plannedCounts.rejected}`,
    `merged:${params.plannedCounts.merged}`,
    `skipped:${params.plannedCounts.skipped}`,
    `maxFailureRate:${params.policyConfig.maxFailureRate.toFixed(4)}`,
  ].join('|');

  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Computes deterministic SHA-256 hash of target baseline records
 */
export function computeTargetBaselineHash(records: unknown[]): string {
  if (records.length === 0) {
    return createHash('sha256').update('empty_target_baseline', 'utf8').digest('hex');
  }
  const stringified = records.map((r) => {
    if (typeof r === 'object' && r !== null) {
      const keys = Object.keys(r as Record<string, unknown>).sort();
      return '{' + keys.map((k) => `${k}:${JSON.stringify((r as any)[k])}`).join(',') + '}';
    }
    return String(r);
  });
  stringified.sort();
  return createHash('sha256').update(stringified.join('\n'), 'utf8').digest('hex');
}

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
