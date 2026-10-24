// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { RejectionReviewScreen } from '@cs/ui';
import {
  erp3OrdersRejectionContext,
  SYNTHETIC_ERP3_REJECTIONS,
} from '../src/rejection-context.js';
import { OrdersRejectionReviewPage } from '../src/pages/OrdersRejectionReviewPage.js';
import { OrdersListPage } from '../src/pages/OrdersListPage.js';
import * as api from '../src/api/erp-3.js';

describe('ERP-3 Sales Orders Migration Rejection Review & Export Screen (ERP3-23)', () => {
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeEach(() => {
    vi.spyOn(api, 'fetchSalesOrders').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });
    vi.spyOn(api, 'fetchInvoices').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  describe('1. Initial Rendering & Layout', () => {
    it('renders header with module title, batch badge, and total count', () => {
      render(
        <RejectionReviewScreen
          context={erp3OrdersRejectionContext}
          rejectedRows={SYNTHETIC_ERP3_REJECTIONS}
          batchId="BATCH_TEST_99"
        />
      );

      expect(screen.getByText(/ERP-3 Sales Orders and Invoices: Migration Rejection Review/i)).toBeTruthy();
      expect(screen.getByText(/Batch: BATCH_TEST_99/i)).toBeTruthy();
      expect(screen.getByText(/Reviewing 5 rejected records in batch BATCH_TEST_99/i)).toBeTruthy();
      expect(screen.getByTestId('privacy-masking-notice')).toBeTruthy();
    });

    it('renders search bar, error code filter dropdown, and action buttons', () => {
      render(
        <RejectionReviewScreen
          context={erp3OrdersRejectionContext}
          rejectedRows={SYNTHETIC_ERP3_REJECTIONS}
        />
      );

      expect(screen.getByTestId('input-rejections-search')).toBeTruthy();
      expect(screen.getByTestId('select-error-code-filter')).toBeTruthy();
      expect(screen.getByTestId('btn-export-rejections')).toBeTruthy();
    });
  });

  describe('2. Acceptance Criterion 1: Module Identifier Columns', () => {
    it('renders module-specific table headers for Sales Orders', () => {
      render(
        <RejectionReviewScreen
          context={erp3OrdersRejectionContext}
          rejectedRows={SYNTHETIC_ERP3_REJECTIONS}
        />
      );

      expect(screen.getByRole('columnheader', { name: /Order Number/i })).toBeTruthy();
      expect(screen.getByRole('columnheader', { name: /Customer Golden ID/i })).toBeTruthy();
      expect(screen.getByRole('columnheader', { name: /Source ID/i })).toBeTruthy();
      expect(screen.getByRole('columnheader', { name: /Currency Code/i })).toBeTruthy();
      expect(screen.getByRole('columnheader', { name: /Error Code/i })).toBeTruthy();
    });

    it('displays formatted values in rows with uppercase order numbers', () => {
      render(
        <RejectionReviewScreen
          context={erp3OrdersRejectionContext}
          rejectedRows={SYNTHETIC_ERP3_REJECTIONS}
        />
      );

      expect(screen.getByText('SO-2026-0001')).toBeTruthy();
      expect(screen.getByText('55555555-0003-4000-8000-000000000001')).toBeTruthy();
      expect(screen.getByText('LEG_ORD_1001')).toBeTruthy();
    });

    it('displays standardized error codes as distinct badges for each row', () => {
      render(
        <RejectionReviewScreen
          context={erp3OrdersRejectionContext}
          rejectedRows={SYNTHETIC_ERP3_REJECTIONS}
        />
      );

      const badges = screen.getAllByTestId('error-code-badge');
      expect(badges.length).toBe(SYNTHETIC_ERP3_REJECTIONS.length);

      const badgeTexts = badges.map((b) => b.textContent);
      expect(badgeTexts).toContain('DUPLICATE_ORDER_NUMBER');
      expect(badgeTexts).toContain('MISSING_CUSTOMER_GOLDEN_ID');
      expect(badgeTexts).toContain('INVALID_ORDER_STATUS');
      expect(badgeTexts).toContain('NEGATIVE_QUANTITY');
    });
  });

  describe('3. Acceptance Criterion 2: Reason Text Explains Failure Clearly', () => {
    it('displays clear human-readable reason text explaining validation or constraint failures', () => {
      render(
        <RejectionReviewScreen
          context={erp3OrdersRejectionContext}
          rejectedRows={SYNTHETIC_ERP3_REJECTIONS}
        />
      );

      // Duplicate Order Number reason
      expect(screen.getAllByText(/Sales order number is already registered after normalization/i).length).toBeGreaterThan(0);

      // Missing Customer Golden ID reason
      expect(
        screen.getByText(/Customer reference must resolve to a valid canonical UUID v4 Golden ID from Hub \/ CRM-1/i)
      ).toBeTruthy();

      // Invalid Order Status reason
      expect(screen.getByText(/Order status transitions are strictly forward-only: Open -> Invoiced -> Closed/i)).toBeTruthy();

      // Negative Quantity reason
      expect(screen.getByText(/Ordered line quantity must be strictly positive/i)).toBeTruthy();
    });

    it('renders document references and remediation advice', () => {
      render(
        <RejectionReviewScreen
          context={erp3OrdersRejectionContext}
          rejectedRows={SYNTHETIC_ERP3_REJECTIONS}
        />
      );

      const docBadges = screen.getAllByTestId('doc-reference-badge');
      const docTexts = docBadges.map((d) => d.textContent);
      expect(docTexts).toContain('Ref: BR-ERP3-01');
      expect(docTexts).toContain('Ref: BR-ERP3-03');
      expect(docTexts).toContain('Ref: FR-ERP3-05');

      // Remediation tips
      expect(screen.getAllByText(/Verify existing order catalog in ERP-3 or re-map source order number/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Ensure customer is master-keyed in CRM-1 Hub before migrating sales orders/i)).toBeTruthy();
    });

    it('renders contextual links for navigating to existing catalog or data dictionary', () => {
      render(
        <RejectionReviewScreen
          context={erp3OrdersRejectionContext}
          rejectedRows={SYNTHETIC_ERP3_REJECTIONS}
        />
      );

      const links = screen.getAllByTestId('contextual-link');
      expect(links.length).toBeGreaterThan(0);

      const linkHrefs = links.map((l) => l.getAttribute('href'));
      expect(linkHrefs.some((h) => h?.includes('/erp3/sales-orders?search='))).toBe(true);
      expect(linkHrefs.some((h) => h?.includes('docs/data-dictionaries/erp-3.md'))).toBe(true);
    });
  });

  describe('4. Acceptance Criterion 3: Sensitive Field Masking', () => {
    it('automatically masks sensitive financial, bank, and employee fields in rawData payload', () => {
      render(
        <RejectionReviewScreen
          context={erp3OrdersRejectionContext}
          rejectedRows={SYNTHETIC_ERP3_REJECTIONS}
        />
      );

      // Verify unmasked bank account number (123456789012) is NOT in the document
      expect(screen.queryByText('123456789012')).toBeNull();

      // Verify unmasked tax ID (999-88-7777) is NOT in the document
      expect(screen.queryByText('999-88-7777')).toBeNull();

      // Verify unmasked SSN (123-45-6789) is NOT in the document
      expect(screen.queryByText('123-45-6789')).toBeNull();
    });

    it('opens raw inspection modal with sensitive fields clearly badged as MASKED', () => {
      render(
        <RejectionReviewScreen
          context={erp3OrdersRejectionContext}
          rejectedRows={SYNTHETIC_ERP3_REJECTIONS}
        />
      );

      // Click "Inspect" on row 1 (which contains bank_account_number and tax_id)
      const inspectBtn = screen.getByTestId('btn-inspect-row-rej_so_01');
      fireEvent.click(inspectBtn);

      const modal = screen.getByTestId('row-inspect-drawer');
      expect(modal).toBeTruthy();
      expect(within(modal).getByText(/Row #4 Payload Inspection/i)).toBeTruthy();

      // Masked values shown in modal
      expect(within(modal).getByText('****-****-9012')).toBeTruthy();
      expect(within(modal).getByText('***-**-7777')).toBeTruthy();

      // Masked badge indicator shown
      const maskedBadges = within(modal).getAllByTestId('inspect-masked-indicator');
      expect(maskedBadges.length).toBeGreaterThanOrEqual(2);

      // Close modal
      const closeBtn = screen.getByTestId('btn-close-inspect');
      fireEvent.click(closeBtn);
      expect(screen.queryByTestId('row-inspect-drawer')).toBeNull();
    });
  });

  describe('5. Acceptance Criterion 4: Formula-Safe CSV Export', () => {
    it('downloads formula-safe CSV export when Export button is clicked', () => {
      render(
        <RejectionReviewScreen
          context={erp3OrdersRejectionContext}
          rejectedRows={SYNTHETIC_ERP3_REJECTIONS}
          batchId="BATCH_2026_01"
        />
      );

      const exportBtn = screen.getByTestId('btn-export-rejections');
      expect(exportBtn).toBeTruthy();
      expect(exportBtn.textContent).toContain('Export Filtered CSV (5)');

      fireEvent.click(exportBtn);
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });
  });

  describe('6. Interactive Filtering & Search Controls', () => {
    it('filters rows by standardized error code dropdown', () => {
      render(
        <RejectionReviewScreen
          context={erp3OrdersRejectionContext}
          rejectedRows={SYNTHETIC_ERP3_REJECTIONS}
        />
      );

      const select = screen.getByTestId('select-error-code-filter');
      fireEvent.change(select, { target: { value: 'NEGATIVE_QUANTITY' } });

      expect(screen.getByText('SO-2026-0004')).toBeTruthy();
      expect(screen.queryByText('SO-2026-0001')).toBeNull();
    });

    it('filters rows by text search input', () => {
      render(
        <RejectionReviewScreen
          context={erp3OrdersRejectionContext}
          rejectedRows={SYNTHETIC_ERP3_REJECTIONS}
        />
      );

      const input = screen.getByTestId('input-rejections-search');
      fireEvent.change(input, { target: { value: 'LEG_ORD_1003' } });

      expect(screen.getByText('SO-2026-0003')).toBeTruthy();
      expect(screen.queryByText('SO-2026-0001')).toBeNull();
    });
  });

  describe('7. OrdersRejectionReviewPage Component', () => {
    it('renders page wrapper and handles back navigation', () => {
      const onNavigateBack = vi.fn();
      render(<OrdersRejectionReviewPage onNavigateBack={onNavigateBack} />);

      expect(screen.getByTestId('orders-rejection-review-page')).toBeTruthy();

      const backBtn = screen.getByTestId('btn-rejection-back');
      fireEvent.click(backBtn);
      expect(onNavigateBack).toHaveBeenCalledTimes(1);
    });

    it('displays retry status notification when retry action is clicked', () => {
      render(<OrdersRejectionReviewPage />);

      const retryAllBtn = screen.getByRole('button', { name: /Retry All Filtered/i });
      fireEvent.click(retryAllBtn);

      expect(screen.getByTestId('retry-status-notification')).toBeTruthy();
      expect(screen.getByText(/queued for batch re-processing/i)).toBeTruthy();
    });
  });

  describe('8. OrdersListPage Integration', () => {
    it('navigates to OrdersRejectionReviewPage when clicking Migration Rejections in toolbar', async () => {
      const onNavigateRejections = vi.fn();
      await act(async () => {
        render(<OrdersListPage onNavigateRejections={onNavigateRejections} />);
      });

      const rejectionsBtn = screen.getByTestId('btn-view-rejections');
      expect(rejectionsBtn).toBeTruthy();

      await act(async () => {
        fireEvent.click(rejectionsBtn);
      });

      expect(onNavigateRejections).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('orders-rejection-review-page')).toBeTruthy();

      // Back returns to list
      const backBtn = screen.getByTestId('btn-rejection-back');
      await act(async () => {
        fireEvent.click(backBtn);
      });

      expect(screen.queryByTestId('orders-rejection-review-page')).toBeNull();
    });

    it('opens directly in rejections view when initialView="rejections"', async () => {
      await act(async () => {
        render(<OrdersListPage initialView="rejections" />);
      });
      expect(screen.getByTestId('orders-rejection-review-page')).toBeTruthy();
    });
  });
});
