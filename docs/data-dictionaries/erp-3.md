# ERP-3 Sales Orders & Invoices — Data Dictionary (Global Reference)

This document specifies the canonical data dictionary for **ERP-3 Sales Orders and Invoices (Group 8)**.

For the module-local copy see:
[`apps/erp/modules/erp-3/docs/data-dictionary.md`](../../apps/erp/modules/erp-3/docs/data-dictionary.md)

For the contract and mock architecture decision record see:
[`docs/adr/ADR-005-erp-3-api-contract-and-mock-baseline.md`](../adr/ADR-005-erp-3-api-contract-and-mock-baseline.md)

---

## Module Summary

| Field | Value |
|---|---|
| **Module** | ERP-3 Sales Orders & Invoices (Group 8) |
| **Issues** | #26 (Data Model), #27 (List/Read API), #28 (Mutation API & Domain Validation), #29 (`[ERP3-04]` List Screen & UI States), #30 (`[ERP3-05]` Create/Edit/Detail Workflow), #31 (Relationships), #150 (`[ERP3-14]` OpenAPI, Event & Mock Contract Package) |
| **PostgreSQL Schema** | `erp3` |
| **API Base** | `/api/v1/erp-orders` |
| **OpenAPI Contract** | `packages/contracts/openapi/erp-3.yaml` (OpenAPI 3.1.0) |
| **TypeScript / Zod Contracts** | `packages/contracts/src/erp-3.ts` (`@clearshift/contracts/erp-3`) |
| **Domain Event Contracts** | `packages/contracts/src/erp-3-events.ts` (`@clearshift/contracts/erp-3-events`, PLT-04 / PLT-09 transactional envelopes) |
| **Mock Contract Package** | `packages/contracts/src/erp-3-mock.ts` (`@clearshift/contracts/erp-3-mock`, `createErp3MockServer()`, default port `4013`) |
| **Logical Tables (SDS §4.7 & Master Spec §5c)** | `erp3_sales_orders`, `erp3_so_lines`, `erp3_invoices`, `erp3_invoice_lines`, `erp3_payments` (plus `erp3.import_receipts` per KIT-08) |
| **Version** | `1.0.0` (Proposed — Pending Gate G1 Sign-Off) |
| **Authoritative References** | `CLEARSHIFT_V1_MASTER_ARCHITECTURE_SPEC.md` (Decisions `C1`, `M2`, `H1`, §5c ERD); `V1_30_ISSUE_STANDARDIZATION_PLAN.md` (§7, §8); `SDS_ClearShift_ERP.md` (§3.2, §4.4 `FR-ERP3-01..05`, `BR-ERP3-01..03`, §4.7, §4.8, §4.10 `EV-09`, §4.11); `ADR-002`; `ADR-003`; `ADR-005` |

---

## Table & Entity Index

| Logical Table / Schema | Purpose | Key Constraints & Ownership |
|---|---|---|
| `erp3_sales_orders` (`SalesOrderSchema`) | Header record for customer sales orders | `id` (PK, UUID), `UNIQUE(order_number)`, mandatory `customer_golden_id` (UUID per ADR-003, `BR-ERP3-03`), `status` (`Open`, `Invoiced`, `Closed`) |
| `erp3_so_lines` (`SalesOrderLineSchema`) | Order line items referencing ERP-1 products | `id` (PK, UUID), `FK(order_id)` to `erp3_sales_orders`, logical `product_id` (UUID) ref to ERP-1, `quantity > 0`, server-computed `tax_amount` and `line_total` |
| `erp3_invoices` (`InvoiceSchema`) | Billing invoice document with status and mandatory `due_date` | `id` (PK, UUID), `UNIQUE(invoice_number)`, optional `order_id` (FK to `erp3_sales_orders`; `||--o{` in Master Spec §5c), mandatory `customer_golden_id` (UUID) and `due_date` (`DR-2`), `status` (`Open`, `Paid`, `Overdue`) |
| `erp3_invoice_lines` (`InvoiceLineSchema`) | Embedded invoice line items (`FR-ERP3-02`, Master Spec §5c) | `id` (PK, UUID), `FK(invoice_id)` to `erp3_invoices`, logical `product_id` (UUID) ref to ERP-1, `quantity > 0`, server-computed `tax_amount` and `line_total` |
| `erp3_payments` (`PaymentSchema`) | Cash, bank, or card payment settlement records applied to an invoice | `id` (PK, UUID), `FK(invoice_id)` to `erp3_invoices`, `amount > 0`, `method` in `cash \| bank \| card` (`FR-ERP3-03`) |

---

## Field Specifications

> **Monetary & Decimal Storage (`SDS §3.2` & `DR-1`):**
> All monetary columns and decimal quantities are stored in PostgreSQL as `NUMERIC(19,4)` (exact decimal, never floating point) and serialized across the wire as string-encoded decimals (`MoneyAmount` / `TaxRateAmount`, pattern `^\d+(\.\d{1,4})?$`). See **DR-1** under *Open Decisions* regarding the intermediate 2-dp vs. 4-dp tax rounding rule.

### 1. `erp3_sales_orders` (`SalesOrderSchema` / `CreateSalesOrderRequestSchema`)

| Field | Storage / Contract Type | Required | Description | Example | Validation & Authority Rule |
|---|---|---|---|---|---|
| `id` | `UUID` | Yes (response) | Primary key | `30000000-0000-4000-8000-000000000001` | UUID (`UuidSchema`) |
| `order_number` | `VARCHAR(64)` | Yes (response) / Optional (create) | Human-readable unique order number (auto-generated if omitted on create) | `SO-2026-0001` | 1..64 chars, unique (`409 ORDER_NUMBER_EXISTS` on duplicate) |
| `customer_golden_id` | `UUID` | Yes | Hub-resolved customer Golden ID (`golden_records.id` PK per ADR-003) | `c0000000-0000-4000-8000-000000000001` | Mandatory UUID (`BR-ERP3-03`). Missing/malformed UUID returns `400 VALIDATION_ERROR` at schema validation; `422 MISSING_CUSTOMER_GOLDEN_ID` / `CUSTOMER_NOT_FOUND` are defined contract error codes (not enforced via cross-module lookup in `erp-3-mock.ts`). |
| `order_date` | `DATE` (`YYYY-MM-DD`) | Yes | Calendar date order was placed | `2026-01-15` | Valid ISO calendar date (`Erp3IsoDateString`) |
| `status` | `VARCHAR(20)` | Yes (response) | Sales order lifecycle state (`FR-ERP3-05`) | `Open` | Enum (`SalesOrderStatusEnum`): `Open`, `Invoiced`, `Closed` (forward-only FSM) |
| `currency` | `CHAR(3)` | Yes | ISO 4217 currency code (`SDS §3.2`) | `INR` | 3 uppercase ASCII letters (`^[A-Z]{3}$`) |
| `total` | `NUMERIC(19,4)` (`MoneyAmount`) | Yes (response) | Server-computed order total | `2360.0000` | Server-computed `SUM(lines.line_total)` (`BR-ERP3-01`); client-supplied total is not trusted |
| `lines` | `SalesOrderLine[]` | Yes (`minItems: 1` on create; required array on response without `minItems` constraint) | Embedded sales order line items | `[...]` | Create request requires at least 1 line (`.min(1)`); response schema validates `z.array(SalesOrderLineSchema)` |
| `source_system` | `VARCHAR(64)` | Optional & nullable on create; required key (`string \| null`) in `SalesOrderSchema` (not in OpenAPI `SalesOrder.required`) | Migration source system identifier | `legacy_erp` | Nullable string, max 64 chars |
| `source_id` | `VARCHAR(128)` | Optional & nullable on create; required key (`string \| null`) in `SalesOrderSchema` (not in OpenAPI `SalesOrder.required`) | Migration source record identifier | `LEGACY-SO-101` | Nullable string, max 128 chars |
| `created_at` | `TIMESTAMPTZ` | Yes (response) | UTC creation timestamp | `2026-01-15T09:00:00.000Z` | ISO 8601 `date-time` |
| `updated_at` | `TIMESTAMPTZ` | Yes (response) | UTC last-updated timestamp | `2026-01-15T09:00:00.000Z` | ISO 8601 `date-time` |

### 2. `erp3_so_lines` (`SalesOrderLineSchema` / `CreateSalesOrderLineRequestSchema`)

| Field | Storage / Contract Type | Required | Description | Example | Validation & Authority Rule |
|---|---|---|---|---|---|
| `id` | `UUID` | Yes (response) | Line primary key | `31000000-0000-4000-8000-000000000001` | UUID (`UuidSchema`) |
| `order_id` | `UUID` | Yes (response) | Foreign key to `erp3_sales_orders.id` | `30000000-0000-4000-8000-000000000001` | Valid sales order UUID |
| `product_id` | `UUID` | Yes | Logical reference to ERP-1 product (`erp1_products.id`) | `10000000-0000-4000-8000-000000000001` | Mandatory UUID (`400 VALIDATION_ERROR` if missing/malformed). `422 PRODUCT_NOT_FOUND` is defined in `ERP3_RELATIONSHIP_ERROR_CODES` for domain validation (not enforced via cross-module lookup in `erp-3-mock.ts`). |
| `quantity` | `NUMERIC(19,4)` (`MoneyAmount`) | Yes | Ordered quantity | `2.0000` | Decimal string up to 4 dp; must be strictly `> 0` |
| `price` | `NUMERIC(19,4)` (`MoneyAmount`) | Yes | Unit price (`SDS §4.7` column name `price`) | `1000.0000` | Non-negative decimal string up to 4 dp (`>= 0`) |
| `tax_rate` | `NUMERIC(7,4)` (`TaxRateAmount`) | Yes | Product tax rate percentage (`SDS §4.2 FR-ERP1-02`) | `18.0000` | Non-negative decimal percentage string up to 4 dp (e.g., `"18.0000"` = 18%) |
| `tax_amount` | `NUMERIC(19,4)` (`MoneyAmount`) | Yes (response) | Server-computed tax for line (`BR-ERP3-02`) | `360.0000` | Server-computed `(quantity * price * tax_rate) / 100`; see **DR-1** for rounding rule |
| `line_total` | `NUMERIC(19,4)` (`MoneyAmount`) | Yes (response) | Server-computed total line amount (`BR-ERP3-01`) | `2360.0000` | Server-computed `(quantity * price) + tax_amount`; see **DR-1** |
| `created_at` | `TIMESTAMPTZ` | Yes (response) | UTC creation timestamp | `2026-01-15T09:00:00.000Z` | ISO 8601 `date-time` |

### 3. `erp3_invoices` (`InvoiceSchema` / `CreateInvoiceRequestSchema`)

| Field | Storage / Contract Type | Required | Description | Example | Validation & Authority Rule |
|---|---|---|---|---|---|
| `id` | `UUID` | Yes (response) | Primary key | `32000000-0000-4000-8000-000000000001` | UUID (`UuidSchema`) |
| `invoice_number` | `VARCHAR(64)` | Yes (response) / Optional (create) | Unique invoice number (auto-generated if omitted on create) | `INV-2026-0001` | 1..64 chars, unique (`409 INVOICE_NUMBER_EXISTS` on duplicate) |
| `order_id` | `UUID` | Optional & nullable on create (`CreateInvoiceRequestSchema`); required key (`UUID \| null`) in `InvoiceSchema` (not in OpenAPI `Invoice.required`) | Linked sales order UUID (`erp3_sales_orders.id`) | `30000000-0000-4000-8000-000000000001` | If supplied, `erp-3-mock.ts` verifies it references an existing sales order (`422 ORDER_REF_NOT_FOUND` if unknown). Master Spec §5c ERD models `ERP3_SALES_ORDERS ||--o{ ERP3_INVOICES` (not DB-unique). |
| `customer_golden_id` | `UUID` | Yes | Customer Golden ID UUID (`ADR-003`) | `c0000000-0000-4000-8000-000000000001` | Mandatory UUID (`400 VALIDATION_ERROR` if missing/malformed). `422 CUSTOMER_NOT_FOUND` is defined in `ERP3_RELATIONSHIP_ERROR_CODES` (not enforced via cross-module lookup in `erp-3-mock.ts`). |
| `invoice_date` | `DATE` (`YYYY-MM-DD`) | Yes | Calendar date invoice was issued | `2026-01-16` | Valid ISO calendar date (`Erp3IsoDateString`) |
| `due_date` | `DATE` (`YYYY-MM-DD`) | Yes | Payment due date (`DR-2`) | `2026-02-15` | Mandatory per `V1_30_ISSUE_STANDARDIZATION_PLAN.md` §8 & Master Spec §5c ERD (Decision `C1`) |
| `status` | `VARCHAR(20)` | Yes (response) | Invoice payment/overdue state (`FR-ERP3-02`, `FR-ERP3-04`) | `Open` | Enum (`InvoiceStatusEnum`): `Open`, `Paid`, `Overdue` |
| `currency` | `CHAR(3)` | Yes | ISO 4217 currency code | `INR` | 3 uppercase ASCII letters (`^[A-Z]{3}$`) |
| `total` | `NUMERIC(19,4)` (`MoneyAmount`) | Yes (response) | Server-computed invoice total | `2360.0000` | Server-computed `SUM(lines.line_total)` (`BR-ERP3-01`) |
| `lines` | `InvoiceLine[]` | Yes (`minItems: 1` on create; required array on response without `minItems` constraint) | Embedded invoice line items (`FR-ERP3-02`) | `[...]` | Create request requires at least 1 line (`.min(1)`); response schema validates `z.array(InvoiceLineSchema)` |
| `source_system` | `VARCHAR(64)` | Optional & nullable on create; required key (`string \| null`) in `InvoiceSchema` (not in OpenAPI `Invoice.required`) | Migration source system identifier | `legacy_erp` | Nullable string, max 64 chars |
| `source_id` | `VARCHAR(128)` | Optional & nullable on create; required key (`string \| null`) in `InvoiceSchema` (not in OpenAPI `Invoice.required`) | Migration source record identifier | `LEGACY-INV-201` | Nullable string, max 128 chars |
| `created_at` | `TIMESTAMPTZ` | Yes (response) | UTC creation timestamp | `2026-01-16T10:00:00.000Z` | ISO 8601 `date-time` |
| `updated_at` | `TIMESTAMPTZ` | Yes (response) | UTC last-updated timestamp | `2026-01-16T10:00:00.000Z` | ISO 8601 `date-time` |

### 4. `erp3_invoice_lines` (`InvoiceLineSchema` / `CreateInvoiceLineRequestSchema`)

| Field | Storage / Contract Type | Required | Description | Example | Validation & Authority Rule |
|---|---|---|---|---|---|
| `id` | `UUID` | Yes (response) | Invoice line primary key | `33000000-0000-4000-8000-000000000001` | UUID (`UuidSchema`) |
| `invoice_id` | `UUID` | Yes (response) | Foreign key to `erp3_invoices.id` | `32000000-0000-4000-8000-000000000001` | Valid invoice UUID |
| `product_id` | `UUID` | Yes | Logical reference to ERP-1 product (`erp1_products.id`) | `10000000-0000-4000-8000-000000000001` | Mandatory UUID (`400 VALIDATION_ERROR` if missing/malformed). `422 PRODUCT_NOT_FOUND` is defined in `ERP3_RELATIONSHIP_ERROR_CODES` (not enforced via cross-module lookup in `erp-3-mock.ts`). |
| `quantity` | `NUMERIC(19,4)` (`MoneyAmount`) | Yes | Invoiced quantity | `2.0000` | Decimal string up to 4 dp; must be strictly `> 0` |
| `price` | `NUMERIC(19,4)` (`MoneyAmount`) | Yes | Unit price | `1000.0000` | Non-negative decimal string up to 4 dp (`>= 0`) |
| `tax_rate` | `NUMERIC(7,4)` (`TaxRateAmount`) | Yes | Tax rate percentage | `18.0000` | Non-negative decimal percentage string up to 4 dp |
| `tax_amount` | `NUMERIC(19,4)` (`MoneyAmount`) | Yes (response) | Server-computed tax amount | `360.0000` | Server-computed `(quantity * price * tax_rate) / 100`; see **DR-1** |
| `line_total` | `NUMERIC(19,4)` (`MoneyAmount`) | Yes (response) | Server-computed line total | `2360.0000` | Server-computed `(quantity * price) + tax_amount`; see **DR-1** |
| `created_at` | `TIMESTAMPTZ` | Yes (response) | UTC creation timestamp | `2026-01-16T10:00:00.000Z` | ISO 8601 `date-time` |

### 5. `erp3_payments` (`PaymentSchema` / `CreatePaymentRequestSchema`)

| Field | Storage / Contract Type | Required | Description | Example | Validation & Authority Rule |
|---|---|---|---|---|---|
| `id` | `UUID` | Yes (response) | Primary key | `34000000-0000-4000-8000-000000000001` | UUID (`UuidSchema`) |
| `invoice_id` | `UUID` | Yes | Foreign key to `erp3_invoices.id` | `32000000-0000-4000-8000-000000000001` | Must reference an existing invoice (`404 INVOICE_NOT_FOUND` if missing; `422 INVOICE_ALREADY_PAID` if already `Paid`) |
| `amount` | `NUMERIC(19,4)` (`MoneyAmount`) | Yes | Payment amount (`FR-ERP3-03`, `FR-ERP3-04`) | `1000.0000` | Decimal string `> 0`; `SUM(payments) <= invoice.total` (`422 PAYMENT_EXCEEDS_INVOICE_TOTAL` on overpayment) |
| `paid_at` | `TIMESTAMPTZ` | Yes (response) / Optional (create) | Timestamp payment was received (defaults to server time if omitted on create) | `2026-01-20T14:30:00.000Z` | ISO 8601 `date-time` |
| `method` | `VARCHAR(20)` | Yes | Payment method (`FR-ERP3-03`) | `bank` | Enum (`PaymentMethodEnum`): `cash`, `bank`, `card` |
| `created_at` | `TIMESTAMPTZ` | Yes (response) | UTC creation timestamp | `2026-01-20T14:30:00.000Z` | ISO 8601 `date-time` |

### 6. `erp3.import_receipts` (`ImportReceiptRecordSchema`, KIT-08 / Decision C4)

| Field | Storage / Contract Type | Required | Description | Example | Validation & Authority Rule |
|---|---|---|---|---|---|
| `id` | `UUID` | Yes | Primary key | `35000000-0000-4000-8000-000000000001` | UUID (`UuidSchema`) |
| `batch_id` | `UUID` | Yes | Migration Kit batch identifier | `3b000000-0000-4000-8000-000000000001` | UUID (`UuidSchema`) |
| `source_row` | `INTEGER` | Yes | 1-indexed source row number | `42` | Non-negative integer |
| `source_system` | `VARCHAR(64)` | No | Source system name | `legacy_erp` | Nullable string, max 64 |
| `source_id` | `VARCHAR(128)` | No | Source record identifier | `LEGACY-001` | Nullable string, max 128 |
| `entity` | `VARCHAR(64)` | Yes | Entity name | `sales_order` | `sales_order`, `invoice`, or `payment` |
| `schema_version` | `INTEGER` | Yes | Target schema version | `1` | Default `1` |
| `idempotency_key` | `VARCHAR(128)` | Yes | Unique idempotency key (`batch_id + row + version`) | `3b000000-0000-4000-8000-000000000001:42:1` | Unique constraint (`import_receipts_erp3_idempotency_key_unique`) |
| `request_hash` | `VARCHAR(64)` | Yes | SHA-256 canonical hash | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | 64 hex chars |
| `target_id` | `UUID` | Yes | Primary key of loaded business record | `30000000-0000-4000-8000-000000000001` | UUID |
| `kind` | `VARCHAR(16)` | Yes | Receipt kind | `created` | `created` \| `linked` |
| `outcome` | `VARCHAR(16)` | Yes | Row outcome | `loaded` | `loaded` \| `rejected` \| `merged` \| `skipped` |
| `response_payload`| `TEXT` | No | Serialized response JSON payload | `{"id":"..."}` | JSON string or null |
| `created_at` | `TIMESTAMPTZ` | Yes | Creation timestamp | `2026-10-23T12:00:00.000Z` | ISO 8601 `date-time` |

---

## API Endpoints (`packages/contracts/openapi/erp-3.yaml`)

All collection endpoints enforce bounded pagination (`page >= 1`, `pageSize` 1..100, default `20`). All error responses conform to ADR-002 / PLT-04 (`Erp3ApiErrorSchema` / `ErrorEnvelopeSchema`).

All 9 V1 baseline endpoints are documented in `packages/contracts/openapi/erp-3.yaml`:

| Method | Endpoint | Operation ID | Authority Source | Description |
|---|---|---|---|---|
| `GET` | `/api/v1/erp-orders/sales-orders` | `listSalesOrders` | SDS §4.8 | Paged list of sales orders; filters: `status`, `customer_golden_id`, `currency`, `from_date`, `to_date`, `search` |
| `POST` | `/api/v1/erp-orders/sales-orders` | `createSalesOrder` | SDS §4.8 | Create sales order with lines; server computes `tax_amount`, `line_total`, and `total` (`BR-ERP3-01`) |
| `GET` | `/api/v1/erp-orders/sales-orders/{id}` | `getSalesOrder` | V1_30 Slot 04 / Master Spec `H1` ⚠️ | Retrieve single sales order with embedded lines by UUID (not in SDS §4.8 summary table; flagged for Gate G1 ratification — **DR-3**) |
| `GET` | `/api/v1/erp-orders/invoices` | `listInvoices` | SDS §4.8 | Paged list of invoices; filters: `status`, `customer_golden_id`, `order_id`, `currency`, `from_date`, `to_date`, `search` |
| `POST` | `/api/v1/erp-orders/invoices` | `createInvoice` | SDS §4.8 | Create invoice with lines and mandatory `due_date`; validates optional `order_id` reference |
| `GET` | `/api/v1/erp-orders/invoices/{id}` | `getInvoice` | V1_30 Slot 04 / Master Spec `H1` ⚠️ | Retrieve single invoice with embedded lines by UUID (not in SDS §4.8 summary table; flagged for Gate G1 ratification — **DR-3**) |
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
| `deal.won` | Inbound (`EV-09`) | `crm-2` | `deal` | Consumed from CRM-2 via Hub when a deal is won; triggers sales order creation in ERP-3 |

---

## Domain Invariants (Non-Negotiable)

1. **`BR-ERP3-01` (Order & Invoice Line Total Integrity)**:
   - Server computes `line_total = (quantity * price) + tax_amount` for each line and `total = SUM(line_total)` across all lines (`lines.length >= 1`). Client-supplied totals are ignored on create, and any line-total mismatch in migration/validation is rejected (`ORDER_LINE_TOTAL_MISMATCH` / `INVOICE_LINE_TOTAL_MISMATCH`).
2. **`BR-ERP3-02` & `DR-1` (Tax per Line)**:
   - `SDS §4.4 BR-ERP3-02` specifies that tax per line equals line amount multiplied by product tax rate, rounded to 2 decimal places, while `SDS §3.2` specifies `NUMERIC(19,4)` storage. Pending Gate G1 confirmation of **DR-1**, the mock server uses exact 4-dp scaled `BigInt` arithmetic and rejects sub-4-dp fractions with `422 DR1_ROUNDING_UNRESOLVED`.
3. **`BR-ERP3-03` (Mandatory Customer Golden ID)**:
   - Every sales order and invoice must have a valid `customer_golden_id` (UUID per `ADR-003`). Missing or malformed UUIDs fail request schema validation with `400 VALIDATION_ERROR` in `erp-3-mock.ts`; `422 MISSING_CUSTOMER_GOLDEN_ID` and `CUSTOMER_NOT_FOUND` (along with `PRODUCT_NOT_FOUND`) are defined in `ERP3_RELATIONSHIP_ERROR_CODES` for target backend/migration domain validation, while the in-memory mock only enforces cross-entity lookup on `invoice.order_id` (`422 ORDER_REF_NOT_FOUND`).
4. **`FR-ERP3-02`, `FR-ERP3-03`, `FR-ERP3-04` (Invoice Status & Payment Settlement)**:
   - Payment `amount` must be strictly `> 0` with `method` in `cash | bank | card`.
   - Recording a payment against an already `Paid` invoice is rejected (`422 INVOICE_ALREADY_PAID`).
   - Any payment that would cause `SUM(payments) > invoice.total` is rejected (`422 PAYMENT_EXCEEDS_INVOICE_TOTAL`).
   - Multiple partial payments are supported by the API/mock contract (`FR-ERP3-04`: *"When the sum of payments equals the invoice total, the invoice becomes Paid automatically"*), emitting `erp.invoice.status_changed`.
   - An unpaid invoice is `Overdue` when the current UTC calendar date is strictly greater than `due_date`; otherwise `Open`.
5. **`FR-ERP3-05` (Sales Order Status Lifecycle)**:
   - Strictly forward-only state machine: `Open` → `Invoiced` → `Closed`. Backward transitions are rejected (`422 INVALID_ORDER_STATUS_TRANSITION`).

---

## Human-Operated Workflows & UI Architecture (`ERP3-04` & `ERP3-05`)

### 1. Sales Orders & Invoices List Screens (`ERP3-04`)
- **Screens**: `OrdersListPage` hosting `OrdersTable`, `InvoicesTable`, `FilterBar`, and `InvoiceFilterBar`.
- **Features**:
  - Bounded paginated tables (`page >= 1`, `pageSize <= 100`, default `20`) with search, status filter, customer Golden ID filter, currency filter, and date-range filters.
  - Explicit loading, empty, and error state views (`StateViews.tsx`).

### 2. Sales Order Creation Workflow (`ERP3-05`)
- **Screen**: `OrderCreatePage` hosting `OrderForm`.
- **Client Validation**:
  - `customerGoldenId`: Mandatory in the UI form (currently validates `/^gid-[a-zA-Z0-9_-]+$/i` in the UI client stub; canonical backend contract requires `ADR-003` UUID `customer_golden_id`).
  - `orderDate`: Valid ISO date (`YYYY-MM-DD`).
  - `lines`: Minimum 1 item required; each line requires `productId`, positive `quantity`, non-negative price, and non-negative tax rate.
- **Live Calculations**:
  - `taxAmount` per line is previewed client-side using `calculateLineAmounts` for immediate UI feedback; server calculation remains authoritative (**DR-1** rounding rule pending Gate G1 confirmation).
  - Overall order subtotal, tax total, and total render live in `cs-totals-summary-card`.
- **Error Handling**: API errors display in `cs-form-error-banner` without wiping user-entered values.

### 3. Sales Order Detail & Status Transitions (`ERP3-05`)
- **Screen**: `OrderDetailPage`.
- **Features**:
  - Read-only display of order metadata, customer reference, and line items (`GET /api/v1/erp-orders/sales-orders/{id}`, **DR-3**).
  - Displays computed totals matching `BR-ERP3-01`.
  - Forward-only status transitions (`Open` → `Invoiced` → `Closed`): irreversible `Closed` action requires confirmation via `ConfirmActionDialog`.
  - `"Generate Invoice"` workflow shortcut transfers the order reference to `InvoiceCreatePage`.

### 4. Billing Invoice Creation Workflow (`ERP3-05`)
- **Screen**: `InvoiceCreatePage` hosting `InvoiceForm`.
- **Client Validation**:
  - `orderId`: Required in the UI order-to-invoice workflow (`order_id` is optional/nullable in the underlying `CreateInvoiceRequestSchema` API contract for standalone invoices and validated against `erp3_sales_orders` when supplied).
  - `dueDate`: Required ISO date (`YYYY-MM-DD`); mandatory for overdue status derivation (**DR-2**).
- **Workflow**:
  - On submission, calls `POST /api/v1/erp-orders/invoices`.
  - Navigates to `InvoiceDetailPage` upon creation.

### 5. Invoice Detail & Payment Settlement (`ERP3-05`)
- **Screen**: `InvoiceDetailPage` hosting `PaymentModal`.
- **Features**:
  - Displays invoice status badge (`Open`, `Paid`, `Overdue`) via `GET /api/v1/erp-orders/invoices/{id}` (**DR-3**).
  - Shows overdue warning banner when status is `Overdue` (unpaid and current UTC date > `due_date`).
  - `"Record Payment"` action opens `PaymentModal` and submits `POST /api/v1/erp-orders/payments`. *(Note: The UI client stub also references `GET /api/v1/erp-orders/payments`, which is not part of the `SDS §4.8` / `erp-3.yaml` V1 route set.)*
  - When `SUM(payments) == invoice.total`, invoice status transitions automatically to `Paid` (`FR-ERP3-04`).

### Branch Divergence & Code-Level Reconciliation Required (`feature/150-erp3-contracts` vs. `origin/main`)

> **Important:** `feature/150-erp3-contracts` (`ERP3-14`) and `origin/main` (`ERP3-04` / `ERP3-05`) currently define **divergent, conflicting versions** of `packages/contracts/src/erp-3.ts` and `packages/contracts/openapi/erp-3.yaml`. Code-level reconciliation of those contract files and the web client (`apps/erp/modules/erp-3/web/src/api/erp-3.ts`) is required before PR #256 can be safely merged into `main`.

| Area | `feature/150-erp3-contracts` (`ERP3-14` Contract & Mock) | `origin/main` (`ERP3-04` / `ERP3-05` Web & Contract Stub) | Divergence & Reconciliation Required Before Merge |
|---|---|---|---|
| **`customer_golden_id` format** | `UUID` (`UuidSchema`, `ADR-003` `golden_records.id` PK) | `CustomerGoldenIdSchema` matching `/^gid-[a-zA-Z0-9_-]+$/i` | Divergent schema validation: code-level reconciliation required between `ADR-003` UUID contract and UI `gid-*` validation |
| **Invoice `order_id` & creation contract** | `CreateInvoiceRequestSchema` requires `customer_golden_id`, `invoice_date`, `due_date`, `currency`, `lines` (`.min(1)`); `order_id` is optional/nullable `UUID` (`422 ORDER_REF_NOT_FOUND` in mock if unknown) | `CreateInvoiceInputSchema` has `{ orderId (required), invoiceDate, dueDate, notes }` and omits `customer_golden_id`, `currency`, and `lines` | Divergent request schemas and route behavior; requires code-level contract/UI reconciliation before merge |
| **Payment cardinality & routes** | `POST /payments` accepts partial and full payments (`FR-ERP3-04`: `SUM(payments) == total` transitions to `Paid`; `SUM > total` rejected with `422`); no `GET /payments` route | UI `PaymentModal` submits full settlement and calls `GET /api/v1/erp-orders/payments` (`PaymentsFilterQuerySchema`) | Divergent route set and payment schemas (`paid_at` ISO `date-time` vs. `paidAt` `YYYY-MM-DD`, `currencyCode`, `reference`); requires code-level reconciliation |
| **Schema exports, naming & status enums** | `snake_case` fields (`customer_golden_id`, `price`, `currency`), TitleCase status enums (`Open`, `Invoiced`, `Closed`, `Paid`, `Overdue`), `Create*RequestSchema`, `SalesOrderListResponseSchema` (`data`) | `camelCase` fields (`customerGoldenId`, `unitPrice`, `currencyCode`), lowercase status enums (`open`, `invoiced`, `closed`, `paid`, `overdue`), `Create*InputSchema`, `Paginated*ResponseSchema` (`items`), plus helper functions (`calculateLineAmounts`, `validateOrderLineTotals`, `deriveInvoiceStatus`) | Directly conflicting exports in `packages/contracts/src/erp-3.ts`; code-level merge resolution required before PR #256 can merge |

---

## Open Decisions & Pending Gate G1 Sign-Offs

1. **DR-1 — Monetary Rounding Rule (Unresolved / Pending Integration Lead Confirmation at Gate G1)**:
   - `SDS_ClearShift_ERP.md` §4.4 `BR-ERP3-02` states *"Tax per line = line amount multiplied by the product tax rate, rounded to 2 decimals"*, whereas `SDS_ClearShift_ERP.md` §3.2 mandates `NUMERIC(19,4)` (4 decimal places) storage and `CLEARSHIFT_V1_MASTER_ARCHITECTURE_SPEC.md` Decision `M2` + `@cs/core` `Money` specify `ROUND_HALF_UP` at currency scale (`2` dp for `INR`/`USD`, padded via `.toStorageString()` to `.toFixed(4)`).
   - Until the Integration Lead confirms whether intermediate `line_amount` and `tax_amount` round at 2 dp `ROUND_HALF_UP` (zero-padded to 4 dp) or retain 4-dp precision, the contract uses 4-dp `MoneyAmount` strings and the mock server (`erp-3-mock.ts`) performs exact scaled `BigInt` arithmetic at 4 dp without rounding, returning mock-specific `422 DR1_ROUNDING_UNRESOLVED` if an input produces a sub-4-dp fraction.
2. **DR-2 — Invoice `due_date` Column (Resolved by Authoritative Hierarchy — Mandatory)**:
   - Required by `V1_30_ISSUE_STANDARDIZATION_PLAN.md` §8 (*"due date is mandatory for overdue calculation"*) and `CLEARSHIFT_V1_MASTER_ARCHITECTURE_SPEC.md` §5c ERD (`ERP3_INVOICES.due_date`). Under Master Spec Decision `C1` (*"Std Plan wins on conflict"*), this supersedes its omission from the summary table in `SDS_ClearShift_ERP.md` §4.7. Enforced as a required `YYYY-MM-DD` field on `InvoiceSchema` and `CreateInvoiceRequestSchema`.
3. **DR-3 — Detail Read Routes (`GET /sales-orders/{id}`, `GET /invoices/{id}`) (Supported by Slot 04, Awaiting Gate G1 Ratification)**:
   - Required by `V1_30_ISSUE_STANDARDIZATION_PLAN.md` §7 Slot 04 (*Detail/read API and linked-record projection*) and `CLEARSHIFT_V1_MASTER_ARCHITECTURE_SPEC.md` §6.1 / Decision `H1` (*Full authoritative route set derived at G1*), consistent with ERP-1, ERP-2, ERP-4, and ERP-5, though omitted from the 5-row summary table in `SDS_ClearShift_ERP.md` §4.8. Included in `erp-3.yaml` and `erp-3-mock.ts` and flagged for Integration Lead Gate G1 ratification.

---

## Versioned Contract Change Control Log

| Version | Date | Gate / Milestone | Author / Team | Description of Changes |
|---|---|---|---|---|
| **`1.0.0`** | 2026-10-23 | Gate G1 Baseline (Pending Sign-Off) | Group 8 / Role 2 (Issue #150) & UI Team (#29, #30) | Consolidated OpenAPI 3.1 specification, Zod schemas, domain event contracts, deterministic mock server, field specifications, domain invariants, and UI workflow documentation for ERP-3 Sales Orders & Invoices. |
