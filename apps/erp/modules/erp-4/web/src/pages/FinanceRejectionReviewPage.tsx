/**
 * ERP-4 Finance & Accounting — Migration Rejection Review Page (ERP4-23 / #179 / KIT-16)
 *
 * Implements the module rejection review and export screen using the shared
 * RejectionReviewScreen from @cs/ui.
 *
 * @module erp4/web/pages/FinanceRejectionReviewPage
 */

import React, { useState } from 'react';
import { RejectionReviewScreen } from '@cs/ui';
import type { RejectedRow } from '@cs/kit';
import {
  erp4AccountsRejectionContext,
  erp4JournalEntriesRejectionContext,
  SYNTHETIC_ERP4_REJECTIONS,
} from '../rejection-context.js';

export interface FinanceRejectionReviewPageProps {
  initialEntity?: 'accounts' | 'journal_entries';
  rejectedRows?: readonly RejectedRow[];
  batchId?: string;
  onBack?: () => void;
}

export const FinanceRejectionReviewPage: React.FC<FinanceRejectionReviewPageProps> = ({
  initialEntity = 'accounts',
  rejectedRows = SYNTHETIC_ERP4_REJECTIONS,
  batchId = 'BATCH_ERP4_2026_01',
  onBack,
}) => {
  const [selectedEntity, setSelectedEntity] = useState<'accounts' | 'journal_entries'>(initialEntity);

  const activeContext =
    selectedEntity === 'accounts'
      ? erp4AccountsRejectionContext
      : erp4JournalEntriesRejectionContext;

  const entityRows = rejectedRows.filter((r) => r.entity === selectedEntity);

  return (
    <div className="space-y-4" data-testid="finance-rejection-review-page">
      <div className="flex items-center justify-between pb-3 border-b border-[var(--cs-border)]">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              data-testid="btn-back-to-migration"
              className="text-xs px-2.5 py-1 rounded border border-[var(--cs-border)] bg-[var(--cs-surface)] hover:bg-[var(--cs-bg)] text-[var(--cs-text)]"
            >
              ← Back
            </button>
          )}
          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[var(--cs-surface)] text-[var(--cs-accent)] border border-[var(--cs-border)]">
            Module: erp4 • Migration Kit Step 6
          </span>
        </div>

        {/* Entity Switcher */}
        <div className="flex items-center gap-2">
          <label htmlFor="rejection-entity-select" className="text-xs font-medium text-[var(--cs-text-muted)]">
            Entity:
          </label>
          <select
            id="rejection-entity-select"
            data-testid="select-rejection-entity"
            value={selectedEntity}
            onChange={(e) => setSelectedEntity(e.target.value as 'accounts' | 'journal_entries')}
            className="text-xs border border-[var(--cs-border)] bg-[var(--cs-bg)] text-[var(--cs-text)] rounded px-2.5 py-1.5"
          >
            <option value="accounts">Chart of Accounts</option>
            <option value="journal_entries">Journal Entries</option>
          </select>
        </div>
      </div>

      <RejectionReviewScreen
        context={activeContext}
        rejectedRows={entityRows.length > 0 ? entityRows : rejectedRows}
        batchId={batchId}
        onBack={onBack}
      />
    </div>
  );
};
