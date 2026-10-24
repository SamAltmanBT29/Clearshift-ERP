import React from 'react';
export * from '../../../../../../packages/ui/tokens.js';
export * from '../../../../../../packages/ui/src/components/PageHeader.js';
export * from '../../../../../../packages/ui/src/components/Table.js';
export * from '../../../../../../packages/ui/src/components/Pagination.js';
export * from '../../../../../../packages/ui/src/components/FormField.js';
export * from '../../../../../../packages/ui/src/components/Alert.js';
export * from '../../../../../../packages/ui/src/components/StateViews.js';
export * from '../../../../../../packages/ui/src/components/Dialog.js';
export * from '../../../../../../packages/ui/src/components/StatusBadge.js';
export * from '../../../../../../packages/ui/src/components/CsvAction.js';

/** E2E host stub for MigrationKitWizard avoiding backend @cs/kit runtime imports in Vite */
export const MigrationKitWizard: React.FC<{ metadata?: unknown; [key: string]: unknown }> = () =>
  React.createElement('div', { 'data-testid': 'migration-kit-wizard' }, 'Migration Kit Wizard');

/** E2E host stub for RejectionReviewScreen avoiding backend @cs/kit runtime imports in Vite */
export const RejectionReviewScreen: React.FC<{ [key: string]: unknown }> = () =>
  React.createElement('div', { 'data-testid': 'rejection-review-screen' }, 'Rejection Review Screen');
