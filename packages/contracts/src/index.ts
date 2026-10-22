/**
 * @clearshift/contracts
 * Shared TypeScript contracts, Zod schemas, and OpenAPI specifications.
 * Re-exports all module contracts for use by API handlers and frontend.
 */

export const ERP_CONTRACT_VERSION = '1.0.0';

export * from './common.js';
export * from './events.js';
export * from './erp-1.js';
export * from './erp-4.js';
export * from './erp-5.js';
export * from './roles.js';
export * from './golden-id.js';
