# ERP-3 Test Suite (ERP3-29)

All test data is 100% synthetic (ADR-003 UUID customer Golden IDs, synthetic ERP-1 product IDs, dummy transaction references). No live external network or production database is required.

## Test Layers

| Layer | Location | Runner | What It Proves |
|---|---|---|---|
| Domain Unit & Migration | `tests/domain`, `tests/migration` | Vitest | BR-ERP3-01 / BR-ERP3-02 calculation rules, 4-dp rounding, migration reconciliation, link integrity, and value mapping |
| API Routes & Mutations | `tests/api` | Vitest | Fastify routes, error envelope `{ statusCode, error, code, message, details, correlation_id }`, 400/401/403/404/422 status codes |
| Contracts & OpenAPI | `tests/contracts` | Vitest | Zod schemas, OpenAPI 3.1 YAML conformance across all 9 baseline endpoints, state machines, and UUID validation |
| Web Components & Pages | `web/tests` | Vitest + React Testing Library | Screen states (skeleton loading, empty states, access denied), search & filter debouncing, forms, routing, and pagination |
| Web API Client | `web/tests/erp-3-api-client.test.ts` | Vitest (fetch stubbed) | URL parameter construction, defaults, request payloads, and `ApiError` envelope normalization |
| Browser Journeys | `e2e/erp-3-journey.spec.ts` | Playwright (Chromium + Firefox) | Real browser E2E workflows: auth redirect with `returnTo`, sales order creation, detail inspection, list view, debounced search filtering, and forward status transitions |

## Execution Commands

```bash
# Run web API client unit tests
npx vitest run apps/erp/modules/erp-3/web/tests/erp-3-api-client.test.ts

# Run contract and OpenAPI conformance tests
npx vitest run apps/erp/modules/erp-3/tests/contracts

# Run all ERP-3 unit and integration test suites
npx vitest run apps/erp/modules/erp-3

# Run full module statement & branch coverage
npx vitest run apps/erp/modules/erp-3 --coverage --coverage.include='apps/erp/modules/erp-3/src/**'

# Install Playwright browser binaries (once per environment)
npx playwright install --with-deps chromium firefox

# Run Playwright end-to-end browser journeys
npm run erp3:e2e
```

## Browser Test Host

`e2e/vite.e2e.config.ts` starts a lightweight Vite dev server on port `5176` that serves the real module routes (`erp3Routes`) and mounts the real Fastify app in memory under `/api/v1/erp-orders` via `app.inject`. `POST /__e2e/reset` initializes a fresh `InMemoryErp3Repository(false)` before each test execution, providing deterministic, zero-flakiness test runs without external dependencies.
