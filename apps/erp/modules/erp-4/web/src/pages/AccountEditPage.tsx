/**
 * ERP-4 Finance and Accounting — Account Edit Page
 *
 * Route: `/erp4/accounts/:accountId/edit`
 *
 * @module erp4/web/pages/AccountEditPage
 */

import React, { useState, useEffect } from 'react';
import { PageTitle } from '@cs/ui';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { fetchAccountById, updateAccount } from '../api/erp-4.js';
import type { Account } from '@clearshift/contracts';
import { SkeletonTable, ErrorState } from '../components/StateViews.js';

export const AccountEditPage: React.FC = () => {
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const [account, setAccount] = useState<Account | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    setIsLoading(true);
    setError(null);
    fetchAccountById(accountId)
      .then((data) => {
        setAccount(data);
        setName(data.name);
        setDescription(data.description || '');
        setIsActive(data.is_active ?? (data as any).isActive ?? true);
      })
      .catch((err) => setError(err?.message || `Failed to fetch account ${accountId}`))
      .finally(() => setIsLoading(false));
  }, [accountId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await updateAccount(accountId, { name, description, is_active: isActive });
      navigate(`/erp4/accounts/${accountId}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to update account');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="cs-page-container">
        <SkeletonTable columns={4} rows={4} />
      </div>
    );
  }

  if (error && !account) {
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
        title={`Edit Account: ${account?.code || (account as any)?.accountNumber || ''}`}
        subtitle={`Update account profile and status for ${account?.name}`}
        actions={
          <Link to={`/erp4/accounts/${accountId}`} className="cs-button cs-button-secondary">
            Cancel
          </Link>
        }
      />

      <div className="cs-card" style={{ maxWidth: '640px' }}>
        {error && (
          <div
            role="alert"
            style={{
              padding: '12px 16px',
              backgroundColor: 'var(--color-error-bg)',
              color: 'var(--color-error)',
              border: '1px solid var(--color-error-border)',
              borderRadius: 'var(--radius-md)',
              marginBottom: '16px',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="cs-form-group" style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
              Account Code
            </label>
            <input
              type="text"
              className="cs-input"
              disabled
              value={account?.code || (account as any)?.accountNumber || ''}
              style={{ width: '100%', opacity: 0.7, cursor: 'not-allowed' }}
            />
          </div>

          <div className="cs-form-group" style={{ marginBottom: '16px' }}>
            <label htmlFor="name" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
              Account Name *
            </label>
            <input
              id="name"
              type="text"
              className="cs-input"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <div className="cs-form-group" style={{ marginBottom: '16px' }}>
            <label htmlFor="description" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
              Description
            </label>
            <input
              id="description"
              type="text"
              className="cs-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <div className="cs-form-group" style={{ marginBottom: '16px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <span style={{ fontWeight: 600 }}>Active Status</span>
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '24px' }}>
            <Link to={`/erp4/accounts/${accountId}`} className="cs-button cs-button-secondary">
              Cancel
            </Link>
            <button
              type="submit"
              className="cs-button cs-button-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AccountEditPage;
