/**
 * ERP-5 HR & Employees — Record State Boundary
 *
 * The states of a screen that shows **one** record: loading, the record
 * itself, a record that does not exist, a refused request and a failure.
 *
 * @module erp5/web/components/RecordStateBoundary
 */

import React from 'react';
import { ErrorState } from '@cs/ui';
import type { HrApiError } from '../api/erp-5.js';
import { PermissionDeniedState } from './PermissionDeniedState.js';

export interface RecordStateBoundaryProps {
  readonly isLoading: boolean;
  readonly error: HrApiError | null;
  readonly onRetry: () => void;
  /** The title of the "not found" view. */
  readonly notFoundTitle: string;
  /** The message of the "not found" view. */
  readonly notFoundMessage: string;
  readonly children: React.ReactNode;
}

export const RecordStateBoundary: React.FC<RecordStateBoundaryProps> = ({
  isLoading,
  error,
  onRetry,
  notFoundTitle,
  notFoundMessage,
  children,
}) => {
  if (error) {
    if (error.isPermissionDenied) {
      return (
        <PermissionDeniedState message={error.message} requiredCapability="module.read" />
      );
    }
    if (error.status === 404) {
      return (
        <section className="cs-erp5-forbidden" role="region" aria-label={notFoundTitle}>
          <h2 className="cs-erp5-forbidden-title">{notFoundTitle}</h2>
          <p className="cs-erp5-forbidden-text">{notFoundMessage}</p>
        </section>
      );
    }
    return (
      <ErrorState
        title="The record could not be loaded"
        message={error.message}
        onRetry={onRetry}
        retryLabel="Try again"
      />
    );
  }

  if (isLoading) {
    return (
      <p className="cs-erp5-loading" role="status" aria-busy="true">
        Loading…
      </p>
    );
  }

  return <>{children}</>;
};

export default RecordStateBoundary;
