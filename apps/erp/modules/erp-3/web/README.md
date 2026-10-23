# ERP-3 Sales Orders & Invoices — Web Frontend

The frontend implementation for **ERP-3 Sales Orders and Invoices**: collection screens, search/filtering, creation/edit/detail workflows, client-side validation, live financial calculations, irreversible status transition confirmations, and full-payment settlement modal.

**Issues:**
- [#29](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/29) — `[ERP3-04] ERP-3 Sales Orders and Invoices: List screen, search/filter and stable empty/loading/error states` (Merged via PR [#246](https://github.com/SamAltmanBT29/Clearshift-ERP/pull/246))
- [#30](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/30) — `[ERP3-05] ERP-3 Sales Orders and Invoices: Create/edit/detail workflow and client-side validation`
- [#150](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/150) — `[ERP3-14] ERP-3 Sales Orders and Invoices: OpenAPI, event and mock contract package`

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
│   │   └── erp-3.ts                         # Type-safe API client consuming canonical snake_case contracts
│   ├── components/
│   │   ├── FilterBar.tsx                    # Accessible filter bar for Sales Orders
│   │   ├── InvoiceFilterBar.tsx             # Accessible filter bar for Invoices
│   │   ├── OrdersTable.tsx                  # Semantic data table for Sales Orders
│   │   ├── InvoicesTable.tsx                # Semantic data table for Invoices
│   │   ├── StateViews.tsx                   # Loading (skeleton), Empty, Error, and Forbidden states
│   │   └── forms/
│   │       ├── OrderForm.tsx                # Dynamic multi-line order form with live totals
│   │       ├── InvoiceForm.tsx              # Invoice creation form with mandatory due_date
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
| **OrdersListPage** | List context (`orders` / `invoices` tab) | Tab switching, search, status filter, pagination, "+ New Sales Order", "+ New Invoice", "View" row details |
| **OrderCreatePage** | `OrderCreatePage` | Add/remove line items, live tax & subtotal preview, UUID Golden ID validation, submit order |
| **OrderDetailPage** | `OrderDetailPage` | View metadata, line items, live totals, advance status (`Open` -> `Invoiced` -> `Closed`), irreversible action confirmation, "Generate Invoice" shortcut |
| **InvoiceCreatePage** | `InvoiceCreatePage` | Select order reference, derive customer/currency/lines from order, input mandatory `due_date`, submit billing invoice |
| **InvoiceDetailPage** | `InvoiceDetailPage` | View status badge (`Open` / `Paid` / `Overdue`), overdue warning banner, payment history, "Record Payment" settlement modal |

---

## 3. Domain Rules & Invariants

1. **Customer Golden ID (ADR-003)**:
   - Validated as a canonical UUID (`UuidSchema` / `CustomerGoldenIdSchema`).
   - Rejects non-UUID strings immediately with field-level alerts.
2. **Live Financial Calculation (DR-1 Pending)**:
   - `calculateLineAmounts` computes 4-dp `subtotal`, `tax_amount`, and `line_total` from `quantity`, `price`, and percentage `tax_rate` (e.g. `"10.0000"` = 10%).
   - ⚠️ **DR-1**: Intermediate 2-dp vs. 4-dp rounding rule is pending Integration Lead confirmation.
3. **Mandatory Due Date & Overdue Derivation (DR-2 Resolved)**:
   - `due_date` is mandatory on invoice creation (`V1_30_ISSUE_STANDARDIZATION_PLAN.md` §8).
   - An unpaid/Open invoice becomes `Overdue` when the current UTC calendar date strictly exceeds `due_date`.
4. **Payment Settlement**:
   - `PaymentModal` validates payment amount against remaining invoice balance due and submits ISO 8601 `paid_at` timestamps and 4-dp `amount` strings.
5. **State Transitions & Isolated Routes (DR-3 Pending)**:
   - Sales Order lifecycle: `Open` -> `Invoiced` -> `Closed`.
   - ⚠️ **DR-3**: `GET /sales-orders/{id}` and `GET /invoices/{id}` are included in the 7-route OpenAPI/mock baseline pending Gate G1 ratification. `PATCH /sales-orders/{id}` (`updateSalesOrderStatus`) and `GET /payments` (`fetchPayments`) are isolated client helpers awaiting backend route ratification.
