/**
 * ERP-3 Sales Orders & Invoices — Migration Batch Runner Utilities
 *
 * Implements chunked batch execution, transient exponential backoff retry,
 * and 10% failure rate stop threshold (ERP3-07 / ERP3-11 / ERP3-13 / KIT-08 / KIT-12 / Decision C4):
 *
 *   1. Chunking: Partitions large row streams into sequential 500-row chunks.
 *   2. Bounded Exponential Retry: Retries transient infrastructure failures (503,
 *      deadlocks, timeouts) without altering or corrupting client idempotency keys.
 *   3. 10% Stop Threshold: Halts batch execution immediately when row failure rate
 *      exceeds 10% of attempted rows (after a minimum sample of 10 rows).
 *   4. Prohibition of Rollback Sagas: Preserves committed rows and durable receipts;
 *      no destructive compensating sagas exist in ClearShift V1.
 *
 * @module erp3/migration/batch-runner
 */

import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_MIN_ATTEMPTED_ROWS,
  DEFAULT_RETRY_CONFIG,
  assertNoRollbackSaga,
} from '@clearshift/contracts';

export {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_MIN_ATTEMPTED_ROWS,
  DEFAULT_RETRY_CONFIG,
  assertNoRollbackSaga,
};

// ─────────────────────────────────────────────────────────────────────────────
// Chunking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Splits an array of items into contiguous chunks of at most `chunkSize` items.
 */
export function chunkArray<T>(items: readonly T[], chunkSize = DEFAULT_CHUNK_SIZE): T[][] {
  if (chunkSize <= 0) {
    throw new Error(`chunkSize must be a positive integer, received: ${chunkSize}`);
  }
  if (items.length === 0) {
    return [];
  }

  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Failure Rate Calculation & Stop Threshold Check
// ─────────────────────────────────────────────────────────────────────────────

export interface FailureThresholdOptions {
  readonly threshold?: number | undefined;
  readonly minAttemptedRows?: number | undefined;
}

/**
 * Calculates the current failure rate as a ratio [0.0, 1.0].
 */
export function calculateFailureRate(rejectedCount: number, attemptedCount: number): number {
  if (attemptedCount <= 0) {
    return 0;
  }
  return rejectedCount / attemptedCount;
}

/**
 * Determines whether batch execution must stop immediately due to excessive failures.
 *
 * Rules:
 *   - Only evaluates once attempted count reaches `minAttemptedRows` (default 10)
 *     to prevent false-positive halts on the very first attempted row.
 *   - Halts if `rejectedCount / attemptedCount > threshold` (default 0.10 / 10%).
 */
export function shouldHaltBatchExecution(
  rejectedCount: number,
  attemptedCount: number,
  options?: FailureThresholdOptions
): boolean {
  const minAttempted = options?.minAttemptedRows ?? DEFAULT_MIN_ATTEMPTED_ROWS;
  const threshold = options?.threshold ?? DEFAULT_FAILURE_THRESHOLD;

  if (attemptedCount < minAttempted) {
    return false;
  }

  const failureRate = calculateFailureRate(rejectedCount, attemptedCount);
  return failureRate > threshold;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transient Retry with Bounded Exponential Backoff
// ─────────────────────────────────────────────────────────────────────────────

export interface RetryOptions {
  readonly maxRetries?: number | undefined;
  readonly initialDelayMs?: number | undefined;
  readonly backoffFactor?: number | undefined;
  readonly isTransientError?: ((error: unknown) => boolean) | undefined;
  readonly onRetry?: ((attempt: number, delayMs: number, error: unknown) => void) | undefined;
}

/**
 * Detects whether an error is transient (infrastructure, network, deadlock, 503)
 * versus a deterministic business validation/conflict error.
 */
export function isTransientFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as Record<string, unknown>;

  // Check explicit retryable flag
  if (err['retryable'] === true) {
    return true;
  }

  // Check HTTP 503 or 504 status
  const statusCode = err['statusCode'] ?? err['status'];
  if (statusCode === 503 || statusCode === 504) {
    return true;
  }

  // Check error codes
  const code = String(err['code'] ?? '');
  if (
    [
      'SERVICE_UNAVAILABLE',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED',
      '40P01', // PostgreSQL deadlock detected
      '57P01', // PostgreSQL admin shutdown
      'QUERY_TIMEOUT',
    ].includes(code)
  ) {
    return true;
  }

  // Check message patterns
  const message = String(err['message'] ?? '').toLowerCase();
  if (
    message.includes('deadlock detected') ||
    message.includes('service unavailable') ||
    message.includes('econnreset') ||
    message.includes('timeout') ||
    message.includes('transient')
  ) {
    return true;
  }

  return false;
}

/**
 * Executes an async operation with bounded exponential backoff retries on transient failures.
 *
 * Critical Invariant:
 *   The caller's idempotency key and source payload are strictly preserved across retries.
 *   Deterministic domain errors (400, 409, 422) are never retried.
 */
export async function executeWithRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options?: RetryOptions
): Promise<{ result: T; attempts: number }> {
  const maxRetries = options?.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries;
  const initialDelay = options?.initialDelayMs ?? DEFAULT_RETRY_CONFIG.initialDelayMs;
  const backoffFactor = options?.backoffFactor ?? DEFAULT_RETRY_CONFIG.backoffFactor;
  const isTransient = options?.isTransientError ?? isTransientFailure;

  let attempt = 1;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    try {
      const result = await operation(attempt);
      return { result, attempts: attempt };
    } catch (err: unknown) {
      lastError = err;

      // If error is deterministic (validation, conflict, domain rejection), do NOT retry
      if (!isTransient(err) || attempt >= maxRetries) {
        throw err;
      }

      // Compute exponential backoff delay
      const delayMs = initialDelay * Math.pow(backoffFactor, attempt - 1);
      if (options?.onRetry) {
        options.onRetry(attempt, delayMs, err);
      }

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      attempt++;
    }
  }

  throw lastError;
}
