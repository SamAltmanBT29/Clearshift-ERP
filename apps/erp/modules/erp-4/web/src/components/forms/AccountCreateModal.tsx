import React, { useState } from 'react';
import type { Account, AccountType } from '@clearshift/contracts';
import { createAccount } from '../../api/erp-4.js';

interface AccountCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newAccount: Account) => void;
}

export const AccountCreateModal: React.FC<AccountCreateModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('asset');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);

  if (!isOpen) return null;

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!code.trim()) {
      errs['code'] = 'Account code is required';
    } else if (!/^[A-Za-z0-9_-]+$/.test(code.trim())) {
      errs['code'] = 'Code must be alphanumeric with hyphens or underscores';
    }

    if (!name.trim()) {
      errs['name'] = 'Account name is required';
    } else if (name.trim().length < 2) {
      errs['name'] = 'Name must be at least 2 characters';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    setApiError(null);
    try {
      const created = await createAccount({
        code: code.trim(),
        name: name.trim(),
        type,
        currency_code: currencyCode,
        description: description.trim() || undefined,
        is_posting_account: true,
      });
      onSuccess(created);
      onClose();
    } catch (err: any) {
      setApiError(err?.message || 'Failed to create account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="cs-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="cs-modal-card">
        <div className="cs-modal-header">
          <h2 id="modal-title" className="cs-modal-title">Create GL Account</h2>
          <button
            type="button"
            className="cs-btn cs-btn-secondary cs-btn-sm"
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="cs-modal-body">
            {apiError && (
              <div
                style={{
                  padding: '10px 12px',
                  background: 'var(--color-error-bg)',
                  border: '1px solid var(--color-error-border)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-error)',
                  fontSize: '13px',
                }}
              >
                {apiError}
              </div>
            )}

            <div className="cs-form-group">
              <label htmlFor="acc-code" className="cs-form-label cs-form-label-required">
                Account Code
              </label>
              <input
                id="acc-code"
                type="text"
                className={`cs-input ${errors['code'] ? 'cs-input-error' : ''}`}
                placeholder="e.g. 1050 or 2010-01"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={isSubmitting}
                aria-describedby={errors['code'] ? 'code-err' : undefined}
              />
              {errors['code'] && <span id="code-err" className="cs-form-error">{errors['code']}</span>}
              <span className="cs-form-helper">Globally unique code in Chart of Accounts</span>
            </div>

            <div className="cs-form-group">
              <label htmlFor="acc-name" className="cs-form-label cs-form-label-required">
                Account Name
              </label>
              <input
                id="acc-name"
                type="text"
                className={`cs-input ${errors['name'] ? 'cs-input-error' : ''}`}
                placeholder="e.g. Petty Cash Vault"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isSubmitting}
                aria-describedby={errors['name'] ? 'name-err' : undefined}
              />
              {errors['name'] && <span id="name-err" className="cs-form-error">{errors['name']}</span>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="cs-form-group">
                <label htmlFor="acc-type" className="cs-form-label cs-form-label-required">
                  Classification
                </label>
                <select
                  id="acc-type"
                  className="cs-select"
                  value={type}
                  onChange={(e) => setType(e.target.value as AccountType)}
                  disabled={isSubmitting}
                >
                  <option value="asset">Asset</option>
                  <option value="liability">Liability</option>
                  <option value="equity">Equity</option>
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                </select>
              </div>

              <div className="cs-form-group">
                <label htmlFor="acc-curr" className="cs-form-label cs-form-label-required">
                  Currency
                </label>
                <select
                  id="acc-curr"
                  className="cs-select"
                  value={currencyCode}
                  onChange={(e) => setCurrencyCode(e.target.value)}
                  disabled={isSubmitting}
                >
                  <option value="USD">USD</option>
                  <option value="INR">INR</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
            </div>

            <div className="cs-form-group">
              <label htmlFor="acc-desc" className="cs-form-label">
                Description Memo
              </label>
              <textarea
                id="acc-desc"
                className="cs-input"
                style={{ resize: 'vertical', minHeight: '60px' }}
                placeholder="Optional description of account ledger purpose"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="cs-modal-footer">
            <button
              type="button"
              className="cs-btn cs-btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="cs-btn cs-btn-primary"
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
