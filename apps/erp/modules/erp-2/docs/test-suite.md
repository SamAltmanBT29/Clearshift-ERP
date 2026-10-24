# ERP-2 Test Suite (ERP2-29)

All test data is 100% synthetic (example.com / example.org addresses, dummy account numbers, synthetic product ids). No live external service is used.

## Layers

| Layer | Location | Runner | What it proves |
|---|---|---|---|
| Domain unit | `tests/domain`, `tests/migration` | Vitest | PO transitions Draft -> Sent -> Received -> Closed, totals and rounding, duplicate policy, migration rules |
| API (Fastify inject) | `tests/api`, `tests/e2e/demo-journey.test.ts` | Vitest | Routes, error envelope `{ code, message, details }`, 400/401/403/404/409/422 conventions, bank masking |
| Contract | `tests/contract`, `tests/contracts` | Vitest | OpenAPI parity and Zod contract conformance for every endpoint |
| DB | `tests/db` | Vitest | Schema and constraints; live proofs run only when `DATABASE_URL_TEST` is set |
| Web component | `web/tests` | Vitest + React Testing Library | Pages, forms, filters, tables, session and route manifest |
| Web API client | `web/tests/erp-2-api-client.test.ts` | Vitest (fetch stubbed) | Query building, request bodies, error mapping to `ApiError` |
| Browser journey | `e2e/erp-2-journey.spec.ts` | Playwright (Chromium + Firefox) | Create, detail, list and filter in a real browser; auth redirect; PO status filter |

## Running

```
npm run erp2:test                      # all ERP-2 Vitest suites
npx vitest run apps/erp/modules/erp-2 --coverage --coverage.include='apps/erp/modules/erp-2/**/src/**'
npx playwright install chromium firefox   # once per machine
npm run erp2:e2e                       # browser journeys
```

DB integration suites need `DATABASE_URL_TEST` (see `npm run compose:up` and `npm run db:migrate:test`).

## Browser host

`e2e/vite.e2e.config.ts` starts a throwaway Vite dev server that serves the real ERP-2 routes and mounts the real ERP-2 Fastify app in memory under `/api`. `POST /__e2e/reset` empties the store before each test. It is test infrastructure only and is never part of a production build. Reports and traces are written to `e2e/.artifacts/` and must not be committed.

## Baseline

Before ERP2-29, ERP-2 had 469 passing Vitest tests across 31 files at 82.9% statement coverage (threshold for the issue: 60%). ERP2-29 adds 15 tests for `web/src/api/erp-2.ts` (previously 54.5% statements) and the Playwright journeys.
