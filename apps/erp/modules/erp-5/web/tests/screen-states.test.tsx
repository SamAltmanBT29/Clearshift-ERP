// @vitest-environment jsdom
/**
 * ERP-5 HR & Employees — Screen State Tests
 *
 * The states of the screens that show **one** record and the states of a
 * collection that has no rows. They are the difference between "the screen
 * is broken" and "the screen is telling the truth", so each one has its own
 * presentation and its own test.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { HrApiError } from '../src/api/erp-5.js';
import { ListStateBoundary } from '../src/components/ListStateBoundary.js';
import { PermissionDeniedState } from '../src/components/PermissionDeniedState.js';
import { RecordStateBoundary } from '../src/components/RecordStateBoundary.js';

describe('ERP-5 screen states', () => {
  describe('1. A screen that shows one record', () => {
    it('announces that it is loading', () => {
      render(
        <RecordStateBoundary
          isLoading
          error={null}
          onRetry={() => undefined}
          notFoundTitle="Employee not found"
          notFoundMessage="This employee does not exist."
        >
          <p>the record</p>
        </RecordStateBoundary>
      );

      const status = screen.getByRole('status');
      expect(status.getAttribute('aria-busy')).toBe('true');
      expect(screen.queryByText('the record')).toBeNull();
    });

    it('shows the record when it could be read', () => {
      render(
        <RecordStateBoundary
          isLoading={false}
          error={null}
          onRetry={() => undefined}
          notFoundTitle="Employee not found"
          notFoundMessage="This employee does not exist."
        >
          <p>the record</p>
        </RecordStateBoundary>
      );

      expect(screen.getByText('the record')).toBeDefined();
    });

    it('shows a not-found view for a record that does not exist', () => {
      render(
        <RecordStateBoundary
          isLoading={false}
          error={new HrApiError(404, 'NOT_FOUND', 'The requested record does not exist.')}
          onRetry={() => undefined}
          notFoundTitle="Employee not found"
          notFoundMessage="This employee does not exist, or it was removed."
        >
          <p>the record</p>
        </RecordStateBoundary>
      );

      expect(screen.getByText('Employee not found')).toBeDefined();
      expect(screen.getByText('This employee does not exist, or it was removed.')).toBeDefined();
      expect(screen.queryByText('the record')).toBeNull();
    });

    it('shows an access-denied view for a refused request', () => {
      render(
        <RecordStateBoundary
          isLoading={false}
          error={new HrApiError(403, 'FORBIDDEN', 'Access denied.')}
          onRetry={() => undefined}
          notFoundTitle="Employee not found"
          notFoundMessage="This employee does not exist."
        >
          <p>the record</p>
        </RecordStateBoundary>
      );

      expect(screen.getByText('Access denied')).toBeDefined();
      // A refused request offers no retry — it is not something a retry fixes.
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('offers a retry for a failure that a retry can fix', async () => {
      const onRetry = vi.fn();
      render(
        <RecordStateBoundary
          isLoading={false}
          error={new HrApiError(500, 'INTERNAL_SERVER_ERROR', 'The record could not be read.')}
          onRetry={onRetry}
          notFoundTitle="Employee not found"
          notFoundMessage="This employee does not exist."
        >
          <p>the record</p>
        </RecordStateBoundary>
      );

      expect(screen.getByRole('alert')).toBeDefined();
      screen.getByRole('button', { name: 'Try again' }).click();
      await waitFor(() => expect(onRetry).toHaveBeenCalled());
    });
  });

  describe('2. A collection with no rows', () => {
    it('shows the empty state', () => {
      render(
        <ListStateBoundary
          isLoading={false}
          error={null}
          isEmpty
          onRetry={() => undefined}
          errorTitle="Unable to load"
          emptyTitle="No employees found"
          emptyMessage="No employee matches the current search."
        >
          <p>the rows</p>
        </ListStateBoundary>
      );

      expect(screen.getByText('No employees found')).toBeDefined();
      expect(screen.queryByText('the rows')).toBeNull();
    });

    it('offers a way out of the empty state', () => {
      const onEmptyAction = vi.fn();
      render(
        <ListStateBoundary
          isLoading={false}
          error={null}
          isEmpty
          onRetry={() => undefined}
          errorTitle="Unable to load"
          emptyTitle="No employees found"
          emptyMessage="No employee matches the current search."
          emptyActionLabel="Clear filters"
          onEmptyAction={onEmptyAction}
        >
          <p>the rows</p>
        </ListStateBoundary>
      );

      screen.getByRole('button', { name: 'Clear filters' }).click();
      expect(onEmptyAction).toHaveBeenCalled();
    });

    it('shows the rows when the collection has some', () => {
      render(
        <ListStateBoundary
          isLoading={false}
          error={null}
          isEmpty={false}
          onRetry={() => undefined}
          errorTitle="Unable to load"
          emptyTitle="No employees found"
          emptyMessage="No employee matches the current search."
        >
          <p>the rows</p>
        </ListStateBoundary>
      );

      expect(screen.getByText('the rows')).toBeDefined();
    });

    it('shows a skeleton while the collection is coming', () => {
      render(
        <ListStateBoundary
          isLoading
          error={null}
          isEmpty={false}
          onRetry={() => undefined}
          errorTitle="Unable to load"
          emptyTitle="No employees found"
          emptyMessage="No employee matches the current search."
        >
          <p>the rows</p>
        </ListStateBoundary>
      );

      expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    });
  });

  describe('3. The access-denied view', () => {
    it('names the permission the screen needs', () => {
      render(<PermissionDeniedState requiredCapability="module.read" />);

      expect(screen.getByText('Access denied')).toBeDefined();
      expect(screen.getByText('module.read')).toBeDefined();
    });

    it('falls back to a plain sentence when it names no permission', () => {
      render(<PermissionDeniedState />);

      expect(screen.getByText('Access denied')).toBeDefined();
      expect(
        screen.getByText(/Your role does not allow this screen/)
      ).toBeDefined();
    });
  });
});
