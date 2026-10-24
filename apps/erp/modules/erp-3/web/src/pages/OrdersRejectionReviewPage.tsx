/**
 * ERP-3 Sales Orders & Invoices — Migration Rejections Review Page (ERP3-23)
 *
 * Dedicated route view for operators to review, filter, and export rejected
 * order and invoice records from Migration Kit batches.
 *
 * Integrates with:
 * - Shared RejectionReviewScreen component from @cs/ui
 * - ERP-3 module rejection context and failure explanations
 * - Automatic sensitive field masking (AC3)
 * - Formula-safe CSV export (AC4)
 *
 * @module erp3/web/pages/OrdersRejectionReviewPage
 */

import React, { useState } from 'react';
import { RejectionReviewScreen } from '@cs/ui';
import type { RejectedRow } from '@cs/kit';
import {
  erp3OrdersRejectionContext,
  SYNTHETIC_ERP3_REJECTIONS,
} from '../rejection-context.js';

export interface OrdersRejectionReviewPageProps {
  readonly initialRows?: readonly RejectedRow[] | undefined;
  readonly batchId?: string | undefined;
  readonly onNavigateBack?: (() => void) | undefined;
  readonly onNavigateToImport?: (() => void) | undefined;
}

export const OrdersRejectionReviewPage: React.FC<OrdersRejectionReviewPageProps> = ({
  initialRows,
  batchId = 'BATCH_2026_01',
  onNavigateBack,
  onNavigateToImport,
}) => {
  const [rows] = useState<readonly RejectedRow[]>(
    initialRows || SYNTHETIC_ERP3_REJECTIONS
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
    <div className="cs-module-root space-y-6" data-testid="orders-rejection-review-page">
      {onNavigateBack && (
        <div style={{ padding: '8px 16px 0 16px' }}>
          <button
            type="button"
            onClick={onNavigateBack}
            data-testid="btn-rejection-back"
            className="cs-btn-back"
          >
            ← Back to Sales Orders
          </button>
        </div>
      )}

      {retryNotice && (
        <div
          role="status"
          data-testid="retry-status-notification"
          style={{
            background: 'var(--color-surface, #ecfdf5)',
            color: '#065f46',
            border: '1px solid #a7f3d0',
            padding: '0.75rem 1.5rem',
            borderRadius: '6px',
            margin: '0 1rem',
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
        >
          ✅ {retryNotice}
        </div>
      )}

      <RejectionReviewScreen
        context={erp3OrdersRejectionContext}
        rejectedRows={rows}
        batchId={batchId}
        onBack={onNavigateBack || onNavigateToImport}
        onRetryRow={handleRetryRow}
        onRetryAll={handleRetryAll}
      />
    </div>
  );
};

export default OrdersRejectionReviewPage;
