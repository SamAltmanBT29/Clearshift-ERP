/**
 * ERP-1 Products & Inventory — Migration Rejections Review Page (ERP1-23)
 *
 * Provides a dedicated route and view for operators to review, filter,
 * and export rejected product records from Migration Kit batches.
 *
 * Integrates with:
 * - Shared RejectionReviewScreen component from @cs/ui
 * - ERP-1 module rejection context and failure explanations
 * - Automatic sensitive field masking (AC3)
 * - Formula-safe CSV export (AC4)
 *
 * @module erp1/web/pages/ProductRejectionReviewPage
 */

import React, { useState } from 'react';
import { RejectionReviewScreen } from '@cs/ui';
import type { RejectedRow } from '@cs/kit';
import {
  erp1ProductsRejectionContext,
  SYNTHETIC_ERP1_REJECTIONS,
} from '../rejection-context.js';

export interface ProductRejectionReviewPageProps {
  initialRows?: readonly RejectedRow[] | undefined;
  batchId?: string | undefined;
  onNavigateBack?: (() => void) | undefined;
  onNavigateToImport?: (() => void) | undefined;
}

export const ProductRejectionReviewPage: React.FC<ProductRejectionReviewPageProps> = ({
  initialRows,
  batchId = 'BATCH_2026_01',
  onNavigateBack,
  onNavigateToImport,
}) => {
  const [rows, setRows] = useState<readonly RejectedRow[]>(
    initialRows || SYNTHETIC_ERP1_REJECTIONS
  );
  const [retryNotice, setRetryNotice] = useState<string | null>(null);

  const handleRetryRow = (rowId: string) => {
    setRetryNotice(`Row ${rowId} queued for re-validation dry run.`);
    setTimeout(() => setRetryNotice(null), 4000);
  };

  const handleRetryAll = (rowIds: string[]) => {
    setRetryNotice(`${rowIds.length} rows queued for batch re-processing.`);
    setTimeout(() => setRetryNotice(null), 4000);
  };

  return (
    <div className="cs-product-rejection-review-page" data-testid="product-rejection-review-page">
      {retryNotice && (
        <div
          role="status"
          data-testid="retry-status-notification"
          style={{
            background: '#ecfdf5',
            color: '#065f46',
            border: '1px solid #a7f3d0',
            padding: '0.75rem 1.5rem',
            borderRadius: '6px',
            margin: '1rem auto 0 auto',
            maxWidth: '1440px',
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
        >
          ✅ {retryNotice}
        </div>
      )}

      <RejectionReviewScreen
        context={erp1ProductsRejectionContext}
        rejectedRows={rows}
        batchId={batchId}
        onBack={onNavigateBack || onNavigateToImport}
        onRetryRow={handleRetryRow}
        onRetryAll={handleRetryAll}
      />
    </div>
  );
};
