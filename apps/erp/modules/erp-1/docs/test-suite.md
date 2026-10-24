# ERP-1 Test Suite (ERP1-29)

All test data is 100% synthetic (ADR-003, synthetic product SKUs, synthetic warehouse WH-01, synthetic category codes). No live external network or production database is required.

## Test Layers

| Layer | Location | Runner | What It Proves |
|---|---|---|---|
| Domain Unit & Rules | `tests/domain`, `tests/migration` | Vitest | BR-ERP1-01 (SKU normalization), BR-ERP1-02 (non-negative stock quantity), FR-ERP1-04 (approved units of measure), cleaning rules, field-level audit, and mapping |
| API Routes & Mutations | `tests/api` | Vitest | Fastify routes, error envelope `{ statusCode, error, code, message, details, correlation_id }`, 400/401/403/404/409 status codes |
| Contracts & OpenAPI | `tests/contract` | Vitest | Zod schemas, OpenAPI 3.1 YAML conformance across baseline endpoints, state machines, and SKU uniqueness |
| Web Components & Pages | `web/tests` | Vitest + React Testing Library | Screen states (skeleton loading, empty states, access denied), search & filter debouncing, forms, routing, and pagination |
| Browser Journeys | `e2e/erp-1-journey.spec.ts` | Playwright (Chromium + Firefox) | Real browser E2E workflows: auth redirect, product catalog navigation, product creation, detail view, search filter, and duplicate SKU detection |

## Execution Commands

```bash
# Run contract and OpenAPI conformance tests
npx vitest run apps/erp/modules/erp-1/tests/contract

# Run cleaning rules and field-level audit tests
npx vitest run apps/erp/modules/erp-1/tests/migration/cleaning.test.ts

# Run mapping and value translation tests
npx vitest run apps/erp/modules/erp-1/tests/migration/mapping.test.ts

# Run all ERP-1 unit and integration test suites
npm run erp1:test

# Run full module coverage
npx vitest run apps/erp/modules/erp-1 --coverage

# Run Playwright end-to-end browser journeys
npm run erp1:e2e
```
