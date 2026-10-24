/**
 * ERP-4 Finance and Accounting — Account Create Page
 *
 * Route: `/erp4/accounts/new`
 *
 * @module erp4/web/pages/AccountCreatePage
 */

import React, { useState } from 'react';
import { PageTitle } from '@cs/ui';
import { Link, useNavigate } from 'react-router-dom';
import { createAccount } from '../api/erp-4.js';
import type { CreateAccountInput } from '@clearshift/contracts';

export const AccountCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState<CreateAccountInput>({
    code: '',
    name: '',
    type: 'asset',
    currency_code: 'USD',
    is_posting_account: true,
    description: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await createAccount(formData);
      navigate('/erp4/accounts');
    } catch (err: any) {
      setError(err?.message || 'Failed to create account');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="cs-page-container">
      <PageTitle
        title="New Account"
        subtitle="Add a general ledger account to the chart of accounts"
        actions={
          <Link to="/erp4/accounts" className="cs-button cs-button-secondary">
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
            <label htmlFor="code" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
              Account Code *
            </label>
            <input
              id="code"
              type="text"
              className="cs-input"
              required
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value })}
              placeholder="e.g. 1010"
              style={{ width: '100%' }}
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
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g. Operating Cash"
              style={{ width: '100%' }}
            />
          </div>

          <div className="cs-form-group" style={{ marginBottom: '16px' }}>
            <label htmlFor="type" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
              Account Type *
            </label>
            <select
              id="type"
              className="cs-select"
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
              style={{ width: '100%' }}
            >
              <option value="asset">Asset</option>
              <option value="liability">Liability</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
          </div>

          <div className="cs-form-group" style={{ marginBottom: '16px' }}>
            <label htmlFor="description" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
              Description
            </label>
            <input
              id="description"
              type="text"
              className="cs-input"
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Operational description..."
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '24px' }}>
            <Link to="/erp4/accounts" className="cs-button cs-button-secondary">
              Cancel
            </Link>
            <button
              type="submit"
              className="cs-button cs-button-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating...' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AccountCreatePage;
