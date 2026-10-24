// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { RejectionReviewScreen } from '@cs/ui';
import {
  erp2VendorsRejectionContext,
  SYNTHETIC_ERP2_REJECTIONS,
} from '../src/rejection-context.js';
import { VendorRejectionReviewPage } from '../src/pages/VendorRejectionReviewPage.js';
import { VendorsListPage } from '../src/pages/VendorsListPage.js';
import * as api from '../src/api/erp-2.js';

describe('ERP-2 Vendors & Purchasing Migration Rejection Review & Export Screen (ERP2-23)', () => {
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeEach(() => {
    vi.spyOn(api, 'fetchVendors').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });
    vi.spyOn(api, 'fetchPurchaseOrders').mockResolvedValue({
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

  // ─── 1. Initial Rendering ─────────────────────────────────────────────────

  describe('1. Initial Rendering & Layout', () => {
    it('renders header with module title, batch badge, and total count', () => {
      render(
        <RejectionReviewScreen
          context={erp2VendorsRejectionContext}
          rejectedRows={SYNTHETIC_ERP2_REJECTIONS}
          batchId="BATCH_ERP2_TEST_01"
        />
      );

      expect(
        screen.getByText(/ERP-2 Vendors and Purchasing: Migration Rejection Review/i)
      ).toBeTruthy();
      expect(screen.getByText(/Batch: BATCH_ERP2_TEST_01/i)).toBeTruthy();
      expect(screen.getByText(/Reviewing 5 rejected records in batch BATCH_ERP2_TEST_01/i)).toBeTruthy();
      expect(screen.getByTestId('privacy-masking-notice')).toBeTruthy();
    });

    it('renders search bar, error code filter dropdown, and export button', () => {
      render(
        <RejectionReviewScreen
          context={erp2VendorsRejectionContext}
          rejectedRows={SYNTHETIC_ERP2_REJECTIONS}
        />
      );

      expect(screen.getByTestId('input-rejections-search')).toBeTruthy();
      expect(screen.getByTestId('select-error-code-filter')).toBeTruthy();
      expect(screen.getByTestId('btn-export-rejections')).toBeTruthy();
    });
  });

  // ─── 2. AC1: Module Identifier Columns ───────────────────────────────────

  describe('2. Acceptance Criterion 1: Module Identifier Columns', () => {
    it('renders ERP-2 module-specific table headers: Tax Number, Vendor Name, Source ID, Currency', () => {
      render(
        <RejectionReviewScreen
          context={erp2VendorsRejectionContext}
          rejectedRows={SYNTHETIC_ERP2_REJECTIONS}
        />
      );

      expect(screen.getByRole('columnheader', { name: /Tax Number/i })).toBeTruthy();
      expect(screen.getByRole('columnheader', { name: /Vendor Name/i })).toBeTruthy();
      expect(screen.getByRole('columnheader', { name: /Source ID/i })).toBeTruthy();
      expect(screen.getByRole('columnheader', { name: /Currency/i })).toBeTruthy();
      expect(screen.getByRole('columnheader', { name: /Error Code/i })).toBeTruthy();
    });

    it('displays normalized uppercase tax numbers from synthetic fixtures', () => {
      render(
        <RejectionReviewScreen
          context={erp2VendorsRejectionContext}
          rejectedRows={SYNTHETIC_ERP2_REJECTIONS}
        />
      );

      // TAX-ACME-9901 is vendor row 1 (source row 5)
      expect(screen.getByText('TAX-ACME-9901')).toBeTruthy();
      // VEND-8821 is source_id
      expect(screen.getByText('VEND-8821')).toBeTruthy();
    });

    it('displays standardized error code badges for each rejected row', () => {
      render(
        <RejectionReviewScreen
          context={erp2VendorsRejectionContext}
          rejectedRows={SYNTHETIC_ERP2_REJECTIONS}
        />
      );

      const badges = screen.getAllByTestId('error-code-badge');
      expect(badges.length).toBe(SYNTHETIC_ERP2_REJECTIONS.length);

      const badgeTexts = badges.map((b) => b.textContent);
      expect(badgeTexts).toContain('DUPLICATE_TAX_NUMBER');
      expect(badgeTexts).toContain('MISSING_REQUIRED_FIELD');
      expect(badgeTexts).toContain('INVALID_PO_STATUS');
      expect(badgeTexts).toContain('NEGATIVE_QUANTITY');
      expect(badgeTexts).toContain('DUPLICATE_PO_NUMBER');
    });
  });

  // ─── 3. AC2: Reason Text Explains Failure ─────────────────────────────────

  describe('3. Acceptance Criterion 2: Reason Text Explains Failure Clearly', () => {
    it('displays human-readable reason text for duplicate tax number violation (BR-ERP2-01)', () => {
      render(
        <RejectionReviewScreen
          context={erp2VendorsRejectionContext}
          rejectedRows={SYNTHETIC_ERP2_REJECTIONS}
        />
      );

      // Human-readable reason text from erp2FailureExplanations
      expect(
        screen.getAllByText(/Tax number is already registered after uppercase alphanumeric normalization/i)
          .length
      ).toBeGreaterThan(0);
    });

    it('displays human-readable reason text for invalid PO status lifecycle violation', () => {
      render(
        <RejectionReviewScreen
          context={erp2VendorsRejectionContext}
          rejectedRows={SYNTHETIC_ERP2_REJECTIONS}
        />
      );

      expect(
        screen.getByText(
          /PO status transitions are strictly unidirectional: Draft -> Sent -> Received -> Closed/i
        )
      ).toBeTruthy();
    });

    it('renders doc reference badges for vendor context rules', () => {
      render(
        <RejectionReviewScreen
          context={erp2VendorsRejectionContext}
          rejectedRows={SYNTHETIC_ERP2_REJECTIONS}
        />
      );

      const docBadges = screen.getAllByTestId('doc-reference-badge');
      const docTexts = docBadges.map((d) => d.textContent);
      expect(docTexts.some((t) => t?.includes('BR-ERP2-01'))).toBe(true);
    });

    it('renders contextual search links for navigating to vendor catalog', () => {
      render(
        <RejectionReviewScreen
          context={erp2VendorsRejectionContext}
          rejectedRows={SYNTHETIC_ERP2_REJECTIONS}
        />
      );

      const links = screen.getAllByTestId('contextual-link');
      expect(links.length).toBeGreaterThan(0);

      const linkHrefs = links.map((l) => l.getAttribute('href'));
      expect(linkHrefs.some((h) => h?.includes('/erp2/vendors?search='))).toBe(true);
      expect(linkHrefs.some((h) => h?.includes('docs/data-dictionaries/erp-2.md'))).toBe(true);
    });
  });

  // ─── 4. AC3: Sensitive Field Masking ─────────────────────────────────────

  describe('4. Acceptance Criterion 3: Sensitive Field Masking', () => {
    it('does not expose raw bank account number in review table (AC3)', () => {
      render(
        <RejectionReviewScreen
          context={erp2VendorsRejectionContext}
          rejectedRows={SYNTHETIC_ERP2_REJECTIONS}
        />
      );

      // Synthetic fixture row 1 contains bank_account: '123456789012'
      expect(screen.queryByText('123456789012')).toBeNull();
    });

    it('does not expose raw tax_id or salary in review table (AC3)', () => {
      render(
        <RejectionReviewScreen
          context={erp2VendorsRejectionContext}
          rejectedRows={SYNTHETIC_ERP2_REJECTIONS}
        />
      );

      // Synthetic fixture row 1 contains tax_id: '999-88-7777', salary: 95000
      expect(screen.queryByText('999-88-7777')).toBeNull();
      expect(screen.queryByText('95000')).toBeNull();
    });

    it('does not expose IBAN in review table (AC3)', () => {
      render(
        <RejectionReviewScreen
          context={erp2VendorsRejectionContext}
          rejectedRows={SYNTHETIC_ERP2_REJECTIONS}
        />
      );

      // Synthetic fixture row 2 contains iban: 'DE89370400440532013000'
      expect(screen.queryByText('DE89370400440532013000')).toBeNull();
    });

    it('opens raw inspection modal with sensitive fields marked as MASKED', () => {
      render(
        <RejectionReviewScreen
          context={erp2VendorsRejectionContext}
          rejectedRows={SYNTHETIC_ERP2_REJECTIONS}
        />
      );

      // Click Inspect on the first row (rej_v01 — contains bank_account and tax_id)
      const inspectBtn = screen.getByTestId('btn-inspect-row-rej_v01');
      fireEvent.click(inspectBtn);

      const modal = screen.getByTestId('row-inspect-drawer');
      expect(modal).toBeTruthy();

      // Bank account must be masked, not raw
      expect(within(modal).queryByText('123456789012')).toBeNull();
      // Masked indicator badges must be present
      const maskedBadges = within(modal).getAllByTestId('inspect-masked-indicator');
      expect(maskedBadges.length).toBeGreaterThanOrEqual(1);

      // Close modal
      const closeBtn = screen.getByTestId('btn-close-inspect');
      fireEvent.click(closeBtn);
      expect(screen.queryByTestId('row-inspect-drawer')).toBeNull();
    });

    it('does not expose SSN (123-45-6789) from PO injection row (AC3)', () => {
      render(
        <RejectionReviewScreen
          context={erp2VendorsRejectionContext}
          rejectedRows={SYNTHETIC_ERP2_REJECTIONS}
        />
      );

      // Synthetic fixture rej_po02 contains ssn: '123-45-6789'
      expect(screen.queryByText('123-45-6789')).toBeNull();
    });
  });

  // ─── 5. AC4: Formula-Safe CSV Export ──────────────────────────────────────

  describe('5. Acceptance Criterion 4: Formula-Safe CSV Export', () => {
    it('downloads formula-safe CSV export when Export button is clicked', () => {
      render(
        <RejectionReviewScreen
          context={erp2VendorsRejectionContext}
          rejectedRows={SYNTHETIC_ERP2_REJECTIONS}
          batchId="BATCH_ERP2_2026_01"
        />
      );

      const exportBtn = screen.getByTestId('btn-export-rejections');
      expect(exportBtn).toBeTruthy();
      expect(exportBtn.textContent).toContain('Export Filtered CSV (5)');

      fireEvent.click(exportBtn);
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });

    it('export count updates when filter reduces visible rows', () => {
      render(
        <RejectionReviewScreen
          context={erp2VendorsRejectionContext}
          rejectedRows={SYNTHETIC_ERP2_REJECTIONS}
        />
      );

      const select = screen.getByTestId('select-error-code-filter');
      fireEvent.change(select, { target: { value: 'DUPLICATE_TAX_NUMBER' } });

      const exportBtn = screen.getByTestId('btn-export-rejections');
      expect(exportBtn.textContent).toContain('Export Filtered CSV (1)');
    });
  });

  // ─── 6. Interactive Filtering & Search ───────────────────────────────────

  describe('6. Interactive Filtering & Search Controls', () => {
    it('filters rows by standardized error code dropdown', () => {
      render(
        <RejectionReviewScreen
          context={erp2VendorsRejectionContext}
          rejectedRows={SYNTHETIC_ERP2_REJECTIONS}
        />
      );

      const select = screen.getByTestId('select-error-code-filter');
      fireEvent.change(select, { target: { value: 'NEGATIVE_QUANTITY' } });

      // NEGATIVE_QUANTITY is rej_po02
      expect(screen.queryByText('TAX-ACME-9901')).toBeNull();
    });

    it('filters rows by text search on vendor name', () => {
      render(
        <RejectionReviewScreen
          context={erp2VendorsRejectionContext}
          rejectedRows={SYNTHETIC_ERP2_REJECTIONS}
        />
      );

      const input = screen.getByTestId('input-rejections-search');
      fireEvent.change(input, { target: { value: 'Globex' } });

      expect(screen.getByText('Globex Components GmbH')).toBeTruthy();
      expect(screen.queryByText('Acme Industrial Supplies Ltd')).toBeNull();
    });
  });

  // ─── 7. VendorRejectionReviewPage Component ──────────────────────────────

  describe('7. VendorRejectionReviewPage Component', () => {
    it('renders page wrapper with data-testid vendor-rejection-review-page', () => {
      render(<VendorRejectionReviewPage />);
      expect(screen.getByTestId('vendor-rejection-review-page')).toBeTruthy();
    });

    it('renders back navigation button when onNavigateBack is provided', () => {
      const onNavigateBack = vi.fn();
      render(<VendorRejectionReviewPage onNavigateBack={onNavigateBack} />);

      const backBtn = screen.getByTestId('btn-rejection-back');
      expect(backBtn).toBeTruthy();

      fireEvent.click(backBtn);
      expect(onNavigateBack).toHaveBeenCalledTimes(1);
    });

    it('does not render back button when onNavigateBack is not provided', () => {
      render(<VendorRejectionReviewPage />);
      expect(screen.queryByTestId('btn-rejection-back')).toBeNull();
    });

    it('accepts custom batchId prop passed through to RejectionReviewScreen', () => {
      render(
        <VendorRejectionReviewPage batchId="BATCH_ERP2_CUSTOM_99" />
      );
      expect(screen.getAllByText(/BATCH_ERP2_CUSTOM_99/i).length).toBeGreaterThan(0);
    });

    it('displays retry status notification when Retry All is clicked', () => {
      render(<VendorRejectionReviewPage />);

      const retryAllBtn = screen.getByRole('button', { name: /Retry All Filtered/i });
      fireEvent.click(retryAllBtn);

      expect(screen.getByTestId('retry-status-notification')).toBeTruthy();
      expect(screen.getByText(/queued for batch re-processing/i)).toBeTruthy();
    });
  });

  // ─── 8. VendorsListPage Integration ──────────────────────────────────────

  describe('8. VendorsListPage Integration', () => {
    it('renders btn-view-rejections button in page header toolbar', async () => {
      await act(async () => {
        render(<VendorsListPage />);
      });

      const rejectionsBtn = screen.getByTestId('btn-view-rejections');
      expect(rejectionsBtn).toBeTruthy();
      expect(rejectionsBtn.textContent?.trim()).toBe('View Rejections');
    });

    it('calls onNavigateRejections callback when btn-view-rejections is clicked', async () => {
      const onNavigateRejections = vi.fn();
      await act(async () => {
        render(<VendorsListPage onNavigateRejections={onNavigateRejections} />);
      });

      const rejectionsBtn = screen.getByTestId('btn-view-rejections');
      await act(async () => {
        fireEvent.click(rejectionsBtn);
      });

      expect(onNavigateRejections).toHaveBeenCalledTimes(1);
    });

    it('renders btn-import-data and btn-view-rejections side by side in same toolbar', async () => {
      await act(async () => {
        render(<VendorsListPage />);
      });

      expect(screen.getByTestId('btn-view-rejections')).toBeTruthy();
      expect(screen.getByTestId('btn-import-data')).toBeTruthy();
    });
  });
});
