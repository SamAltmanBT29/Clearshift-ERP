import React from 'react';

export interface ConfirmActionDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmActionDialog: React.FC<ConfirmActionDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDestructive = false,
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="cs-modal-overlay" role="presentation">
      <div
        className="cs-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
      >
        <header className="cs-modal-header">
          <h2 id="confirm-dialog-title" className="cs-modal-title">
            {title}
          </h2>
        </header>

        <div className="cs-modal-body">
          <p id="confirm-dialog-message" className="cs-modal-message">
            {message}
          </p>
        </div>

        <footer className="cs-modal-actions">
          <button
            type="button"
            className="cs-btn-secondary"
            onClick={onCancel}
            disabled={isLoading}
            aria-label={cancelLabel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={isDestructive ? 'cs-btn-danger' : 'cs-btn-primary'}
            onClick={onConfirm}
            disabled={isLoading}
            aria-label={confirmLabel}
          >
            {isLoading ? 'Processing...' : confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
};
