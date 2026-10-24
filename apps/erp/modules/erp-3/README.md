# ERP-3 Sales Orders & Invoices (V1) — Runbook & Evidence Guide

Package `@cs/mod-erp3`. API base `/api/v1/erp-orders`. Tables `erp3.sales_orders`, `erp3.so_lines`, `erp3.invoices`, `erp3.invoice_lines`, `erp3.payments`, `erp3.import_receipts`.

- **Data dictionary (module)**: [`apps/erp/modules/erp-3/docs/data-dictionary.md`](docs/data-dictionary.md)
- **Data dictionary (canonical)**: [`docs/data-dictionaries/erp-3.md`](../../../../docs/data-dictionaries/erp-3.md)
- **OpenAPI 3.1 contract**: [`packages/contracts/openapi/erp-3.yaml`](../../../../packages/contracts/openapi/erp-3.yaml)
- **Security and authorization runbook**: [`apps/erp/modules/erp-3/docs/security.md`](docs/security.md)
- **Demo script**: [`docs/demo-scripts/erp-3-v1.md`](../../../../docs/demo-scripts/erp-3-v1.md)

---

## 1. Endpoints

All endpoints are hosted under `/api/v1/erp-orders`:

| Method | Path | Summary & Notes |
|---|---|---|
| `GET` | `/sales-orders` | Paged list of sales orders; filters: `status`, `customer_golden_id`, `currency`, `from_date`, `to_date`, `search` |
| `GET` | `/sales-orders/{id}` | Retrieve sales order with embedded line items |
| `POST` | `/sales-orders` | Create sales order; server re-computes `tax_amount`, `line_total`, and `total` server-side (`BR-ERP3-01`) |
| `PATCH` | `/sales-orders/{id}` | Update sales order status (`Open` → `Invoiced` → `Closed` forward-only) |
| `GET` | `/invoices` | Paged list of invoices; filters: `status`, `customer_golden_id`, `order_id`, `currency`, `from_date`, `to_date`, `search` |
| `GET` | `/invoices/{id}` | Retrieve single invoice with embedded line items |
| `POST` | `/invoices` | Create billing invoice; mandatory `due_date`; enforces at most one V1 invoice per sales order |
| `GET` | `/payments` | Paged list of recorded payments; optional `invoice_id` filter |
| `POST` | `/payments` | Record payment; auto-transitions invoice to `Paid` upon full payment (`FR-ERP3-04`) |
| `POST` | `/import` | Durable migration import adapter (KIT-08 / Decision C4) |

---

## 2. Invariants & Evidence Mapping

| Domain Invariant | Enforced By | Tested In |
|---|---|---|
| **Every order has a valid customer Golden ID** (`BR-ERP3-03`) | Fastify Zod schema validation & domain rules | `apps/erp/modules/erp-3/tests/domain/rules.test.ts`, `apps/erp/modules/erp-3/tests/api/mutations.test.ts` |
| **Server-side line subtotal & tax matching document total** (`BR-ERP3-01`, `BR-ERP3-02`) | Server recomputes totals; client totals ignored | `apps/erp/modules/erp-3/tests/domain/rules.test.ts`, `apps/erp/modules/erp-3/tests/api/mutations.test.ts` |
| **Unique invoice number and at most one V1 invoice per sales order** | Unique constraint in PostgreSQL & application check | `apps/erp/modules/erp-3/tests/api/mutations.test.ts`, `packages/database/migrations/erp3_v1.sql` |
| **Mandatory invoice `due_date`; Overdue derived strictly when UTC calendar date > `due_date`** (`FR-ERP3-02`) | Schema requirement & `deriveInvoiceStatus` | `apps/erp/modules/erp-3/tests/domain/rules.test.ts`, `apps/erp/modules/erp-3/tests/api/mutations.test.ts` |
| **V1 accepts one full payment per invoice; partial/overpayment rejected** (`FR-ERP3-03`, `FR-ERP3-04`) | Payment validation rules | `apps/erp/modules/erp-3/tests/domain/rules.test.ts`, `apps/erp/modules/erp-3/tests/api/mutations.test.ts` |
| **Full payment automatically transitions invoice to `Paid`** (`FR-ERP3-04`) | `Erp3Service` state update | `apps/erp/modules/erp-3/tests/api/mutations.test.ts`, `packages/contracts/tests/erp-3.mock.test.ts` |
| **Forward-only sales order status transitions** (`FR-ERP3-05`) | `assertValidOrderStatusTransition` | `apps/erp/modules/erp-3/tests/domain/rules.test.ts`, `apps/erp/modules/erp-3/tests/api/mutations.test.ts` |
| **Idempotent Migration Kit ingestion** (`KIT-08`) | `import_receipts` table + transactional commit | `apps/erp/modules/erp-3/tests/api/mutations.test.ts` |

---

## 3. Running Verification & Evidence

```bash
# 1. Strict TypeScript check (0 errors)
npm run typecheck

# 2. Strict ESLint check (0 errors)
npm run lint

# 3. Security scanner check (0 secrets / unapproved uploads)
npm run security:scan

# 4. Vitest unit and API mutation tests
npx vitest run apps/erp/modules/erp-3/tests

# 5. OpenAPI and event contract tests
npx vitest run packages/contracts/tests/erp-3*
```

---

## 4. Deterministic Seed & Reset

```bash
# Public API deterministic seed
ERP3_BASE_URL=http://localhost:3000 node sample-data/erp-3/seed.ts
```
