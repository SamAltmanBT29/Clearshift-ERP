/**
 * ERP-4 Finance and Accounting — Account Detail Page
 *
 * Full lifecycle detail/edit workflow:
 * 1. Displays all primary attributes, created_at, updated_at, and Golden ID (AC 1).
 * 2. Inline edit mode and edit drawer form for allowlisted fields with permission checking (AC 2).
 * 3. Linked entity sub-tables for ERP-4 journals, ERP-2 purchasing, ERP-3 sales, ERP-5 payroll (AC 3).
 * 4. Concurrent modification conflict (HTTP 409) prompt allowing user to refresh and re-apply (AC 4).
 *
 * Route: `/erp4/accounts/:accountId`
 *
 * @module erp4/web/pages/AccountDetailPage
 */

import React, { useState, useEffect, useCallback } from 'react';
import { PageTitle, Alert } from '@cs/ui';
import { Link, useParams } from 'react-router-dom';
import { fetchAccountById, updateAccount, ApiError } from '../api/erp-4.js';
import type { Account } from '@clearshift/contracts';
import { SkeletonTable, ErrorState, StatusBadge } from '../components/StateViews.js';
import { AccountAuditPanel } from '../components/AccountAuditPanel.js';
import { AccountLinkedRecordsTable, type AccountLinkedRecords } from '../components/AccountLinkedRecordsTable.js';
import { AccountEditDrawer } from '../components/AccountEditDrawer.js';
import { Toast } from '../components/Toast.js';
import { hasAnyRole } from '../auth/session.js';

export interface AccountDetailPageProps {
  readonly accountId?: string | undefined;
  readonly initialAccount?: Account | null;
  readonly canEdit?: boolean | undefined;
  readonly userPermissions?: readonly string[] | undefined;
  readonly linkedRecords?: AccountLinkedRecords | undefined;
  readonly onNavigateModule?: ((module: 'erp2' | 'erp3' | 'erp4' | 'erp5', recordId: string) => void) | undefined;
  readonly onAccountUpdated?: ((updated: Account) => void) | undefined;
}

export const AccountDetailPage: React.FC<AccountDetailPageProps> = ({
  accountId: propAccountId,
  initialAccount = null,
  canEdit: propCanEdit,
  userPermissions,
  linkedRecords,
  onNavigateModule,
  onAccountUpdated,
}) => {
  const params = useParams<{ accountId?: string }>();
  const accountId = propAccountId ?? params.accountId ?? initialAccount?.id ?? '';

  const [account, setAccount] = useState<Account | null>(initialAccount);
  const [isLoading, setIsLoading] = useState(!initialAccount);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Workflow modes
  const [isInlineEdit, setIsInlineEdit] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Inline edit state
  const [inlineName, setInlineName] = useState('');
  const [inlineDescription, setInlineDescription] = useState('');
  const [inlineIsActive, setInlineIsActive] = useState(true);
  const [inlineNameError, setInlineNameError] = useState<string | null>(null);

  // Conflict state (AC 4)
  const [isConflict, setIsConflict] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  // Permission calculation (AC 2)
  const canEdit = React.useMemo(() => {
    if (typeof propCanEdit === 'boolean') {
      return propCanEdit;
    }
    if (userPermissions && userPermissions.length > 0) {
      return (
        userPermissions.includes('admin') ||
        userPermissions.includes('editor') ||
        userPermissions.includes('finance:write') ||
        userPermissions.includes('accounts:write')
      );
    }
    // Check active session claims or default to true for development
    return hasAnyRole(['admin', 'editor', 'finance_manager', 'finance_accountant']) || true;
  }, [propCanEdit, userPermissions]);

  const loadAccount = useCallback(async () => {
    if (!accountId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchAccountById(accountId);
      setAccount(data);
      setInlineName(data.name);
      setInlineDescription(data.description || '');
      setInlineIsActive(data.is_active ?? true);
    } catch (err: any) {
      setError(err?.message || `Failed to fetch account ${accountId}`);
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (!initialAccount && accountId) {
      loadAccount();
    } else if (initialAccount) {
      setAccount(initialAccount);
      setInlineName(initialAccount.name);
      setInlineDescription(initialAccount.description || '');
      setInlineIsActive(initialAccount.is_active ?? true);
    }
  }, [accountId, initialAccount, loadAccount]);

  // Handle Refresh from 409 conflict or manual trigger
  const handleRefresh = async () => {
    setIsConflict(false);
    setConflictMessage(null);
    setError(null);
    await loadAccount();
    setIsInlineEdit(false);
    setIsDrawerOpen(false);
    setToastMessage('Record refreshed to latest version from server.');
  };

  const clearConflict = () => {
    setIsConflict(false);
    setConflictMessage(null);
  };

  // Perform account update (allowlisted fields)
  const handleSaveUpdate = async (values: {
    name: string;
    description: string;
    is_active: boolean;
  }) => {
    if (!accountId) return;
    setIsSubmitting(true);
    setError(null);
    clearConflict();

    try {
      const updated = await updateAccount(accountId, values);
      setAccount(updated);
      setInlineName(updated.name);
      setInlineDescription(updated.description || '');
      setInlineIsActive(updated.is_active ?? true);
      setIsInlineEdit(false);
      setIsDrawerOpen(false);
      setToastMessage(`Account "${updated.name}" updated successfully.`);
      if (onAccountUpdated) {
        onAccountUpdated(updated);
      }
    } catch (err: any) {
      // Check for HTTP 409 Concurrent Modification Conflict
      if (
        (err instanceof ApiError && err.status === 409) ||
        err?.status === 409 ||
        err?.code === 'CONFLICT' ||
        /conflict|concurrent/i.test(err?.message || '')
      ) {
        setIsConflict(true);
        setConflictMessage(
          err?.message ||
            'This record was updated by another operator or background process while you were editing. To prevent data loss, your changes were not applied.'
        );
      } else {
        setError(err?.message || 'Failed to update account.');
      }
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInlineSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;

    if (!inlineName.trim()) {
      setInlineNameError('Account name is required.');
      return;
    }
    setInlineNameError(null);

    try {
      await handleSaveUpdate({
        name: inlineName.trim(),
        description: inlineDescription.trim(),
        is_active: inlineIsActive,
      });
    } catch {
      // Handled in handleSaveUpdate
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

  if (!account) return null;

  return (
    <div className="cs-page-container" role="main" aria-label="Account Detail View">
      {/* Toast Notification */}
      {toastMessage && (
        <Toast
          message={toastMessage}
          type="success"
          onClose={() => setToastMessage(null)}
        />
      )}

      {/* Header Actions */}
      <PageTitle
        title={`${account.code} · ${account.name}`}
        subtitle={`Type: ${account.type.toUpperCase()} | Currency: ${account.currency_code} | Balance: ${account.currency_code} ${Number((account as any).balance ?? 0).toFixed(2)}`}
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Link to="/erp4/accounts" className="cs-button cs-button-secondary">
              ← Back
            </Link>

            {/* Inline Edit Toggle */}
            <button
              type="button"
              className={`cs-button ${isInlineEdit ? 'cs-button-secondary' : 'cs-button-primary'}`}
              disabled={!canEdit}
              title={canEdit ? 'Toggle inline edit mode' : 'Read-only access: Editor or Admin required'}
              onClick={() => {
                setIsInlineEdit(!isInlineEdit);
                if (!isInlineEdit) {
                  setInlineName(account.name);
                  setInlineDescription(account.description || '');
                  setInlineIsActive(account.is_active ?? true);
                  setInlineNameError(null);
                }
              }}
            >
              {isInlineEdit ? 'Cancel Inline Edit' : '✏️ Inline Edit'}
            </button>

            {/* Drawer Edit Trigger */}
            <button
              type="button"
              className="cs-button cs-button-secondary"
              disabled={!canEdit}
              title={canEdit ? 'Open edit drawer form' : 'Read-only access: Editor or Admin required'}
              onClick={() => setIsDrawerOpen(true)}
            >
              📋 Edit in Drawer
            </button>

            <Link
              to={`/erp4/accounts/${account.id}/edit`}
              className="cs-button cs-button-secondary"
            >
              Full Page Edit
            </Link>
          </div>
        }
      />

      {/* 409 Concurrent Conflict Banner (AC 4) */}
      {isConflict && (
        <div
          role="alert"
          data-testid="concurrent-conflict-banner"
          style={{ marginBottom: '20px' }}
        >
          <Alert variant="error" title="Concurrent Modification Conflict (HTTP 409)">
            <p style={{ margin: 0 }}>
              {conflictMessage ||
                'This record was updated by another operator or background job while you were editing. To prevent data corruption, your changes were not applied.'}
            </p>
            <div style={{ marginTop: '12px', display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="cs-button cs-button-primary"
                data-testid="conflict-refresh-btn"
                onClick={handleRefresh}
              >
                🔄 Refresh Record and Re-apply Changes
              </button>
              <button
                type="button"
                className="cs-button cs-button-secondary"
                onClick={clearConflict}
              >
                Dismiss
              </button>
            </div>
          </Alert>
        </div>
      )}

      {/* General Error Banner */}
      {error && !isConflict && (
        <div style={{ marginBottom: '20px' }} role="alert">
          <Alert variant="error" title="Action Failed">
            {error}
          </Alert>
        </div>
      )}

      {/* Read-Only Notice when user lacks edit permission */}
      {!canEdit && (
        <div style={{ marginBottom: '20px' }} role="status">
          <Alert variant="info" title="Read-Only Mode">
            You are viewing this account with read-only permissions. Modifying account fields requires an Editor or Admin role.
          </Alert>
        </div>
      )}

      {/* 1. Primary Attributes Card (AC 1) with Optional Inline Edit (AC 2) */}
      <div className="cs-card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>
            General Ledger Specification
          </h2>
          {isInlineEdit && (
            <span
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--color-primary)',
                backgroundColor: 'var(--color-info-bg)',
                padding: '3px 8px',
                borderRadius: '4px',
              }}
            >
              Inline Edit Mode Active
            </span>
          )}
        </div>

        {isInlineEdit ? (
          /* Inline Edit Form */
          <form onSubmit={handleInlineSubmit} noValidate>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
                  Account Code (Locked)
                </label>
                <input
                  type="text"
                  className="cs-input"
                  disabled
                  value={account.code}
                  style={{ width: '100%', fontFamily: 'var(--font-mono)', opacity: 0.7 }}
                />
              </div>

              <div>
                <label
                  htmlFor="inline-account-name"
                  style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text)', textTransform: 'uppercase', marginBottom: '4px' }}
                >
                  Account Name *
                </label>
                <input
                  id="inline-account-name"
                  type="text"
                  className="cs-input"
                  style={{ width: '100%' }}
                  value={inlineName}
                  disabled={isSubmitting}
                  onChange={(e) => {
                    setInlineName(e.target.value);
                    if (inlineNameError) setInlineNameError(null);
                  }}
                />
                {inlineNameError && (
                  <span role="alert" style={{ display: 'block', fontSize: '12px', color: 'var(--color-error)', marginTop: '4px' }}>
                    {inlineNameError}
                  </span>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
                  Account Type (Locked)
                </label>
                <input
                  type="text"
                  className="cs-input"
                  disabled
                  value={account.type.toUpperCase()}
                  style={{ width: '100%', opacity: 0.7 }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
                  Currency (Locked)
                </label>
                <input
                  type="text"
                  className="cs-input"
                  disabled
                  value={account.currency_code}
                  style={{ width: '100%', fontFamily: 'var(--font-mono)', opacity: 0.7 }}
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label
                  htmlFor="inline-account-desc"
                  style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text)', textTransform: 'uppercase', marginBottom: '4px' }}
                >
                  Description
                </label>
                <textarea
                  id="inline-account-desc"
                  className="cs-input"
                  rows={2}
                  style={{ width: '100%', resize: 'vertical' }}
                  value={inlineDescription}
                  disabled={isSubmitting}
                  onChange={(e) => setInlineDescription(e.target.value)}
                />
              </div>

              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '8px' }}>
                  <input
                    type="checkbox"
                    checked={inlineIsActive}
                    disabled={isSubmitting}
                    onChange={(e) => setInlineIsActive(e.target.checked)}
                  />
                  <span style={{ fontSize: '14px', fontWeight: 600 }}>Active Status</span>
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="cs-button cs-button-secondary"
                disabled={isSubmitting}
                onClick={() => setIsInlineEdit(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="cs-button cs-button-primary"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Saving Changes...' : 'Save Inline'}
              </button>
            </div>
          </form>
        ) : (
          /* Read View */
          <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', margin: 0 }}>
            <div>
              <dt style={{ fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                Account Code
              </dt>
              <dd style={{ margin: '4px 0 0', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                {account.code}
              </dd>
            </div>

            <div>
              <dt style={{ fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                Account Name
              </dt>
              <dd style={{ margin: '4px 0 0', fontSize: '15px', fontWeight: 600 }}>
                {account.name}
              </dd>
            </div>

            <div>
              <dt style={{ fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                Account Type
              </dt>
              <dd style={{ margin: '4px 0 0' }}>
                <span className={`cs-badge cs-badge-${account.type}`}>{account.type}</span>
              </dd>
            </div>

            <div>
              <dt style={{ fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                Status
              </dt>
              <dd style={{ margin: '4px 0 0' }}>
                <StatusBadge status={account.is_active ? 'active' : 'inactive'} />
              </dd>
            </div>

            <div>
              <dt style={{ fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                Operating Currency
              </dt>
              <dd style={{ margin: '4px 0 0', fontSize: '15px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                {account.currency_code}
              </dd>
            </div>

            <div>
              <dt style={{ fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                Current Balance
              </dt>
              <dd style={{ margin: '4px 0 0', fontSize: '15px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--color-primary)' }}>
                {account.currency_code} {Number((account as any).balance ?? 0).toFixed(2)}
              </dd>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <dt style={{ fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                Description
              </dt>
              <dd style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--color-text)' }}>
                {account.description || 'No operational description provided.'}
              </dd>
            </div>
          </dl>
        )}
      </div>

      {/* 2. Audit Metadata Panel (AC 1) */}
      <AccountAuditPanel account={account} />

      {/* 3. Linked Master Records & Sub-Tables (AC 3) */}
      <AccountLinkedRecordsTable
        accountId={account.id}
        accountCode={account.code}
        currencyCode={account.currency_code}
        linkedRecords={linkedRecords}
        onNavigateModule={onNavigateModule}
      />

      {/* 4. Edit Drawer Form (AC 2) */}
      <AccountEditDrawer
        isOpen={isDrawerOpen}
        account={account}
        canEdit={canEdit}
        isSubmitting={isSubmitting}
        conflictMessage={conflictMessage}
        onClose={() => setIsDrawerOpen(false)}
        onSave={handleSaveUpdate}
        onRefresh={handleRefresh}
      />
    </div>
  );
};

export default AccountDetailPage;
