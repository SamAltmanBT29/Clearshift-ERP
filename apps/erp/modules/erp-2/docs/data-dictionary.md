# ERP-2 Vendors & Purchasing - Data Dictionary (V1)

Source of truth: `apps/erp/modules/erp-2/db/schema.ts` (Drizzle) and `packages/contracts/src/erp-2.ts` (Zod).
PostgreSQL schema: `erp2`. API base: `/api/v1/erp-vendors`. Synthetic data only.

## Conventions
- Money: `NUMERIC(18,2)`, never floating point. Quantity: `NUMERIC(12,2)`. API transports both as decimal **strings** (`"215.75"`).
- Rounding: each `line_total = ROUND_HALF_UP(quantity x price, 2)` (decimal.js); order `total` = sum of the rounded line totals. Computed server-side only; a client-supplied `total` is ignored.
- Currency: ISO-4217 code on vendor and purchase order. No FX conversion in V1.
- Bank details: write-only. Input `bank_details`, stored/returned as `bank_masked` = `XXXX-XXXX-<last 4 digits>`. The raw value is never stored or returned.
- No cross-module foreign keys: `po_lines.product_id` is validated against ERP-1 through the `ReferenceResolver` (`exists('product', id)`), not by a database FK (Decision C7).

## erp2.vendors
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | `gen_random_uuid()` |
| name | varchar(255) | no | search target (case-insensitive) |
| tax_number | varchar(64) | no | UNIQUE (`vendors_tax_number_unique`); duplicate -> HTTP 409 `DUPLICATE_TAX_NUMBER` |
| email | varchar(255) | no | |
| phone, address_line, city, country | varchar | yes | |
| bank_masked | varchar(64) | yes | `XXXX-XXXX-7890` |
| currency | varchar(3) | no | default `USD` |
| source_system, source_id | varchar | yes | Migration Kit lineage |
| created_at, updated_at | timestamptz | no | default `now()` |

## erp2.purchase_orders
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| po_number | varchar(64) | no | UNIQUE; generated `PO-<epoch>-<4 hex>` when omitted |
| vendor_id | uuid FK -> vendors.id | no | unknown vendor -> HTTP 422 `VENDOR_NOT_FOUND` |
| order_date | date | no | |
| status | enum `erp2.po_status` | no | `Draft` -> `Sent` -> `Received` -> `Closed` only; default `Draft` |
| currency | varchar(3) | no | defaults to vendor currency |
| total | numeric(18,2) | no | server computed |
| created_at, updated_at | timestamptz | no | |

## erp2.po_lines
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| po_id | uuid FK -> purchase_orders.id | no | `ON DELETE CASCADE` |
| product_id | uuid | no | ERP-1 product, resolver-validated (BR-ERP2-01), unknown -> HTTP 422 `UNKNOWN_PRODUCT` |
| quantity | numeric(12,2) | no | > 0 |
| price | numeric(18,2) | no | >= 0 |
| line_total | numeric(18,2) | no | server computed |

## erp2.import_receipts (Migration Kit, KIT-08 / Decision C4)
One durable receipt per `idempotency_key` (UNIQUE), written in the **same transaction** as the business row.
Same key + same payload hash -> replay (HTTP 200, no new rows). Same key + different payload -> HTTP 409 `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`.
Columns: id, batch_id, source_row, source_system, source_id, entity (`vendor`|`purchase_order`), schema_version, idempotency_key, request_hash (sha256 of canonical JSON), target_id, kind, outcome, response_payload, created_at.

## Status machine (FR-ERP2-04)
| From | Allowed next |
|---|---|
| Draft | Sent |
| Sent | Received |
| Received | Closed |
| Closed | (terminal) |
Backwards moves, skips and cancellation are rejected with HTTP 422 `INVALID_STATUS_TRANSITION`. `Received` does not change inventory (goods receipts are V2).

## Error envelope
`{ statusCode, error, code, message, details[], correlation_id }`. Codes: `VALIDATION_ERROR` 400, `INVALID_UUID` 400, `UNAUTHORIZED` 401, `NOT_FOUND` 404, `DUPLICATE_TAX_NUMBER` / `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` 409, domain codes 422, `INTERNAL_SERVER_ERROR` 500 (message masked).
