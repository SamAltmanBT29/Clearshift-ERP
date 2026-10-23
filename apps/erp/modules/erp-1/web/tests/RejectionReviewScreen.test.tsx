// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { RejectionReviewScreen } from '@cs/ui';
import {
  erp1ProductsRejectionContext,
  SYNTHETIC_ERP1_REJECTIONS,
} from '../src/rejection-context.js';
import { ProductRejectionReviewPage } from '../src/pages/ProductRejectionReviewPage.js';
import { ProductsListPage } from '../src/pages/ProductsListPage.js';

import * as api from '../src/api/erp-1.js';

describe('ERP-1 Products Migration Rejection Review & Export Screen (ERP1-23)', () => {
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeEach(() => {
    vi.spyOn(api, 'fetchCategories').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
      totalPages: 0,
    });
    vi.spyOn(api, 'fetchProducts').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 0,
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
          context={erp1ProductsRejectionContext}
          rejectedRows={SYNTHETIC_ERP1_REJECTIONS}
          batchId="BATCH_TEST_99"
        />
      );

      expect(screen.getByText(/ERP-1 Products and Inventory: Migration Rejection Review/i)).toBeTruthy();
      expect(screen.getByText(/Batch: BATCH_TEST_99/i)).toBeTruthy();
      expect(screen.getByText(/Reviewing 5 rejected records in batch BATCH_TEST_99/i)).toBeTruthy();
      expect(screen.getByTestId('privacy-masking-notice')).toBeTruthy();
    });

    it('renders back navigation button when onBack prop is supplied', () => {
      const handleBack = vi.fn();
      render(
        <RejectionReviewScreen
          context={erp1ProductsRejectionContext}
          rejectedRows={SYNTHETIC_ERP1_REJECTIONS}
          onBack={handleBack}
        />
      );

      const backBtn = screen.getByTestId('btn-back-to-import');
      expect(backBtn).toBeTruthy();
      fireEvent.click(backBtn);
      expect(handleBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. Acceptance Criterion 1: Identifier Columns & Standard Error Codes', () => {
    it('renders module-specific identifier columns: SKU, Product Name, Source ID', () => {
      render(
        <RejectionReviewScreen
          context={erp1ProductsRejectionContext}
          rejectedRows={SYNTHETIC_ERP1_REJECTIONS}
        />
      );

      // Check column header texts
      const table = screen.getByRole('table');
      expect(within(table).getByText('SKU')).toBeTruthy();
      expect(within(table).getByText('Product Name')).toBeTruthy();
      expect(within(table).getByText('Source ID')).toBeTruthy();
      expect(within(table).getByText('Category Code')).toBeTruthy();

      // Check identifier cell values in row 1
      const row1 = screen.getByTestId('rejection-row-rej_p01');
      expect(within(row1).getByTestId('cell-identifier-sku').textContent).toContain('WIDGET-001');
      expect(within(row1).getByTestId('cell-identifier-name').textContent).toContain('Steel Industrial Precision Widget M8');
      expect(within(row1).getByTestId('cell-identifier-sourceId').textContent).toContain('LEGACY_P_1001');
    });

    it('displays standardized error codes as distinct red badges for each row', () => {
      render(
        <RejectionReviewScreen
          context={erp1ProductsRejectionContext}
          rejectedRows={SYNTHETIC_ERP1_REJECTIONS}
        />
      );

      const badges = screen.getAllByTestId('error-code-badge');
      expect(badges.length).toBe(SYNTHETIC_ERP1_REJECTIONS.length);

      const badgeTexts = badges.map((b) => b.textContent);
      expect(badgeTexts).toContain('DUPLICATE_SKU');
      expect(badgeTexts).toContain('INVALID_UNIT_OF_MEASURE');
      expect(badgeTexts).toContain('NEGATIVE_PRICE');
      expect(badgeTexts).toContain('INVALID_TAX_RATE');
    });
  });

  describe('3. Acceptance Criterion 2: Reason Text Explains Failure Clearly', () => {
    it('displays clear human-readable reason text explaining validation or constraint failures', () => {
      render(
        <RejectionReviewScreen
          context={erp1ProductsRejectionContext}
          rejectedRows={SYNTHETIC_ERP1_REJECTIONS}
        />
      );

      // Duplicate SKU reason (present on both rej_p01 and rej_p05)
      expect(screen.getAllByText(/SKU is already registered after normalization/i).length).toBeGreaterThan(0);

      // Invalid Unit of Measure reason
      expect(
        screen.getByText(/Unit of measure must be one of the approved V1 units: pcs, kg, g, litre, metre, box/i)
      ).toBeTruthy();

      // Negative Price reason
      expect(screen.getByText(/Product unit price cannot be negative/i)).toBeTruthy();

      // Invalid Tax Rate reason
      expect(screen.getByText(/Tax rate must be a valid decimal between 0.0000 and 1.0000/i)).toBeTruthy();
    });

    it('renders document references and remediation advice', () => {
      render(
        <RejectionReviewScreen
          context={erp1ProductsRejectionContext}
          rejectedRows={SYNTHETIC_ERP1_REJECTIONS}
        />
      );

      const docBadges = screen.getAllByTestId('doc-reference-badge');
      const docTexts = docBadges.map((d) => d.textContent);
      expect(docTexts).toContain('Ref: BR-ERP1-01');
      expect(docTexts).toContain('Ref: FR-ERP1-04');
      expect(docTexts).toContain('Ref: FR-ERP1-02');

      // Remediation tips
      expect(screen.getAllByText(/Verify existing catalog in ERP-1 or re-map source SKU/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Standardize unit to one of the 6 allowed V1 units/i)).toBeTruthy();
    });

    it('renders contextual links for navigating to existing catalog or data dictionary', () => {
      render(
        <RejectionReviewScreen
          context={erp1ProductsRejectionContext}
          rejectedRows={SYNTHETIC_ERP1_REJECTIONS}
        />
      );

      const links = screen.getAllByTestId('contextual-link');
      expect(links.length).toBeGreaterThan(0);

      const linkHrefs = links.map((l) => l.getAttribute('href'));
      expect(linkHrefs.some((h) => h?.includes('/erp1/products?search='))).toBe(true);
      expect(linkHrefs.some((h) => h?.includes('docs/data-dictionaries/erp-1.md'))).toBe(true);
    });
  });

  describe('4. Acceptance Criterion 3: Sensitive Field Masking', () => {
    it('automatically masks sensitive financial, bank, and employee fields in rawData payload', () => {
      render(
        <RejectionReviewScreen
          context={erp1ProductsRejectionContext}
          rejectedRows={SYNTHETIC_ERP1_REJECTIONS}
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
          context={erp1ProductsRejectionContext}
          rejectedRows={SYNTHETIC_ERP1_REJECTIONS}
        />
      );

      // Click "Inspect" on row 1 (which contains bank_account_number and tax_id)
      const inspectBtn = screen.getByTestId('btn-inspect-row-rej_p01');
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
          context={erp1ProductsRejectionContext}
          rejectedRows={SYNTHETIC_ERP1_REJECTIONS}
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
          context={erp1ProductsRejectionContext}
          rejectedRows={SYNTHETIC_ERP1_REJECTIONS}
        />
      );

      const select = screen.getByTestId('select-error-code-filter');
      fireEvent.change(select, { target: { value: 'NEGATIVE_PRICE' } });

      // Only row with NEGATIVE_PRICE should remain
      expect(screen.getByTestId('rejection-row-rej_p03')).toBeTruthy();
      expect(screen.queryByTestId('rejection-row-rej_p01')).toBeNull();
      expect(screen.queryByTestId('rejection-row-rej_p02')).toBeNull();

      // Clear filters button resets
      const clearBtn = screen.getByTestId('btn-clear-filters');
      fireEvent.click(clearBtn);
      expect(screen.getByTestId('rejection-row-rej_p01')).toBeTruthy();
    });

    it('filters rows by text search query', () => {
      render(
        <RejectionReviewScreen
          context={erp1ProductsRejectionContext}
          rejectedRows={SYNTHETIC_ERP1_REJECTIONS}
        />
      );

      const searchInput = screen.getByTestId('input-rejections-search');
      fireEvent.change(searchInput, { target: { value: 'FLUID-CHEM' } });

      expect(screen.getByTestId('rejection-row-rej_p02')).toBeTruthy();
      expect(screen.queryByTestId('rejection-row-rej_p01')).toBeNull();
    });

    it('displays empty state when search returns no matching records', () => {
      render(
        <RejectionReviewScreen
          context={erp1ProductsRejectionContext}
          rejectedRows={SYNTHETIC_ERP1_REJECTIONS}
        />
      );

      const searchInput = screen.getByTestId('input-rejections-search');
      fireEvent.change(searchInput, { target: { value: 'NONEXISTENT_QUERY_XYZ' } });

      expect(screen.getByTestId('rejections-empty-state')).toBeTruthy();
    });
  });

  describe('7. Dedicated Page and Integration with ProductsListPage', () => {
    it('renders ProductRejectionReviewPage directly with mock data and retry handlers', () => {
      render(<ProductRejectionReviewPage batchId="BATCH_RETRY_TEST" />);

      expect(screen.getByTestId('product-rejection-review-page')).toBeTruthy();
      expect(screen.getByText(/Batch: BATCH_RETRY_TEST/i)).toBeTruthy();

      // Trigger retry on a row
      const retryBtn = screen.getByTestId('btn-retry-row-rej_p01');
      fireEvent.click(retryBtn);

      expect(screen.getByTestId('retry-status-notification')).toBeTruthy();
      expect(screen.getByTestId('retry-status-notification').textContent).toContain('rej_p01 queued');
    });

    it('renders rejections view when ProductsListPage has initialView="rejections"', () => {
      render(<ProductsListPage initialView="rejections" />);

      expect(screen.getByTestId('product-rejection-review-page')).toBeTruthy();
    });

    it('navigates to rejections view when ⚠️ Rejections button is clicked on ProductsListPage', () => {
      render(<ProductsListPage initialView="list" />);

      const rejectionsBtn = screen.getByTestId('btn-rejections-list');
      expect(rejectionsBtn).toBeTruthy();

      fireEvent.click(rejectionsBtn);
      expect(screen.getByTestId('product-rejection-review-page')).toBeTruthy();
    });
  });
});
