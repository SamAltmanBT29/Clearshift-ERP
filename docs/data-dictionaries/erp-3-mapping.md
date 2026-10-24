# ERP-3 Mapping & Value Translation Configuration (ERP3-28 / KIT-05)

Canonical mapping templates live in `sample-data/erp-3/mapping-template.json` and `apps/erp/modules/erp-3/src/migration/mapping-config.ts`.

---

## 1. Template Contract & Reproducibility (AC4)

| Property | Description |
|---|---|
| `templateId` | Stable identifier, e.g. `erp3-canonical-v1` |
| `name` | Human-readable name, e.g. `ERP-3 Sales Orders & Invoices Canonical Mapping Template` |
| `version` | Semantic version `x.y.z` (e.g. `1.0.0`); any schema or mapping rule change requires a version bump |
| `module` | `erp3` |
| `mappingSchemaVersion` | Numeric schema revision (`1`) |
| `entities` | Entity mapping specifications for `sales_order`, `so_line`, `invoice`, `invoice_line`, and `payment` |
| `enumTranslations` | Per-table dictionary with domain `allowed` allowlist and legacy `map` |

### Reproducibility & Fingerprinting
`templateFingerprint(template)` computes a deterministic SHA-256 hash over key-sorted, canonicalized JSON representation. The identical template produces the exact same fingerprint on every run. Dry-run results and durable import receipts carry the `templateId` and `fingerprint`.

---

## 2. Type Coercion Engine (AC1)

Coercions are pure, deterministic functions that do not rely on IEEE-754 floating-point numbers:

| Target Type | Coercion & Validation Rules | Output Format | Error Behavior |
|---|---|---|---|
| `string` | Strips leading/trailing whitespace; neutralizes OWASP CSV formula injection prefixes (`=`, `+`, `-`, `@`) | String | None |
| `integer` | Strictly validates regex `/^-?\d+$/` | Number | Structured `TypeError` if invalid |
| `decimal` | Strips currency symbols (`$`, `€`, `₹`), commas, and whitespace. Handles accounting parentheses negatives `(100.50)` -> `-100.50`. Applies string-based half-up rounding to 4 decimal places via `BigInt` | Exact 4-decimal string `^\d+\.\d{4}$` | Structured `TypeError` if non-numeric |
| `date` | Supports ISO (`YYYY-MM-DD`), slash (`YYYY/MM/DD`), and DMY (`DD-MM-YYYY`, `DD/MM/YYYY`). Validates calendar boundaries (rejects leap/month overflows like Feb 31) | ISO 8601 `YYYY-MM-DD` | Structured `TypeError` if invalid date |
| `boolean` | Maps truthy (`true`, `1`, `yes`, `y`, `t`) and falsy (`false`, `0`, `no`, `n`, `f`) case-insensitively | Boolean `true \| false` | Falls back to default if empty |
| `uuid` | Strictly validates RFC 4122 format `/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/` | Lowercase UUID | Structured `TypeError` if invalid format |
| `enum` | Normalizes input string (trimmed, lowercased) and matches against the designated `enumTable` allowlist | Exact allowlist value | Throws `EnumTranslationError` if unmapped |

---

## 3. Enum Translation Tables (AC2)

Source systems use diverse representations, abbreviations, and casing for document statuses, payment methods, and currencies. The mapping engine normalizes these to authoritative domain allowlists:

### 3.1 Sales Order Status (`order_status`)
- **Domain Allowlist:** `['Open', 'Invoiced', 'Closed']`
- **Translation Mapping:**
  - `open`, `opened`, `new`, `active`, `pending`, `draft` &rarr; `Open`
  - `invoiced`, `billed`, `processing` &rarr; `Invoiced`
  - `closed`, `complete`, `completed`, `done`, `fulfilled`, `cancelled`, `canceled` &rarr; `Closed`

### 3.2 Invoice Status (`invoice_status`)
- **Domain Allowlist:** `['Open', 'Paid', 'Overdue']`
- **Translation Mapping:**
  - `open`, `unpaid`, `pending`, `issued`, `due` &rarr; `Open`
  - `paid`, `settled`, `cleared` &rarr; `Paid`
  - `overdue`, `past_due`, `past due`, `delinquent`, `late` &rarr; `Overdue`

### 3.3 Payment Method (`payment_method`)
- **Domain Allowlist:** `['cash', 'bank', 'card']`
- **Translation Mapping:**
  - `cash`, `currency`, `physical` &rarr; `cash`
  - `bank`, `wire`, `wire transfer`, `ach`, `neft`, `rtgs`, `imps`, `bank transfer`, `transfer`, `cheque`, `check` &rarr; `bank`
  - `card`, `credit`, `debit`, `credit card`, `debit card`, `visa`, `mastercard`, `amex` &rarr; `card`

### 3.4 Currency Code (`currency`)
- **Domain Allowlist:** `['USD', 'EUR', 'INR']`
- **Translation Mapping:**
  - `usd`, `$`, `dollar`, `dollars`, `us$` &rarr; `USD`
  - `eur`, `€`, `euro`, `euros` &rarr; `EUR`
  - `inr`, `₹`, `rs`, `rs.`, `rupee`, `rupees` &rarr; `INR`

---

## 4. Required Target Column Enforcement Guards (AC3)

Before any dry run or target database mutation, the guard asserts that all required target attributes are mapped to valid source columns present in the file headers.

| Target Entity | Target Table | Required Target Attributes | Candidate Key |
|---|---|---|---|
| `sales_order` | `erp3.sales_orders` | `order_number`, `customer_golden_id`, `order_date`, `currency`, `source_id` | `order_number` |
| `so_line` | `erp3.so_lines` | `order_id` (or `parent_source_id`), `line_number`, `product_id`, `quantity`, `unit_price`, `tax_rate`, `source_id` | `order_id, line_number` |
| `invoice` | `erp3.invoices` | `invoice_number`, `customer_golden_id`, `invoice_date`, `due_date`, `currency`, `source_id` | `invoice_number` |
| `invoice_line` | `erp3.invoice_lines` | `invoice_id` (or `parent_source_id`), `line_number`, `product_id`, `quantity`, `unit_price`, `tax_rate`, `source_id` | `invoice_id, line_number` |
| `payment` | `erp3.payments` | `invoice_id` (or `parent_source_id`), `payment_date`, `amount`, `method`, `source_id` | `invoice_id` (1:1 full settlement) |

### Failure Behavior
If any required target column is unmapped, mapped as optional, or references a source column missing from the file header:
1. `validateAgainstHeaders()` identifies missing columns.
2. `assertDryRunReady()` throws `MappingValidationError` (HTTP 400).
3. The standard ClearShift error envelope is emitted:
   ```json
   {
     "code": "MAPPING_VALIDATION_FAILED",
     "message": "Mapping template failed validation with 2 issue(s)",
     "details": {
       "issues": [
         {
           "code": "MISSING_SOURCE_COLUMN",
           "target": "customer_golden_id",
           "source": "customer_golden_id",
           "message": "Source column \"customer_golden_id\" for required target \"customer_golden_id\" is missing from the file."
         }
       ]
     }
   }
   ```
4. Dry-run execution halts immediately without attempting row processing or database mutation.

---

## 5. Security & Privacy Protections (PLT-10, PLT-12)

- **Sensitive Fields:** Customer PII or credentials are never echoed in row error logs. Errors report `rowIndex`, `target`, `source`, and `reason`.
- **Zero Floating-Point Leakage:** All calculations use exact integer arithmetic (`BigInt`) or string-based decimal padding.
- **OWASP Formula Injection Defense:** String values starting with formula control characters (`=`, `+`, `-`, `@`, `\t`, `\r`) are sanitized per PLT-12 before ingestion.
- **Audit Logging:** Every mapping validation failure and transformation event is captured in the transactional audit log with stable idempotency keys.
