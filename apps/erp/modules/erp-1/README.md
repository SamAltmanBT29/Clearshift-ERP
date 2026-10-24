# ERP-1 Products & Inventory (V1) — Runbook & Module Documentation

Package `@cs/mod-erp1`. API base `/api/v1/erp-products`.
Tables: `erp1_categories`, `erp1_warehouses`, `erp1_products`, `erp1_stock_levels`, `erp1_import_receipts` (schema `erp1`).
Data dictionary: [`docs/data-dictionary.md`](docs/data-dictionary.md) — Contract: `packages/contracts/openapi/erp-1.yaml` — Demo: `docs/demo-scripts/erp-1-v1.md`.

---

## Public Endpoints
| Method | Path | Summary / Invariants Enforced |
|---|---|---|
| GET | `/products` | Search by name / SKU (case-insensitive), category filter, price bounds, stockStatus, bounded pagination (`pageSize` max 100) |
| GET | `/products/{id}` | Product master details |
| POST | `/products` | SKU uniqueness in database (BR-ERP1-01), unit of measure validation (FR-ERP1-04), explicit ISO 4217 currency (`USD`), decimal price |
| PATCH | `/products/{id}` | Update product attributes; re-validates SKU uniqueness on modification |
| GET | `/products/{id}/linked-records` | Linked stock locations and transaction history |
| GET | `/categories` | List product categories |
| POST | `/categories` | Create category; enforces one-level hierarchy only in V1 (FR-ERP1-03) |
| GET | `/categories/{id}` | Category details |
| PATCH | `/categories/{id}` | Update category name / code |
| GET | `/stock` | Stock levels per product and warehouse |
| POST | `/stock/opening` | Set opening stock; strictly enforces non-negative quantity check (BR-ERP1-02) |
| GET | `/migration-metadata` | Module field registry for Migration Kit |
| GET | `/rejections` | Module-specific rejection review context and rules |

---

## Execution & Test Commands
```bash
node -v                                     # Must be Node.js 24 LTS
npm install
npm run lint && npm run typecheck
npx vitest run apps/erp/modules/erp-1       # Domain, API, contract parity, seed, and e2e demo journey
DATABASE_URL=postgres://user:pass@localhost:5432/clearshift_test npx vitest run apps/erp/modules/erp-1/tests/db
```
*Note: DB constraint tests skip cleanly with an informative message if `DATABASE_URL` is not provided.*

| Layer | Location |
|---|---|
| Domain unit & invariants | `tests/domain/` |
| Fastify injection (endpoints, error envelope, validation, idempotency) | `tests/api/`, `tests/seed/` |
| DB constraints / transactions (PostgreSQL) | `tests/db/constraints.test.ts`, `tests/db/schema.test.ts` |
| OpenAPI <-> routes parity | `tests/contract/openapi-parity.test.ts` |
| Deterministic seed | `sample-data/erp-1/seed.ts`, `tests/seed/seed.test.ts` |
| Scripted demo journey | `tests/e2e/demo-journey.test.ts` |
| Web UI / RTL component tests | `web/tests/` |

---

## Seed & Reset
```bash
# Public API idempotent seed:
ERP1_BASE_URL=http://localhost:3000 node sample-data/erp-1/seed.ts

# Full local reset:
npm run db:reset
```

---

## Invariants and Where They Are Asserted
| Invariant | Test Suite Reference |
|---|---|
| **BR-ERP1-01**: SKU is unique in the database, not only in the UI | `tests/domain/invariants.test.ts`, `tests/db/schema.test.ts`, `tests/e2e/demo-journey.test.ts` |
| **BR-ERP1-02**: Stock quantity cannot become negative | `tests/domain/invariants.test.ts`, `tests/db/schema.test.ts`, `tests/api/auth-and-envelope.test.ts` |
| **FR-ERP1-03**: Category hierarchy is strictly one level only in V1 | `tests/domain/invariants.test.ts`, `tests/e2e/demo-journey.test.ts` |
| **FR-ERP1-04**: Unit of measure is one of `pcs, kg, g, litre, metre, box` | `tests/domain/invariants.test.ts`, `packages/contracts/tests/erp-1.test.ts` |
| **FR-ERP1-05**: Operates exactly one default warehouse in V1 (`WH-01`) | `tests/domain/invariants.test.ts`, `tests/db/schema.test.ts` |
| Explicit uppercase ISO-4217 currency (`USD`) required on creation | `tests/domain/invariants.test.ts`, `tests/api/auth-and-envelope.test.ts` |
| Exact decimal handling: NUMERIC(19,4) price and NUMERIC(5,2) tax rate | `tests/domain/invariants.test.ts`, `packages/contracts/tests/erp-1.test.ts` |
| Idempotent seed execution and durable import receipts | `tests/seed/seed.test.ts`, `sample-data/erp-1/seed.ts` |
| Error envelope conforming to `{ statusCode, error, code, message, details, correlation_id }` | `tests/api/auth-and-envelope.test.ts` |

---

## Known Defects & Handoff Tracking
| # | Sev | Defect | Status |
|---|---|---|---|
| 1 | P1 | Multi-warehouse stock transfers and location tracking | Out of scope for V1; deferred to V2 (FR-ERP1-05 restricts to single warehouse) |
| 2 | P1 | Automated fuzzy SKU duplicate matching | Prohibited by V1 core rules; exact normalized matching only |
| 3 | P2 | Compensating rollback sagas for failed batch loads | Out of scope for V1; bounded retry and durable receipts applied |
| 4 | P2 | Real-time webhook delivery for outbound stock events | Out of scope for V1; transactional outbox pattern used |
