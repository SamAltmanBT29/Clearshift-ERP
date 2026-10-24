# ERP-3 Sales Orders & Invoices — Module Data Dictionary

See the canonical global reference copy at [`docs/data-dictionaries/erp-3.md`](../../../../../docs/data-dictionaries/erp-3.md) and architecture decision record [`docs/adr/ADR-005-erp-3-api-contract-and-mock-baseline.md`](../../../../../docs/adr/ADR-005-erp-3-api-contract-and-mock-baseline.md).

## 1. Ownership & Boundaries

- **Module ID**: `erp3` (Group 8 — Sales Orders & Invoices)
- **PostgreSQL Schema**: `erp3`
- **Route Prefix**: `/api/v1/erp-orders`
- **Logical Tables (`SDS §4.7` & `Master Spec §5c`)**: `erp3_sales_orders`, `erp3_so_lines`, `erp3_invoices`, `erp3_invoice_lines`, `erp3_payments` (plus `erp3.import_receipts` per KIT-08)
- **Cross-Module References**:
  - `customer_golden_id` (UUID): Resolved against Hub Identity / CRM-1 Golden ID registry (`ADR-003`, `BR-ERP3-03`). Never mutated by ERP-3.
  - `product_id` (UUID): Resolved against ERP-1 Products & Inventory (`/api/v1/erp-products`). Never mutated by ERP-3.
  - Outbound accounting events (`erp.invoice.created`, `erp.payment.created`, `erp.invoice.status_changed`): Consumed by ERP-4 Finance & Accounting.
  - Inbound CRM event (`deal.won`, `SDS §4.10 EV-09`): Produced by CRM-2 and consumed by ERP-3 to create a sales order.

## 2. Public Contract & Mock Exports

- **OpenAPI 3.1 Specification**: `packages/contracts/openapi/erp-3.yaml`
- **Zod Schemas & Types**: `packages/contracts/src/erp-3.ts` (`@clearshift/contracts/erp-3`)
- **Event Envelopes & Payloads**: `packages/contracts/src/erp-3-events.ts` (`@clearshift/contracts/erp-3-events`)
- **Deterministic Mock Server**: `packages/contracts/src/erp-3-mock.ts` (`@clearshift/contracts/erp-3-mock`, `createErp3MockServer()`, `ERP3_MOCK_DEFAULT_PORT = 4013`)
- **Data Quality Rules & Migration Engine (`ERP3-08`, Issue #33)**: [`apps/erp/modules/erp-3/docs/data-quality-rules.md`](data-quality-rules.md), `sample-data/erp-3/dirty-data-v1.csv`, `sample-data/erp-3/expected-profile.json`, `sample-data/erp-3/mapping-template.json`

## 3. Core Invariants & Reconciled Contract Rules

- **`BR-ERP3-01` (Order/Invoice Total Integrity)**: `total` is server-computed as the exact sum of `line_total` across all lines (`lines` requires `.min(1)` on create requests; response schemas validate `z.array(...)` without a minimum length). Monetary values and quantities use `NUMERIC(19,4)` (`SDS §3.2`) serialized as 4-dp decimal strings (`MoneyAmount`).
- **`BR-ERP3-02` & `DR-1` (Line Tax Calculation — Pending Gate G1 Confirmation)**: `tax_amount = (quantity * price * tax_rate) / 100` and `line_total = (quantity * price) + tax_amount`, where `tax_rate` is a percentage string (`TaxRateAmount`, e.g., `"18.0000"` = 18%). Pending Integration Lead confirmation of the DR-1 rounding rule (`SDS §4.4 BR-ERP3-02` 2-dp tax rounding + `Master Spec Decision M2` `ROUND_HALF_UP` vs. `SDS §3.2 NUMERIC(19,4)` 4-dp storage), the mock performs exact 4-dp `BigInt` arithmetic and rejects sub-4-dp fractions with `422 DR1_ROUNDING_UNRESOLVED`.
- **`BR-ERP3-03` & Reference Validation (`customer_golden_id`, `product_id`, `order_id`)**: In `erp-3.ts` and `erp-3-mock.ts`, missing or malformed UUIDs for `customer_golden_id` or `product_id` return `400 VALIDATION_ERROR` during Zod schema validation. `422` relationship error codes (`MISSING_CUSTOMER_GOLDEN_ID`, `CUSTOMER_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `ORDER_REF_NOT_FOUND`) are defined in `ERP3_RELATIONSHIP_ERROR_CODES`, but the in-memory mock only performs a cross-entity lookup on `invoice.order_id` (`422 ORDER_REF_NOT_FOUND`).
- **Required/Nullable Request vs. Response Fields & Migration Kit Fields**:
  - `source_system`, `source_id`, and invoice `order_id` are optional/nullable on `CreateSalesOrderRequestSchema` / `CreateInvoiceRequestSchema` and nullable keys (`string | null`) on `SalesOrderSchema` / `InvoiceSchema` (omitted from OpenAPI `required` arrays).
  - `idempotency_key`, `batch_id`, and `source_row` are optional/nullable on `CreateSalesOrderRequestSchema`, `CreateInvoiceRequestSchema`, and `CreatePaymentRequestSchema` in this branch; they are not returned on response entities, not used for deduplication by `erp-3-mock.ts`, and absent from the competing `origin/main` `Create*InputSchema` definitions.
- **Invoice `due_date` (`DR-2`)**: `due_date` (`YYYY-MM-DD`) is mandatory on `InvoiceSchema` and `CreateInvoiceRequestSchema` per `V1_30_ISSUE_STANDARDIZATION_PLAN.md` §8 and `CLEARSHIFT_V1_MASTER_ARCHITECTURE_SPEC.md` §5c ERD + Decision `C1`.
- **`FR-ERP3-03` & `FR-ERP3-04` (Payments & Auto-Paid Transition)**: Payment `amount` must be `> 0` with `method` in `cash | bank | card`. Recording a payment on an already `Paid` invoice returns `422 INVOICE_ALREADY_PAID`. A payment that would cause `SUM(payments) > invoice.total` returns `422 PAYMENT_EXCEEDS_INVOICE_TOTAL`. Multiple partial payments are supported by the API/mock contract; when `SUM(payments) == invoice.total`, the invoice automatically transitions to `Paid` and emits `erp.invoice.status_changed`.
- **`FR-ERP3-05` (Sales Order Status Lifecycle)**: Strictly forward-only `Open` → `Invoiced` → `Closed`. `UpdateSalesOrderStatusRequestSchema` is exported in `erp-3.ts`, but `PATCH /sales-orders/{id}` is not one of the 7 routes in `erp-3.yaml` or `erp-3-mock.ts`.
- **`DR-3` (Detail Read Routes — Pending Gate G1 Ratification)**: `GET /sales-orders/{id}` and `GET /invoices/{id}` are included per `V1_30_ISSUE_STANDARDIZATION_PLAN.md` §7 Slot 04 and `CLEARSHIFT_V1_MASTER_ARCHITECTURE_SPEC.md` Decision `C1` / `H1`, and flagged for Gate G1 ratification.
- **Branch Divergence with `origin/main` (`ERP3-04` / `ERP3-05`)**: `feature/150-erp3-contracts` and `origin/main` currently define conflicting `packages/contracts/src/erp-3.ts` and `packages/contracts/openapi/erp-3.yaml` files (`snake_case` vs. `camelCase`, `UUID` vs. `gid-*` `customer_golden_id`, TitleCase vs. lowercase status enums, and full-line `CreateInvoiceRequestSchema` vs. order-only `CreateInvoiceInputSchema`). Code-level reconciliation is required before PR #256 can be safely merged.
