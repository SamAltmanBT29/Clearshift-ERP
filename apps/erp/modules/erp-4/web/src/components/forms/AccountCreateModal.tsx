/**
 * ERP-4 Finance and Accounting — Account Creation Modal
 *
 * Implements:
 * - Accessible Dialog modal powered by shared @cs/ui Dialog
 * - Integrates AccountForm with real-time field validation, double-submit protection, and 400 error mapping
 * - On successful submission, closes modal, updates table cache, and triggers toast callback
 *
 * Conforms to Acceptance Criteria for Issue #176 (ERP4-20):
 * - AC1: Form validates required fields, email format, phone numbers, and decimal ranges before submission.
 * - AC2: Client submission button disables during inflight request to prevent double-submit.
 * - AC3: Server validation errors (400) map directly to corresponding input fields with error text.
 * - AC4: Successful submission closes modal, updates table cache, and shows confirmation toast.
 *
 * @module erp4/web/components/forms/AccountCreateModal
 */

import React, { useState } from 'react';
import type { Account } from '@clearshift/contracts';
import { Dialog } from '@cs/ui';
import { AccountForm, type AccountFormData } from './AccountForm.js';
import { createAccount } from '../../api/erp-4.js';

export interface AccountCreateModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onAccountCreated?: ((account: Account) => void) | undefined;
  /** Backward-compatible alias for onAccountCreated */
  readonly onSuccess?: ((account: Account) => void) | undefined;
  readonly initialData?: Partial<Account> | undefined;
  /** Optional custom submit implementation for mocking / isolated testing */
  readonly onSubmitAccount?: ((data: AccountFormData) => Promise<Account>) | undefined;
  readonly className?: string | undefined;
}

export const AccountCreateModal: React.FC<AccountCreateModalProps> = ({
  isOpen,
  onClose,
  onAccountCreated,
  onSuccess,
  initialData,
  onSubmitAccount = createAccount,
  className = '',
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data: AccountFormData) => {
    setIsSubmitting(true);
    try {
      const created = await onSubmitAccount({
        code: data.code,
        name: data.name,
        type: data.type,
        currency_code: data.currency_code || 'USD',
        is_posting_account: data.is_posting_account ?? true,
        description: data.description || null,
        parent_id: data.parent_id || null,
      });

      // Update table cache
      if (onAccountCreated) {
        onAccountCreated(created);
      }
      if (onSuccess) {
        onSuccess(created);
      }

      // Close modal
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Create General Ledger Account"
      description="Create GL Account: Add a new account to the ClearShift Chart of Accounts with double-entry integrity."
      className={className}
    >
      <AccountForm
        initialData={initialData}
        onSubmit={handleSubmit}
        onCancel={onClose}
        isLoading={isSubmitting}
      />
    </Dialog>
  );
};

export default AccountCreateModal;
