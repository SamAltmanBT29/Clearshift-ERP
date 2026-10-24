# ERP-3 Cleaning Rules & Field-Level Audit (ERP3-27 / KIT-04)

Configuration: `apps/erp/modules/erp-3/src/migration/cleaning-config.ts`  
Fixture: `sample-data/erp-3/dirty-data-v1.csv` (135 synthetic rows, ERP3-25)  
Manifest: `sample-data/erp-3/expected-profile.json`  

The module configures the shared `@cs/kit` cleaning engine (`cleanDataset`, the standard cleaners, and the V1 rule registry). It adds zero duplicate cleaning infrastructure. Rule IDs in field change audits and row rejections come directly from the shared registry (`V1_CLEANING_RULES`).

---

## 1. Cleaning Rules Per Field

Entries marked "Fix" modify the input field and write a `FieldChangeAudit` entry (`source_row`, `field_name`, `original_value`, `cleaned_value`, `rule_id`). Entries marked "Reject" stop the row with the structured reason code.

| Record type | Field | Fixes (Rule ID) | Rejects (Reason code) |
|---|---|---|---|
| sales_order | order_number | Trim, upper-case (RL-TEXT-01) | Empty `ORDER_NUMBER_REQUIRED`; over 64 chars `ORDER_NUMBER_TOO_LONG`; non-alphanumeric `INVALID_ORDER_NUMBER_FORMAT`; formula prefix `FORMULA_INJECTION_DETECTED` |
| sales_order | customer_golden_id | Trim, lower-case (RL-TEXT-01) | Empty `CUSTOMER_GOLDEN_ID_REQUIRED`; malformed UUID `INVALID_CUSTOMER_GOLDEN_ID`; unknown customer `CUSTOMER_NOT_FOUND` |
| sales_order | order_date | `YYYY/M/D`, unpadded ISO -> `YYYY-MM-DD` (RL-DATE-01) | Empty `ORDER_DATE_REQUIRED`; ambiguous date `AMBIGUOUS_DATE_FORMAT_REVIEW`; impossible calendar date `INVALID_DATE` |
| sales_order | order_status | Canonical case matching `Open`, `Invoiced`, `Closed` (RL-TEXT-01) | Empty `STATUS_REQUIRED`; unknown status `INVALID_STATUS` |
| sales_order | currency | Trim, upper-case (RL-TEXT-01) | Empty `CURRENCY_REQUIRED`; not USD/EUR/INR `INVALID_CURRENCY` |
| sales_order | notes | Control characters removed (RL-TEXT-02); trim and collapse whitespace (RL-TEXT-01) | Longer than 1000 chars `NOTES_TOO_LONG`; formula prefix `FORMULA_INJECTION_DETECTED` |
| so_line | parent_source_id | Trim (RL-TEXT-01) | Empty `PARENT_SOURCE_ID_REQUIRED`; formula prefix `FORMULA_INJECTION_DETECTED` |
| so_line | line_number | Trim (RL-TEXT-01) | Not a positive integer `INVALID_LINE_NUMBER` |
| so_line | product_id | Trim, lower-case (RL-TEXT-01) | Empty `PRODUCT_ID_REQUIRED`; malformed UUID `INVALID_PRODUCT_ID`; unknown product `PRODUCT_NOT_FOUND` |
| so_line | quantity | Trim (RL-TEXT-01) | Empty `QUANTITY_REQUIRED`; not a 4dp decimal `INVALID_QUANTITY`; zero or negative `NEGATIVE_OR_ZERO_QUANTITY` |
| so_line | unit_price | Currency symbols and thousands separators stripped (RL-CURRENCY-01) | Empty `UNIT_PRICE_REQUIRED`; not a 4dp decimal `INVALID_UNIT_PRICE`; negative `NEGATIVE_UNIT_PRICE`; decimal comma `INVALID_UNIT_PRICE` |
| so_line | tax_rate | Trim, strip `%` (RL-TEXT-01) | Empty `TAX_RATE_REQUIRED`; not a 4dp decimal `INVALID_TAX_RATE`; outside 0.0000-100.0000% `TAX_RATE_OUT_OF_RANGE` |
| invoice | invoice_number | Trim, upper-case (RL-TEXT-01) | Empty `INVOICE_NUMBER_REQUIRED`; over 64 chars `INVOICE_NUMBER_TOO_LONG`; non-alphanumeric `INVALID_INVOICE_NUMBER_FORMAT`; formula prefix `FORMULA_INJECTION_DETECTED` |
| invoice | customer_golden_id | Trim, lower-case (RL-TEXT-01) | Empty `CUSTOMER_GOLDEN_ID_REQUIRED`; malformed UUID `INVALID_CUSTOMER_GOLDEN_ID`; unknown customer `CUSTOMER_NOT_FOUND` |
| invoice | invoice_date | Valid date format coercion -> `YYYY-MM-DD` (RL-DATE-01) | Empty `INVOICE_DATE_REQUIRED`; ambiguous date `AMBIGUOUS_DATE_FORMAT_REVIEW`; impossible calendar date `INVALID_DATE` |
| invoice | due_date | Valid date format coercion -> `YYYY-MM-DD` (RL-DATE-01) | Empty `DUE_DATE_REQUIRED`; ambiguous date `AMBIGUOUS_DATE_FORMAT_REVIEW`; impossible calendar date `INVALID_DUE_DATE` |
| invoice | currency | Trim, upper-case (RL-TEXT-01) | Empty `CURRENCY_REQUIRED`; not USD/EUR/INR `INVALID_CURRENCY` |
| invoice | invoice_status | Canonical case matching `Open`, `Paid`, `Overdue` (RL-TEXT-01) | Unknown status `INVALID_STATUS` |
| invoice_line | parent_source_id | Trim (RL-TEXT-01) | Empty `PARENT_SOURCE_ID_REQUIRED`; formula prefix `FORMULA_INJECTION_DETECTED` |
| invoice_line | line_number | Trim (RL-TEXT-01) | Not a positive integer `INVALID_LINE_NUMBER` |
| invoice_line | product_id | Trim, lower-case (RL-TEXT-01) | Empty `PRODUCT_ID_REQUIRED`; malformed UUID `INVALID_PRODUCT_ID`; unknown product `PRODUCT_NOT_FOUND` |
| invoice_line | quantity | Trim (RL-TEXT-01) | Empty `QUANTITY_REQUIRED`; not a 4dp decimal `INVALID_QUANTITY`; zero or negative `NEGATIVE_OR_ZERO_QUANTITY` |
| invoice_line | unit_price | Currency symbols and separators stripped (RL-CURRENCY-01) | Empty `UNIT_PRICE_REQUIRED`; not a 4dp decimal `INVALID_UNIT_PRICE`; negative `NEGATIVE_UNIT_PRICE` |
| invoice_line | tax_rate | Trim, strip `%` (RL-TEXT-01) | Empty `TAX_RATE_REQUIRED`; not a 4dp decimal `INVALID_TAX_RATE`; outside 0.0000-100.0000% `TAX_RATE_OUT_OF_RANGE` |
| payment | payment_number | Trim, upper-case (RL-TEXT-01) | Empty `PAYMENT_NUMBER_REQUIRED`; over 64 chars `PAYMENT_NUMBER_TOO_LONG`; non-alphanumeric `INVALID_PAYMENT_NUMBER_FORMAT`; formula prefix `FORMULA_INJECTION_DETECTED` |
| payment | parent_source_id | Trim (RL-TEXT-01) | Empty `PARENT_SOURCE_ID_REQUIRED`; formula prefix `FORMULA_INJECTION_DETECTED` |
| payment | payment_date | Valid date format coercion -> `YYYY-MM-DD` (RL-DATE-01) | Empty `PAYMENT_DATE_REQUIRED`; ambiguous date `AMBIGUOUS_DATE_FORMAT_REVIEW`; impossible calendar date `INVALID_DATE` |
| payment | payment_amount | Currency symbols and separators stripped (RL-CURRENCY-01) | Empty `PAYMENT_AMOUNT_REQUIRED`; not a 4dp decimal `INVALID_PAYMENT_AMOUNT`; zero or negative `NEGATIVE_OR_ZERO_PAYMENT_AMOUNT` |
| payment | payment_method | Trim, lower-case (RL-TEXT-01) | Empty `PAYMENT_METHOD_REQUIRED`; not cash/bank/card `INVALID_PAYMENT_METHOD` |
| payment | payment_reference | Control characters removed (RL-TEXT-02); trim and collapse whitespace (RL-TEXT-01) | Longer than 128 chars `PAYMENT_REFERENCE_TOO_LONG`; formula prefix `FORMULA_INJECTION_DETECTED` |

---

## 2. Registry Rules Not Applicable to ERP-3

| Rule ID | Name | Rationale for ERP-3 |
|---|---|---|
| `RL-EMAIL-01` | Email Normalization | ERP-3 entities carry no contact email address column (customer communications live in CRM-1/Platform). |
| `RL-PHONE-01` | Phone Sanitization | ERP-3 entities carry no phone number column. |
| `RL-NAME-01` | Proper Case Name Normalization | Customer identities resolve via CRM-1 Golden IDs (BR-ERP3-03); ERP-3 holds no raw personal/contact names. |
| `RL-ADDR-01` | Address Standardization | ERP-3 entities carry no postal address, street, or city columns (billing/shipping addresses live in CRM-1). |
| `RL-TAX-01` | Tax Number Formatting | Tax entity registration numbers are stored in ERP-2 (Vendor) and CRM-1 (Customer); ERP-3 lines store percentage `tax_rate`. |
| `RL-DUP-01` | Exact Key Duplicate Flagging | Duplicate candidate detection is owned by the ERP3-25 evaluator and ERP3-26 profiler. |

---

## 3. Field-Level Change Audit Trail

- **Audit Entry Schema**: Every modified field value generates a structured `FieldChangeAudit` record containing:
  - `source_row`: Source row identifier (e.g. `R024`).
  - `field_name`: Qualified column name (e.g. `order_number`, `currency`).
  - `original_value`: Exact raw string before transformation.
  - `cleaned_value`: Transformed clean value after rule execution.
  - `rule_id`: Stable identifier of the executing rule (e.g. `RL-TEXT-01`, `RL-DATE-01`, `RL-CURRENCY-01`).
- **Sequential Stepper**: When a field undergoes multiple cleaning passes (e.g. trimming whitespace, then upper-casing), each change produces an independent sequential audit record.
- **Row Outcomes**:
  - `new`: No field values required modification; row passes as-is.
  - `cleaned`: At least one field was modified and logged in the audit trail.
  - `rejected`: At least one unrecoverable validation error was encountered.

---

## 4. Guarantees & Non-Destructive Invariants

- **Immutability (BR-KIT-03)**: Raw input rows and CSV buffers are never mutated in memory or on disk. Cleaned values are stored in a separate projection while originals are preserved in `rawData`.
- **Formula Injection Defense (PLT-12 / KIT-16)**: Inputs with spreadsheet formula prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) are rejected outright rather than being silently modified.
- **Ambiguous Date Safety**: Dates with ambiguous day/month interpretations (e.g. `10/12/2026`) are rejected for human decision rather than guessed.
- **Audit Export Security**: Audit trail CSV exports are sanitized with single-quote escaping on formula prefixes.
- **No API Changes**: No HTTP endpoints are added, so OpenAPI contracts remain unchanged.
