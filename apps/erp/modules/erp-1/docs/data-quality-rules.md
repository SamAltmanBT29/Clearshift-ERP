# ERP-1 Products & Inventory — V1 Data-Quality Rules

Rule catalogue version: **1.0.0**  
Code: [`apps/erp/modules/erp-1/src/migration/rules.ts`](../src/migration/rules.ts)  
Tests: [`apps/erp/modules/erp-1/tests/migration/rules.test.ts`](../tests/migration/rules.test.ts)  
Synthetic Dirty Pack: [`sample-data/erp-1/dirty-data-v1.csv`](../../../../sample-data/erp-1/dirty-data-v1.csv)  
Expected Profile: [`sample-data/erp-1/expected-profile.json`](../../../../sample-data/erp-1/expected-profile.json)  
Mapping Template: [`sample-data/erp-1/mapping-template.json`](../../../../sample-data/erp-1/mapping-template.json)  

**Traceability**: SDS ClearShift ERP v2.0 V1 — FR-ERP1-01..06, BR-ERP1-01..03; Project Plan v3.0 §7.6; Issue [#13](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/13) ([ERP1-08]).

---

## 1. Principles & Non-Negotiable Invariants

1. **Raw Input Immutability (BR-KIT-03)**:
   Source CSV data is parsed into frozen raw records. Profiling, cleaning, and normalization create new projections; raw cell strings and input SHA-256 digests are strictly immutable.
2. **Deterministic Profiling & Multi-Run Reproducibility**:
   Executing the rule engine on the committed synthetic fixture with the same rule catalogue version yields a byte-equivalent profile report (`expected-profile.json`) with verified SHA-256 fingerprint (`25040ea5a6c9ec820f21798f0f4014edb116844392fea024048e96537c39ee91`).
3. **Deterministic Exact Duplicate Matching Only (No Fuzzy Auto-Merge)**:
   - Duplicates are evaluated strictly against normalized exact candidate keys:
     - Products: normalized uppercase/trimmed `sku` (`PRD-003` $\to$ `DUPLICATE_SKU_REVIEW`)
     - Categories: normalized uppercase/trimmed `code` (`CAT-004` $\to$ `DUPLICATE_CATEGORY_CODE_REVIEW`)
     - Stock levels: composite `sku::warehouse_code` key (`STK-009` $\to$ `DUPLICATE_STOCK_LEVEL_REVIEW`)
   - Candidate duplicates receive terminal outcome `review` and are held in the human review queue. No automatic or destructive merging occurs in V1.
4. **Mandatory SKU Natural Key Uniqueness (BR-ERP1-01)**:
   Product SKU natural key is unique in the database (`erp1_products_sku_unique_idx`), not merely in the client UI. Case and surrounding whitespace are normalized prior to checking.
5. **Non-Negative Stock Inventory Quantities (BR-ERP1-02)**:
   Inventory stock levels can never become negative ($\text{quantity} \ge 0$). Any record attempting to set or decrement stock below zero is rejected with reason code `NEGATIVE_STOCK`.
6. **Strict Single Warehouse Facility in V1 (FR-ERP1-05 / BR-ERP1-03)**:
   ClearShift V1 operates strictly with exactly one warehouse facility (`WH-01`). Attempts to import secondary warehouses are rejected (`MULTIPLE_WAREHOUSES_REJECTED`), enforced by the partial unique index `erp1_warehouses_single_idx`.
7. **Fixed V1 Units of Measure (FR-ERP1-04)**:
   Product units of measure are strictly bounded to the 6 approved enumerations: `pcs`, `kg`, `g`, `litre`, `metre`, `box`. Any other unit is rejected (`INVALID_UNIT_OF_MEASURE`).
8. **Explicit Currency and Decimal Arithmetic (FR-ERP1-02 / NUMERIC(19,4))**:
   Prices and quantities are stored as exact decimal numbers up to 4 decimal places. Floating-point types are prohibited. Currency is mandatory, explicit ISO-4217 uppercase, with no implicit default currency assumption.
9. **OWASP Formula Injection Defense (PLT-12 / KIT-16)**:
   Any textual field starting with formula execution trigger prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) is rejected (`FORMULA_INJECTION_DETECTED`) to neutralize spreadsheet execution vectors.
10. **Sensitive Field Masking (RL-02)**:
    Synthetic banking information (`supplier_bank_account`) and employee identifiers (`employee_ssn`) are automatically masked (`****-****-1234` and `***-**-1234`) in review screens and export views.

---

## 2. Row Outcomes & Reconciliation

Every parsed source row maps to exactly one terminal outcome:
- **`accepted`**: Validated and cleaned; ready for ingestion through module public REST endpoints.
- **`rejected`**: Failed one or more business/format rules; not loaded; lists stable reason codes.
- **`review`**: Exact duplicate candidate; held for human decision in the review queue; never loaded automatically.
- **`skipped`**: Source row skipped for an approved reason (0 in canonical V1 fixture).

Reconciliation equation:
$$\text{source} = \text{accepted} + \text{rejected} + \text{review} + \text{skipped}$$
$$\text{unaccounted} = 0$$

In the canonical V1 Dirty Data Pack (`sample-data/erp-1/dirty-data-v1.csv`):
- **Total rows**: 131
- **Reconciliation**:
  - `accepted`: 69
  - `rejected`: 55
  - `review`: 7
  - `skipped`: 0
  - `unaccounted`: 0 (`is_balanced: true`)

### Breakdown by Entity

| Record Type | Total | Accepted | Rejected | Review | Skipped | Status |
|---|---|---|---|---|---|---|
| `category` | 15 | 8 | 5 | 2 | 0 | Balanced |
| `warehouse` | 6 | 1 | 5 | 0 | 0 | Balanced |
| `product` | 65 | 35 | 27 | 3 | 0 | Balanced |
| `stock_level` | 45 | 25 | 18 | 2 | 0 | Balanced |
| **Total** | **131** | **69** | **55** | **7** | **0** | **Balanced** |

---

## 3. Fields, Required vs. Optional, and Enumerations

| Entity | Required Fields | Optional Fields | Enumerations / Allowed Sets |
|---|---|---|---|
| **Category** | `code`, `name` | `source_id`, `description` | `code`: length $\le 64$, unique after uppercase/trim |
| **Warehouse** | `code`, `name` | `source_id`, `is_default` | Single facility allowed: `code == 'WH-01'`, `is_default == true` |
| **Product** | `name`, `sku`, `unit_of_measure`, `price`, `currency` | `category_code`, `tax_rate` (default `0.00`), `source_id`, `notification_email`, `contact_phone` | `unit_of_measure` $\in$ {`pcs`, `kg`, `g`, `litre`, `metre`, `box`}; `currency` $\in$ {`USD`, `EUR`, `GBP`, `INR`}; `price` $\ge 0.0000$ (up to 4 dp); `tax_rate` $0.00 \dots 100.00$ |
| **Stock Level** | `sku`, `warehouse_code`, `quantity` | `as_of_date`, `source_id` | `warehouse_code == 'WH-01'`; `quantity` $\ge 0.0000$ (up to 4 dp); `as_of_date`: ISO-8601 `YYYY-MM-DD` |

---

## 4. Normalization Rules

| Entity / Field | Rule ID | Transformation Applied |
|---|---|---|
| `category.code` | `CAT-005` | Trim whitespace; convert to uppercase. |
| `category.name` | `CAT-006` | Trim leading/trailing whitespace. |
| `warehouse.code` | `WH-004` | Trim whitespace; convert to uppercase (`WH-01`). |
| `product.sku` | `PRD-003` | Trim whitespace; convert to uppercase (`normalizeSku`). |
| `product.name` | `PRD-001` | Trim leading/trailing whitespace. |
| `product.currency` | `PRD-010` | Trim whitespace; convert to uppercase ISO-4217 code. |
| `product.unit_of_measure` | `PRD-005` | Trim whitespace; map case-insensitively to approved canonical lowercase unit. |
| `stock_level.warehouse_code` | `STK-003` | Trim whitespace; convert to uppercase. |
| `stock_level.as_of_date` | `STK-010` | Validate explicit ISO-8601 calendar date. |

---

## 5. Candidate Keys & Duplicate Review Policy

ClearShift V1 prohibits automatic destructive merging or fuzzy heuristic matching. When an exact candidate key collision occurs:
1. The initial record is evaluated and ingested normally.
2. Subsequent records with an identical normalized key receive terminal outcome `review` with reason code `DUPLICATE_<ENTITY>_REVIEW`.
3. The duplicate candidate is placed into the migration review queue for explicit operator resolution (`MERGE`, `REJECT`, or `KEEP_BOTH`).

Candidate Keys:
- **Product**: normalized uppercase `sku` (`PRD-003` $\to$ `DUPLICATE_SKU_REVIEW`)
- **Category**: normalized uppercase `code` (`CAT-004` $\to$ `DUPLICATE_CATEGORY_CODE_REVIEW`)
- **Stock Level**: composite `sku::warehouse_code` (`STK-009` $\to$ `DUPLICATE_STOCK_LEVEL_REVIEW`)

---

## 6. Complete Data Quality Rule Catalogue

| Rule ID | Version | Entity | Field | Condition | Action | Reason Code | Explanation | Traceability |
|---|---|---|---|---|---|---|---|---|
| `CAT-001` | 1.0.0 | category | `code` | Empty or whitespace | `reject` | `CATEGORY_CODE_REQUIRED` | Category code is mandatory. | FR-ERP1-03 |
| `CAT-002` | 1.0.0 | category | `name` | Empty or whitespace | `reject` | `CATEGORY_NAME_REQUIRED` | Category name is mandatory. | FR-ERP1-03 |
| `CAT-003` | 1.0.0 | category | `code` | Length > 64 chars | `reject` | `CATEGORY_CODE_TOO_LONG` | Exceeds max length limit. | FR-ERP1-03 |
| `CAT-004` | 1.0.0 | category | `code` | Duplicate normalized code in batch | `review` | `DUPLICATE_CATEGORY_CODE_REVIEW` | Duplicate code held for review. | FR-ERP1-03 |
| `WH-001` | 1.0.0 | warehouse | `code` | Empty or whitespace | `reject` | `WAREHOUSE_CODE_REQUIRED` | Warehouse code is mandatory. | FR-ERP1-05 |
| `WH-002` | 1.0.0 | warehouse | `name` | Empty or whitespace | `reject` | `WAREHOUSE_NAME_REQUIRED` | Warehouse name is mandatory. | FR-ERP1-05 |
| `WH-003` | 1.0.0 | warehouse | `code` | Facility other than WH-01 | `reject` | `MULTIPLE_WAREHOUSES_REJECTED` | Exactly one warehouse in V1. | FR-ERP1-05 / BR-ERP1-03 |
| `PRD-001` | 1.0.0 | product | `name` | Empty or whitespace | `reject` | `PRODUCT_NAME_REQUIRED` | Product name is mandatory. | FR-ERP1-01 |
| `PRD-002` | 1.0.0 | product | `sku` | Empty or whitespace | `reject` | `SKU_REQUIRED` | Product SKU is mandatory. | FR-ERP1-01 / BR-ERP1-01 |
| `PRD-003` | 1.0.0 | product | `sku` | Duplicate normalized SKU | `review` | `DUPLICATE_SKU_REVIEW` | Normalized SKU exists; held for review. | BR-ERP1-01 |
| `PRD-004` | 1.0.0 | product | `unit_of_measure` | Empty or whitespace | `reject` | `UNIT_OF_MEASURE_REQUIRED` | Unit of measure is mandatory. | FR-ERP1-04 |
| `PRD-005` | 1.0.0 | product | `unit_of_measure` | Not in approved list | `reject` | `INVALID_UNIT_OF_MEASURE` | Unit must be pcs, kg, g, litre, metre, box. | FR-ERP1-04 |
| `PRD-006` | 1.0.0 | product | `price` | Empty or whitespace | `reject` | `PRICE_REQUIRED` | Selling price is mandatory. | FR-ERP1-02 |
| `PRD-007` | 1.0.0 | product | `price` | Price < 0 | `reject` | `NEGATIVE_PRICE` | Selling price cannot be negative. | FR-ERP1-02 / BR-ERP1-01 |
| `PRD-008` | 1.0.0 | product | `price` | Not a valid numeric decimal | `reject` | `INVALID_PRICE_FORMAT` | Must be numeric decimal string. | FR-ERP1-02 |
| `PRD-009` | 1.0.0 | product | `price` | Decimal places > 4 | `reject` | `EXCESS_DECIMAL_PLACES` | Maximum precision 4 decimal places. | FR-ERP1-02 / SDS §4.7 |
| `PRD-010` | 1.0.0 | product | `currency` | Empty or whitespace | `reject` | `CURRENCY_REQUIRED` | Explicit currency is mandatory. | FR-ERP1-02 |
| `PRD-011` | 1.0.0 | product | `currency` | Not 3-letter ISO 4217 | `reject` | `INVALID_CURRENCY` | Must be valid ISO 4217 code. | FR-ERP1-02 |
| `PRD-012` | 1.0.0 | product | `tax_rate` | Tax rate < 0 | `reject` | `NEGATIVE_TAX_RATE` | Tax rate cannot be negative. | FR-ERP1-02 |
| `PRD-013` | 1.0.0 | product | `tax_rate` | Tax rate > 100.00% | `reject` | `TAX_RATE_OUT_OF_RANGE` | Tax rate cannot exceed 100.00%. | FR-ERP1-02 |
| `PRD-014` | 1.0.0 | product | `tax_rate` | Not a valid numeric decimal | `reject` | `INVALID_TAX_RATE_FORMAT` | Must be numeric decimal representation. | FR-ERP1-02 |
| `PRD-015` | 1.0.0 | product | `category_code` | Category not in master | `reject` | `CATEGORY_NOT_FOUND` | Foreign key reference not found. | FR-ERP1-03 |
| `PRD-016` | 1.0.0 | product | `notification_email` | Invalid email format | `reject` | `INVALID_EMAIL_FORMAT` | Must match RFC-5322 format if supplied. | RL-02 |
| `PRD-017` | 1.0.0 | product | `contact_phone` | Invalid telephone format | `reject` | `INVALID_PHONE_FORMAT` | Must match international format if supplied. | RL-02 |
| `PRD-018` | 1.0.0 | product | `name` | Begins with `=,+,-,@,\t,\r` | `reject` | `FORMULA_INJECTION_DETECTED` | Formula injection prefix rejected. | PLT-12 / KIT-16 |
| `STK-001` | 1.0.0 | stock_level | `sku` | Empty or whitespace | `reject` | `PRODUCT_REQUIRED` | Stock level requires product reference. | FR-ERP1-06 |
| `STK-002` | 1.0.0 | stock_level | `sku` | SKU not in catalog | `reject` | `PRODUCT_NOT_FOUND` | Referenced SKU does not exist. | FR-ERP1-06 |
| `STK-003` | 1.0.0 | stock_level | `warehouse_code` | Empty or whitespace | `reject` | `WAREHOUSE_REQUIRED` | Warehouse reference is mandatory. | FR-ERP1-05 / FR-ERP1-06 |
| `STK-004` | 1.0.0 | stock_level | `warehouse_code` | Warehouse not WH-01 | `reject` | `WAREHOUSE_NOT_FOUND` | Referenced warehouse does not exist. | FR-ERP1-05 |
| `STK-005` | 1.0.0 | stock_level | `quantity` | Empty or whitespace | `reject` | `QUANTITY_REQUIRED` | Stock quantity is required. | FR-ERP1-06 |
| `STK-006` | 1.0.0 | stock_level | `quantity` | Quantity < 0 | `reject` | `NEGATIVE_STOCK` | Stock cannot become negative. | BR-ERP1-02 / FR-ERP1-06 |
| `STK-007` | 1.0.0 | stock_level | `quantity` | Not a valid numeric decimal | `reject` | `INVALID_QUANTITY_FORMAT` | Quantity must be numeric decimal. | FR-ERP1-06 |
| `STK-008` | 1.0.0 | stock_level | `quantity` | Decimal places > 4 | `reject` | `EXCESS_DECIMAL_PLACES` | Maximum precision 4 decimal places. | FR-ERP1-06 / SDS §4.7 |
| `STK-009` | 1.0.0 | stock_level | `sku,warehouse_code` | Duplicate product/warehouse stock | `review` | `DUPLICATE_STOCK_LEVEL_REVIEW` | Repeated opening stock held for review. | FR-ERP1-06 / DR-6 |
| `STK-010` | 1.0.0 | stock_level | `as_of_date` | Ambiguous date format | `reject` | `AMBIGUOUS_DATE_FORMAT` | Explicit ISO-8601 required. | FR-ERP1-06 / SDS §4.7 |
| `STK-011` | 1.0.0 | stock_level | `as_of_date` | Invalid calendar date | `reject` | `INVALID_DATE` | Date not on calendar (e.g. Feb 30). | FR-ERP1-06 |
