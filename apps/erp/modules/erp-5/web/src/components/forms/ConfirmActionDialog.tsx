/**
 * ERP-5 HR & Employees — Confirm Action Dialog
 *
 * The confirmation for an action that cannot be taken back.
 *
 * In V1 the only irreversible action of the module is the **decision on a
 * leave record**: `approved` and `rejected` are terminal states, a decision
 * is never reversed and a leave is never un-decided (the V1 leave state
 * matrix, ERP5-06). The operator confirms it once, in plain words, before
 * the record is written.
 *
 * @module erp5/web/components/forms/ConfirmActionDialog
 */

import React from 'react';
import { Dialog } from '@cs/ui';

export interface ConfirmActionDialogProps {
  readonly isOpen: boolean;
  readonly title: string;
  readonly message: React.ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel?: string | undefined;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export const ConfirmActionDialog: React.FC<ConfirmActionDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Keep the current value',
  onConfirm,
  onCancel,
}) => (
  <Dialog
    isOpen={isOpen}
    onClose={onCancel}
    title={title}
    footer={
      <>
        <button
          type="button"
          className="cs-erp5-button cs-erp5-button-secondary"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className="cs-erp5-button cs-erp5-button-primary"
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </>
    }
  >
    {message}
  </Dialog>
);

export default ConfirmActionDialog;
