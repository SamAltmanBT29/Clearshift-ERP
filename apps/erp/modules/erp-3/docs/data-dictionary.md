# ERP-3 Sales Orders & Invoices — Module Data Dictionary

See also the canonical global reference copy at [`docs/data-dictionaries/erp-3.md`](../../../../../docs/data-dictionaries/erp-3.md) and architecture decision record [`docs/adr/ADR-005-erp-3-api-contract-and-mock-baseline.md`](../../../../../docs/adr/ADR-005-erp-3-api-contract-and-mock-baseline.md).

---

## 1. Module Boundaries & Ownership

- **Module ID**: `erp3` (Group 8 — Sales Orders & Invoices)
- **PostgreSQL Schema**: `erp3` (Namespace isolation)
- **Primary Migration**: `packages/database/migrations/erp3_v1.sql` (guarded, idempotent, tracked in `public.schema_migrations`)
- **Drizzle Model**: `apps/erp/modules/erp-3/db/schema.ts` (re-exported via `@clearshift/database`)
- **Primary Keys**: UUID (`gen_random_uuid()`)
- **Monetary & Quantities**: PostgreSQL `NUMERIC(19, 4)` for currency amounts; `NUMERIC(12, 4)` for quantities; `NUMERIC(6, 4)` for percentage tax rates.
- **Cross-Module Boundaries (Decision C7)**:
  - `customer_golden_id` (UUID): Reference to CRM-1 / Hub Golden ID registry (`golden_records.id` per ADR-003). Never mutated by ERP-3; no cross-module database foreign key constraint.
  - `product_id` (UUID): Reference to ERP-1 Products & Inventory (`erp1_products.id`). No cross-module database foreign key constraint.
  - All foreign keys are strictly intra-module within schema `erp3`.

---

## 2. Table Specifications

### 2.1 Table: `erp3.sales_orders` (Sales Order Header)
Primary record for customer sales orders.

| Column | PostgreSQL Type | Nullable | Default | Constraints & Meaning |
|---|---|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `order_number` | `VARCHAR(64)` | No | — | Human-readable unique order number (`sales_orders_order_number_unique`, `sales_orders_number_not_empty`) |
| `customer_golden_id` | `UUID` | No | — | Hub-resolved customer Golden ID (`BR-ERP3-03`). Indexed via `sales_orders_customer_idx` |
| `order_date` | `DATE` | No | — | Calendar order date (`YYYY-MM-DD`). Indexed via `sales_orders_date_idx` |
| `status` | `erp3.sales_order_status` | No | `'Open'` | Enum: `'Open'`, `'Invoiced'`, `'Closed'`. Indexed via `sales_orders_status_idx` |
| `currency` | `VARCHAR(3)` | No | `'USD'` | ISO 4217 3-letter currency code |
| `subtotal` | `NUMERIC(19, 4)` | No | `0.0000` | Server-computed sum of line subtotals (`sales_orders_subtotal_non_negative`) |
| `tax_total` | `NUMERIC(19, 4)` | No | `0.0000` | Server-computed sum of line tax amounts (`sales_orders_tax_total_non_negative`) |
| `total` | `NUMERIC(19, 4)` | No | `0.0000` | Authoritative server-computed document total (`sales_orders_total_non_negative`) |
| `source_system` | `VARCHAR(64)` | Yes | `NULL` | Migration source system identifier |
| `source_id` | `VARCHAR(128)` | Yes | `NULL` | Migration source record identifier |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | UTC creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | No | `now()` | UTC last-updated timestamp |

### 2.2 Table: `erp3.so_lines` (Sales Order Lines)
Line items belonging to a sales order.

| Column | PostgreSQL Type | Nullable | Default | Constraints & Meaning |
|---|---|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `order_id` | `UUID` | No | — | FK to `erp3.sales_orders(id)` `ON DELETE CASCADE`. Indexed via `so_lines_order_id_idx` |
| `line_number` | `INTEGER` | No | — | Line item index; unique per order (`so_lines_order_line_unique`) |
| `product_id` | `UUID` | No | — | Logical reference to ERP-1 product |
| `quantity` | `NUMERIC(12, 4)` | No | — | Ordered quantity; strictly positive (`so_lines_quantity_positive`) |
| `unit_price` | `NUMERIC(19, 4)` | No | — | Unit price; non-negative (`so_lines_unit_price_non_negative`) |
| `tax_rate` | `NUMERIC(6, 4)` | No | `0.0000` | Tax percentage; range 0.0000 to 100.0000 (`so_lines_tax_rate_range`) |
| `tax_amount` | `NUMERIC(19, 4)` | No | `0.0000` | Server-computed tax (`so_lines_tax_amount_non_negative`, `BR-ERP3-02`) |
| `line_total` | `NUMERIC(19, 4)` | No | — | Server-computed line total (`so_lines_line_total_non_negative`, `BR-ERP3-01`) |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | UTC creation timestamp |

### 2.3 Table: `erp3.invoices` (Invoices)
Billing documents issued to customers.

| Column | PostgreSQL Type | Nullable | Default | Constraints & Meaning |
|---|---|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `invoice_number` | `VARCHAR(64)` | No | — | Human-readable unique invoice number (`invoices_invoice_number_unique`, `invoices_number_not_empty`) |
| `order_id` | `UUID` | Yes | `NULL` | FK to `erp3.sales_orders(id)`. Unique constraint `invoices_order_id_unique` enforces at most one V1 invoice per order |
| `customer_golden_id` | `UUID` | No | — | Customer Golden ID (`BR-ERP3-03`). Indexed via `invoices_customer_idx` |
| `invoice_date` | `DATE` | No | — | Calendar issue date |
| `due_date` | `DATE` | No | — | Mandatory payment due date (`invoices_due_date_after_or_equal_invoice_date`). Indexed via `invoices_due_date_idx` |
| `status` | `erp3.invoice_status` | No | `'Open'` | Enum: `'Open'`, `'Paid'`, `'Overdue'`. Indexed via `invoices_status_idx` |
| `currency` | `VARCHAR(3)` | No | `'USD'` | ISO 4217 3-letter currency code |
| `subtotal` | `NUMERIC(19, 4)` | No | `0.0000` | Server-computed subtotal (`invoices_subtotal_non_negative`) |
| `tax_total` | `NUMERIC(19, 4)` | No | `0.0000` | Server-computed tax total (`invoices_tax_total_non_negative`) |
| `total` | `NUMERIC(19, 4)` | No | `0.0000` | Server-computed total (`invoices_total_non_negative`) |
| `source_system` | `VARCHAR(64)` | Yes | `NULL` | Migration source system identifier |
| `source_id` | `VARCHAR(128)` | Yes | `NULL` | Migration source record identifier |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | UTC creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | No | `now()` | UTC last-updated timestamp |

### 2.4 Table: `erp3.invoice_lines` (Invoice Lines)
Line items belonging to an invoice.

| Column | PostgreSQL Type | Nullable | Default | Constraints & Meaning |
|---|---|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `invoice_id` | `UUID` | No | — | FK to `erp3.invoices(id)` `ON DELETE CASCADE`. Indexed via `invoice_lines_invoice_id_idx` |
| `line_number` | `INTEGER` | No | — | Line item index; unique per invoice (`invoice_lines_invoice_line_unique`) |
| `product_id` | `UUID` | No | — | Logical reference to ERP-1 product |
| `quantity` | `NUMERIC(12, 4)` | No | — | Invoiced quantity; strictly positive (`invoice_lines_quantity_positive`) |
| `unit_price` | `NUMERIC(19, 4)` | No | — | Unit price; non-negative (`invoice_lines_unit_price_non_negative`) |
| `tax_rate` | `NUMERIC(6, 4)` | No | `0.0000` | Tax percentage; range 0.0000 to 100.0000 (`invoice_lines_tax_rate_range`) |
| `tax_amount` | `NUMERIC(19, 4)` | No | `0.0000` | Server-computed tax (`invoice_lines_tax_amount_non_negative`) |
| `line_total` | `NUMERIC(19, 4)` | No | — | Server-computed line total (`invoice_lines_line_total_non_negative`) |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | UTC creation timestamp |

### 2.5 Table: `erp3.payments` (Invoice Settlement Payments)
Payment settlement records applied to invoices.

| Column | PostgreSQL Type | Nullable | Default | Constraints & Meaning |
|---|---|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `invoice_id` | `UUID` | No | — | FK to `erp3.invoices(id)`. Indexed via `payments_invoice_id_idx` |
| `amount` | `NUMERIC(19, 4)` | No | — | Payment amount; strictly positive (`payments_amount_positive`) |
| `currency` | `VARCHAR(3)` | No | `'USD'` | ISO 4217 3-letter currency code |
| `payment_date` | `DATE` | No | — | Payment settlement calendar date. Indexed via `payments_date_idx` |
| `payment_method` | `erp3.payment_method` | No | — | Enum: `'cash'`, `'bank'`, `'card'` (`FR-ERP3-03`) |
| `reference` | `VARCHAR(128)` | Yes | `NULL` | External transaction / check / reference number |
| `idempotency_key` | `VARCHAR(128)` | Yes | `NULL` | Client-provided or migration idempotency key |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | UTC creation timestamp |

### 2.6 Table: `erp3.import_receipts` (Durable Idempotency Receipts)
Idempotent ledger required by Migration Kit (KIT-08 / Decision C4).

| Column | PostgreSQL Type | Nullable | Default | Constraints & Meaning |
|---|---|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `batch_id` | `UUID` | No | — | Migration batch identifier |
| `source_row` | `INTEGER` | No | — | Source row number in batch |
| `source_system` | `VARCHAR(64)` | Yes | `NULL` | Source system identifier |
| `source_id` | `VARCHAR(128)` | Yes | `NULL` | Source entity identifier |
| `entity` | `VARCHAR(64)` | No | — | Entity type: `'sales_order'`, `'invoice'`, `'payment'` |
| `schema_version` | `INTEGER` | No | `1` | Schema version of entity |
| `idempotency_key` | `VARCHAR(128)` | No | — | Unique key: `batch_id + row + version` (`import_receipts_erp3_idempotency_key_unique`) |
| `request_hash` | `VARCHAR(64)` | No | — | SHA-256 canonical hash of request payload |
| `target_id` | `UUID` | No | — | UUID of created/linked business row |
| `kind` | `VARCHAR(16)` | No | `'created'` | Receipt kind (`created` \| `linked`) |
| `outcome` | `VARCHAR(16)` | No | `'loaded'` | Outcome (`loaded` \| `rejected` \| `merged` \| `skipped`) |
| `response_payload` | `TEXT` | Yes | `NULL` | Serialized JSON response |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | Ingestion timestamp |

---

## 3. Enumerated Types

```sql
CREATE TYPE erp3.sales_order_status AS ENUM ('Open', 'Invoiced', 'Closed');
CREATE TYPE erp3.invoice_status AS ENUM ('Open', 'Paid', 'Overdue');
CREATE TYPE erp3.payment_method AS ENUM ('cash', 'bank', 'card');
```

---

## 4. Invariants Enforced at Schema & DB Level

1. **UUID Primary Keys**: Every table uses a `UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
2. **Deterministic Uniqueness**:
   - `sales_orders.order_number` is unique.
   - `invoices.invoice_number` is unique.
   - `invoices.order_id` is unique (enforcing at most one V1 invoice per sales order).
   - `(order_id, line_number)` is unique on `so_lines`.
   - `(invoice_id, line_number)` is unique on `invoice_lines`.
   - `import_receipts.idempotency_key` is unique.
3. **Check Constraints**:
   - Quantities are strictly positive (`> 0`).
   - Prices, tax amounts, line totals, and document totals are non-negative (`>= 0`).
   - Tax rates are bounded percentages (`>= 0 AND <= 100`).
   - Payment amounts are strictly positive (`> 0`).
   - Invoice `due_date >= invoice_date`.
4. **Referential Integrity & Cascades**:
   - Order lines cascade delete when the parent sales order is deleted (`ON DELETE CASCADE`).
   - Invoice lines cascade delete when the parent invoice is deleted (`ON DELETE CASCADE`).
   - Cross-module relationships use logical UUID columns without DB-level foreign keys.
