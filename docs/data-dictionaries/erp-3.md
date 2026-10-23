# ERP-3 Sales Orders and Invoices — Data Dictionary

This document specifies the canonical data dictionary for ERP-3 Sales Orders and Invoices (Group 8).

---

## Module Summary

| Field | Value |
|---|---|
| **Module** | ERP-3 Sales Orders and Invoices |
| **Issues** | #26 (Data Model), #27 (List/Read API & Contracts), #28 (Mutation API & Domain Validation), #29 (List Screen & UI States), #30 (Create/Edit Workflow), #31 (Relationships) |
| **PostgreSQL Schema** | `erp3` |
| **API Base** | `/api/v1/erp-orders` |
| **OpenAPI Contract** | `packages/contracts/openapi/erp-3.yaml` |
| **Zod Contracts** | `packages/contracts/src/erp-3.ts` |
| **Tables** | `erp3_sales_orders`, `erp3_so_lines`, `erp3_invoices`, `erp3_payments` |
| **Version** | V1.0 |
| **SDS Reference** | ClearShift ERP v2.0 §4.4, §4.7; FR-ERP3-01..05, BR-ERP3-01..03 |

---

## Table Index

| Table | Purpose | Key Constraints |
|---|---|---|
| `erp3_sales_orders` | Header record for customer purchase orders | `id` (PK, UUID), `customer_golden_id` NOT NULL, `order_number` UNIQUE, `status` CHECK (open, invoiced, closed) |
| `erp3_so_lines` | Line items detailing product, quantity, unit price, tax, and totals | `id` (PK, UUID), `order_id` (FK to `erp3_sales_orders`), `product_id` NOT NULL, `quantity` > 0, `line_total` = subtotal + tax |
| `erp3_invoices` | Billing document generated against an order | `id` (PK, UUID), `order_id` (FK, unique in V1), `invoice_number` UNIQUE, `due_date` NOT NULL, `status` (open, paid, overdue) |
| `erp3_payments` | Cash, bank, or card payments applied to an invoice | `id` (PK, UUID), `invoice_id` (FK to `erp3_invoices`), `amount` > 0, `method` CHECK (cash, bank, card) |

---

## Field Specifications

### 1. `erp3_sales_orders`

| Field | Type | Required | Description | Example | Validation Rule |
|---|---|---|---|---|---|
| `id` | UUID | Yes | Primary key | `550e8400-e29b-41d4-a716-446655440000` | UUID v4 |
| `order_number` | VARCHAR(32) | Yes | Human-readable sequential order number | `SO-1001` | Unique across tenant |
| `customer_golden_id` | VARCHAR(64) | Yes | Hub-resolved customer Golden ID | `gid-cust-001` | Must match `gid-*` |
| `order_date` | DATE | Yes | Date order was placed | `2026-10-23` | Valid ISO date |
| `status` | VARCHAR(20) | Yes | Order lifecycle state | `open` | Enum: `open`, `invoiced`, `closed` |
| `subtotal` | NUMERIC(12,2) | Yes | Sum of line subtotals | `1250.00` | Non-negative decimal |
| `tax_total` | NUMERIC(12,2) | Yes | Sum of line taxes | `125.00` | Non-negative decimal |
| `total` | NUMERIC(12,2) | Yes | Total order value | `1375.00` | Must equal `subtotal + tax_total` |
| `currency_code` | CHAR(3) | Yes | ISO 4217 currency code | `USD` | Exactly 3 uppercase letters |
| `notes` | TEXT | No | Optional remarks/shipping info | `Deliver to loading dock 2` | Max 1000 chars |
| `created_at` | TIMESTAMPTZ | Yes | Creation timestamp | `2026-10-23T08:00:00Z` | Server set |
| `updated_at` | TIMESTAMPTZ | Yes | Last update timestamp | `2026-10-23T08:00:00Z` | Server set |

### 2. `erp3_so_lines`

| Field | Type | Required | Description | Example | Validation Rule |
|---|---|---|---|---|---|
| `id` | UUID | Yes | Primary key | `c1a2b3c4-0000-0000-0000-000000000001` | UUID v4 |
| `order_id` | UUID | Yes | Foreign key to `erp3_sales_orders` | `550e8400-e29b-41d4-a716-446655440000` | Valid order ID |
| `product_id` | VARCHAR(64) | Yes | Target product reference (ERP-1) | `prod-widget-a` | Non-empty |
| `quantity` | INTEGER | Yes | Ordered quantity | `10` | > 0 |
| `unit_price` | NUMERIC(12,2) | Yes | Price per unit | `125.00` | >= 0 |
| `tax_rate` | NUMERIC(5,4) | Yes | Tax rate applied | `0.1000` | Decimal, e.g. 0.10 for 10% |
| `tax_amount` | NUMERIC(12,2) | Yes | Computed tax for line | `125.00` | Round(`quantity * unit_price * tax_rate`, 2) |
| `line_total` | NUMERIC(12,2) | Yes | Total line amount | `1375.00` | `quantity * unit_price + tax_amount` |

### 3. `erp3_invoices`

| Field | Type | Required | Description | Example | Validation Rule |
|---|---|---|---|---|---|
| `id` | UUID | Yes | Primary key | `d1a2b3c4-0000-0000-0000-000000000002` | UUID v4 |
| `invoice_number` | VARCHAR(32) | Yes | Unique invoice number | `INV-2026-001` | Unique |
| `order_id` | UUID | Yes | Linked sales order | `550e8400-e29b-41d4-a716-446655440000` | 1-to-1 link in V1 |
| `customer_golden_id` | VARCHAR(64) | Yes | Customer reference | `gid-cust-001` | Matches order's customer |
| `invoice_date` | DATE | Yes | Date invoice was issued | `2026-10-23` | Valid ISO date |
| `due_date` | DATE | Yes | Date payment is due | `2026-11-23` | Required; used for overdue check |
| `total` | NUMERIC(12,2) | Yes | Total invoice amount | `1375.00` | Matches order total |
| `paid_amount` | NUMERIC(12,2) | Yes | Amount paid to date | `0.00` | Default 0.00 |
| `currency_code` | CHAR(3) | Yes | ISO currency code | `USD` | Exactly 3 uppercase letters |
| `status` | VARCHAR(20) | Yes | Invoice state | `open` | Enum: `open`, `paid`, `overdue` |
| `notes` | TEXT | No | Terms or invoice notes | `Net 30 terms` | Max 1000 chars |

### 4. `erp3_payments`

| Field | Type | Required | Description | Example | Validation Rule |
|---|---|---|---|---|---|
| `id` | UUID | Yes | Primary key | `e1a2b3c4-0000-0000-0000-000000000003` | UUID v4 |
| `invoice_id` | UUID | Yes | Foreign key to `erp3_invoices` | `d1a2b3c4-0000-0000-0000-000000000002` | Valid invoice ID |
| `amount` | NUMERIC(12,2) | Yes | Payment amount | `1375.00` | In V1, full payment only |
| `currency_code` | CHAR(3) | Yes | Payment currency | `USD` | Matches invoice currency |
| `paid_at` | DATE | Yes | Date payment was received | `2026-10-24` | Valid ISO date |
| `method` | VARCHAR(20) | Yes | Payment method | `bank` | Enum: `cash`, `bank`, `card` |
| `reference` | VARCHAR(64) | No | Bank transaction / receipt ref | `TXN-987654321` | Safe string |

---

## Domain Invariants (Non-Negotiable)

1. **BR-ERP3-01**: Sum of line subtotals and tax amounts must equal the order total:
   $$\text{Total} = \sum (\text{Line Subtotal}) + \sum (\text{Line Tax})$$
2. **BR-ERP3-02**: Tax per line equals line amount multiplied by the product tax rate, rounded to 2 decimal places:
   $$\text{Tax}_{\text{line}} = \text{round}(\text{Quantity} \times \text{UnitPrice} \times \text{TaxRate}, 2)$$
3. **BR-ERP3-03**: Every order must have a valid customer Golden ID. Orders without a customer Golden ID are rejected.
4. **Invoice State Rule**:
   - An invoice becomes `paid` automatically when the accepted payment equals the invoice total.
   - An unpaid/open invoice becomes `overdue` when the current UTC calendar date is strictly greater than `due_date`.
   - Otherwise, status is `open`.
5. **Single Full Payment in V1**: Partial payments and overpayments are rejected.
