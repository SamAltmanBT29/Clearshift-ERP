# ERP-3 Sales Orders & Invoices — Web Frontend

The frontend implementation for **ERP-3 Sales Orders and Invoices**: collection screens, search/filtering, creation/edit/detail workflows, client-side validation, live financial calculations, irreversible status transition confirmations, and full-payment settlement modal.

**Issues:**
- [#29](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/29) — `[ERP3-04] ERP-3 Sales Orders and Invoices: List screen, search/filter and stable empty/loading/error states` (Merged via PR [#246](https://github.com/SamAltmanBT29/Clearshift-ERP/pull/246))
- [#30](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/30) — `[ERP3-05] ERP-3 Sales Orders and Invoices: Create/edit/detail workflow and client-side validation`

**Architecture & Specifications:**
- ClearShift Master Architecture Spec & SDS ERP v2.0
- Design Authority & Frontend Guidelines: `apps/Frontend_Guidelines.md`
- Data Dictionary: [`docs/data-dictionaries/erp-3.md`](../../../../docs/data-dictionaries/erp-3.md)
- OpenAPI Specification: [`packages/contracts/openapi/erp-3.yaml`](../../../../packages/contracts/openapi/erp-3.yaml)
- TypeScript Contracts: [`packages/contracts/src/erp-3.ts`](../../../../packages/contracts/src/erp-3.ts)

---

## 1. Directory Structure

```
apps/erp/modules/erp-3/web/
├── preview.html                             # Browser preview for visual inspection
├── src/
│   ├── index.ts                             # Public facade module exports
│   ├── theme.css                            # Minimal white SaaS theme using :root CSS tokens
│   ├── api/
│   │   └── erp-3.ts                         # Type-safe API client and financial math utilities
│   ├── components/
│   │   ├── FilterBar.tsx                    # Accessible filter bar for Sales Orders
│   │   ├── InvoiceFilterBar.tsx             # Accessible filter bar for Invoices
│   │   ├── OrdersTable.tsx                  # Semantic data table for Sales Orders
│   │   ├── InvoicesTable.tsx                # Semantic data table for Invoices
│   │   ├── StateViews.tsx                   # Loading (skeleton), Empty, Error, and Forbidden states
│   │   └── forms/
│   │       ├── OrderForm.tsx                # Dynamic multi-line order form with live totals
│   │       ├── InvoiceForm.tsx              # Invoice creation form with mandatory dueDate
│   │       ├── ConfirmActionDialog.tsx      # Accessible modal for irreversible transitions
│   │       └── PaymentModal.tsx             # Modal dialog for invoice full settlement
│   └── pages/
│       ├── OrdersListPage.tsx               # Primary tabbed list view (Orders & Invoices)
│       ├── OrderCreatePage.tsx              # Sales Order creation screen
│       ├── OrderDetailPage.tsx              # Sales Order detail & status transition screen
│       ├── InvoiceCreatePage.tsx            # Invoice creation screen
│       └── InvoiceDetailPage.tsx            # Invoice detail, status badge & payment screen
└── tests/
    ├── OrdersListPage.test.ts               # Domain invariant and query tests
    ├── OrdersListPage.test.tsx              # RTL tests for tab navigation, tables, and states
    └── OrderFormsAndWorkflow.test.tsx       # RTL tests for form validation, live totals, & modals
```

---

## 2. Screens & Workflows

| Screen | Route / View | Primary Actions |
|---|---|---|
| **OrdersListPage** | List context (`orders` / `invoices` tab) | Tab switching, search, status filter, pagination, "+ New Order", "+ New Invoice", "View" row details |
| **OrderCreatePage** | `OrderCreatePage` | Add/remove line items, live tax & subtotal preview, Golden ID validation, submit order |
| **OrderDetailPage** | `OrderDetailPage` | View metadata, line items, live totals, advance status (`open` -> `invoiced` -> `closed`), irreversible action confirmation, "Generate Invoice" shortcut |
| **InvoiceCreatePage** | `InvoiceCreatePage` | Select order reference, input mandatory `dueDate`, submit billing invoice |
| **InvoiceDetailPage** | `InvoiceDetailPage` | View status badge (`open` / `paid` / `overdue`), overdue warning banner, payment history, "Record Payment" settlement modal |

---

## 3. Domain Rules & Invariants

1. **Customer Golden ID**:
   - Case-insensitive regex matching `/^gid-[a-zA-Z0-9_-]+$/i`.
   - Rejects invalid IDs immediately with field-level alerts.
2. **Live Financial Calculation**:
   - `calculateLineAmounts` calculates tax (`quantity * unitPrice * (taxRate / 100)`) with half-up rounding.
   - Order total equals sum of line items: `orderTotal = subtotal + taxTotal`.
   - Client calculation provides immediate operator feedback while server remains final authority.
3. **Mandatory Due Date & Overdue Derivation**:
   - `dueDate` is mandatory on invoice creation.
   - An unpaid/open invoice becomes `overdue` when the current UTC calendar date strictly exceeds `dueDate`.
4. **Single Full Settlement in V1**:
   - `PaymentModal` validates payment amount equals total invoice balance due. Partial payments and overpayments are rejected in V1.
5. **State Transitions & Irreversible Actions**:
   - Sales Order lifecycle: `open` -> `invoiced` -> `closed`.
   - Transitions to `closed` are irreversible and require operator confirmation via `ConfirmActionDialog`.

---

## 4. Design & Accessibility Compliance

- **Minimal White Theme**: Pure CSS adhering strictly to `:root` design tokens in `theme.css`.
- **Landmarks & Semantics**: Proper `<main>`, `<header>`, `<table>`, `<dialog>` (or `role="dialog"` modal), and `<nav>` navigation landmarks.
- **Labels & Descriptions**: Native inputs and selects paired with `<label>` or `.sr-only` descriptions.
- **Resilient UI States**:
  - `SkeletonTable`: Animated skeleton placeholders during API loading.
  - `EmptyState`: Contextual empty views with "+ Create" or "Reload" actions.
  - `ErrorState`: Clear error notification with safe "Try again" retry mechanism.
  - Form state preservation: Server-side validation errors preserve operator input.

---

## 5. Verification & Running Tests

```bash
# Typecheck across the monorepo
npm run typecheck

# Frontend architecture and accessibility linting
npm run validate:frontend

# Vitest suite for ERP-3 web module
npx vitest run apps/erp/modules/erp-3/web

# Full repository test run
npm test
```
