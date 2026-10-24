/**
 * ERP-4 Finance and Accounting — Account Edit Drawer Modal
 *
 * Provides a slide-over/modal drawer form allowing updates to allowlisted fields
 * (name, description, is_active) with permission checking and 409 conflict handling.
 *
 * @module erp4/web/components/AccountEditDrawer
 */

import React, { useState, useEffect } from 'react';
import type { Account } from '@clearshift/contracts';
import { Dialog, FormField, Alert } from '@cs/ui';

export interface AccountEditDrawerProps {
  readonly isOpen: boolean;
  readonly account: Account;
  readonly canEdit?: boolean;
  readonly isSubmitting?: boolean;
  readonly conflictMessage?: string | null;
  readonly onClose: () => void;
  readonly onSave: (values: { name: string; description: string; is_active: boolean }) => Promise<void>;
  readonly onRefresh?: () => void;
}

export const AccountEditDrawer: React.FC<AccountEditDrawerProps> = ({
  isOpen,
  account,
  canEdit = true,
  isSubmitting = false,
  conflictMessage = null,
  onClose,
  onSave,
  onRefresh,
}) => {
  const [name, setName] = useState(account.name);
  const [description, setDescription] = useState(account.description || '');
  const [isActive, setIsActive] = useState(account.is_active ?? true);
  const [nameError, setNameError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName(account.name);
      setDescription(account.description || '');
      setIsActive(account.is_active ?? true);
      setNameError(null);
      setLocalError(null);
    }
  }, [isOpen, account]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;

    if (!name || !name.trim()) {
      setNameError('Account name is required.');
      return;
    }
    setNameError(null);
    setLocalError(null);

    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        is_active: isActive,
      });
    } catch (err: any) {
      setLocalError(err?.message || 'Failed to update account');
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit Account: ${account.code}`}
      aria-label="Edit Account Profile"
    >
      <div style={{ maxWidth: '520px', width: '100%' }}>
        {/* Permission Warning */}
        {!canEdit && (
          <div style={{ marginBottom: '16px' }} role="alert">
            <Alert variant="warning" title="Read-Only Access">
              You do not have permission to modify accounts. Editor or Admin role is required.
            </Alert>
          </div>
        )}

        {/* 409 Conflict Banner */}
        {conflictMessage && (
          <div
            role="alert"
            data-testid="drawer-conflict-banner"
            style={{ marginBottom: '16px' }}
          >
            <Alert variant="error" title="Concurrent Modification Conflict (HTTP 409)">
              <p style={{ margin: 0 }}>{conflictMessage}</p>
              {onRefresh && (
                <div style={{ marginTop: '10px' }}>
                  <button
                    type="button"
                    className="cs-button cs-button-primary"
                    style={{ fontSize: '12px' }}
                    onClick={onRefresh}
                  >
                    🔄 Refresh and Re-apply
                  </button>
                </div>
              )}
            </Alert>
          </div>
        )}

        {localError && !conflictMessage && (
          <div style={{ marginBottom: '16px' }} role="alert">
            <Alert variant="error" title="Validation Failed">
              {localError}
            </Alert>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* Read-Only Locked Fields */}
          <div
            style={{
              padding: '12px',
              backgroundColor: 'var(--color-surface)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              marginBottom: '16px',
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
              🔒 System Locked Attributes (Immutable)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px' }}>
              <div>
                <span style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>Code: </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{account.code}</span>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>Type: </span>
                <span style={{ fontWeight: 600, textTransform: 'uppercase' }}>{account.type}</span>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>Currency: </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{account.currency_code}</span>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>UUID: </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{account.id.slice(0, 8)}...</span>
              </div>
            </div>
          </div>

          {/* Editable Allowlisted Field 1: Name */}
          <div style={{ marginBottom: '16px' }}>
            <FormField
              label="Account Name *"
              id="drawer-account-name"
              {...(nameError ? { error: nameError } : {})}
              helperText="Descriptive title used in financial statements"
            >
              <input
                id="drawer-account-name"
                name="name"
                type="text"
                className="cs-input"
                style={{ width: '100%' }}
                value={name}
                disabled={!canEdit || isSubmitting}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(null);
                }}
              />
            </FormField>
          </div>

          {/* Editable Allowlisted Field 2: Description */}
          <div style={{ marginBottom: '16px' }}>
            <FormField
              label="Operational Description"
              id="drawer-account-desc"
              helperText="Usage notes, account purpose, or department allocation"
            >
              <textarea
                id="drawer-account-desc"
                name="description"
                className="cs-input"
                rows={3}
                style={{ width: '100%', resize: 'vertical' }}
                value={description}
                disabled={!canEdit || isSubmitting}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FormField>
          </div>

          {/* Editable Allowlisted Field 3: Status */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: canEdit ? 'pointer' : 'not-allowed' }}>
              <input
                type="checkbox"
                checked={isActive}
                disabled={!canEdit || isSubmitting}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <span style={{ fontSize: '14px', fontWeight: 600 }}>
                Active for Posting Transactions
              </span>
            </label>
          </div>

          {/* Form Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button
              type="button"
              className="cs-button cs-button-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
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
    </Dialog>
  );
};

export default AccountEditDrawer;
