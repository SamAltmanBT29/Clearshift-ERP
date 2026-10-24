# ERP-4 Finance & Accounting Test Suite (ERP4-29)

All test data is 100% synthetic (deterministic UUIDs, synthetic chart of accounts, balanced journal lines). No live external banking or third-party tax filing service is used in V1.

## Layers

| Layer | Location | Runner | What it proves |
|---|---|---|---|
| Domain unit | `tests/domain`, `tests/migration` | Vitest | Double-entry invariants, atomic posting, reversal compensation, cleaning and profiling assertions |
| API (Fastify inject) | `tests/api` | Vitest | Routes, standard error envelope `{ code, message, details }`, 400/401/403/404/409/422 status conventions |
| Contract | `tests/contracts` | Vitest | OpenAPI 3.1 parity and Zod contract conformance across all 18 published endpoints |
| DB | `tests/db` | Vitest | Schema and constraints; live proofs execute when `DATABASE_URL_TEST` is configured |
| Web component | `web/tests` | Vitest + React Testing Library | AccountsListPage, FilterBar, Tables, Modal, and tab switches in JSDOM |
| Web API client | `web/tests/erp-4-api-client.test.ts` | Vitest (fetch stubbed) | Query normalization, request bodies, error mapping to `ApiError` |
| Browser journey | `e2e/erp-4-journey.spec.ts` | Playwright (Chromium + Firefox) | End-to-end browser workflows: auth redirect, accounts list, search/type filtering, journal creation and posting |

## Running

```bash
npm run erp4:test                      # all ERP-4 Vitest suites
npx vitest run apps/erp/modules/erp-4 --coverage --coverage.include='apps/erp/modules/erp-4/**/src/**'
npx playwright install chromium firefox   # once per machine
npm run erp4:e2e                       # browser journeys
```

## Browser host

`e2e/vite.e2e.config.ts` starts a Vite dev server serving the real ERP-4 web routes (`erp4Routes`) and mounts the Fastify app in memory via `app.inject()`. `POST /__e2e/reset` resets the in-memory repository to default synthetic fixtures before every test run.
Reports and traces are isolated under `e2e/.artifacts/` and ignored by version control.
