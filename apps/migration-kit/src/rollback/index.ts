/**
 * ClearShift Migration Kit — Compensating Saga Rollback (KIT-12)
 *
 * Public exports for Step 5b Rollback Saga:
 * - Journal store and memory implementation
 * - Conflict preflight validation
 * - Compensating saga engine
 *
 * @module migration-kit/rollback
 */

export * from './journal.js';
export * from './preflight.js';
export * from './saga.js';
