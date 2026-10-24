# ERP-2 Cleaning Rules & Field-Level Audit (ERP2-27 / KIT-04)

Configuration: `apps/erp/modules/erp-2/src/migration/cleaning-config.ts`
Fixture: `sample-data/erp-2/dirty-data-v1.csv` (173 synthetic rows, ERP2-25)

The module configures the shared `@cs/kit` cleaning engine (`cleanDataset`, the standard cleaners and the V1 rule registry). It adds no cleaning engine of its own. Rule ids in audits and rejections come from the shared registry (`V1_CLEANING_RULES`).

## Cleaning rules per field

Entries marked "reject" stop the row with the listed reason code. Entries marked "fix" change the value and write an audit entry.

| Record type | Field | Fixes (rule id) | Rejects (reason code) |
|---|---|---|---|
| vendor | vendor_code | trim, upper-case (RL-TEXT-01) | empty `VENDOR_CODE_REQUIRED`; over 64 chars `VENDOR_CODE_TOO_LONG`; formula prefix `FORMULA_INJECTION_DETECTED` |
| vendor | vendor_name | control characters (RL-TEXT-02); trim and collapse spaces (RL-TEXT-01) | empty `VENDOR_NAME_REQUIRED`; formula prefix `FORMULA_INJECTION_DETECTED` |
| vendor | tax_number | trim, upper-case (RL-TAX-01); separators kept | not 4-32 letters/digits once separators are ignored `INVALID_TAX_NUMBER` |
| vendor | email | trim, lower-case (RL-EMAIL-01) | invalid address `INVALID_EMAIL` |
| vendor, purchase_order | currency | trim, upper-case (RL-TEXT-01) | empty `CURRENCY_REQUIRED`; not USD/EUR/GBP/INR `INVALID_CURRENCY` |
| vendor | payment_terms_days | trim (RL-TEXT-01) | not a whole number `INVALID_PAYMENT_TERMS`; outside 0-365 `PAYMENT_TERMS_OUT_OF_RANGE` |
| purchase_order, po_line | po_number | trim, upper-case (RL-TEXT-01) | empty `PO_NUMBER_REQUIRED`; formula prefix `FORMULA_INJECTION_DETECTED` |
| purchase_order | po_vendor_code | trim, upper-case (RL-TEXT-01) | empty `PO_VENDOR_REQUIRED`; formula prefix `FORMULA_INJECTION_DETECTED` |
| purchase_order | po_status | canonical case, e.g. `  received ` -> `Received` (RL-TEXT-01) | empty `PO_STATUS_REQUIRED`; unknown `INVALID_PO_STATUS` |
| purchase_order | status_path | trim around `>` (RL-TEXT-01) | none (transitions are validated by the ERP2-25 evaluator) |
| purchase_order | po_date | `YYYY/M/D`, `YYYY-M-D` and padded ISO -> `YYYY-MM-DD` (RL-DATE-01) | empty `PO_DATE_REQUIRED`; `DD/MM/YYYY`-style `AMBIGUOUS_DATE_FORMAT_REVIEW`; impossible date `INVALID_DATE` |
| purchase_order | expected_date | same as po_date (optional) | `AMBIGUOUS_DATE_FORMAT_REVIEW`, `INVALID_DATE` |
| purchase_order | po_total | currency symbols and thousands separators removed (RL-CURRENCY-01) | empty `PO_TOTAL_REQUIRED`; not a non-negative decimal with up to 2 places, or a decimal comma `INVALID_PO_TOTAL` |
| po_line | line_no | trim (RL-TEXT-01) | not a positive whole number `INVALID_LINE_NUMBER` |
| po_line | product_sku | trim, upper-case (RL-TEXT-01) | empty `SKU_REQUIRED`; formula prefix `FORMULA_INJECTION_DETECTED` |
| po_line | quantity | trim (RL-TEXT-01) | empty `QUANTITY_REQUIRED`; not a decimal with up to 3 places `INVALID_QUANTITY`; zero or negative `QUANTITY_MUST_BE_POSITIVE` |
| po_line | unit_price | currency symbols and thousands separators removed (RL-CURRENCY-01) | empty `PRICE_REQUIRED`; not a decimal with up to 4 places or a decimal comma `INVALID_PRICE`; negative `PRICE_MUST_BE_NON_NEGATIVE` |
| po_line | line_total | as unit_price (optional) | not a non-negative decimal with up to 2 places `INVALID_LINE_TOTAL` |

Where an ERP2-25 reason code exists, the cleaner uses the same code. `INVALID_LINE_TOTAL` is the only new one.

## Registry rules not applied

| Rule | Reason |
|---|---|
| RL-PHONE-01 | ERP-2 has no phone column. |
| RL-NAME-01 | Vendor names are company names; proper-casing would corrupt them. |
| RL-ADDR-01 | ERP-2 has no address or city columns. |
| RL-DUP-01 | Exact duplicate detection is owned by the ERP2-25 evaluator and the ERP2-26 profiler. |

## Field-level audit

Every modified value produces one audit entry with `source_row` (the fixture `row_id`), `field_name`, `original_value`, `cleaned_value` and `rule_id`. A field that needs two changes (trim, then upper-case) produces two entries in order. Rows are classified as `new` (no change), `cleaned` (at least one change) or `rejected` (at least one structured rejection with rule id, reason code and message). The audit export is the shared formula-safe CSV (`kit_clean_log`).

## Guarantees

- Raw input is never mutated; cleaned values live in a separate projection and the original is preserved in `rawData`.
- Bank details are masked before cleaning. `bank_account` has no cleaning rule, so it cannot appear in an audit entry or export.
- Ambiguous dates are never guessed: they are rejected for a human decision.
- Formula-injection values are rejected unchanged rather than repaired.
- Matching is exact and deterministic; there is no fuzzy matching and no automatic merge.
- No API endpoints are added, so the OpenAPI contract is unchanged.
