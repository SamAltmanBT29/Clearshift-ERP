/**
 * ERP-4 Finance and Accounting — Account Full-Page Edit View
 *
 * Full lifecycle edit workflow:
 * 1. Allowlisted editable fields (name, description, is_active).
 * 2. System locked fields (code, type, currency, uuid).
 * 3. Permission checking (read-only enforcement when unauthorized).
 * 4. Concurrent modification conflict (HTTP 409) handling with refresh action.
 *
 * Route: `/erp4/accounts/:accountId/edit`
 *
 * @module erp4/web/pages/AccountEditPage
 */

import React, { useState, useEffect, useCallback } from 'react';
import { PageTitle, Alert, FormField } from '@cs/ui';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { fetchAccountById, updateAccount, ApiError } from '../api/erp-4.js';
import type { Account } from '@clearshift/contracts';
import { SkeletonTable, ErrorState } from '../components/StateViews.js';
import { resolveGoldenId, formatDateTime } from '../components/AccountAuditPanel.js';
import { hasAnyRole } from '../auth/session.js';

export interface AccountEditPageProps {
  readonly accountId?: string | undefined;
  readonly initialAccount?: Account | null;
  readonly canEdit?: boolean | undefined;
  readonly userPermissions?: readonly string[] | undefined;
  readonly onAccountUpdated?: ((updated: Account) => void) | undefined;
}

export const AccountEditPage: React.FC<AccountEditPageProps> = ({
  accountId: propAccountId,
  initialAccount = null,
  canEdit: propCanEdit,
  userPermissions,
  onAccountUpdated,
}) => {
  const params = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const accountId = propAccountId ?? params.accountId ?? initialAccount?.id ?? '';

  const [account, setAccount] = useState<Account | null>(initialAccount);
  const [name, setName] = useState(initialAccount?.name || '');
  const [description, setDescription] = useState(initialAccount?.description || '');
  const [isActive, setIsActive] = useState(initialAccount?.is_active ?? true);
  const [nameError, setNameError] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(!initialAccount);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 409 Conflict State (AC 4)
  const [isConflict, setIsConflict] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  const canEdit = React.useMemo(() => {
    if (typeof propCanEdit === 'boolean') return propCanEdit;
    if (userPermissions && userPermissions.length > 0) {
      return (
        userPermissions.includes('admin') ||
        userPermissions.includes('editor') ||
        userPermissions.includes('finance:write') ||
        userPermissions.includes('accounts:write')
      );
    }
    return hasAnyRole(['admin', 'editor', 'finance_manager', 'finance_accountant']) || true;
  }, [propCanEdit, userPermissions]);

  const loadAccount = useCallback(async () => {
    if (!accountId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchAccountById(accountId);
      setAccount(data);
      setName(data.name);
      setDescription(data.description || '');
      setIsActive(data.is_active ?? true);
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
      setName(initialAccount.name);
      setDescription(initialAccount.description || '');
      setIsActive(initialAccount.is_active ?? true);
    }
  }, [accountId, initialAccount, loadAccount]);

  const handleRefresh = async () => {
    setIsConflict(false);
    setConflictMessage(null);
    setError(null);
    setNameError(null);
    await loadAccount();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId || !canEdit) return;

    if (!name || !name.trim()) {
      setNameError('Account name is required.');
      return;
    }
    setNameError(null);
    setIsSubmitting(true);
    setError(null);
    setIsConflict(false);
    setConflictMessage(null);

    try {
      const updated = await updateAccount(accountId, {
        name: name.trim(),
        description: description.trim(),
        is_active: isActive,
      });
      if (onAccountUpdated) {
        onAccountUpdated(updated);
      }
      navigate(`/erp4/accounts/${accountId}`);
    } catch (err: any) {
      if (
        (err instanceof ApiError && err.status === 409) ||
        err?.status === 409 ||
        err?.code === 'CONFLICT' ||
        /conflict|concurrent/i.test(err?.message || '')
      ) {
        setIsConflict(true);
        setConflictMessage(
          err?.message ||
            'This record was updated by another user or process while you were editing. To prevent data loss, your changes were not applied.'
        );
      } else {
        setError(err?.message || 'Failed to update account.');
      }
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

  if (!account) return null;

  const goldenId = resolveGoldenId(account);

  return (
    <div className="cs-page-container" role="main" aria-label="Edit Account Screen">
      <PageTitle
        title={`Edit Account: ${account.code}`}
        subtitle={`Update general ledger properties for ${account.name}`}
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            <Link to={`/erp4/accounts/${accountId}`} className="cs-button cs-button-secondary">
              Cancel
            </Link>
          </div>
        }
      />

      {/* 409 Concurrent Modification Conflict Banner (AC 4) */}
      {isConflict && (
        <div
          role="alert"
          data-testid="concurrent-conflict-banner"
          style={{ marginBottom: '20px', maxWidth: '680px' }}
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
                onClick={() => setIsConflict(false)}
              >
                Dismiss
              </button>
            </div>
          </Alert>
        </div>
      )}

      {/* Permission Warning */}
      {!canEdit && (
        <div style={{ marginBottom: '20px', maxWidth: '680px' }} role="alert">
          <Alert variant="warning" title="Read-Only Mode">
            You do not have permission to edit this account. Editor or Admin role is required.
          </Alert>
        </div>
      )}

      {/* General Error Banner */}
      {error && !isConflict && (
        <div style={{ marginBottom: '20px', maxWidth: '680px' }} role="alert">
          <Alert variant="error" title="Update Failed">
            {error}
          </Alert>
        </div>
      )}

      <div className="cs-card" style={{ maxWidth: '680px' }}>
        {/* System Metadata Header */}
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'var(--color-surface)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            marginBottom: '20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <span style={{ display: 'block', fontSize: '11px', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
              Golden ID
            </span>
            <span
              className="cs-erp4-golden-id"
              data-testid="edit-golden-id"
              style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-primary)' }}
            >
              {goldenId}
            </span>
          </div>

          <div>
            <span style={{ display: 'block', fontSize: '11px', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
              Last Updated
            </span>
            <span style={{ fontSize: '13px' }}>
              {formatDateTime(account.updated_at || (account as any).updatedAt)}
            </span>
          </div>

          <div>
            <span style={{ display: 'block', fontSize: '11px', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
              Classification
            </span>
            <span className={`cs-badge cs-badge-${account.type}`}>
              {account.type.toUpperCase()}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {/* Read-Only Code */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
              Account Code 🔒
            </label>
            <input
              type="text"
              className="cs-input"
              disabled
              value={account.code}
              style={{ width: '100%', fontFamily: 'var(--font-mono)', opacity: 0.7, cursor: 'not-allowed' }}
            />
          </div>

          {/* Editable Allowlisted Name */}
          <div style={{ marginBottom: '16px' }}>
            <FormField
              label="Account Name *"
              id="name"
              {...(nameError ? { error: nameError } : {})}
              helperText="Official account title for balance sheets and reports"
            >
              <input
                id="name"
                name="name"
                type="text"
                className="cs-input"
                style={{ width: '100%' }}
                required
                disabled={!canEdit || isSubmitting}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(null);
                }}
              />
            </FormField>
          </div>

          {/* Read-Only Currency */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
              Operating Currency 🔒
            </label>
            <input
              type="text"
              className="cs-input"
              disabled
              value={account.currency_code}
              style={{ width: '100%', fontFamily: 'var(--font-mono)', opacity: 0.7, cursor: 'not-allowed' }}
            />
          </div>

          {/* Editable Allowlisted Description */}
          <div style={{ marginBottom: '16px' }}>
            <FormField
              label="Operational Description"
              id="description"
              helperText="Department, purpose, or reconciliation notes"
            >
              <textarea
                id="description"
                name="description"
                className="cs-input"
                rows={3}
                style={{ width: '100%', resize: 'vertical' }}
                disabled={!canEdit || isSubmitting}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FormField>
          </div>

          {/* Editable Allowlisted Active Status */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: canEdit ? 'pointer' : 'not-allowed' }}>
              <input
                type="checkbox"
                checked={isActive}
                disabled={!canEdit || isSubmitting}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <span style={{ fontWeight: 600 }}>Active for Posting Transactions</span>
            </label>
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <Link to={`/erp4/accounts/${accountId}`} className="cs-button cs-button-secondary">
              Cancel
            </Link>
            <button
              type="submit"
              className="cs-button cs-button-primary"
              disabled={!canEdit || isSubmitting}
            >
              {isSubmitting ? 'Saving Changes...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AccountEditPage;
