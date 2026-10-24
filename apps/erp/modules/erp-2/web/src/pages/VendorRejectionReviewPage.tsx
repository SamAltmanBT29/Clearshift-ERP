/**
 * ERP-2 Vendors & Purchasing — Migration Rejections Review Page (ERP2-23)
 *
 * Provides a dedicated route and view for operators to review, filter,
 * and export rejected vendor and purchase-order records from Migration Kit batches.
 *
 * Integrates with:
 * - Shared RejectionReviewScreen component from @cs/ui
 * - ERP-2 module rejection context and failure explanations
 * - Automatic sensitive field masking (AC3) — bank details, tax_id, salary, IBAN
 * - Formula-safe CSV export (AC4)
 *
 * @module erp2/web/pages/VendorRejectionReviewPage
 */

import React, { useState } from 'react';
import { RejectionReviewScreen } from '@cs/ui';
import type { RejectedRow } from '@cs/kit';
import {
  erp2VendorsRejectionContext,
  SYNTHETIC_ERP2_REJECTIONS,
} from '../rejection-context.js';

export interface VendorRejectionReviewPageProps {
  readonly initialRows?: readonly RejectedRow[] | undefined;
  readonly batchId?: string | undefined;
  readonly onNavigateBack?: (() => void) | undefined;
  readonly onNavigateToImport?: (() => void) | undefined;
}

export const VendorRejectionReviewPage: React.FC<VendorRejectionReviewPageProps> = ({
  initialRows,
  batchId = 'BATCH_ERP2_2026_01',
  onNavigateBack,
  onNavigateToImport,
}) => {
  const [rows] = useState<readonly RejectedRow[]>(
    initialRows || SYNTHETIC_ERP2_REJECTIONS
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
    <div className="cs-module-root space-y-6" data-testid="vendor-rejection-review-page">
      {onNavigateBack && (
        <div style={{ padding: '8px 16px 0 16px' }}>
          <button
            type="button"
            onClick={onNavigateBack}
            data-testid="btn-rejection-back"
            className="cs-btn-back"
          >
            ← Back to Vendors & Purchasing
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
        context={erp2VendorsRejectionContext}
        rejectedRows={rows}
        batchId={batchId}
        onBack={onNavigateBack || onNavigateToImport}
        onRetryRow={handleRetryRow}
        onRetryAll={handleRetryAll}
      />
    </div>
  );
};

export default VendorRejectionReviewPage;
