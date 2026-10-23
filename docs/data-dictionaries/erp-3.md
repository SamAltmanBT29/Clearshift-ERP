# ERP-3 Sales Orders & Invoices — Data Dictionary (Global Reference)

This document is the global-docs copy of the ERP-3 module data dictionary.

For the module-local copy see:
[`apps/erp/modules/erp-3/docs/data-dictionary.md`](../../apps/erp/modules/erp-3/docs/data-dictionary.md)

---

## Module Summary

| Field | Value |
|---|---|
| **Module** | ERP-3 Sales Orders & Invoices |
| **Issue** | #150 (`[ERP3-14] ERP-3 Sales Orders and Invoices: OpenAPI, event and mock contract package`) |
| **PostgreSQL Schema** | `erp3` |
| **API Base** | `/api/v1/erp-orders` |
| **OpenAPI Contract** | `packages/contracts/openapi/erp-3.yaml` |
| **TypeScript Contracts** | `packages/contracts/src/erp-3.ts` (`@clearshift/contracts/erp-3`) |
| **Domain Events** | `packages/contracts/src/erp-3-events.ts` (`@clearshift/contracts/erp-3-events`, PLT-04 / PLT-09 transactional envelopes) |
| **Mock Contract Package** | `packages/contracts/src/erp-3-mock.ts` (`@clearshift/contracts/erp-3-mock`, `createErp3MockServer()`, default port `4013`) |
| **Logical Tables (SDS §4.7)** | `erp3_sales_orders`, `erp3_so_lines`, `erp3_invoices`, `erp3_payments` (plus `erp3.import_receipts` per KIT-08) |
| **Version** | `1.0.0` (Proposed — Pending Gate G1 Sign-Off) |
| **SDS Reference** | ClearShift ERP v2.0 §4.4 (FR-ERP3-01..05, BR-ERP3-01..03), §4.7, §4.8, §4.10 (EV-09) |

---

## Table & Entity Index

| Logical Table / Schema | Purpose | Key Constraints & Ownership |
|---|---|---|
| `erp3_sales_orders` (`SalesOrderSchema`) | Sales order header with customer Golden ID, status, and computed total | `UNIQUE(order_number)`, mandatory `customer_golden_id` (UUID PK per ADR-003, `BR-ERP3-03`) |
| `erp3_so_lines` (`SalesOrderLineSchema`) | Order line items referencing ERP-1 products | `FK(order_id)`, logical `product_id` ref to ERP-1 (`quantity > 0`, server-computed `tax_amount` & `line_total`) |
| `erp3_invoices` (`InvoiceSchema`) | Sales invoice header with status (`Open`, `Paid`, `Overdue`) and `due_date` | `UNIQUE(invoice_number)`, optional `order_id`, mandatory `customer_golden_id` and `due_date` |
| `erp3_invoice_lines` (`InvoiceLineSchema`) | Embedded invoice line items (FR-ERP3-02) | `FK(invoice_id)`, logical `product_id` ref to ERP-1, server-computed `tax_amount` & `line_total` |
| `erp3_payments` (`PaymentSchema`) | Payment settlement records linked to an invoice | `FK(invoice_id)`, `amount > 0`, `method` in `cash \| bank \| card` (`FR-ERP3-03`) |

---

## API Endpoints (`packages/contracts/openapi/erp-3.yaml`)

All collection endpoints enforce bounded pagination (`page >= 1`, `pageSize` 1..100, default `20`). All error responses conform to ADR-002 / PLT-04 (`Erp3ApiErrorSchema` / `ErrorEnvelopeSchema`).

| Method | Endpoint | Operation ID | Source | Description |
|---|---|---|---|---|
| `GET` | `/api/v1/erp-orders/sales-orders` | `listSalesOrders` | SDS §4.8 | Paged list of sales orders; filters: `status`, `customer_golden_id`, `currency`, `from_date`, `to_date`, `search` |
| `POST` | `/api/v1/erp-orders/sales-orders` | `createSalesOrder` | SDS §4.8 | Create sales order with lines; server computes `tax_amount`, `line_total`, and `total` (`BR-ERP3-01`) |
| `GET` | `/api/v1/erp-orders/sales-orders/{id}` | `getSalesOrder` | Implied (Slot 04) ⚠️ | Retrieve single sales order with embedded lines by UUID (flagged for Integration Lead confirmation) |
| `GET` | `/api/v1/erp-orders/invoices` | `listInvoices` | SDS §4.8 | Paged list of invoices; filters: `status`, `customer_golden_id`, `order_id`, `currency`, `from_date`, `to_date`, `search` |
| `POST` | `/api/v1/erp-orders/invoices` | `createInvoice` | SDS §4.8 | Create invoice with lines and mandatory `due_date`; validates optional `order_id` reference |
| `GET` | `/api/v1/erp-orders/invoices/{id}` | `getInvoice` | Implied (Slot 04) ⚠️ | Retrieve single invoice with embedded lines by UUID (flagged for Integration Lead confirmation) |
| `POST` | `/api/v1/erp-orders/payments` | `createPayment` | SDS §4.8 | Record payment against an invoice; auto-transitions invoice to `Paid` when `SUM(payments) == total` (`FR-ERP3-04`) |

---

## Domain Event Contracts (`@clearshift/contracts/erp-3-events`)

All events use the PLT-04 / PLT-09 transactional `EventEnvelopeSchema` (`event_id`, `event_type`, `schema_version`, `occurred_at`, `correlation_id`, `producer`, `entity_type`, `entity_id`, `payload`).

| Event Type | Direction | Producer | Entity Type | Trigger & Payload Summary |
|---|---|---|---|---|
| `erp.sales_order.created` | Produced | `erp-3` | `sales_order` | Emitted when a new sales order is created in `Open` status |
| `erp.sales_order.status_changed` | Produced | `erp-3` | `sales_order` | Emitted on forward status transition (`Open` → `Invoiced` → `Closed`) |
| `erp.invoice.created` | Produced | `erp-3` | `invoice` | Emitted when a new invoice is created in `Open` status (consumed by ERP-4 for AR posting) |
| `erp.invoice.status_changed` | Produced | `erp-3` | `invoice` | Emitted when invoice status changes (e.g., `Open` → `Paid` upon full settlement) |
| `erp.payment.created` | Produced | `erp-3` | `payment` | Emitted when a payment is recorded; includes `invoice_status_after` |
| `deal.won` | Inbound (EV-09) | `crm-2` | `deal` | Consumed from CRM-2 via Hub when a deal is won; triggers sales order creation in ERP-3 |

---

## Open Decisions & Pending Sign-Offs

1. **DR-1 — Monetary Rounding Rule (Unresolved / Requires Integration Lead Confirmation)**:
   - `SDS_ClearShift_ERP.md` §4.4 `BR-ERP3-02` states *"Tax per line = line amount multiplied by the product tax rate, rounded to 2 decimals"*, whereas `SDS_ClearShift_ERP.md` §3.2 mandates `numeric(19,4)` (4 decimal places) storage and `CLEARSHIFT_V1_MASTER_ARCHITECTURE_SPEC.md` Decision `M2` + `@cs/core` `Money` specify `ROUND_HALF_UP` at currency scale (`2` dp for `INR`/`USD`, padded via `.toStorageString()` to `.toFixed(4)`).
   - Until the Integration Lead confirms whether intermediate `line_amount` and `tax_amount` round at 2 dp `ROUND_HALF_UP` (zero-padded to 4 dp) or 4 dp, the contract uses 4-dp `MoneyAmount` strings and the mock server (`erp-3-mock.ts`) performs exact scaled `BigInt` arithmetic at 4 dp without rounding, returning mock-specific `422 DR1_ROUNDING_UNRESOLVED` if an input produces a sub-4-dp fraction.
2. **DR-2 — Invoice `due_date` Column (Resolved by Authoritative Hierarchy — Mandatory)**:
   - Required by `V1_30_ISSUE_STANDARDIZATION_PLAN.md` §8 (*"due date is mandatory for overdue calculation"*) and `CLEARSHIFT_V1_MASTER_ARCHITECTURE_SPEC.md` §5c ERD (`ERP3_INVOICES.due_date`). Under Master Spec Decision `C1` (*"Std Plan wins on conflict"*), this supersedes its omission from the summary table in `SDS_ClearShift_ERP.md` §4.7. Included as a required `YYYY-MM-DD` field on `InvoiceSchema` and `CreateInvoiceRequestSchema`.
3. **DR-3 — Detail Read Routes (`GET /sales-orders/{id}`, `GET /invoices/{id}`) (Required by Slot 04, Flagged for Gate G1 Sign-Off)**:
   - Required by `V1_30_ISSUE_STANDARDIZATION_PLAN.md` §7 Slot 04 (*Detail/read API and linked-record projection*) and `CLEARSHIFT_V1_MASTER_ARCHITECTURE_SPEC.md` §6.1 / Decision `H1` (*Full authoritative route set derived at G1*), consistent with ERP-1, ERP-2, ERP-4, and ERP-5, though omitted from the 5-row summary table in `SDS_ClearShift_ERP.md` §4.8. Included in `erp-3.yaml` and `erp-3-mock.ts` and flagged for Integration Lead Gate G1 sign-off.

---

## Versioned Contract Change Control Log

| Version | Date | Gate / Milestone | Author / Team | Description of Changes |
|---|---|---|---|---|
| **`1.0.0`** | 2026-10-23 | Gate G1 Baseline (Pending Sign-Off) | Group 8 / Role 2 (Issue #150) | Initial OpenAPI 3.1 specification, Zod schemas, domain event contracts, and deterministic mock server for ERP-3 Sales Orders & Invoices. |
