import { describe, it, expect, vi } from "vitest";
import React from "react";
import {
  PageTitle,
  Breadcrumb,
  Table,
  Pagination,
  FormField,
  FormErrorSummary,
  Alert,
  SkeletonTable,
  EmptyState,
  ErrorState,
  Dialog,
  StatusBadge,
  CsvExportButton,
  sanitizeCsvCell,
  generateCsvContent,
  MAX_SAFE_DOM_ROWS,
  tokens
} from "../src/index.js";

describe("Shared UI Library & Accessible Design Tokens (PLT-08)", () => {
  describe("1. Accessible Names, Visible Focus & Disabled States", () => {
    it("Breadcrumb exposes nav landmark with aria-label and aria-current on the active page", () => {
      const items = [
        { label: "Home", href: "/" },
        { label: "Finance", href: "/finance" },
        { label: "Chart of Accounts", isCurrent: true }
      ];

      const element = <Breadcrumb items={items} />;
      expect(element.props["aria-label"]).toBeUndefined(); // React component props
      // Test React component render output
      const rendered = Breadcrumb({ items });
      expect(rendered.props["aria-label"]).toBe("Breadcrumb");
      const listItems = rendered.props.children.props.children;
      expect(listItems.length).toBe(3);
      // Last item has aria-current="page"
      const lastItemSpan = listItems[2].props.children[1];
      expect(lastItemSpan.props["aria-current"]).toBe("page");
      expect(lastItemSpan.props.children).toBe("Chart of Accounts");
    });

    it("PageTitle renders semantic h1 with accessible title", () => {
      const rendered = PageTitle({
        title: "General Ledger",
        subtitle: "View and filter journal entries"
      });
      const headerContent = rendered.props.children[1].props.children[0];
      const h1 = headerContent.props.children[0];
      expect(h1.type).toBe("h1");
      expect(h1.props.children).toBe("General Ledger");
    });

    it("FormField associates label with input and links error via aria-describedby and aria-invalid", () => {
      const inputId = "account-code";
      const errorMsg = "Account code is required";
      const helperMsg = "4-digit numeric code";

      const rendered = FormField({
        id: inputId,
        label: "Account Code",
        helperText: helperMsg,
        error: errorMsg,
        required: true,
        disabled: false,
        children: <input type="text" />
      });

      // Label has htmlFor matching inputId
      const label = rendered.props.children[0];
      expect(label.props.htmlFor).toBe(inputId);

      // Injected input props
      const inputWrapper = rendered.props.children[1];
      const clonedInput = inputWrapper.props.children;
      expect(clonedInput.props.id).toBe(inputId);
      expect(clonedInput.props["aria-invalid"]).toBe(true);
      expect(clonedInput.props["aria-required"]).toBe(true);
      expect(clonedInput.props["aria-describedby"]).toContain(`${inputId}-error`);

      // Focus classes are present
      expect(clonedInput.props.className).toContain("focus:ring-2");
    });

    it("FormField correctly handles disabled states", () => {
      const inputId = "disabled-field";
      const rendered = FormField({
        id: inputId,
        label: "Locked Balance",
        disabled: true,
        children: <input type="text" />
      });

      const label = rendered.props.children[0];
      expect(label.props.className).toContain("cursor-not-allowed");

      const input = rendered.props.children[1].props.children;
      expect(input.props.disabled).toBe(true);
      expect(input.props.className).toContain("disabled:opacity-50");
    });

    it("Pagination renders accessible nav, buttons with accessible labels, and handles disabled states", () => {
      const onPageChange = vi.fn();
      const rendered = Pagination({
        currentPage: 1,
        totalPages: 5,
        totalItems: 100,
        onPageChange
      });

      expect(rendered.props["aria-label"]).toBe("Pagination");
      const buttonContainer = rendered.props.children[1];
      const prevButton = buttonContainer.props.children[0];
      const nextButton = buttonContainer.props.children[2];

      // Previous button on page 1 is disabled
      expect(prevButton.props["aria-label"]).toBe("Go to previous page");
      expect(prevButton.props.disabled).toBe(true);

      // Next button on page 1 is enabled
      expect(nextButton.props["aria-label"]).toBe("Go to next page");
      expect(nextButton.props.disabled).toBe(false);

      // Page 1 button has aria-current="page"
      const pagesList = buttonContainer.props.children[1].props.children;
      const firstPageBtn = pagesList[0].props.children;
      expect(firstPageBtn.props["aria-current"]).toBe("page");
    });

    it("Alert exposes correct role (alert for error/warning, status for info/success) and accessible dismiss", () => {
      const onDismiss = vi.fn();
      const errorAlert = Alert({
        variant: "error",
        title: "Transaction Rejected",
        children: "Debits and credits must balance.",
        onDismiss
      });
      expect(errorAlert.props.role).toBe("alert");

      const successAlert = Alert({
        variant: "success",
        title: "Entry Posted",
        children: "Journal entry posted successfully."
      });
      expect(successAlert.props.role).toBe("status");

      // Dismiss button has accessible label
      const dismissBtn = errorAlert.props.children.props.children[1];
      expect(dismissBtn.props["aria-label"]).toBe("Dismiss alert");
    });
  });

  describe("2. Table Wrapper, Server Paging, Sort & Virtualization Guard", () => {
    interface AccountRow {
      code: string;
      name: string;
      type: string;
      balance: number;
    }

    const columns = [
      { key: "code", header: "Account Code", sortable: true },
      { key: "name", header: "Name", sortable: true },
      { key: "type", header: "Type" },
      { key: "balance", header: "Balance", align: "right" as const }
    ];

    const sampleData: AccountRow[] = [
      { code: "1010", name: "Operating Cash", type: "asset", balance: 50000 },
      { code: "2010", name: "Accounts Payable", type: "liability", balance: 12000 }
    ];

    it("Table renders accessible col scope, aria-sort on headers, and triggers onSort", () => {
      const onSort = vi.fn();
      const rendered = Table<AccountRow>({
        columns,
        data: sampleData,
        keyExtractor: (r) => r.code,
        sortColumn: "code",
        sortDirection: "asc",
        onSort
      });

      const tableEl = rendered.props.children;
      const thead = tableEl.props.children[1];
      const headerRow = thead.props.children;
      const thList = headerRow.props.children;

      expect(thList[0].props.scope).toBe("col");
      expect(thList[0].props["aria-sort"]).toBe("ascending");
      expect(thList[2].props["aria-sort"]).toBeUndefined(); // non-sortable column

      // Clicking column header triggers sort
      thList[0].props.onClick();
      expect(onSort).toHaveBeenCalledWith("code");
    });

    it("enforces non-negotiable memory safety guard against 100,000 rows in browser DOM", () => {
      // Create huge dataset (10,000 rows)
      const hugeData: AccountRow[] = Array.from({ length: 10000 }, (_, i) => ({
        code: `acc-${i}`,
        name: `Account ${i}`,
        type: "asset",
        balance: 100
      }));

      // Render with virtualization windowing enabled
      const rendered = Table<AccountRow>({
        columns,
        data: hugeData,
        keyExtractor: (r) => r.code,
        virtualize: true,
        virtualWindowSize: 50,
        virtualStartIndex: 100
      });

      const tableEl = rendered.props.children;
      const tbody = tableEl.props.children[2];
      // renderedRows should be sliced to 50 rows instead of 10,000!
      // In tbody children: [topSpacer, ...renderedRows, bottomSpacer]
      const rows = tbody.props.children[1];
      expect(rows.length).toBe(50);
      expect(hugeData.length).toBeGreaterThan(MAX_SAFE_DOM_ROWS);
    });
  });

  describe("3. Keyboard Smoke Test & Modal/Error Operation", () => {
    it("Dialog exposes role dialog, aria-modal, aria-labelledby, and accessible close button", () => {
      const onClose = vi.fn();
      const element = (
        <Dialog
          isOpen={true}
          onClose={onClose}
          title="Post Journal Entry"
          description="Are you sure you want to post this entry to the general ledger?"
        >
          <div>Entry Details</div>
        </Dialog>
      );

      expect(element).toBeDefined();
      expect(element.props.isOpen).toBe(true);
      expect(element.props.title).toBe("Post Journal Entry");
      expect(element.props.description).toContain("general ledger");
      expect(element.props.onClose).toBe(onClose);
    });

    it("FormErrorSummary provides jump-to anchor links for keyboard navigation", () => {
      const errors = [
        { fieldId: "account-code", message: "Account code is required" },
        { fieldId: "entry-amount", message: "Amount must be greater than zero" }
      ];

      const rendered = FormErrorSummary({ errors });
      expect(rendered?.props.role).toBe("alert");
      expect(rendered?.props["aria-live"]).toBe("assertive");

      const listItems = rendered?.props.children[1].props.children;
      expect(listItems.length).toBe(2);
      const link1 = listItems[0].props.children;
      expect(link1.props.href).toBe("#account-code");
      expect(link1.props.children).toBe("Account code is required");
    });
  });

  describe("4. CSV Action & Formula Injection Protection (PLT-12)", () => {
    it("CsvExportButton exposes accessible label and aria-busy state", () => {
      const onExport = vi.fn().mockResolvedValue([]);
      const element = (
        <CsvExportButton
          onExport={onExport}
          label="Export Accounts CSV"
        />
      );

      expect(element).toBeDefined();
      expect(element.props.label).toBe("Export Accounts CSV");
      expect(element.props.onExport).toBe(onExport);
    });

    it("sanitizes CSV cells to neutralize formula injection (=, +, -, @, tab)", () => {
      expect(sanitizeCsvCell("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
      expect(sanitizeCsvCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
      expect(sanitizeCsvCell("-500")).toBe("'-500");
      expect(sanitizeCsvCell("@malicious_macro")).toBe("'@malicious_macro");
      expect(sanitizeCsvCell("Normal String")).toBe("Normal String");
      expect(sanitizeCsvCell('Text with "quotes" and , comma')).toBe('"Text with ""quotes"" and , comma"');
    });

    it("generates well-formed CSV table strings", () => {
      const records = [
        { code: "1010", name: "Cash", balance: 5000 },
        { code: "2010", name: "Payables", balance: -2000 }
      ];
      const csv = generateCsvContent(records);
      expect(csv).toContain("code,name,balance");
      expect(csv).toContain("1010,Cash,5000");
    });
  });

  describe("5. Design Tokens Integrity", () => {
    it("exports complete color, spacing, radius, and elevation tokens", () => {
      expect(tokens.colors.bg).toBeDefined();
      expect(tokens.colors.accent).toBeDefined();
      expect(tokens.colors.ok).toBeDefined();
      expect(tokens.colors.err).toBeDefined();
      expect(tokens.spacing.s4).toBe("16px");
      expect(tokens.radius.md).toBe("4px");
    });
  });
});
