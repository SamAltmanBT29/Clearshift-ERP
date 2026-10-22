# ADR-004: ERP-4 Finance & Accounting OpenAPI 3.1 Contract, Domain Events, and Deterministic Mock Baseline

## Status
Accepted — Signed off for Gate G1 Baseline

## Context
ERP-4 Finance and Accounting is a foundational V1 target module in ClearShift ERP. Its delivery is governed by SDS ClearShift ERP v2.0 §7.9 and requires production-grade execution for Gate G1.

Multiple workstreams depend directly on ERP-4:
- **ERP-2 (Purchasing & Payables)**: Requires accounts payable and expense ledger posting contracts.
- **ERP-3 (Sales & Receivables)**: Requires accounts receivable, bank accounts, and revenue recognition posting contracts.
- **ERP-5 (HR & Payroll)**: Requires salary and payroll totals ledger integration contracts.
- **CRM-5 (Executive Dashboards & Projections)**: Requires chart of accounts and trial balance read contracts.

Prior to Gate G1, these dependent teams require:
1. An authoritative OpenAPI 3.1 public specification document.
2. Shared Zod schemas ensuring runtime request/response validation.
3. Strongly-typed transactional domain event schemas conforming to PLT-04 and PLT-09.
4. A deterministic mock server and reproducible synthetic fixtures to enable parallel development and CI contract audits without cross-module blockers.

Traceability: ClearShift Project Plan v3.0 §§9.3–9.6; SDS ClearShift ERP v2.0 §7.9; V1 Standardization Plan #14; Issue #170 ([ERP4-14]).

## Decision

1. **Interface Source of Truth**:
   - The authoritative public API contract is published at `packages/contracts/openapi/erp-4.yaml` (OpenAPI 3.1.0).
   - Base path: `/api/v1/erp-finance`.
   - All 18 endpoints spanning Chart of Accounts, Journal Entries, Trial Balance, Opening Balances, and Accounting Periods are strictly specified.
   - All monetary fields use string-encoded fixed-precision decimals (`NUMERIC(20,4)` representation). IEEE-754 floating point numbers are strictly prohibited.

2. **Shared Zod Schemas**:
   - Runtime validation at Fastify boundaries is powered by Zod contracts defined in `@clearshift/contracts` (`packages/contracts/src/erp-4.ts`).
   - Every entity, request body, query parameter, and response payload is validated through these schemas.
   - Non-negotiable domain rule `BR-ERP4-01`: `SUM(debits) === SUM(credits)` at 4 decimal places precision is enforced by schema refinements and `isJournalEntryBalanced()` helpers.
   - All collection queries enforce bounded pagination (`page >= 1`, `pageSize <= 100`, default `20`). Page sizes exceeding 100 are rejected immediately with HTTP 400.

3. **Transactional Domain Event Envelopes**:
   - Event contracts are published in `@clearshift/contracts/erp-4-events` conforming to `EventEnvelopeSchema` (PLT-04 / PLT-09).
   - Produced events:
     - `erp.account.created`
     - `erp.account.updated`
     - `erp.journal_entry.created`
     - `erp.journal_entry.posted`
     - `erp.journal_entry.reversed`
     - `erp.journal_entry.voided`
     - `erp.period.status_changed`
     - `erp.opening_balance.created`
   - Inbound event contracts:
     - `erp.vendor_bill.posted` (from ERP-2)
     - `erp.invoice.posted` (from ERP-3)
     - `erp.payroll_total.posted` (from ERP-5)

4. **Deterministic Mock Contract Package**:
   - Implemented in `@clearshift/contracts/erp-4-mock` and executable via `npm run mock:erp-4` or in-process via `createErp4MockServer()`.
   - Pre-seeded with 100% synthetic, deterministic test accounts, fiscal periods, and balanced journal entries.
   - Enforces all domain rules and business invariants, returning standard error envelopes (`ApiError` / `ErrorEnvelope`) on validation or domain constraint failure.
   - Provides `reset()` helper to return state to initial seed, preventing test state bleed.

5. **Versioned Change Control**:
   - Version `1.0.0` is the frozen baseline for Gate G1.
   - Any proposed contract revision requires a formal versioned change record and Integration Lead review.

## Gate G1 Review & Sign-Off Record

| Role | Signatory | Status | Milestone | Date |
|---|---|---|---|---|
| **Role 2 — Integration / Backend Lead** | Integration Team Lead | Approved | Gate G1 Design Freeze | 2026-10-22 |
| **Platform Architect** | Architecture Review Board | Approved | Gate G1 Contract Baseline | 2026-10-22 |
| **Peer Review** | Group 10 Reviewer | Approved | Contract & Mock Verification | 2026-10-22 |

## Consequences

- **Positive**:
  - Unblocks ERP-2, ERP-3, ERP-5, and CRM-5 teams to build against deterministic mock endpoints and strongly-typed contracts.
  - Guarantees zero cumulative floating-point rounding drift across module boundaries.
  - Breaking schema changes are caught automatically by CI contract test suites.
- **Negative**:
  - Dependent modules cannot invent local financial schemas and must consume `@clearshift/contracts`.
