# ERP-5 HR & Employees: Test Suite (ERP5-29)

All test data is 100% synthetic (fictional names, RFC 2606 domains, synthetic employee identifiers, synthetic payroll amounts). Zero live external services or real personal data are used.

## Test Layers and Verification Strategy

| Layer | Location | Runner | What It Proves |
|---|---|---|---|
| **Domain Rules & Invariants** | `tests/domain`, `src/domain` | Vitest | Domain rules: join date never precedes birth date (BR-ERP5-01), leave date order (FR-ERP5-04), acyclic department hierarchy (FR-ERP5-03), payroll aggregate invariants (FR-ERP5-06). |
| **API Integration** | `tests/api` | Vitest (Fastify `app.inject`) | HTTP route endpoints, shared error envelope `{ code, message, details, correlation_id }`, status codes 400/401/403/404/409/422, correlation ID propagation, raw salary masking. |
| **Security & Authorization** | `tests/security` | Vitest | Hub EdDSA JWT verification (PLT-05), RBAC permissions matrix (16 routes × 5 roles), object-level security guards, salary masking enforcement (`salary_display = "XX,XXX"`). |
| **Contracts & OpenAPI** | `tests/contracts` | Vitest | Strict Zod schema contract parity, OpenAPI v3 documentation parity, resolution of all `$ref` references, strict input payload parsing. |
| **Database Schema** | `tests/db` | Vitest | Drizzle schema definitions and constraints; live PostgreSQL proofs run against `DATABASE_URL_TEST`. |
| **Migration Kit Domain** | `tests/migration` | Vitest | Data dictionary and ERD parity (ERP5-24), canonical 130-row dirty data pack (ERP5-25), candidate key profiling (ERP5-26), cleaning rules & field audit ledger (ERP5-27), mapping templates & type coercion (ERP5-28). |
| **Web UI Components** | `web/tests/*.tsx` | Vitest + React Testing Library | Collection lists, create/edit forms, status badges, empty/error/loading states, keyboard accessibility. |
| **Web API Client** | `web/tests/erp-5-api-client.test.ts` | Vitest (stubbed transport) | Query string builder, authorization header injection, single-record reads, resource mutations, `HrApiError` normalization, `isPermissionDenied` getter, abort signals. |
| **Browser Journey (E2E)** | `e2e/erp-5-journey.spec.ts` | Playwright (Chromium + Firefox) | Real browser journeys against in-memory host: auth redirect, employee create, detail view with masked salary, list and search filtering, department creation and hierarchy. |

## Running Test Suites

```bash
# Run all ERP-5 unit, integration, and contract suites
npx vitest run apps/erp/modules/erp-5

# Run test coverage reporting for ERP-5 source code
npx vitest run apps/erp/modules/erp-5 --coverage --coverage.include='apps/erp/modules/erp-5/src/**'

# Run Playwright browser journeys (requires local browser binaries)
npx playwright test -c apps/erp/modules/erp-5/e2e/playwright.config.ts

# Run with live PostgreSQL container (when DATABASE_URL_TEST is set)
DATABASE_URL_TEST=postgresql://postgres:postgres@localhost:5432/clearshift_test npx vitest run apps/erp/modules/erp-5/tests/db
```

## Coverage Verification

Running `npx vitest run apps/erp/modules/erp-5 --coverage --coverage.include='apps/erp/modules/erp-5/src/**'` produces:

```
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
-------------------|---------|----------|---------|---------|-------------------
All files          |   94.61 |    85.24 |      98 |   94.61 |                   
 src               |   80.16 |     85.5 |      90 |   80.16 |                   
  app.ts           |   90.69 |    85.18 |     100 |   90.69 |                   
  public.ts        |   61.29 |    92.85 |     100 |   61.29 |                   
 src/auth          |   96.07 |    93.02 |     100 |   96.07 |                   
 src/domain        |   92.27 |    91.04 |     100 |   92.27 |                   
 src/migration     |    97.2 |     87.5 |     100 |    97.2 |                   
 src/policies      |   86.98 |    72.72 |      60 |   86.98 |                   
 src/routes        |     100 |    81.15 |     100 |     100 |                   
 src/services      |   93.95 |     82.5 |   98.63 |   93.95 |                   
-------------------|---------|----------|---------|---------|-------------------
```

Core business logic statement coverage is **94.61%**, well exceeding the Gate G4 requirement threshold of **60%**.

## Browser Test Infrastructure

The Playwright browser host (`e2e/vite.e2e.config.ts`) runs a standalone Vite server on port 5175. It mounts the production `erp5Routes` and mounts the Fastify app directly in memory using an in-memory repository. `POST /__e2e/reset` guarantees test isolation with an empty store before each test. Reports and traces are generated under `.artifacts/` and ignored by version control.
