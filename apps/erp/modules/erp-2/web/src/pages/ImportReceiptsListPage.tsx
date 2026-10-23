/**
 * ERP-2 Vendors & Purchasing — Import Receipts Page
 *
 * @module erp2/web/pages/ImportReceiptsListPage
 */

import React from 'react';
import { PageTitle } from '@cs/ui';

export const ImportReceiptsListPage: React.FC = () => {
  return (
    <div className="cs-page-container">
      <PageTitle
        title="Import receipts"
        subtitle="Review durable Migration Kit receipts, idempotency keys, and row load outcomes"
      />
      <div className="cs-card">
        <p className="text-sm text-[var(--cs-text-muted)]">
          Audit ledger for batch imports and idempotency replays (KIT-08).
        </p>
      </div>
    </div>
  );
};

export default ImportReceiptsListPage;
