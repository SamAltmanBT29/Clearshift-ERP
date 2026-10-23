# ADR-005: ERP-3 Sales Orders & Invoices OpenAPI 3.1 Contract, Domain Events, and Deterministic Mock Baseline

## Status
Proposed — Pending Gate G1 Sign-Off

## Context
ERP-3 Sales Orders and Invoices (Group 8) is a core V1 business module in ClearShift ERP, governed by SDS ClearShift ERP v2.0 §§4.4, 4.7, 4.8, and 4.10, and the V1 30-Issue Standardization Plan (§7 Slot 14, §8 ERP-3 overlay).

Multiple workstreams depend on ERP-3 contracts prior to full backend implementation:
- **CRM-1 (Contacts, Companies & Leads)**: Supplies customer Golden IDs (`customer_golden_id`, ADR-003) referenced by sales orders and invoices.
- **CRM-2 (Deals, Pipeline & Quotes)**: Emits the `deal.won` event (SDS §4.10 EV-09) consumed by ERP-3 to create sales orders.
- **CRM-3 (Support Tickets & Activities)**: Reads sales order and invoice status projections.
- **ERP-1 (Products & Inventory)**: Supplies `product_id` references for sales order and invoice lines.
- **ERP-4 (Finance & Accounting)**: Consumes ERP-3 invoice and payment events for Accounts Receivable and revenue recognition postings.
- **Migration Kit**: Uses ERP-3 schemas, idempotency fields (`idempotency_key`, `batch_id`, `source_row`), and error codes for target-adapter validation.

Traceability: SDS ClearShift ERP v2.0 §§4.4, 4.7, 4.8, 4.10; V1_30_ISSUE_STANDARDIZATION_PLAN §§7–8; ADR-002; ADR-003; Issue #150 (`[ERP3-14]`).

## Decision

1. **OpenAPI 3.1 Interface Contract**:
   - Published at `packages/contracts/openapi/erp-3.yaml` under base path `/api/v1/erp-orders`.
   - Documents the 5 routes explicitly listed in SDS §4.8 (`GET /sales-orders`, `POST /sales-orders`, `GET /invoices`, `POST /invoices`, `POST /payments`) plus 2 detail read routes (`GET /sales-orders/{id}`, `GET /invoices/{id}`) implied by V1 Standardization Plan §7 Slot 04 and flagged for Integration Lead confirmation.
   - All monetary values, quantities, and tax rates use string-encoded decimals (`MoneyAmount` / `TaxRateAmount`, up to 4 decimal places) to prevent IEEE-754 floating-point drift.

2. **Shared Zod Schemas (`@clearshift/contracts/erp-3`)**:
   - Defined in `packages/contracts/src/erp-3.ts` and re-exported from `@clearshift/contracts`.
   - Enforces `SalesOrderStatusEnum` (`Open`, `Invoiced`, `Closed`), `InvoiceStatusEnum` (`Open`, `Paid`, `Overdue`), `PaymentMethodEnum` (`cash`, `bank`, `card`), positive line quantities (`> 0`), positive payment amounts (`> 0`), mandatory `customer_golden_id` (`BR-ERP3-03`), mandatory invoice `due_date`, and bounded collection pagination (`page >= 1`, `pageSize <= 100`, default `20`).
   - Standardizes domain error codes in `ERP3_RELATIONSHIP_ERROR_CODES` and aligns error responses with ADR-002 / PLT-04 (`ErrorEnvelopeSchema`).

3. **Transactional Domain Event Contracts (`@clearshift/contracts/erp-3-events`)**:
   - Defined in `packages/contracts/src/erp-3-events.ts` using `createEventEnvelopeSchema` (PLT-04 / PLT-09).
   - Produced events (`producer: "erp-3"`): `erp.sales_order.created`, `erp.sales_order.status_changed`, `erp.invoice.created`, `erp.invoice.status_changed`, `erp.payment.created`.
   - Inbound event contract: `deal.won` (`InboundDealWonPayloadSchema` / `InboundDealWonEventSchema`) from CRM-2 (SDS §4.10 EV-09).

4. **Deterministic Mock Server (`@clearshift/contracts/erp-3-mock`)**:
   - Defined in `packages/contracts/src/erp-3-mock.ts` via `createErp3MockServer()` (`ERP3_MOCK_DEFAULT_PORT = 4013`) with `reset()` and `stop()` lifecycle helpers.
   - Pre-seeded with deterministic synthetic sales orders, invoices, and payments.
   - Implements filtering (`status`, `customer_golden_id`, `order_id`, `currency`, `from_date`, `to_date`, `search`), duplicate number conflict detection (`409`), cross-reference checks (`422`), payment overflow/already-paid guards (`422`), and automatic `Open` → `Paid` transition with event emission when `SUM(payments) == invoice.total` (`FR-ERP3-04`).

5. **Decision Verification & Provisional Guard for Unresolved Rounding Rule (`DR-1`, `DR-2`, `DR-3`)**:
   - **DR-1 (Monetary Rounding — Requires Integration Lead Confirmation)**:
     - `docs/SDS_ClearShift_ERP.md` §3.2 mandates `numeric(19,4)` storage for all monetary values.
     - `docs/SDS_ClearShift_ERP.md` §4.4 `BR-ERP3-02` states: *"Tax per line = line amount multiplied by the product tax rate, rounded to 2 decimals."*
     - `docs/CLEARSHIFT_V1_MASTER_ARCHITECTURE_SPEC.md` §0 Decision `M2` ratifies *"half-up decimals"*, and `packages/core/src/money/money.ts` (`@cs/core` `Money`) implements `Decimal.ROUND_HALF_UP` at currency exponent scale (`2` for `INR`/`USD`) with `.toStorageString()` formatting as `.toFixed(4)`.
     - **Conflict / Ambiguity**: The specifications do not state whether ERP-3 line calculation rounds intermediate `line_amount = quantity * price` to 2 dp before applying `tax_rate`, nor whether `tax_amount` in `BR-ERP3-02` is rounded to 2 dp half-up and zero-padded to 4 dp (`"XX.XX00"`) in `numeric(19,4)` or computed at 4 dp (`"0.0540"` for `qty=3, price=0.1, tax_rate=18`). Until the Integration Lead confirms the exact formula, the contract uses 4-dp `MoneyAmount` strings and the mock (`erp-3-mock.ts`) performs exact 4-dp scaled `BigInt` arithmetic without rounding, returning mock-specific `422 DR1_ROUNDING_UNRESOLVED` if a calculation produces a sub-4-dp remainder. `DR1_ROUNDING_UNRESOLVED` is isolated to `erp-3-mock.ts` and excluded from `ERP3_RELATIONSHIP_ERROR_CODES`.
   - **DR-2 (Invoice `due_date` — Authoritatively Mandatory)**:
     - `docs/V1_30_ISSUE_STANDARDIZATION_PLAN.md` §8 (ERP-3 Non-Negotiable Rules) explicitly mandates: *"due date is mandatory for overdue calculation"*, and Required Fixture Cases include *"invalid due date; paid/overdue conflict"*.
     - `docs/CLEARSHIFT_V1_MASTER_ARCHITECTURE_SPEC.md` §5c ERD defines `ERP3_INVOICES` with `date due_date`.
     - Per `CLEARSHIFT_V1_MASTER_ARCHITECTURE_SPEC.md` line 2 & Decision `C1` (*"Std Plan wins on conflict"*), `due_date` is authoritatively mandatory despite its omission from the summary table in `SDS_ClearShift_ERP.md` §4.7.
   - **DR-3 (Detail Routes `GET /sales-orders/{id}` & `GET /invoices/{id}` — Required by Slot 04, Flagged for Gate G1 Sign-Off)**:
     - `docs/V1_30_ISSUE_STANDARDIZATION_PLAN.md` §7 Slot 04 (*`04. Detail/read API and linked-record projection`*) and `docs/CLEARSHIFT_V1_MASTER_ARCHITECTURE_SPEC.md` §6.1 / Decision `H1` (*"Full authoritative route set derived at G1"*) require detail read endpoints for every business module, matching `erp-1.yaml`, `erp-2.yaml`, `erp-4.yaml`, and `erp-5.yaml`. They are included in `erp-3.yaml` and `erp-3-mock.ts` and remain flagged for Integration Lead Gate G1 sign-off because they are omitted from the 5-row summary table in `SDS_ClearShift_ERP.md` §4.8.

## Open Items Requiring Integration Lead Confirmation at Gate G1

| ID | Topic | Authoritative Finding & Contract Baseline | Question / Action for Integration Lead |
|---|---|---|---|
| **DR-1** | Tax & line total rounding rule (`SDS §4.4 BR-ERP3-02` 2 dp vs. `SDS §3.2 numeric(19,4)` & `Master Spec M2` half-up) | 4-dp `MoneyAmount` strings; exact 4-dp `BigInt` arithmetic in mock (`422 DR1_ROUNDING_UNRESOLVED` on sub-4-dp remainder) | Confirm whether ERP-3 line calculation in `ERP3-03`/`ERP3-06` should (A) round `line_amount` and `tax_amount` to 2 dp `ROUND_HALF_UP` and zero-pad to 4 dp (`.toFixed(4)` via `@cs/core` `Money.round().toStorageString()`), or (B) retain 4-dp precision for `line_amount` and/or `tax_amount` |
| **DR-2** | Invoice `due_date` requirement (`V1_30 §8` & `Master Spec §5c` vs. `SDS §4.7` table omission) | Settled per Decision `C1`: required `YYYY-MM-DD` field on `InvoiceSchema` and `CreateInvoiceRequestSchema` | Ratify SDS v1.1 patch adding `due_date` to SDS §4.7 table (per Decision `C1`) |
| **DR-3** | Detail routes `GET /sales-orders/{id}` & `GET /invoices/{id}` (`V1_30 §7 Slot 04` vs. `SDS §4.8` table omission) | Settled per Decision `C1` / Slot 04: documented in `erp-3.yaml` and implemented in `erp-3-mock.ts` | Ratify at Gate G1 per Decision `H1` before `ERP3-04` implementation |

## Gate G1 Review & Sign-Off Record

| Role | Signatory | Status | Milestone | Date |
|---|---|---|---|---|
| **Role 2 — Integration / Backend Engineer** | Group 8 Role 2 | Submitted | Gate G1 Contract Baseline | 2026-10-23 |
| **Integration Lead** | Integration Team Lead | Pending | Gate G1 Design Freeze | — |
| **Peer Review** | Peer Group Reviewer | Pending | Contract & Mock Verification | — |
