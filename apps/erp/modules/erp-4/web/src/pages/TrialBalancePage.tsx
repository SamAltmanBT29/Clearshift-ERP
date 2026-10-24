/**
 * ERP-4 Finance and Accounting — Trial Balance Page
 *
 * Route: `/erp4/trial-balance`
 *
 * @module erp4/web/pages/TrialBalancePage
 */

import React, { useState, useEffect, useCallback } from 'react';
import { PageTitle } from '@cs/ui';
import type { NormalizedTrialBalanceResponse } from '../api/erp-4.js';
import { fetchTrialBalance } from '../api/erp-4.js';
import { TrialBalanceTable } from '../components/TrialBalanceTable.js';
import { ErrorState } from '../components/StateViews.js';

export const TrialBalancePage: React.FC = () => {
  const [period, setPeriod] = useState<string>(() => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${now.getFullYear()}-${month}`;
  });
  const [trialBalanceData, setTrialBalanceData] = useState<NormalizedTrialBalanceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTrialBalance = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchTrialBalance(period);
      setTrialBalanceData(response);
    } catch (err: any) {
      setError(err?.message || 'Failed to load trial balance report');
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => {
    loadTrialBalance();
  }, [loadTrialBalance]);

  return (
    <div className="cs-page-container">
      <PageTitle
        title="Trial Balance"
        subtitle="Verification of general ledger debit and credit equilibrium for reporting periods"
        actions={
          <button
            type="button"
            className="cs-button cs-button-secondary"
            onClick={loadTrialBalance}
            disabled={isLoading}
          >
            {isLoading ? 'Recalculating...' : 'Refresh Report'}
          </button>
        }
      />

      {error ? (
        <ErrorState
          title="Failed to Load Trial Balance"
          message={error}
          onRetry={loadTrialBalance}
        />
      ) : (
        <TrialBalanceTable
          data={trialBalanceData}
          isLoading={isLoading}
          period={period}
          onPeriodChange={setPeriod}
          onRefresh={loadTrialBalance}
        />
      )}
    </div>
  );
};

export default TrialBalancePage;
