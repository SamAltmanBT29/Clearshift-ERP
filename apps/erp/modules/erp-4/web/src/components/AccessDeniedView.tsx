/**
 * ERP-4 Finance and Accounting — 403 Forbidden / Access-Denied View
 *
 * Rendered when a user encounters an HTTP 403 Forbidden response or lacks
 * required RBAC roles (Finance Admin, Finance Editor, Finance Viewer, Auditor).
 * Conforms to ClearShift SDS §4.8 access control requirements.
 *
 * @module erp4/web/components/AccessDeniedView
 */

import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DEFAULT_FINANCE_ROLES } from '../utils/error-sanitizer.js';

export interface AccessDeniedViewProps {
  title?: string | undefined;
  message?: string | undefined;
  resourceName?: string | undefined;
  requiredRoles?: string[] | undefined;
  currentRole?: string | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  dashboardUrl?: string | undefined;
  className?: string | undefined;
}

export const AccessDeniedView: React.FC<AccessDeniedViewProps> = ({
  title = 'Access Denied (403 Forbidden)',
  message,
  resourceName = 'Finance and Accounting Ledger',
  requiredRoles = DEFAULT_FINANCE_ROLES,
  currentRole,
  onRetry,
  onBack,
  dashboardUrl = '/erp4',
  className = '',
}) => {
  const navigate = useNavigate();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate(-1);
    }
  };

  return (
    <div
      role="region"
      aria-label="Access Denied"
      className={`cs-access-denied-view p-8 rounded-lg border border-[var(--cs-err,#dc2626)] bg-[var(--cs-surface,#ffffff)] shadow-sm max-w-2xl mx-auto my-8 text-center ${className}`}
    >
      {/* Visual Shield / Lock Indicator */}
      <div
        className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center bg-[var(--cs-err-bg,#fef2f2)] border border-[var(--cs-err,#dc2626)]/30 text-3xl"
        aria-hidden="true"
      >
        🔒
      </div>

      {/* Heading */}
      <h2 className="text-xl font-bold text-[var(--cs-text,#1f2937)] mb-2">
        {title}
      </h2>

      {/* Primary Explanation */}
      <p className="text-sm text-[var(--cs-text-muted,#4b5563)] mb-4">
        {message || `You do not have the required permissions or role to access ${resourceName}.`}
      </p>

      {/* Missing Role Explanation Box */}
      <div className="bg-[var(--cs-bg,#f9fafb)] rounded-md p-4 mb-6 border border-[var(--cs-border,#e5e7eb)] text-left">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--cs-text-muted,#6b7280)] mb-2">
          Access Policy Requirements
        </div>
        <div className="text-sm text-[var(--cs-text,#374151)] mb-2">
          To perform this action or view these financial records, your user account must possess one of the following assigned roles:
        </div>
        <ul className="list-disc list-inside space-y-1 mb-3 text-sm font-medium text-[var(--cs-text,#111827)]">
          {requiredRoles.map((role) => (
            <li key={role}>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-[var(--cs-border,#e5e7eb)]/60">
                {role}
              </span>
            </li>
          ))}
        </ul>
        {currentRole && (
          <div className="text-xs text-[var(--cs-text-muted,#6b7280)] pt-2 border-t border-[var(--cs-border,#e5e7eb)]">
            Your current active role is: <span className="font-mono font-semibold">{currentRole}</span>
          </div>
        )}
        <div className="text-xs text-[var(--cs-text-muted,#6b7280)] mt-2">
          If you require access, please contact your Organization Administrator or PMO Security Officer with your user identifier.
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={handleBack}
          className="px-4 py-2 text-sm font-medium rounded border border-[var(--cs-border,#d1d5db)] bg-[var(--cs-bg,#ffffff)] hover:bg-[var(--cs-surface,#f3f4f6)] text-[var(--cs-text,#374151)] transition-colors"
        >
          ← Go Back
        </button>

        <Link
          to={dashboardUrl}
          className="px-4 py-2 text-sm font-medium rounded bg-[var(--cs-accent,#2563eb)] text-white hover:bg-[var(--cs-accent-hover,#1d4ed8)] transition-colors"
        >
          Return to Finance Overview
        </Link>

        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="px-4 py-2 text-sm font-medium rounded border border-[var(--cs-accent,#2563eb)] text-[var(--cs-accent,#2563eb)] hover:bg-[var(--cs-accent,#2563eb)]/10 transition-colors"
          >
            Retry Request
          </button>
        )}
      </div>
    </div>
  );
};

export default AccessDeniedView;
