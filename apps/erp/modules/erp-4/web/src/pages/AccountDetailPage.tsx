/**
 * ERP-4 Finance and Accounting — Account Detail Page
 *
 * Route: `/erp4/accounts/:accountId`
 *
 * @module erp4/web/pages/AccountDetailPage
 */

import React, { useState, useEffect } from 'react';
import { PageTitle } from '@cs/ui';
import { Link, useParams } from 'react-router-dom';
import { fetchAccountById } from '../api/erp-4.js';
import type { Account } from '@clearshift/contracts';
import { SkeletonTable, ErrorState, StatusBadge } from '../components/StateViews.js';

export const AccountDetailPage: React.FC = () => {
  const { accountId } = useParams<{ accountId: string }>();
  const [account, setAccount] = useState<Account | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    setIsLoading(true);
    setError(null);
    fetchAccountById(accountId)
      .then((data) => setAccount(data))
      .catch((err) => setError(err?.message || `Failed to fetch account ${accountId}`))
      .finally(() => setIsLoading(false));
  }, [accountId]);

  if (isLoading) {
    return (
      <div className="cs-page-container">
        <SkeletonTable columns={4} rows={4} />
      </div>
    );
  }

  if (error || !account) {
    return (
      <div className="cs-page-container">
        <PageTitle
          title="Account Not Found"
          actions={
            <Link to="/erp4/accounts" className="cs-button cs-button-secondary">
              ← Back to Chart of Accounts
            </Link>
          }
        />
        <ErrorState
          title="Record Not Found"
          message={error || `Account ${accountId} does not exist.`}
        />
      </div>
    );
  }

  return (
    <div className="cs-page-container">
      <PageTitle
        title={`${account.code || (account as any).accountNumber} · ${account.name}`}
        subtitle={`Classification: ${account.type.toUpperCase()} | Currency: ${account.currency_code || (account as any).currency || 'USD'}`}
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            <Link to="/erp4/accounts" className="cs-button cs-button-secondary">
              ← Back
            </Link>
            <Link to={`/erp4/accounts/${account.id}/edit`} className="cs-button cs-button-primary">
              Edit Account
            </Link>
          </div>
        }
      />

      <div className="cs-card" style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>
          General Ledger Specification
        </h2>
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div>
            <dt style={{ fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
              Account Code
            </dt>
            <dd style={{ fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
              {account.code || (account as any).accountNumber}
            </dd>
          </div>
          <div>
            <dt style={{ fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
              Account Type
            </dt>
            <dd style={{ fontSize: '15px', fontWeight: 600 }}>
              <span className={`cs-badge cs-badge-${account.type}`}>{account.type}</span>
            </dd>
          </div>
          <div>
            <dt style={{ fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
              Status
            </dt>
            <dd>
              <StatusBadge status={account.is_active ? 'active' : 'inactive'} />
            </dd>
          </div>
          <div>
            <dt style={{ fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
              Currency
            </dt>
            <dd style={{ fontSize: '15px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              {account.currency_code || 'USD'}
            </dd>
          </div>
          <div>
            <dt style={{ fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
              Description
            </dt>
            <dd style={{ fontSize: '14px', color: 'var(--color-text)' }}>
              {account.description || 'No operational description provided.'}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
};

export default AccountDetailPage;
