/** Browser-only slice of @clearshift/contracts for the ERP3-29 e2e host (avoids the events.ts <-> erp-4-events.ts cycle). */
// Load order matters: erp-4 <-> erp-4-events is a circular import that only initialises
// correctly when erp-4-events is evaluated first (as under vitest).
import '../../../../../../packages/contracts/src/erp-4-events.js';
export * from '../../../../../../packages/contracts/src/common.js';
export * from '../../../../../../packages/contracts/src/erp-3.js';
export * from '../../../../../../packages/contracts/src/roles.js';
export * from '../../../../../../packages/contracts/src/golden-id.js';
export * from '../../../../../../packages/contracts/src/import-target.js';
export * from '../../../../../../packages/contracts/src/migration-target.js';
