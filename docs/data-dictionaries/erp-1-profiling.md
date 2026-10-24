# ERP-1 Profiling Configuration (ERP1-26 / KIT-03)

**Module:** ERP-1 Products & Inventory (Group 6)  
**Issue:** [#122](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/122) (ERP1-26)  
**Target:** Sprint 2 — Gate G2  
**Configuration:** `apps/erp/modules/erp-1/src/migration/profiling-config.ts`  
**Test Suite:** `apps/erp/modules/erp-1/tests/migration/profiling.test.ts`  
**Fixture:** `sample-data/erp-1/dirty-data-v1.csv` (131 synthetic rows, ERP1-25)  
**Manifest:** `sample-data/erp-1/expected-profile.json`  
**Shared Platform Integration:** `@cs/kit` (`profileDataset`, `exportProfileReportToCsv`)

The ERP-1 module implements canonical column profiling and exact duplicate candidate analysis strictly conforming to the ClearShift V1 stack (Node.js 24 LTS, TypeScript strict, `@cs/kit`, Fastify 5). The module integrates with the shared Migration Kit profiler rather than creating duplicate platform utilities. Profile keys are formatted as `<record_type>.<column>`.

---

## 1. Profiled Columns & Data Quality Invariants

| Record Type | Column | Required | Invalid-Format Invariant & Rule |
|---|---|---|---|
| `category` | `code` | Yes | Blank, longer than 64 characters, or starts with a spreadsheet formula prefix (`=`, `+`, `-`, `@`, `\t`, `\r`) |
| `category` | `name` | Yes | Blank, longer than 255 characters, or starts with a spreadsheet formula prefix |
| `warehouse` | `code` | Yes | Blank, not equal to the single V1 operating facility (`WH-01` per FR-ERP1-05), or starts with a formula prefix |
| `warehouse` | `name` | Yes | Blank, longer than 255 characters, or starts with a formula prefix |
| `warehouse` | `is_default` | Yes | Must be a valid boolean string (`true` or `false`) |
| `product` | `name` | Yes | Blank, longer than 255 characters, or starts with a formula prefix |
| `product` | `sku` | Yes | Blank, longer than 128 characters, or starts with a formula prefix |
| `product` | `category_code` | No | If populated, must reference a valid category code (`GEN`, `ELEC`, `CHEM`, `RAW`, `PKG`, `TOOLS`, `MÉC`, `SAFETY`) and contain no formula prefix |
| `product` | `unit_of_measure` | Yes | Must belong to the fixed ClearShift V1 UOM list (`pcs`, `kg`, `g`, `litre`, `metre`, `box` per FR-ERP1-04) |
| `product` | `price` | Yes | Must be a non-negative decimal with at most 4 decimal places (`NUMERIC(19,4)` per FR-ERP1-02 / BR-ERP1-01) |
| `product` | `currency` | Yes | Must be an accepted 3-letter currency code (`USD`, `EUR`, `GBP`, `INR`) |
| `product` | `tax_rate` | No | If populated, must be a non-negative decimal between 0.00 and 100.00 (`NUMERIC(5,2)`) |
| `product` | `notification_email` | No | If populated, must conform to RFC-5322 email syntax (max 254 chars) |
| `product` | `contact_phone` | No | If populated, must conform to international phone syntax (7-20 digits/symbols) |
| `stock_level` | `sku` | Yes | Blank, starts with a formula prefix, or does not reference a valid product master SKU (BR-ERP1-01) |
| `stock_level` | `warehouse_code` | Yes | Blank or does not reference the single V1 warehouse (`WH-01` per FR-ERP1-05) |
| `stock_level` | `quantity` | Yes | Must be a non-negative decimal with at most 4 decimal places (BR-ERP1-01 / BR-ERP1-02: stock may not become negative) |
| `stock_level` | `as_of_date` | No | If populated, must be a valid ISO 8601 calendar date (`YYYY-MM-DD`); ambiguous date formats (`DD/MM/YYYY` or `MM/DD/YYYY`) count as invalid |

### Sensitive Fields Policy (PII & Financial Protection)
`supplier_bank_account` and `employee_ssn` are sensitive personal/financial columns present in the raw intake dataset. Per ClearShift security invariants:
- Sensitive columns are **never** profiled with column rules (preventing raw values from appearing in `topValues` or quality metrics).
- `profileErp1Dataset` creates a masked copy (`maskSensitiveFields`) where bank accounts (`CH93-****`) and SSNs (`***-**-****`) are sanitized before profiling.
- Neither the profile report nor the CSV Data Health export contains raw bank accounts or SSNs.

---

## 2. Exact Duplicate Candidate Rules

| Rule Name | Record Type | Candidate Key Extraction | Manifest Expectation |
|---|---|---|---|
| `category_code` | `category` | Normalized uppercase category code (`code.trim().toUpperCase()`) | 2 candidate rows (`R012`, `R013` matching `R001`) |
| `product_sku` | `product` | Normalized uppercase SKU (`normalizeSku(sku)`) | 3 candidate rows (`R057`, `R058` matching `R022`, `R059` matching `R023`) |
| `stock_level_key` | `stock_level` | Composite natural key (`${normalizeSku(sku)}::${warehouse_code.trim().toUpperCase()}`) for valid stock rows | 2 candidate rows (`R112`, `R113` matching `R087`) |

**Total Exact Duplicate Candidates:** 7 (matching `reconciliation.review = 7` in `expected-profile.json`).

**Rules & Constraints:**
- Matching is deterministic and exact only; fuzzy matching and automated merge sagas are strictly out of scope for V1.
- Candidate duplicates are grouped for human decision-making in Migration Kit review screens.
- Rows with malformed field values (e.g. invalid quantity, invalid dates) are segregated into rejected outcomes rather than duplicate candidate review.

---

## 3. Operational Invariants & Guarantees

1. **Strictly Non-Destructive Operation (AC3):**
   - The source CSV text, file bytes, and SHA-256 hash remain untouched.
   - The computed report SHA-256 matches `fixture_sha256` (`25040ea5a6c9ec820f21798f0f4014edb116844392fea024048e96537c39ee91`).
   - Deep-frozen input objects are not mutated; profiling is completely read-only.
2. **Deterministic Manifest Parity (AC1 & AC4):**
   - Column metrics (`totalRows`, `nullCount`, `populatedCount`, `distinctCount`, `invalidFormatCount`, `invalidFormatRate`, and `topValues`) reproduce identically across runs.
   - Every column's invalid count matches the pre-calculated manifest count derived from `by_reason_code`.
3. **OWASP Formula Injection Defense:**
   - Any cell value beginning with `=`, `+`, `-`, `@`, tab (`\t`), or carriage return (`\r`) is detected as a format defect.
   - The CSV Data Health export (`exportErp1ProfileCsv`) prefixes sensitive cells with `'` ensuring formula execution is neutralized in spreadsheet applications.
4. **API & Contract Parity:**
   - Profile computation is consumed by the Migration Kit without altering existing OpenAPI contracts or introducing redundant endpoints.
