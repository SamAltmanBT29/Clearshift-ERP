# ERP-3 Sales Orders & Invoices — Web Frontend

The frontend implementation for **ERP-3 Sales Orders and Invoices**: collection screens, search/filtering, creation/edit/detail workflows, client-side validation, live financial calculations, irreversible status transition confirmations, and full-payment settlement modal.

**Issues:**
- [#29](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/29) — `[ERP3-04] ERP-3 Sales Orders and Invoices: List screen, search/filter and stable empty/loading/error states` (Merged via PR [#246](https://github.com/SamAltmanBT29/Clearshift-ERP/pull/246))
- [#30](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/30) — `[ERP3-05] ERP-3 Sales Orders and Invoices: Create/edit/detail workflow and client-side validation` (Merged via PR [#251](https://github.com/SamAltmanBT29/Clearshift-ERP/pull/251))
- [#152](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/152) — `[ERP3-16] ERP-3 Sales Orders and Invoices: Module route/page registration using the shared shell`

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
│   ├── route-manifest.ts                    # Frozen route manifest (single source of truth)
│   ├── routes.tsx                           # React Router 7 route definitions under /erp3
│   ├── theme.css                            # Minimal white SaaS theme using :root CSS tokens
│   ├── api/
│   │   └── erp-3.ts                         # Type-safe API client and financial math utilities
│   ├── auth/
│   │   ├── RequireAuth.tsx                  # Module route guard redirecting to Hub /login
│   │   └── session.ts                       # Opaque token reader with JWT expiration check
│   ├── components/
│   │   ├── ModuleShell.tsx                  # Shared layout shell (landmarks, banner, skip-link)
│   │   ├── ModuleNav.tsx                    # Accessible navigation hierarchy & active states
│   │   ├── ModuleBreadcrumbs.tsx            # Shared @cs/ui Breadcrumb adapter
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
│       ├── SalesOrdersListPage.tsx          # Routed Sales Orders collection view
│       ├── InvoicesListPage.tsx             # Routed Invoices collection view
│       ├── PaymentsListPage.tsx             # Routed Payments collection view
│       ├── OrderCreatePage.tsx              # Sales Order creation screen
│       ├── SalesOrderCreatePage.tsx         # Routed Sales Order creation page
│       ├── OrderDetailPage.tsx              # Sales Order detail & status transition screen
│       ├── SalesOrderDetailPage.tsx         # Routed Sales Order detail page
│       ├── SalesOrderEditPage.tsx           # Routed Sales Order edit page
│       ├── InvoiceCreatePage.tsx            # Invoice creation screen
│       ├── InvoiceCreateRoutePage.tsx       # Routed Invoice creation page
│       ├── InvoiceDetailPage.tsx            # Invoice detail, status badge & payment screen
│       ├── InvoiceDetailRoutePage.tsx       # Routed Invoice detail page
│       ├── InvoiceEditRoutePage.tsx         # Routed Invoice edit page
│       └── ModuleNotFoundPage.tsx           # Accessible 404 recovery screen under /erp3/*
└── tests/
    ├── OrdersListPage.test.ts               # Domain invariant and query tests
    ├── OrdersListPage.test.tsx              # RTL tests for tab navigation, tables, and states
    ├── OrderFormsAndWorkflow.test.tsx       # RTL tests for form validation, live totals, & modals
    ├── route-manifest.test.ts               # Route manifest, matching & breadcrumb tests
    ├── routes.test.tsx                      # React Router registration & screen rendering tests
    ├── module-shell.test.tsx                # Accessibility landmarks, keyboard & guard tests
    ├── module-nav.test.tsx                  # Navigation component active state tests
    ├── session.test.ts                      # Session token storage & JWT expiration tests
    ├── public-facade.test.ts                # Public exports verification tests
    └── support/
        ├── api-mock.ts                      # Module fetch stub for tests
        ├── jsdom-environment.ts             # JSDOM Request/AbortSignal shim
        └── session.ts                       # Test JWT generation and storage helpers
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
