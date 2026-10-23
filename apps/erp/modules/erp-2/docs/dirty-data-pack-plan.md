# ERP-2 Vendors & Purchasing: Dirty Data Pack Plan

**Issue**: [ERP2-24 / #140](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/140), Gate G1 design artifact
**Scope**: this is a **plan**. It defines the synthetic fixture strategy, edge-case scenarios and expected defect distribution. It does not create the CSV. The fixture and its test are follow-up work (TC-GAP-06 in the [traceability matrix](./traceability-matrix.md)).
**Format reference**: `apps/erp/modules/erp-1/src/migration/dirty-data-plan.ts` and `sample-data/erp-1/dirty-data-v1.csv`.

## 1. Fixture strategy

| Item | Decision |
|---|---|
| Planned path | `sample-data/erp-2/dirty-data-v1.csv` (plus `expected-profile.json`, `mapping-template.json`, matching the ERP-1/3/4 layout) |
| Size | 120 source rows: 40 vendors, 30 purchase orders, 50 PO lines |
| Determinism | Fixed row ids, fixed ordering, no randomness. Same file gives the same profile on every run. |
| Synthetic only | 100% invented data: names like `Dirty Vendor 007 Ltd`, tax numbers `TX-DIRTY-001..`, emails `*@dirty-vendor.example`, bank numbers that are not real accounts, product ids from the seed range `5eed0000-0000-4000-8000-0000000000aN`. No real person, customer, employee or bank data. |
| Raw immutability | Extract writes rows untouched into `raw_erp2` (BR-KIT-03). Cleaning happens in a later step. |
| Duplicate policy | **Exact, deterministic matching only** (normalised tax number, email, PO number). No fuzzy scoring. Candidates with conflicting keys are `AMBIGUOUS` and held for human review. |
| Out of scope | Fuzzy matching, V2 rollback sagas, outbound messaging, cloud storage. |

### 1.1 Planned columns

`row_id, record_type, case_tags, source_system, source_id, name, tax_number, email, phone, address_line, city, country, bank_account, currency, po_number, vendor_ref, order_date, status, notes, product_ref, line_number, quantity, price, expect_outcome, expect_reasons`

- `record_type`: `vendor`, `purchase_order` or `po_line`
- `vendor_ref` points to a vendor `source_id`; `product_ref` points to a seed product id; PO lines reference their order through `po_number`
- `expect_outcome`: `loaded`, `loaded_cleaned`, `loaded_after_review`, `merged`, `rejected`
- `expect_reasons`: pipe-separated reason codes (see §5)

## 2. Scenario catalogue

Reason codes marked † already exist in `src/domain/rules.ts`. The rest are readable labels to be bound to the target adapter's stable codes when the fixture is written.

### 2.1 Vendors (40 rows)

| ID | Scenario | Rows | Expected outcome | Reason |
|---|---|---|---|---|
| V-CLEAN | Valid vendor, all fields well formed | 22 | loaded | none |
| V-AC-01 | Leading/trailing whitespace in name and tax number | 2 | loaded_cleaned | TRIMMED |
| V-AC-02 | Email in mixed case (`Sales@Dirty-Vendor.example`) | 1 | loaded_cleaned | EMAIL_LOWERCASED |
| V-AC-03 | Phone with punctuation / spacing variants | 1 | loaded_cleaned | PHONE_NORMALISED |
| V-AC-04 | Currency in lowercase (`usd`) | 1 | loaded_cleaned | CURRENCY_UPPERCASED |
| V-AC-05 | Bank number with spaces/hyphens (`1234 5678 7890`) | 1 | loaded_cleaned | BANK_MASKED (stored as `XXXX-XXXX-7890`) |
| V-DUP-01 | Same normalised tax number as an earlier row (`tx-dirty-010` vs `TX-DIRTY-010`) | 4 | merged | EXACT_DUPLICATE |
| V-DUP-02 | Same normalised email, **different** tax number (conflicting keys) | 2 | loaded_after_review (reviewer picks KEEP_BOTH) | AMBIGUOUS |
| V-REJ-01 | Empty name | 1 | rejected | NAME_REQUIRED |
| V-REJ-02 | Empty tax number | 1 | rejected | TAX_NUMBER_REQUIRED |
| V-REJ-03 | Bank details shorter than 4 characters | 2 | rejected | INVALID_BANK_DETAILS † |
| V-REJ-04 | Currency not 3 letters (`US`, `DOLLAR`) | 1 | rejected | INVALID_CURRENCY |
| V-REJ-05 | Name longer than 255 characters | 1 | rejected | NAME_TOO_LONG |

### 2.2 Purchase orders (30 rows)

| ID | Scenario | Rows | Expected outcome | Reason |
|---|---|---|---|---|
| P-CLEAN | Valid header, existing vendor, valid status and date | 16 | loaded | none |
| P-AC-01 | Date as `DD/MM/YYYY` | 1 | loaded_cleaned | DATE_NORMALISED |
| P-AC-02 | Status in lowercase (`sent`) | 1 | loaded_cleaned | STATUS_CASE_NORMALISED |
| P-AC-03 | Currency in lowercase | 1 | loaded_cleaned | CURRENCY_UPPERCASED |
| P-AC-04 | Notes with stray whitespace | 1 | loaded_cleaned | TRIMMED |
| P-DUP-01 | Same normalised `po_number` as an earlier row (`po-dirty-0007` vs `PO-DIRTY-0007`) | 2 | merged | EXACT_DUPLICATE |
| P-REJ-01 | `vendor_ref` matches no vendor | 2 | rejected | UNKNOWN_VENDOR (HTTP 422 equivalent) |
| P-REJ-02 | PO currency differs from the vendor currency | 1 | rejected | CURRENCY_MISMATCH |
| P-REJ-03 | Status not in the approved set (`Cancelled`) | 1 | rejected | INVALID_STATUS |
| P-REJ-04 | Header with zero lines | 2 | rejected | EMPTY_ORDER_LINES † |
| P-REJ-05 | Empty `po_number` | 1 | rejected | PO_NUMBER_REQUIRED |
| P-REJ-06 | Unparseable order date (`31/02/2026`) | 1 | rejected | INVALID_DATE |

### 2.3 PO lines (50 rows)

| ID | Scenario | Rows | Expected outcome | Reason |
|---|---|---|---|---|
| L-CLEAN | Valid product, quantity > 0, price >= 0 | 30 | loaded | none |
| L-AC-01 | Quantity with thousands separator (`1,000`) | 1 | loaded_cleaned | NUMBER_NORMALISED |
| L-AC-02 | Price with trailing spaces | 2 | loaded_cleaned | TRIMMED |
| L-AC-03 | Quantity with 3 decimals (`2.505`) rounded half-up to 2 | 2 | loaded_cleaned | ROUNDED_HALF_UP (see rounding finding R1) |
| L-AC-04 | Price `12.5` padded to `12.50` | 1 | loaded_cleaned | DECIMAL_PADDED |
| L-REJ-01 | `product_ref` unknown to ERP-1 | 5 | rejected | UNKNOWN_PRODUCT (BR-ERP2-01) |
| L-REJ-02 | Quantity `0` | 2 | rejected | QUANTITY_MUST_BE_POSITIVE † |
| L-REJ-03 | Quantity negative | 2 | rejected | QUANTITY_MUST_BE_POSITIVE † |
| L-REJ-04 | Price negative | 2 | rejected | PRICE_MUST_BE_NON_NEGATIVE † |
| L-REJ-05 | Quantity not a number (`ten`) | 1 | rejected | INVALID_QUANTITY † |
| L-REJ-06 | Price not a number (`free`) | 1 | rejected | INVALID_PRICE † |
| L-REJ-07 | Line whose parent order was rejected or does not exist | 1 | rejected | ORPHAN_LINE |

### 2.4 Security scenarios (embedded in the rows above, no extra rows)

- At least one vendor name and one note start with `=`, `+`, `-` or `@` to prove CSV formula-injection defence (same OWASP rule as ERP-1, PLT-12 / KIT-16). Expected: neutralised on export, never executed.
- Every bank number in the fixture is fake, and the expected profile must show **no raw account digits** beyond the last four.

## 3. Expected defect distribution

| Entity | Rows | Clean | Auto-cleaned | Review then loaded | Merged | Rejected |
|---|---|---|---|---|---|---|
| Vendors | 40 | 22 | 6 | 2 | 4 | 6 |
| Purchase orders | 30 | 16 | 4 | 0 | 2 | 8 |
| PO lines | 50 | 30 | 6 | 0 | 0 | 14 |
| **Total** | **120** | **68 (56.7%)** | **16 (13.3%)** | **2 (1.7%)** | **6 (5.0%)** | **28 (23.3%)** |

Defect classes by share of all 120 rows: formatting defects 16 (13.3%), duplicates 8 (6.7%: 6 exact + 2 ambiguous), referential defects 11 (9.2%: unknown vendor 2, unknown product 5, orphan line 1, zero-line orders 2, currency mismatch 1), value-range defects 11 (9.2%), missing required fields 5 (4.2%), other validation 1.

## 4. Reconciliation rule

For the reference run (reviewer decisions fixed as above):

```
Source rows (120) = Loaded (84 + 2 after review = 86) + Rejected (28) + Merged (6)
```

`Loaded` = 68 clean + 16 auto-cleaned + 2 review-then-loaded = 86 (71.7%). The profile test must assert this equality exactly, and that every row has exactly one outcome.

## 5. Expected-profile checks (for the future test)

1. Row counts per `record_type` and per `expect_outcome` match §3.
2. Every `rejected` row has at least one reason code; every `loaded_cleaned` row records what changed.
3. Re-running the same fixture with the same idempotency keys creates no new records (KIT-08).
4. Exact duplicates are found by normalised keys only; no row is matched by similarity.
5. Raw input rows are unchanged after the run.
6. No log line, receipt payload or profile output contains an unmasked bank number.

## 6. Open questions for Gate G1

1. **Stop threshold vs fixture reject rate.** `batch-retry-stop.test.ts` documents a stop when the row failure rate exceeds 10% (after at least 10 attempted rows). This pack deliberately has 23.3% rejected rows. Confirm with the ERP2-13 / KIT-12 owner whether business rejections count toward that threshold; if they do, the pack must be run through profile, clean and dry-run stages, or the threshold must be configurable for QA runs.
2. **Rounding rule (finding R1)** affects scenario L-AC-03, so the expected values cannot be fixed until the domain owner decides.
3. **Reason-code binding.** Codes without † need to be mapped to the adapter's stable codes.
4. **Vendor email nullability** (SQL nullable, Drizzle NOT NULL, drift item D2) decides whether "missing email" is a rejected scenario or a clean one.
