# ERP-2 Vendors & Purchasing: V1 Data-Quality Rules

Rule catalogue version **1.0.0**.

- Canonical implementation: `apps/erp/modules/erp-2/src/migration/dirty-data-plan.ts` (`RULE_CATALOGUE`, `evaluateDataset`, `buildProfile`), delivered by ERP2-25 (#141).
- Fixture, manifest and mapping: `sample-data/erp-2/` (`dirty-data-v1.csv`, `expected-profile.json`, `mapping-template.json`).
- Tests: `apps/erp/modules/erp-2/tests/migration/` (`dirty-data-plan.test.ts`, `cleaning.test.ts`, `profiling.test.ts`, `reconciliation.test.ts`, `idempotency.test.ts`, `batch-retry-stop.test.ts`).

This document describes the catalogue. It does not define it. If this document and the code disagree, the code and its tests win and this document must be fixed.

## 1. Principles

- Raw input is never modified. Cleaning produces new values and records which rules fired in `rule_ids`.
- No fuzzy matching and no automatic merge. Exact normalized duplicates are held for human review and never loaded.
- Every rule has a stable `rule_id`, a `version`, an input condition, an action (`normalize`, `reject`, `review` or `skip`), a reason code and a human-readable explanation.
- Every source row ends in exactly one terminal outcome: `accepted`, `rejected`, `review` or `skipped`. Nothing is unaccounted for.
- Currency is explicit on every vendor and purchase order. There is no implicit default and no FX conversion in V1.
- Money uses fixed-point arithmetic only. Line total = `ROUND_HALF_UP(quantity x unit_price, 2 dp)`. PO total = sum of rounded valid line totals.
- Bank account numbers are masked server-side (only the last 4 characters stay visible) and are excluded from logs and exports.
- Idempotency key: `SYNTH-ERP2-DIRTY-V1:{entity}:{source_id}`.

## 2. Fixture and manifest

| Item | Value |
|---|---|
| Source system | `SYNTH-ERP2-DIRTY-V1` |
| Fixture | `sample-data/erp-2/dirty-data-v1.csv` (173 rows: 46 vendors, 44 purchase orders, 83 lines) |
| SHA-256 | `acc5a3b3c9785f97b59cdabfaf64f626afad26e8d2cbcd5990c93549352ed65b` |
| Manifest | `sample-data/erp-2/expected-profile.json` (`profile_schema_version` 1) |
| Mapping | `sample-data/erp-2/mapping-template.json` (`mapping_schema_version` 1) |
| Rules version | `1.0.0` |
| Load order | vendor, purchase_order, po_line |

Verify the checksum locally:

```bash
shasum -a 256 sample-data/erp-2/dirty-data-v1.csv
```

### Expected outcomes

| Record type | Total | Accepted | Rejected | Review | Skipped |
|---|---|---|---|---|---|
| vendor | 46 | 26 | 15 | 5 | 0 |
| purchase_order | 44 | 22 | 18 | 4 | 0 |
| po_line | 83 | 46 | 35 | 2 | 0 |
| **All rows** | **173** | **94** | **68** | **11** | **0** |

## 3. Required and optional fields

| Entity | Required | Optional (validated when supplied) |
|---|---|---|
| Vendor | `vendor_code`, `vendor_name`, `currency` | `tax_number`, `email`, `payment_terms_days`, `bank_account` |
| Purchase order | `po_number`, `po_vendor_code`, `po_status`, `po_date`, `currency`, `po_total`, at least one valid line | `expected_date`, `status_path` |
| PO line | `po_number` (accepted parent), `line_no`, `product_sku`, `quantity`, `unit_price` | `line_total` |

## 4. Accepted enumerations and limits

| Field | Accepted values |
|---|---|
| `record_type` | `vendor`, `purchase_order`, `po_line` (anything else is skipped) |
| `currency` | `USD`, `EUR`, `GBP`, `INR` (upper-case); a PO currency must equal its vendor currency |
| `po_status` | `Draft`, `Sent`, `Received`, `Closed` |
| Status path | starts at `Draft`, advances one step at a time, ends at `po_status`; no backwards moves, no cancellation |
| `vendor_code` | at most 64 characters |
| `payment_terms_days` | whole number, 0 to 365 |
| `quantity` | decimal, up to 3 places, greater than 0 |
| `unit_price` | decimal, up to 4 places, 0 or greater |
| `po_total` | non-negative decimal, up to 2 places |
| Dates | real calendar dates in `YYYY-MM-DD`; `DD/MM/YYYY`-style values are held for review as ambiguous |

## 5. Normalization

| Key | Normalization |
|---|---|
| Vendor code, PO number, PO vendor code, product SKU | trimmed and upper-cased |
| Tax number | upper-cased, spaces and hyphens stripped |
| Email | trimmed and lower-cased |
| PO status | trimmed and mapped to canonical casing |

## 6. Relationship resolution

- `po_vendor_code` must resolve to an accepted vendor, otherwise the PO is rejected with `VENDOR_NOT_FOUND`.
- `po_number` on a line must resolve to an accepted PO, otherwise the line is rejected with `PO_NOT_FOUND`.
- `product_sku` must exist in the ERP-1 product catalogue snapshot, otherwise the line is rejected with `UNKNOWN_PRODUCT`.
- A held or rejected parent makes its children fail with the matching `*_NOT_FOUND` reason.
- A PO with no valid, loadable line is rejected with `EMPTY_ORDER_LINES`.

## 7. Exact duplicate candidate keys

Duplicates are detected on exact normalized keys only. The later row gets outcome `review` and is never loaded or merged until a human decides.

| Entity | Key | Reason code |
|---|---|---|
| Vendor | normalized vendor code | `DUPLICATE_VENDOR_CODE_REVIEW` |
| Vendor | normalized tax number | `DUPLICATE_TAX_NUMBER_REVIEW` |
| Purchase order | normalized PO number | `DUPLICATE_PO_NUMBER_REVIEW` |
| PO line | normalized (PO number, line number) | `DUPLICATE_LINE_REVIEW` |

## 8. Rule catalogue (45 rules)

### Normalization

| Rule | Entity | Field | Condition | Action | Reason code | Explanation |
|---|---|---|---|---|---|---|
| `NRM-001` | all | vendor_code, po_number, po_vendor_code, product_sku | natural key has padding or lower-case characters | normalize | none | Natural keys are trimmed and upper-cased before matching. |
| `NRM-002` | purchase_order | po_status | status has padding or non-canonical casing | normalize | none | Status is trimmed and mapped to canonical casing. |
| `NRM-003` | vendor | tax_number | tax number has padding, spaces, hyphens or lower-case characters | normalize | none | Upper-cased and stripped of spaces and hyphens before matching. |

### General

| Rule | Entity | Field | Condition | Action | Reason code | Explanation |
|---|---|---|---|---|---|---|
| `GEN-001` | all | free-text fields | value starts with `=`, `+`, `-`, `@`, tab or carriage return | reject | `FORMULA_INJECTION_DETECTED` | Spreadsheet formula injection prefix (OWASP); never loaded or exported. |
| `GEN-002` | all | currency | currency is empty | reject | `CURRENCY_REQUIRED` | Currency is explicit; there is no implicit default. |
| `GEN-003` | all | currency | currency is not USD, EUR, GBP or INR | reject | `INVALID_CURRENCY` | Must be an accepted upper-case ISO-4217 code. |
| `GEN-004` | all | po_number | po_number is empty or whitespace | reject | `PO_NUMBER_REQUIRED` | Required on purchase order and line rows. |
| `GEN-005` | all | record_type | record_type is not vendor, purchase_order or po_line | skip | `UNSUPPORTED_RECORD_TYPE` | Outside the ERP-2 entity set; skipped, never loaded. |

### Vendors

| Rule | Entity | Field | Condition | Action | Reason code | Explanation |
|---|---|---|---|---|---|---|
| `VND-001` | vendor | vendor_code | empty or whitespace | reject | `VENDOR_CODE_REQUIRED` | Vendor code is the natural key and is required. |
| `VND-002` | vendor | vendor_code | longer than 64 characters | reject | `VENDOR_CODE_TOO_LONG` | Exceeds the maximum length. |
| `VND-003` | vendor | vendor_name | empty or whitespace | reject | `VENDOR_NAME_REQUIRED` | Vendor name is required. |
| `VND-004` | vendor | tax_number | normalized tax number is not 5-20 letters/digits | reject | `INVALID_TAX_NUMBER` | Optional, but must be well formed when supplied. |
| `VND-005` | vendor | email | not a valid address | reject | `INVALID_EMAIL` | Optional, but must be valid when supplied. |
| `VND-006` | vendor | payment_terms_days | not an integer | reject | `INVALID_PAYMENT_TERMS` | Must be a whole number of days. |
| `VND-007` | vendor | payment_terms_days | less than 0 or greater than 365 | reject | `PAYMENT_TERMS_OUT_OF_RANGE` | Must be between 0 and 365 inclusive. |
| `VND-008` | vendor | bank_account | does not match the synthetic IBAN pattern | reject | `INVALID_BANK_DETAILS` | Malformed; account numbers are masked in all review and export output. |
| `VND-009` | vendor | vendor_code | normalized vendor code already accepted in batch | review | `DUPLICATE_VENDOR_CODE_REVIEW` | Exact duplicate; held for human review, never merged. |
| `VND-010` | vendor | tax_number | normalized tax number already accepted in batch | review | `DUPLICATE_TAX_NUMBER_REVIEW` | Exact duplicate; held for human review, never merged. |

### Purchase orders

| Rule | Entity | Field | Condition | Action | Reason code | Explanation |
|---|---|---|---|---|---|---|
| `PO-001` | purchase_order | po_vendor_code | empty or whitespace | reject | `PO_VENDOR_REQUIRED` | A PO must reference a vendor. |
| `PO-002` | purchase_order | po_vendor_code | referenced vendor is not an accepted vendor | reject | `VENDOR_NOT_FOUND` | Foreign key missing. |
| `PO-003` | purchase_order | po_status | empty | reject | `PO_STATUS_REQUIRED` | Status is required. |
| `PO-004` | purchase_order | po_status | not Draft, Sent, Received or Closed | reject | `INVALID_PO_STATUS` | Must be one of the four V1 statuses. |
| `PO-005` | purchase_order | status_path | does not start at Draft, skips a step, or does not end at po_status | reject | `INVALID_STATUS_TRANSITION` | Transitions are explicit: Draft, Sent, Received, Closed. |
| `PO-006` | purchase_order | po_date | empty | reject | `PO_DATE_REQUIRED` | Order date is required. |
| `PO-007` | purchase_order | po_date, expected_date | not a real calendar date in YYYY-MM-DD | reject | `INVALID_DATE` | Dates must be real ISO dates. |
| `PO-008` | purchase_order | expected_date | earlier than po_date | reject | `EXPECTED_DATE_BEFORE_ORDER_DATE` | Expected delivery cannot precede the order date. |
| `PO-009` | purchase_order | currency | PO currency differs from the vendor currency | reject | `CURRENCY_MISMATCH` | PO currency must equal vendor currency. |
| `PO-010` | purchase_order | po_number | no valid, loadable line references the PO | reject | `EMPTY_ORDER_LINES` | A PO must have at least one valid line. |
| `PO-011` | purchase_order | po_total | empty | reject | `PO_TOTAL_REQUIRED` | Total is required. |
| `PO-012` | purchase_order | po_total | not a non-negative decimal with at most 2 places | reject | `INVALID_PO_TOTAL` | Must be a non-negative decimal, 2 places max. |
| `PO-013` | purchase_order | po_total | differs from the sum of rounded valid line totals | reject | `PO_TOTAL_MISMATCH` | Total must equal the sum of `ROUND_HALF_UP(quantity x unit_price, 2)` over valid lines. |
| `PO-014` | purchase_order | po_date | DD/MM/YYYY-style, day/month order ambiguous | review | `AMBIGUOUS_DATE_FORMAT_REVIEW` | Held for human review. |
| `PO-015` | purchase_order | po_number | normalized PO number already accepted in batch | review | `DUPLICATE_PO_NUMBER_REVIEW` | Exact duplicate; held for human review, never merged. |

### Purchase order lines

| Rule | Entity | Field | Condition | Action | Reason code | Explanation |
|---|---|---|---|---|---|---|
| `LIN-001` | po_line | po_number | referenced PO is not an accepted PO | reject | `PO_NOT_FOUND` | Foreign key missing. |
| `LIN-002` | po_line | line_no | not a positive integer | reject | `INVALID_LINE_NUMBER` | Must be an integer of 1 or more. |
| `LIN-003` | po_line | product_sku | empty or whitespace | reject | `SKU_REQUIRED` | Every line must reference a product SKU. |
| `LIN-004` | po_line | product_sku | normalized SKU is not in the ERP-1 catalogue | reject | `UNKNOWN_PRODUCT` | Product does not exist in ERP-1. |
| `LIN-005` | po_line | quantity | empty | reject | `QUANTITY_REQUIRED` | Quantity is required. |
| `LIN-006` | po_line | quantity | not a decimal with at most 3 places | reject | `INVALID_QUANTITY` | Up to 3 decimal places. |
| `LIN-007` | po_line | quantity | zero or negative | reject | `QUANTITY_MUST_BE_POSITIVE` | Must be greater than zero. |
| `LIN-008` | po_line | unit_price | empty | reject | `PRICE_REQUIRED` | Unit price is required. |
| `LIN-009` | po_line | unit_price | not a decimal with at most 4 places | reject | `INVALID_PRICE` | Up to 4 decimal places. |
| `LIN-010` | po_line | unit_price | negative | reject | `PRICE_MUST_BE_NON_NEGATIVE` | Must be zero or greater. |
| `LIN-011` | po_line | line_total | supplied value differs from `ROUND_HALF_UP(quantity x unit_price, 2)` | reject | `LINE_TOTAL_MISMATCH` | Supplied total does not match the computed decimal value. |
| `LIN-012` | po_line | po_number, line_no | normalized (po_number, line_no) already accepted in batch | review | `DUPLICATE_LINE_REVIEW` | Exact duplicate; held for human review, never merged. |

## 9. How this is verified

- Fixture counts, checksum and per-row outcomes are asserted against `expected-profile.json` and reproduce identically across runs.
- Raw input checksum and raw cell values are unchanged after profiling, cleaning and mapping.
- Each rule's reason code is exercised by at least one fixture row.
- Policy checks (no fuzzy matching, no automatic merge, formula-injection defence, bank-detail masking, status transitions) are covered in `dirty-data-plan.test.ts`.

Run the suite from the repo root:

```bash
npx vitest run apps/erp/modules/erp-2/tests/migration
```

## 10. Traceability

SDS ClearShift ERP v2.0, V1: FR-ERP2-01..06, BR-ERP2-01. Gate evidence: `apps/erp/modules/erp-2/docs/gate-g4-evidence-pack.md`. Field-level dictionary: `apps/erp/modules/erp-2/docs/data-dictionary.md`.
