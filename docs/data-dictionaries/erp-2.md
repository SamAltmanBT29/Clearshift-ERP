# ERP-2 Vendors & Purchasing — Data Dictionary (Global Reference)

This document is the global-docs copy of the module data dictionary for ERP-2 (Vendors & Purchasing).

---

## Module Summary

| Field | Value |
|---|---|
| **Module** | ERP-2 Vendors and Purchasing |
| **Issues** | #24 (`24-erp2-09-erp-2-vendors-and-purchasing-authorization-sensitive-field-protection-audit-and-safe-logging`) |
| **PostgreSQL Schema** | `erp2` |
| **API Base** | `/api/v1/erp-vendors` |
| **OpenAPI Contract** | `packages/contracts/openapi/erp-2.yaml` |
| **Tables** | `erp2.erp2_vendors`, `erp2.erp2_purchase_orders`, `erp2.erp2_po_lines`, `erp2.erp2_import_receipts` |
| **Version** | V1.0 |
| **SDS Reference** | ClearShift ERP v2.0 §4.3, §4.7, §4.8; FR-ERP2-01..06, BR-ERP2-01 |

---

## Table Index

| Table | Purpose | Primary Key | Key Constraints & Invariants |
|---|---|---|---|
| `erp2.erp2_vendors` | Vendor master registry | `id (uuid)` | `UNIQUE(tax_number)`, `bank_masked` format `XXXX-XXXX-####` |
| `erp2.erp2_purchase_orders` | Purchase order headers | `id (uuid)` | `UNIQUE(po_number)`, `status` FSM: Draft -> Sent -> Received -> Closed, `total` non-negative `numeric(18,2)` |
| `erp2.erp2_po_lines` | Purchase order line items | `id (uuid)` | `FK(po_id) REFERENCES erp2_purchase_orders(id)`, `product_id` validated via ERP-1 `ReferenceResolver`, `quantity > 0`, `price >= 0` |
| `erp2.erp2_import_receipts` | Idempotent mutation & import tracking | `id (uuid)` | `UNIQUE(idempotency_key)` |

---

## Detailed Table Schemas

### 1. `erp2.erp2_vendors`

| Column | Type | Nullable | Default | Description & Security Policy |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `name` | `varchar(255)` | No | — | Vendor company / business name (searchable) |
| `tax_number` | `varchar(64)` | No | — | Tax identifier (e.g. VAT, EIN, GSTIN) — unique |
| `email` | `varchar(255)` | No | — | Vendor primary contact email |
| `phone` | `varchar(32)` | No | — | Vendor contact phone |
| `address_line` | `varchar(255)` | No | — | Physical street address |
| `city` | `varchar(100)` | No | — | City |
| `country` | `varchar(100)` | No | — | Country name or code |
| `bank_masked` | `varchar(32)` | No | — | **SENSITIVE:** Masked bank account (`XXXX-XXXX-7890`). Never exposed raw. |
| `source_system` | `varchar(64)` | Yes | `NULL` | Migration Kit provenance: source system identifier |
| `source_id` | `varchar(128)` | Yes | `NULL` | Migration Kit provenance: legacy vendor ID |
| `created_at` | `timestamptz` | No | `now()` | Record creation timestamp |
| `updated_at` | `timestamptz` | No | `now()` | Record last modification timestamp |

### 2. `erp2.erp2_purchase_orders`

| Column | Type | Nullable | Default | Description & Security Policy |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `po_number` | `varchar(64)` | No | — | Business PO identifier (e.g. `PO-2026-0001`), unique |
| `vendor_id` | `uuid` | No | — | Foreign key references `erp2_vendors.id` |
| `order_date` | `date` | No | — | Date purchase order was placed (`YYYY-MM-DD`) |
| `status` | `varchar(32)` | No | `'Draft'` | Enum: `Draft`, `Sent`, `Received`, `Closed` |
| `currency_code` | `varchar(3)` | No | `'USD'` | ISO 4217 3-letter currency code |
| `total` | `numeric(18,2)` | No | `0.00` | Recomputed server-side from lines; non-negative |
| `created_at` | `timestamptz` | No | `now()` | Creation timestamp |
| `updated_at` | `timestamptz` | No | `now()` | Update timestamp |

### 3. `erp2.erp2_po_lines`

| Column | Type | Nullable | Default | Description & Security Policy |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `po_id` | `uuid` | No | — | Cascade FK referencing `erp2_purchase_orders.id` |
| `product_id` | `uuid` | No | — | Logical reference to ERP-1 product (asserted via `ReferenceResolver`) |
| `quantity` | `numeric(18,4)` | No | — | Quantity ordered; must be `> 0` |
| `price` | `numeric(18,2)` | No | — | Unit price in order currency; non-negative |
| `line_total` | `numeric(18,2)` | No | — | Computed: `quantity * price` with half-up rounding |
| `created_at` | `timestamptz` | No | `now()` | Creation timestamp |

---

## Security, Sensitivity & Audit Policies

### 1. Bank Details Masking (FR-ERP2-06)
- **Invariant:** Bank details are masked everywhere: screens, API JSON responses, error logs, and application logs show `XXXX-XXXX-7890`.
- **Normalization:** Any input string containing a bank account number is stripped of spaces and hyphens. The last 4 alphanumeric characters are preserved, yielding `XXXX-XXXX-<last4>`. If input has fewer than 4 characters, default `XXXX-XXXX-7890` is applied.
- Raw unmasked bank numbers are never stored in plain text or serialized to clients.

### 2. Authorization & RBAC Policy
All API operations enforce JWT verification via `@cs/identity` and role capabilities:
- `GET /api/v1/erp-vendors/vendors`: `viewer`, `editor`, `analyst`, `admin`
- `POST /api/v1/erp-vendors/vendors`: `editor`, `migration_runner`, `admin`
- `PATCH /api/v1/erp-vendors/vendors/:id`: `editor`, `migration_runner`, `admin`
- `GET /api/v1/erp-vendors/purchase-orders`: `viewer`, `editor`, `analyst`, `admin`
- `GET /api/v1/erp-vendors/purchase-orders/:id`: `viewer`, `editor`, `analyst`, `admin`
- `POST /api/v1/erp-vendors/purchase-orders`: `editor`, `migration_runner`, `admin`
- `PATCH /api/v1/erp-vendors/purchase-orders/:id`: `editor`, `migration_runner`, `admin` (status transition only)

Unauthenticated callers receive `401 Unauthorized`. Authenticated callers lacking permission receive `403 Forbidden`.

### 3. Safe Logging Policy
- Fastify/Pino loggers redact headers (`Authorization`, `Cookie`) and payload keys (`bank_details`, `password`, `token`, `salary`).
- Raw database rows containing private data are never logged in full.

### 4. Audit Trail Integration (platform.audit)
- Material state changes (`VENDOR_CREATED`, `VENDOR_UPDATED`, `PO_CREATED`, `PO_STATUS_CHANGED`) write structured audit records to `platform.audit`.
- Audit logs capture `actor`, `action`, `entity`, `entity_id`, and `diff_redacted` without copying sensitive plain-text values.
