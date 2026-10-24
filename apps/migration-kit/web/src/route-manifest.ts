export const MIGRATION_KIT_BASE_PATH = '/kit';
export const MIGRATION_KIT_MODULE_LABEL = 'Migration Kit';
export const MIGRATION_KIT_APP_TITLE = 'ClearShift ERP';
export const MIGRATION_KIT_MAIN_REGION_ID = 'migration-kit-main';

export type MigrationKitNavGroupId = 'batches' | 'migration';

export interface MigrationKitRouteDescriptor {
  readonly id: string;
  readonly path: string;
  readonly label: string;
  readonly title: string;
  readonly group: MigrationKitNavGroupId | null;
}

export const MIGRATION_KIT_ROUTE_DESCRIPTORS: readonly MigrationKitRouteDescriptor[] = [
  { id: 'batches', path: 'batches', label: 'Batches', title: 'Batches', group: 'batches' },
  { id: 'batch-new', path: 'batches/new', label: 'New Batch', title: 'New Batch', group: 'batches' },
  { id: 'batch-detail', path: 'batches/:batchId', label: 'Batch Detail', title: 'Batch Detail', group: 'batches' },
  { id: 'profile', path: 'batches/:batchId/profile', label: 'Profile', title: 'Profile', group: 'migration' },
  { id: 'mapping', path: 'batches/:batchId/mapping', label: 'Mapping', title: 'Mapping', group: 'migration' },
  { id: 'duplicates', path: 'batches/:batchId/duplicates', label: 'Duplicates', title: 'Duplicates', group: 'migration' },
  { id: 'result', path: 'batches/:batchId/result', label: 'Result', title: 'Result', group: 'migration' },
  { id: 'reconciliation', path: 'batches/:batchId/reconciliation', label: 'Reconciliation', title: 'Reconciliation', group: 'migration' },
  { id: 'rejects', path: 'batches/:batchId/rejects', label: 'Rejects', title: 'Rejects', group: 'migration' },
];