/**
 * @clearshift/contracts
 * Shared TypeScript contracts, Zod schemas, and OpenAPI specifications.
 * Re-exports all module contracts for use by API handlers and frontend.
 */

export const ERP_CONTRACT_VERSION = '1.0.0';

export * from './common.js';
export * from './events.js';
export * from './migration-events.js';
export * from './erp-1.js';
export * from './erp-1-events.js';
export * from './erp-1-mock.js';
export * from './erp-2.js';
export * from './erp-2-events.js';
export * from './erp-2-mock.js';
export * from './erp-3.js';
export * from './erp-3-events.js';
export * from './erp-3-mock.js';
export * from './erp-4.js';
export * from './erp-5.js';
export * from './roles.js';
export * from './golden-id.js';
export * from './import-target.js';
export * from './migration-target.js';
export * from './erp-4-mock.js';
export * from './validation.js';

// Explicit disambiguation between erp-1, migration-events, and migration-target
export type { TargetFieldDefinition } from './erp-1.js';
export { TargetFieldDefinitionSchema } from './erp-1.js';
export type { BatchCleanedPayload, BatchMappedPayload, BatchProfiledPayload } from './migration-events.js';
export { BatchCleanedPayloadSchema, BatchMappedPayloadSchema, BatchProfiledPayloadSchema } from './migration-events.js';

