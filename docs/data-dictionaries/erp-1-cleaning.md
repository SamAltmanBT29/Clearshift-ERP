# ERP-1 Cleaning Rules & Field-Level Audit (ERP1-27 / KIT-04)

Configuration: `apps/erp/modules/erp-1/src/migration/cleaning-config.ts`  
Fixture: `sample-data/erp-1/dirty-data-v1.csv` (ERP1-25)

The module configures the shared `@cs/kit` cleaning engine (`cleanDataset`, the standard cleaners and the V1 rule registry). It adds no duplicate cleaning engine of its own. Rule IDs in audits and rejections come from the shared registry (`V1_CLEANING_RULES`).

## Cleaning rules per field

Entries marked "reject" stop the row with the listed reason code. Entries marked "fix" change the value and write an audit entry.

| Record type | Field | Fixes (rule ID) | Rejects (reason code) |
|---|---|---|---|
| category | code | trim, upper-case (RL-TEXT-01); control chars (RL-TEXT-02) | empty `CATEGORY_CODE_REQUIRED`; formula prefix `FORMULA_INJECTION_DETECTED` |
| category | name | control chars (RL-TEXT-02); trim and collapse spaces (RL-TEXT-01) | empty `CATEGORY_NAME_REQUIRED`; formula prefix `FORMULA_INJECTION_DETECTED` |
| category, warehouse | is_default | trim, lower-case (RL-TEXT-01) | not true/false `INVALID_BOOLEAN` |
| warehouse | code | trim, upper-case (RL-TEXT-01); control chars (RL-TEXT-02) | empty `WAREHOUSE_CODE_REQUIRED`; not WH-01 `INVALID_WAREHOUSE_FACILITY`; formula prefix `FORMULA_INJECTION_DETECTED` |
| warehouse | name | control chars (RL-TEXT-02); trim and collapse spaces (RL-TEXT-01) | empty `WAREHOUSE_NAME_REQUIRED`; formula prefix `FORMULA_INJECTION_DETECTED` |
| warehouse | notification_email | trim, lower-case, validated (RL-EMAIL-01) | invalid email structure `INVALID_EMAIL` |
| warehouse | contact_phone | trim, normalized to digits + leading '+' (RL-PHONE-01) | none |
| product, stock_level | sku | trim, upper-case (RL-TEXT-01); control chars (RL-TEXT-02) | empty `SKU_REQUIRED`; over 64 chars `SKU_TOO_LONG`; formula prefix `FORMULA_INJECTION_DETECTED` |
| product | name | control chars (RL-TEXT-02); trim and collapse spaces (RL-TEXT-01) | empty `PRODUCT_NAME_REQUIRED`; formula prefix `FORMULA_INJECTION_DETECTED` |
| product | category_code | trim, upper-case (RL-TEXT-01) | empty `CATEGORY_CODE_REQUIRED`; formula prefix `FORMULA_INJECTION_DETECTED` |
| product | unit_of_measure | trim, lower-case (RL-TEXT-01) | empty `UOM_REQUIRED`; not pcs/kg/g/litre/metre/box `INVALID_UOM` |
| product | price | currency symbols and separators stripped (RL-CURRENCY-01) | empty `PRICE_REQUIRED`; negative `NEGATIVE_PRICE`; invalid decimal or decimal comma `INVALID_PRICE_FORMAT` |
| product | currency | trim, upper-case (RL-TEXT-01) | empty `CURRENCY_REQUIRED`; not USD/EUR/GBP/INR `INVALID_CURRENCY` |
| product | tax_rate | currency symbols removed, decimal scale 4 (RL-CURRENCY-01) | negative or non-decimal `INVALID_TAX_RATE` |
| stock_level | warehouse_code | trim, upper-case (RL-TEXT-01) | empty `WAREHOUSE_CODE_REQUIRED`; not WH-01 `INVALID_WAREHOUSE_FACILITY` |
| stock_level | quantity | trim, currency symbols removed (RL-CURRENCY-01) | empty `QUANTITY_REQUIRED`; negative `NEGATIVE_STOCK_QUANTITY`; invalid number `INVALID_QUANTITY_FORMAT` |
| stock_level | as_of_date | `YYYY/M/D`, `YYYY-M-D` coerced to `YYYY-MM-DD` (RL-DATE-01) | empty `DATE_REQUIRED`; ambiguous `AMBIGUOUS_DATE_FORMAT_REVIEW`; impossible date `INVALID_DATE` |

## Registry rules not applied

| Rule | Reason |
|---|---|
| RL-NAME-01 | Product and warehouse names are proper facility/trade names with technical acronyms (e.g. NEMA, SMD); proper-casing would corrupt them. |
| RL-DUP-01 | Exact duplicate detection is owned by the ERP1-25 Dirty Data Pack evaluator and the ERP1-26 profiler. |

## Field-level audit

Every modified value produces one audit entry with `source_row` (the fixture `row_id`), `field_name`, `original_value`, `cleaned_value`, and `rule_id`. Rows are classified as `new` (no change), `cleaned` (at least one change), or `rejected` (at least one structured rejection with rule id, reason code and message). The audit export is the shared formula-safe CSV (`kit_clean_log`).

## Guarantees

- Raw input is never mutated (BR-KIT-03); original input is preserved in `rawData`.
- Sensitive banking and employee identification fields (`supplier_bank_account`, `employee_ssn`) are masked before cleaning and excluded from audit logs.
- Ambiguous dates are never guessed: they are rejected for human review.
- Formula-injection prefixes are rejected rather than silently repaired (OWASP / PLT-12 / KIT-16).
- Matching is deterministic and exact; no fuzzy matching or unapproved merge in V1.
