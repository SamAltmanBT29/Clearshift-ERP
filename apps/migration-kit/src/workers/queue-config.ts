/**
 * ClearShift Migration Kit — BullMQ Queue & Worker Configuration (KIT-11)
 *
 * Implements pinned Redis 8.10.1 configuration and BullMQ execution options
 * matching SDS ClearShift Migration Kit v2.0 §11.1–11.9 and Issue #78 [KIT-11].
 *
 * Required Settings:
 * - Pinned Redis: 8.10.1
 * - Attempt count: 3
 * - Exponential backoff: base 1 second (1000ms), maximum backoff 30 seconds (30000ms)
 * - Per-job timeout: 15 minutes (900000ms)
 * - Configurable concurrency: default 4
 * - Circuit breaker ceiling: 10% row failures inside a chunk
 *
 * @module migration-kit/workers/queue-config
 */

import {
  BullMqWorkerDefaults,
  BullMqQueueConfigSchema,
  type BullMqQueueConfig,
} from '@clearshift/contracts';

/**
 * Standard queue names for the seven-step migration pipeline.
 */
export const MIGRATION_KIT_QUEUES = {
  EXTRACT: 'migration-kit:extract',
  PROFILE: 'migration-kit:profile',
  CLEAN: 'migration-kit:clean',
  MAP: 'migration-kit:map',
  DRY_RUN: 'migration-kit:dry-run',
  LOAD: 'migration-kit:load',
  VALIDATE: 'migration-kit:validate',
} as const;

export type MigrationKitQueueName =
  (typeof MIGRATION_KIT_QUEUES)[keyof typeof MIGRATION_KIT_QUEUES];

/**
 * Computes deterministic exponential backoff delay in milliseconds.
 * Formula: min(backoffMaxMs, backoffBaseMs * 2^(attempt - 1))
 */
export function computeExponentialBackoffMs(
  attempt: number,
  baseMs: number = BullMqWorkerDefaults.BACKOFF_BASE_MS,
  maxMs: number = BullMqWorkerDefaults.BACKOFF_MAX_MS
): number {
  if (attempt <= 1) return baseMs;
  const exponent = Math.min(attempt - 1, 10);
  const delay = baseMs * Math.pow(2, exponent);
  return Math.min(delay, maxMs);
}

/**
 * Creates validated BullMQ worker configuration.
 */
export function createBullMqConfig(
  overrides: Partial<BullMqQueueConfig> = {}
): BullMqQueueConfig {
  return BullMqQueueConfigSchema.parse({
    redisHost: process.env['REDIS_HOST'] ?? 'localhost',
    redisPort: process.env['REDIS_PORT'] ? parseInt(process.env['REDIS_PORT'], 10) : 6379,
    redisVersion: '8.10.1',
    attempts: BullMqWorkerDefaults.ATTEMPTS,
    backoffBaseMs: BullMqWorkerDefaults.BACKOFF_BASE_MS,
    backoffMaxMs: BullMqWorkerDefaults.BACKOFF_MAX_MS,
    jobTimeoutMs: BullMqWorkerDefaults.JOB_TIMEOUT_MS,
    concurrency: overrides.concurrency ?? BullMqWorkerDefaults.DEFAULT_CONCURRENCY,
    circuitBreakerThreshold: BullMqWorkerDefaults.MAX_CHUNK_FAILURE_RATE,
    ...overrides,
  });
}

/**
 * BullMQ Job Options descriptor.
 */
export interface BullMqJobOptions {
  attempts: number;
  backoff: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
  timeout: number;
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
}

/**
 * Generates standard BullMQ job options for migration jobs.
 */
export function getStandardJobOptions(
  config: BullMqQueueConfig = createBullMqConfig()
): BullMqJobOptions {
  return {
    attempts: config.attempts,
    backoff: {
      type: 'exponential',
      delay: config.backoffBaseMs,
    },
    timeout: config.jobTimeoutMs,
    removeOnComplete: 100,
    removeOnFail: 500,
  };
}
