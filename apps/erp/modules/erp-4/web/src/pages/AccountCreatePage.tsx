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
import { AccountForm, type AccountFormData } from '../components/forms/AccountForm.js';
import { Toast } from '../components/Toast.js';

export const AccountCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleSubmit = async (data: AccountFormData) => {
    const created = await createAccount({
      code: data.code,
      name: data.name,
      type: data.type,
      currency_code: data.currency_code || 'USD',
      is_posting_account: data.is_posting_account ?? true,
      description: data.description || null,
      parent_id: data.parent_id || null,
    });

    setToastMessage(`Account ${created.code} (${created.name}) created successfully.`);
    // Navigate back to accounts list after brief confirmation
    setTimeout(() => {
      navigate('/erp4/accounts');
    }, 600);
  };

  return (
    <div className="cs-page-container">
      <PageTitle
        title="New Account"
        subtitle="Add a general ledger account to the chart of accounts with real-time validation"
        actions={
          <Link to="/erp4/accounts" className="cs-btn cs-btn-secondary">
            ← Back to Accounts
          </Link>
        }
      />

      <div className="max-w-2xl bg-[var(--cs-surface,#ffffff)] border border-[var(--cs-border,#e5e7eb)] rounded-lg p-6 shadow-sm">
        <AccountForm
          onSubmit={handleSubmit}
          onCancel={() => navigate('/erp4/accounts')}
        />
      </div>

      {toastMessage && (
        <Toast
          message={toastMessage}
          type="success"
          onClose={() => setToastMessage(null)}
        />
      )}
    </div>
  );
};

export default AccountCreatePage;
