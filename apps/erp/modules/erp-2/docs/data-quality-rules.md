# ERP-2 Vendors & Purchasing — V1 Data-Quality Rules

Rule catalogue version **1.0.0**. Code: `apps/erp/modules/erp-2/src/migration/rules.ts`. Tests: `apps/erp/modules/erp-2/tests/migration/rules.test.ts`.

Traceability: SDS ClearShift ERP v2.0 V1 — FR-ERP2-01..06, BR-ERP2-01; Project Plan v3.0 §7.7.

## 1. Principles

1. **Raw input is never changed.** The fixture is parsed into frozen rows. Cleaning writes new values; the raw cells and the raw SHA-256 are unchanged after profiling, cleaning and mapping.
2. **Deterministic.** The same fixture and the same rule version give a byte-identical profile (`expected-profile.json`).
3. **No fuzzy matching, no automatic merge.** Duplicates are detected only on exact candidate keys after normalization (vendor `tax_number`, purchase-order `po_number`). A later duplicate gets outcome `review`, is not loaded, and is never merged. A human decides.
4. **Every outcome has a stable reason.** Each rule has a `rule_id`, a version, an input condition, a result and a human-readable reason. Reject and review rules also have a stable `reason_code`.
5. **Cross-module references go through ERP-1's public contract.** Product existence is asked of the ERP-1 `ReferenceResolver` (`exists('product', id)`). This module never reads ERP-1 tables and no other module writes to this module's tables.
6. **Totals are server-side.** Order total = sum of line totals; line total = round half-up(quantity × price, 2) with decimal (BigInt) arithmetic. A total in the source file is ignored.
7. **Bank details are never reported unmasked.** Reports show `XXXX-XXXX-<last 4 digits>` only.
8. **Synthetic data only.** Nothing is uploaded to any external or cloud service.

## 2. Outcomes

| Outcome | Meaning |
|---|---|
| `accepted` | Passed every rule. Carries clean data for the import call. |
| `rejected` | Failed at least one reject rule. Not loaded. Reasons listed. |
| `review` | Exact duplicate candidate, or child of one. Not loaded until a human decides. |

An order is loaded **whole or not at all**: one rejected line rejects the order and holds its other lines back (`LINE_REJECTED`, `PARENT_PO_REJECTED`).

## 3. Fields, required vs optional, enumerations

| Entity | Required | Optional | Enumerations |
|---|---|---|---|
| Vendor | source_id, name, tax_number, email, currency | phone, address_line, city, country, bank_details | currency ∈ USD, EUR, GBP |
| Purchase order | source_id, vendor_ref, order_date, status, currency, at least one line | po_number (server generates when blank), client_total (ignored) | status ∈ Draft → Sent → Received → Closed; currency ∈ USD, EUR, GBP |
| Purchase-order line | parent_source_id, product_id, quantity, price | — | — |

Notes:
- **Currency is explicit** on vendors and orders: blank is rejected, there is no default and no FX conversion in V1.
- **Status.** `POST /purchase-orders` always creates `Draft`. A clean order whose `post_load_status` is later in the flow is advanced afterwards by forward-only `PATCH` calls. `Cancelled` and every other value are rejected (`INVALID_STATUS`). Marking `Received` does not change inventory (goods receipts are V2).
- **Amounts** are non-negative decimals with at most 2 decimals. Quantity must be greater than zero and fit NUMERIC(12,2); price fits NUMERIC(18,2); total must fit NUMERIC(18,2). Over-precise values are rejected, never rounded.
- **Dates** must be real calendar dates in `YYYY-MM-DD`. `YYYY/MM/DD` is converted. Day-first and month-first dates are ambiguous and rejected (`AMBIGUOUS_DATE_FORMAT`).

## 4. Normalization

| Field | Normalization |
|---|---|
| name, address_line, city, country | trim, collapse inner whitespace; blank optional value becomes null |
| tax_number, vendor_ref, po_number | remove whitespace, upper-case |
| email | trim, lower-case |
| phone | remove spaces, dots, dashes, parentheses |
| bank_details | remove spaces and dashes, upper-case |
| currency | trim, upper-case |
| status | trim, fix case |
| order_date | `YYYY/MM/DD` → `YYYY-MM-DD` |
| product_id | trim, lower-case |
| quantity, price | trim, remove thousands commas, pad to exactly 2 decimals |

A normalization rule is counted in the profile only when it actually changed a non-blank cell.

## 5. Relationship resolution

| Reference | Resolved through | Failure |
|---|---|---|
| Order → vendor | `vendor_ref` (vendor tax number) matched exactly against accepted vendor rows in the batch | `VENDOR_NOT_FOUND`, `VENDOR_REJECTED` |
| Line → order | `parent_source_id` matched to the first order row with that `source_id` | `ORPHAN_LINE` |
| Line → product | ERP-1 `ReferenceResolver` | `UNKNOWN_PRODUCT` (or `INVALID_PRODUCT_ID_FORMAT` before asking) |

## 6. Source-to-target mapping

See `sample-data/erp-2/mapping-template.json`. Vendors load first, then purchase orders with their lines, through `POST /api/v1/erp-vendors/import` (or the public create endpoints). Idempotency key: `SYNTH-ERP2-DIRTY-V1:{entity}:{source_id}`.

## 7. Rule catalogue

### Vendors

| rule_id | Version | Field | Kind | Input condition | Result | Reason code | Reason |
|---|---|---|---|---|---|---|---|
| `VND-001` | 1.0.0 | `name` | required | name is empty after trimming | reject | `VENDOR_NAME_REQUIRED` | Vendor name is required. |
| `VND-002` | 1.0.0 | `tax_number` | required | tax_number is empty after trimming | reject | `TAX_NUMBER_REQUIRED` | Vendor tax number is required. |
| `VND-003` | 1.0.0 | `email` | required | email is empty after trimming | reject | `EMAIL_REQUIRED` | Vendor email is required. |
| `VND-004` | 1.0.0 | `currency` | required | currency is empty after trimming | reject | `CURRENCY_REQUIRED` | Currency must be explicit; there is no default and no FX conversion in V1. |
| `VND-005` | 1.0.0 | `source_id` | required | source_id is empty after trimming | reject | `SOURCE_ID_REQUIRED` | Source id is required for migration lineage. |
| `VND-010` | 1.0.0 | `name` | normalize | name has leading/trailing or repeated inner whitespace | normalize | — | Trim and collapse whitespace in the vendor name. |
| `VND-011` | 1.0.0 | `tax_number` | normalize | tax_number has whitespace or lowercase letters | normalize | — | Remove whitespace and upper-case the tax number. |
| `VND-012` | 1.0.0 | `email` | normalize | email has surrounding whitespace or uppercase letters | normalize | — | Trim and lower-case the email. |
| `VND-013` | 1.0.0 | `phone` | normalize | phone contains spaces, dots, dashes or parentheses | normalize | — | Strip phone separators; an empty phone becomes null. |
| `VND-014` | 1.0.0 | `currency` | normalize | currency has whitespace or lowercase letters | normalize | — | Trim and upper-case the currency code. |
| `VND-015` | 1.0.0 | `address_line` | normalize | address_line, city or country has surrounding/repeated whitespace | normalize | — | Trim and collapse whitespace; an empty value becomes null. |
| `VND-016` | 1.0.0 | `bank_details` | normalize | bank_details contains spaces or dashes | normalize | — | Strip spaces and dashes and upper-case; an empty value becomes null. |
| `VND-020` | 1.0.0 | `name` | length | normalized name is longer than 255 characters | reject | `NAME_TOO_LONG` | Vendor name must be at most 255 characters. |
| `VND-021` | 1.0.0 | `address_line` | length | normalized address_line is longer than 255 characters | reject | `ADDRESS_TOO_LONG` | Address must be at most 255 characters. |
| `VND-022` | 1.0.0 | `city` | length | normalized city is longer than 100 characters | reject | `CITY_TOO_LONG` | City must be at most 100 characters. |
| `VND-023` | 1.0.0 | `country` | length | normalized country is longer than 64 characters | reject | `COUNTRY_TOO_LONG` | Country must be at most 64 characters. |
| `VND-030` | 1.0.0 | `tax_number` | format | normalized tax_number does not match ^[A-Z0-9-]{3,64}$ | reject | `INVALID_TAX_NUMBER_FORMAT` | Tax number may only contain A-Z, 0-9 and "-" (3 to 64 characters). |
| `VND-031` | 1.0.0 | `email` | format | normalized email is not local@domain.tld or is longer than 255 characters | reject | `INVALID_EMAIL_FORMAT` | Email address is not valid. |
| `VND-032` | 1.0.0 | `phone` | format | non-empty normalized phone does not match ^\+?\d{7,15}$ | reject | `INVALID_PHONE_FORMAT` | Phone must be 7 to 15 digits with an optional leading "+". |
| `VND-033` | 1.0.0 | `bank_details` | format | non-empty normalized bank_details is not 4-34 alphanumerics containing at least 4 digits | reject | `INVALID_BANK_DETAILS_FORMAT` | Bank details must be 4 to 34 alphanumeric characters with at least 4 digits. |
| `VND-040` | 1.0.0 | `currency` | enum | normalized currency is not one of USD, EUR, GBP | reject | `INVALID_CURRENCY` | Currency is not an accepted ISO 4217 code in V1. |
| `VND-050` | 1.0.0 | `tax_number` | duplicate | a later row has the same normalized tax_number as an earlier row that passed all other vendor rules | review | `DUPLICATE_TAX_NUMBER_REVIEW` | Exact duplicate tax number; held for explicit review, never merged automatically. |
| `VND-060` | 1.0.0 | `bank_details` | derive | bank_details present and valid | derive | — | Reports show bank details only as XXXX-XXXX-<last 4 digits>. |

### Purchase orders

| rule_id | Version | Field | Kind | Input condition | Result | Reason code | Reason |
|---|---|---|---|---|---|---|---|
| `PUR-001` | 1.0.0 | `source_id` | required | source_id is empty after trimming | reject | `SOURCE_ID_REQUIRED` | Source id is required; order lines attach to their order through it. |
| `PUR-002` | 1.0.0 | `vendor_ref` | required | vendor_ref is empty after trimming | reject | `VENDOR_REF_REQUIRED` | Vendor reference (vendor tax number) is required. |
| `PUR-003` | 1.0.0 | `order_date` | required | order_date is empty after trimming | reject | `ORDER_DATE_REQUIRED` | Order date is required. |
| `PUR-004` | 1.0.0 | `status` | required | status is empty after trimming | reject | `STATUS_REQUIRED` | Status is required. |
| `PUR-005` | 1.0.0 | `currency` | required | currency is empty after trimming | reject | `CURRENCY_REQUIRED` | Currency must be explicit; there is no default and no FX conversion in V1. |
| `PUR-006` | 1.0.0 | `lines` | required | no po_line row attaches to this order | reject | `NO_LINES` | A purchase order needs at least one line. |
| `PUR-010` | 1.0.0 | `po_number` | normalize | po_number has whitespace or lowercase letters | normalize | — | Trim and upper-case the PO number; an empty value becomes null (server generates it). |
| `PUR-011` | 1.0.0 | `vendor_ref` | normalize | vendor_ref has whitespace or lowercase letters | normalize | — | Remove whitespace and upper-case so it matches the vendor tax number. |
| `PUR-012` | 1.0.0 | `order_date` | normalize | order_date is YYYY/MM/DD | normalize | — | Convert YYYY/MM/DD to YYYY-MM-DD. |
| `PUR-013` | 1.0.0 | `status` | normalize | status differs from an accepted status only by case or whitespace | normalize | — | Trim and fix the case of the status. |
| `PUR-014` | 1.0.0 | `currency` | normalize | currency has whitespace or lowercase letters | normalize | — | Trim and upper-case the currency code. |
| `PUR-020` | 1.0.0 | `po_number` | length | normalized po_number is longer than 64 characters | reject | `PO_NUMBER_TOO_LONG` | PO number must be at most 64 characters. |
| `PUR-030` | 1.0.0 | `order_date` | format | normalized order_date is not a real calendar date in YYYY-MM-DD | reject | `INVALID_ORDER_DATE` | Order date must be a real date in YYYY-MM-DD format. |
| `PUR-031` | 1.0.0 | `order_date` | format | order_date looks like DD/MM/YYYY or MM/DD/YYYY | reject | `AMBIGUOUS_DATE_FORMAT` | Day-first and month-first dates are ambiguous and are never guessed. |
| `PUR-040` | 1.0.0 | `status` | enum | normalized status is not Draft, Sent, Received or Closed | reject | `INVALID_STATUS` | Status must be Draft, Sent, Received or Closed; cancellation is not supported in V1. |
| `PUR-041` | 1.0.0 | `currency` | enum | normalized currency is not one of USD, EUR, GBP | reject | `INVALID_CURRENCY` | Currency is not an accepted ISO 4217 code in V1. |
| `PUR-050` | 1.0.0 | `vendor_ref` | reference | no vendor row in the batch has this normalized tax number | reject | `VENDOR_NOT_FOUND` | The order references a vendor that is not in the batch. |
| `PUR-051` | 1.0.0 | `vendor_ref` | reference | the only vendor row with this tax number was rejected | reject | `VENDOR_REJECTED` | The order references a vendor that failed data-quality rules. |
| `PUR-060` | 1.0.0 | `po_number` | duplicate | a later row has the same normalized non-empty po_number as an earlier row that passed all header rules | review | `DUPLICATE_PO_NUMBER_REVIEW` | Exact duplicate PO number; held for explicit review, never merged automatically. |
| `PUR-070` | 1.0.0 | `total` | derive | always | derive | — | Order total = sum of line totals computed server-side; any total in the source file is ignored. |
| `PUR-071` | 1.0.0 | `total` | format | computed total does not fit NUMERIC(18,2) | reject | `TOTAL_OVERFLOW` | The computed order total exceeds NUMERIC(18,2). |
| `PUR-072` | 1.0.0 | `lines` | reference | at least one attached line was rejected by its own rules | reject | `LINE_REJECTED` | An order is loaded whole or not at all; one rejected line rejects the order. |

### Purchase-order lines

| rule_id | Version | Field | Kind | Input condition | Result | Reason code | Reason |
|---|---|---|---|---|---|---|---|
| `LIN-002` | 1.0.0 | `product_id` | required | product_id is empty after trimming | reject | `PRODUCT_ID_REQUIRED` | Product id is required. |
| `LIN-003` | 1.0.0 | `quantity` | required | quantity is empty after trimming | reject | `QUANTITY_REQUIRED` | Quantity is required. |
| `LIN-004` | 1.0.0 | `price` | required | price is empty after trimming | reject | `PRICE_REQUIRED` | Price is required. |
| `LIN-010` | 1.0.0 | `product_id` | normalize | product_id has whitespace or uppercase letters | normalize | — | Trim and lower-case the product id. |
| `LIN-011` | 1.0.0 | `quantity` | normalize | quantity or price has whitespace, thousands separators or fewer than 2 decimals | normalize | — | Trim, remove thousands commas and pad to exactly 2 decimals. |
| `LIN-030` | 1.0.0 | `product_id` | format | normalized product_id is not a UUID | reject | `INVALID_PRODUCT_ID_FORMAT` | Product id must be a UUID. |
| `LIN-031` | 1.0.0 | `quantity` | format | normalized quantity is not a plain non-negative decimal | reject | `INVALID_QUANTITY_FORMAT` | Quantity must be a plain decimal such as 10 or 10.50. |
| `LIN-032` | 1.0.0 | `price` | format | normalized price is not a plain non-negative decimal | reject | `INVALID_PRICE_FORMAT` | Price must be a plain decimal such as 15 or 15.50. |
| `LIN-033` | 1.0.0 | `quantity` | format | quantity or price starts with "-" | reject | `NEGATIVE_AMOUNT` | Amounts must be non-negative. |
| `LIN-034` | 1.0.0 | `quantity` | format | quantity or price has more than 2 decimal places | reject | `EXCESS_DECIMAL_PLACES` | Amounts have at most 2 decimals; values are never silently rounded. |
| `LIN-035` | 1.0.0 | `quantity` | format | quantity equals zero | reject | `QUANTITY_NOT_POSITIVE` | Quantity must be greater than zero. |
| `LIN-036` | 1.0.0 | `quantity` | format | quantity has more than 10 integer digits or price more than 16 | reject | `AMOUNT_OVERFLOW` | Amount exceeds the NUMERIC column limit. |
| `LIN-040` | 1.0.0 | `product_id` | reference | the ERP-1 ReferenceResolver reports no product with this id | reject | `UNKNOWN_PRODUCT` | Product does not exist in ERP-1 (BR-ERP2-01). |
| `LIN-041` | 1.0.0 | `parent_source_id` | reference | parent_source_id is empty or matches no purchase_order source_id | reject | `ORPHAN_LINE` | The line does not belong to any purchase order in the batch. |
| `LIN-042` | 1.0.0 | `parent_source_id` | reference | the line passed its own rules but its purchase order was rejected | reject | `PARENT_PO_REJECTED` | The parent order was rejected, so the line is not loaded. |
| `LIN-043` | 1.0.0 | `parent_source_id` | reference | the line passed its own rules but its purchase order is held for review | review | `PARENT_PO_IN_REVIEW` | The parent order is held for review, so the line is held with it. |
| `LIN-050` | 1.0.0 | `line_total` | derive | always | derive | — | Line total = round_half_up(quantity x price, 2) using decimal arithmetic. |

## 8. Fixture and expected outcomes

| Item | Value |
|---|---|
| Fixture | `sample-data/erp-2/dirty-data-v1.csv` |
| Manifest and expected outcomes | `sample-data/erp-2/expected-profile.json` |
| SHA-256 | `754c2740163de9d9ec8e8bdd5deee5cd87a7b4ddac0cde335388f7e7d076b725` |
| Fixture schema version | 1 |
| Rows | 86 (21 vendors, 31 purchase orders, 34 lines) |
| Outcomes | 16 accepted, 66 rejected, 4 review |

Each fixture row carries `case_tags` (`entity.field:valid` or `:invalid`) and hand-written `expect_outcome` / `expect_reasons`, so every field and enumeration has at least one valid and one invalid row and the engine is checked against an independent oracle.

**Changing the fixture or a rule:** edit the CSV or rule, bump `RULES_VERSION` for any rule change, regenerate `expected-profile.json`, and update the checksum above. The checksum test fails until all three agree. Keep the CSV with LF line endings.

## 9. Runbook

```bash
# from the Clearshift-ERP root, Node 24
npx vitest run apps/erp/modules/erp-2/tests/migration/rules.test.ts
npx vitest run apps/erp/modules/erp-2
shasum -a 256 sample-data/erp-2/dirty-data-v1.csv   # must equal the SHA-256 above
```
