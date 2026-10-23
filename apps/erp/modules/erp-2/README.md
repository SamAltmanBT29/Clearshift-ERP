# ERP-2 Vendors & Purchasing (V1) - runbook

Package `@cs/mod-erp2`. API base `/api/v1/erp-vendors`. Tables `erp2_vendors, erp2_purchase_orders, erp2_po_lines` (schema `erp2`) plus `import_receipts`.
Data dictionary: [`docs/data-dictionary.md`](docs/data-dictionary.md) - contract: `packages/contracts/openapi/erp-2.yaml` - demo: `docs/demo-scripts/erp-2-v1.md`.

## Endpoints
| Method | Path | Notes |
|---|---|---|
| GET | /vendors | `search` (name / tax number, case-insensitive), `page`, `pageSize` (max 100) |
| GET | /vendors/{id} | |
| POST | /vendors | bank details masked; optional `Idempotency-Key` + `batch_id` -> durable import path |
| PATCH | /vendors/{id} | editable fields only |
| GET | /purchase-orders | `vendor_id`, `status`, paging |
| GET | /purchase-orders/{id} | with lines |
| POST | /purchase-orders | total recomputed server-side; every line product validated via ERP-1 |
| PATCH | /purchase-orders/{id} | status transition only |
| POST | /import | Migration Kit row import (KIT-08) |
| POST | /duplicates/check | Deterministic exact duplicate scanner (ERP2-12 / KIT-10) |
| GET | /duplicates/candidates | List held duplicate candidates with entity/status filtering |
| GET | /duplicates/candidates/{id} | Retrieve duplicate candidate details and diffs |
| POST | /duplicates/review | Human review decision (MERGE, REJECT, KEEP_BOTH) with immutable audit logging |

## Run the evidence
```bash
node -v                                     # must be v24.x
npm install
npm run lint && npm run typecheck
npx vitest run apps/erp/modules/erp-2       # domain, API, contract, seed, e2e (DB tests skip without DATABASE_URL)
DATABASE_URL=postgres://user:pass@localhost:5432/clearshift_test npx vitest run apps/erp/modules/erp-2/tests/db
```
The DB suite TRUNCATEs `erp2.*` - use a throw-away database (`npm run compose:up`).

| Layer | Location |
|---|---|
| Domain unit | `tests/domain/` |
| Fastify injection (every endpoint, auth, validation, idempotency) | `tests/api/`, `tests/migration/` |
| DB constraints / transactions (real PostgreSQL) | `tests/db/constraints.test.ts` |
| OpenAPI <-> routes parity | `tests/contract/openapi-parity.test.ts` |
| Deterministic seed | `sample-data/erp-2/seed.ts`, `tests/seed/` |
| Scripted demo journey | `tests/e2e/demo-journey.test.ts` |

## Seed / reset
```bash
ERP2_BASE_URL=http://localhost:3000 ERP2_AUTH_TOKEN=... node sample-data/erp-2/seed.ts   # idempotent, public API only
npm run db:reset                                                                           # full reset
```

## Invariants and where they are asserted
| Invariant | Test |
|---|---|
| Every PO line references an existing ERP-1 product | `tests/api/purchase-orders.test.ts` (UNKNOWN_PRODUCT), `tests/e2e/demo-journey.test.ts`, `tests/seed/seed.test.ts` |
| Total recomputed server-side, decimal, half-up | `tests/domain/invariants.test.ts`, `tests/api/purchase-orders.test.ts`, `tests/seed/seed.test.ts` |
| Draft -> Sent -> Received -> Closed only | `tests/domain/invariants.test.ts` (all 16 pairs), `tests/api/mutations.test.ts` |
| Received does not change inventory | `tests/e2e/demo-journey.test.ts` |
| Bank details never unmasked (`XXXX-XXXX-7890`) | `tests/domain/invariants.test.ts`, `tests/api/list.test.ts`, `tests/seed/seed.test.ts` |
| NUMERIC(18,2) amounts, ISO currency | `tests/db/constraints.test.ts` |
| Idempotent import, no direct table writes by Kit | `tests/migration/idempotency.test.ts`, `tests/db/constraints.test.ts` |
| Normalized exact keys only (`tax_number`, `email`, `po_number`), confidence strictly 1.0 | `tests/domain/duplicate-policy.test.ts`, `tests/api/duplicates.test.ts` |
| Fuzzy duplicate matching and automated merge sagas prohibited in V1 | `tests/domain/duplicate-policy.test.ts`, `tests/api/duplicates.test.ts` |
| Human review decisions (`MERGE`, `REJECT`, `KEEP_BOTH`) immutably logged with `merge.decided`, actor ID, timestamp, kept ID, and merged ID | `tests/api/duplicates.test.ts`, `web/tests/duplicate-review.test.tsx` |

## Known defects (file each as an issue and link it here before closing ERP2-10)
| # | Sev | Defect | Status |
|---|---|---|---|
| 1 | P1 | `DrizzleErp2Repository.listVendors/listPurchaseOrders`: `total` ignored the filter, a second `.where()` overwrote the first (vendor+status), vendor search was case-sensitive and name-only | Fixed by `apps/erp/modules/erp-2/tools/patch-repository.py`, covered by `tests/db` |
| 2 | P1 | `DrizzleErp2Repository.createPurchaseOrder` inserted header and lines as separate statements (orphan header on line failure) outside the import path | Fixed (single transaction), covered by `tests/db` |
| 3 | P1 | No role authorization: `app.ts` reads `role:<x>` from the token but no route or service enforces it, and any token other than `invalid`/`expired` is accepted. Authorization tests cannot exist until RBAC rules are decided (Role 1 / `packages/rbac`) | OPEN - needs decision |
| 4 | P1 | Product validation is silently skipped when no `ReferenceResolver` is injected (`buildApp()` default). Production wiring must pass the ERP-1 resolver | OPEN - verify wiring |
| 5 | P2 | `line_total` is rounded from the raw price while `price` is stored rounded; the public API only accepts 2-decimal prices so it is unreachable via POST, but the import path should be re-checked | OPEN - low risk |
| 6 | P2 | Status update is read-then-write without `WHERE status = <current>`: two concurrent PATCHes can both pass the check | OPEN |
| 7 | P2 | Service re-implements rules from `domain/rules.ts` instead of calling them (drift risk); `assertValidBankDetails` is not called by the service | OPEN |
| 8 | P2 | PO currency is not checked against the vendor currency | OPEN - confirm rule |
| 9 | P1 | `apps/erp/modules/erp-2/web/` established with route registration, manifest, shell, and tests | Delivered by ERP2-16 (Issue #132) |
| 10 | P3 | Root `vitest.config.ts` coverage `include` has no ERP-2 paths | OPEN |

Do not close ERP2-10 while 3, 4 and 9 are open.
