# ERP-2 Vendors & Purchasing — Data Dictionary (Global Reference)

This document is the global-docs copy of the module data dictionary.

For the canonical, detailed version see:
[`apps/erp/modules/erp-2/docs/data-dictionary.md`](../../apps/erp/modules/erp-2/docs/data-dictionary.md)

---

## Module Summary

| Field | Value |
|---|---|
| **Module** | ERP-2 Vendors & Purchasing (Group 7) |
| **Issue** | #16 — `[ERP2-01] ERP-2 Vendors and Purchasing schema, Drizzle models, and guarded migrations` |
| **PostgreSQL Schema** | `erp2` |
| **API Base** | `/api/v1/erp-vendors` |
| **OpenAPI Contract** | `packages/contracts/openapi/erp-2.yaml` |
| **Zod Contract** | `packages/contracts/src/erp-2.ts` |
| **Drizzle Model** | `apps/erp/modules/erp-2/db/schema.ts` |
| **Migration** | `packages/database/migrations/erp2_v1.sql` |
| **Tables** | `erp2.vendors`, `erp2.purchase_orders`, `erp2.po_lines`, `erp2.import_receipts` |
| **Version** | V1.0 |
| **SDS Reference** | ClearShift ERP v2.0 §4.3 (FR-ERP2-01..06, BR-ERP2-01), §4.7 (ERP-2 tables) |

## Table Index

| Table | Purpose | Key Constraint |
|---|---|---|
| `erp2.vendors` | Vendor master records | UNIQUE(`tax_number`), CHECK(`length(trim(name)) > 0`), CHECK(bank mask) |
| `erp2.purchase_orders` | Purchase order headers | UNIQUE(`po_number`), FK → `erp2.vendors`, CHECK(`total >= 0`) |
| `erp2.po_lines` | Purchase order lines | UNIQUE(`po_id`, `line_number`), FK → `erp2.purchase_orders`, CHECK(`quantity > 0`) |
| `erp2.import_receipts` | Idempotency & migration audit | UNIQUE(`idempotency_key`), INDEX(`batch_id`, `source_row`) |

## API Endpoints Baseline

All collection endpoints support bounded pagination (`page >= 1`, `pageSize <= 100`, default 20) and search queries.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/erp-vendors/vendors` | Search and list vendors with bounded paging |
| `POST` | `/api/v1/erp-vendors/vendors` | Create new vendor (bank details masked upon serialization) |
| `PATCH` | `/api/v1/erp-vendors/vendors/{id}` | Update vendor details |
| `GET` | `/api/v1/erp-vendors/purchase-orders` | List purchase orders with status/vendor filters |
| `GET` | `/api/v1/erp-vendors/purchase-orders/{id}` | Retrieve purchase order with line items |
| `POST` | `/api/v1/erp-vendors/purchase-orders` | Create purchase order with validated lines |
| `PATCH` | `/api/v1/erp-vendors/purchase-orders/{id}` | Advance purchase order status (`draft` -> `sent` -> `received` -> `closed`) |

## Domain Rules

- **Product Reference (BR-ERP2-01)**: Every purchase order line must reference an existing product through the owning ERP-1 API contract. Unknown product = rejected row.
- **Server-Side Total Recomputation (FR-ERP2-05)**: Order total is recomputed server-side from lines using decimal arithmetic (`total = sum(line_total)`).
- **Status Progression (FR-ERP2-04)**: Status flow is strictly forward-only: `draft` -> `sent` -> `received` -> `closed`. Backwards transitions or cancellations are rejected in V1.
- **Bank Details Protection (FR-ERP2-06)**: Bank details are masked everywhere in format `XXXX-XXXX-7890`. Raw bank numbers are never returned in public API payloads or log output.
- **Namespace & FK Isolation (Decision C7)**: All foreign keys in `erp2` target `erp2` tables only. No direct database foreign keys cross module schema boundaries.
