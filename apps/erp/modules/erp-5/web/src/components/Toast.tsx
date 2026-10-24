/**
 * ERP-5 HR & Employees — Toast
 *
 * A small, transient notification shown after a successful action. The
 * module owns no notification primitive of its own beyond this — it is the
 * confirmation toast required by the create/edit workflow (ERP5-20) and is
 * rendered once, by the module shell, so it survives the route change that
 * follows a successful save.
 *
 * @module erp5/web/components/Toast
 */

import React from 'react';

export interface ToastMessage {
  readonly id: string;
  readonly message: string;
  readonly variant?: 'success' | 'error' | undefined;
}

export interface ToastProps {
  readonly message: string;
  readonly variant?: 'success' | 'error' | undefined;
  readonly onDismiss: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, variant = 'success', onDismiss }) => {
  const role = variant === 'error' ? 'alert' : 'status';
  const live = variant === 'error' ? 'assertive' : 'polite';

  return (
    <div
      role={role}
      aria-live={live}
      className={`cs-erp5-toast cs-erp5-toast--${variant}`}
    >
      <span className="cs-erp5-toast-message">{message}</span>
      <button
        type="button"
        className="cs-erp5-toast-dismiss"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
};

export default Toast;