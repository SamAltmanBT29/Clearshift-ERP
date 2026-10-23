/**
 * ERP-5 HR & Employees — List State Boundary
 *
 * One place where the four states of a collection screen are decided, so that
 * every list of the module behaves identically and none of them can be
 * confused with another:
 *
 *   | State              | What the operator sees                       |
 *   |--------------------|----------------------------------------------|
 *   | loading            | a skeleton of the table that is coming      |
 *   | no data            | an empty state with a way out                |
 *   | API failure        | a readable message and a retry action        |
 *   | permission denied  | an access-denied view, never a retry button |
 *
 * The permission-denied state is deliberately **not** an error state: there
 * is nothing to retry, and offering a retry would invite the operator to
 * hammer an endpoint that has already refused them.
 *
 * @module erp5/web/components/ListStateBoundary
 */

import React from 'react';
import { EmptyState, ErrorState, SkeletonTable } from '@cs/ui';
import type { HrApiError } from '../api/erp-5.js';
import { PermissionDeniedState } from './PermissionDeniedState.js';

export interface ListStateBoundaryProps {
  readonly isLoading: boolean;
  readonly error: HrApiError | null;
  readonly isEmpty: boolean;
  /** The retry action of the failure state. */
  readonly onRetry: () => void;
  /** The title of the failure state. */
  readonly errorTitle: string;
  /** The title of the empty state. */
  readonly emptyTitle: string;
  /** The message of the empty state. */
  readonly emptyMessage: string;
  /** The label of the empty-state action, when the screen offers one. */
  readonly emptyActionLabel?: string | undefined;
  /** The action of the empty state, when the screen offers one. */
  readonly onEmptyAction?: (() => void) | undefined;
  readonly skeletonColumns?: number | undefined;
  readonly skeletonRows?: number | undefined;
  readonly children: React.ReactNode;
}

export const ListStateBoundary: React.FC<ListStateBoundaryProps> = ({
  isLoading,
  error,
  isEmpty,
  onRetry,
  errorTitle,
  emptyTitle,
  emptyMessage,
  emptyActionLabel,
  onEmptyAction,
  skeletonColumns,
  skeletonRows,
  children,
}) => {
  if (error) {
    if (error.isPermissionDenied) {
      return (
        <PermissionDeniedState
          message={error.message}
          requiredCapability="module.read"
        />
      );
    }
    return (
      <ErrorState
        title={errorTitle}
        message={error.message}
        onRetry={onRetry}
        retryLabel="Try again"
      />
    );
  }

  if (isLoading) {
    return <SkeletonTable columns={skeletonColumns ?? 6} rows={skeletonRows ?? 6} />;
  }

  if (isEmpty) {
    return (
      <EmptyState
        title={emptyTitle}
        message={emptyMessage}
        {...(emptyActionLabel && onEmptyAction
          ? { actionLabel: emptyActionLabel, onAction: onEmptyAction }
          : {})}
      />
    );
  }

  return <>{children}</>;
};

export default ListStateBoundary;
