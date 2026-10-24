# ERP-3 Profiling Configuration (ERP3-26 / KIT-03)

Configuration: `apps/erp/modules/erp-3/src/migration/profiling-config.ts`  
Fixture: `sample-data/erp-3/dirty-data-v1.csv` (135 synthetic rows, ERP3-25)  
Manifest: `sample-data/erp-3/expected-profile.json`  

The module configures the shared `@cs/kit` profiler (`profileDataset`, `exportProfileReportToCsv`). It adds zero duplicate platform infrastructure. Profile keys are `<record_type>.<column>`.

---

## 1. Profiled Columns

| Record type | Column | Required | Invalid-format rule |
|---|---|---|---|
| sales_order | order_number | yes | empty, longer than 64 characters, non-alphanumeric (outside `[A-Za-z0-9_-]`), or starts with a formula prefix (`=`, `+`, `-`, `@`, `\t`, `\r`) |
| sales_order | customer_golden_id | yes | not a valid UUID string, or not present in known customer Golden ID registry |
| sales_order | order_date | yes | not a real ISO 8601 calendar date (`YYYY-MM-DD`) |
| sales_order | order_status | yes | not one of `Open`, `Invoiced`, or `Closed` |
| sales_order | currency | yes | not one of `USD`, `EUR`, `INR` (exact upper-case) |
| sales_order | notes | no | longer than 1000 characters, or starts with a formula prefix |
| so_line | parent_source_id | yes | empty, or longer than 64 characters |
| so_line | line_number | yes | not a positive whole integer (`> 0`) |
| so_line | product_id | yes | not a valid UUID string, or not found in known product catalog |
| so_line | quantity | yes | not a positive decimal (`> 0.0000`, max 4 decimal places) |
| so_line | unit_price | yes | not a non-negative decimal (`>= 0.0000`, max 4 decimal places) |
| so_line | tax_rate | yes | not a decimal between `0.0000` and `100.0000` percent inclusive |
| invoice | invoice_number | yes | empty, longer than 64 characters, non-alphanumeric, or starts with a formula prefix |
| invoice | customer_golden_id | yes | not a valid UUID, or not found in known customer registry |
| invoice | invoice_date | yes | not a real ISO 8601 calendar date (`YYYY-MM-DD`) |
| invoice | due_date | yes | not a real ISO 8601 calendar date, or earlier than `invoice_date` (FR-ERP3-02) |
| invoice | currency | yes | not one of `USD`, `EUR`, `INR` |
| invoice | invoice_status | no | not one of `Open`, `Paid`, `Overdue` |
| invoice_line | parent_source_id | yes | empty, or longer than 64 characters |
| invoice_line | line_number | yes | not a positive whole integer (`> 0`) |
| invoice_line | product_id | yes | not a valid UUID, or not found in known product catalog |
| invoice_line | quantity | yes | not a positive decimal (`> 0.0000`) |
| invoice_line | unit_price | yes | not a non-negative decimal (`>= 0.0000`) |
| invoice_line | tax_rate | yes | not a decimal between `0.0000` and `100.0000` percent |
| payment | payment_number | yes | empty, longer than 64 characters, or starts with a formula prefix |
| payment | parent_source_id | yes | empty, or longer than 64 characters |
| payment | payment_date | yes | not a real ISO 8601 calendar date |
| payment | payment_amount | yes | not a positive decimal (`> 0.0000`) |
| payment | payment_method | yes | not one of `cash`, `bank`, `card` |
| payment | payment_reference | no | longer than 128 characters, or starts with a formula prefix |

Profile metrics computed per column: `totalRows`, `populatedCount`, `nullCount`, `distinctCount`, `invalidFormatCount`, `invalidFormatRate` (percentage, 2 decimal places), and top 5 most frequent values.

---

## 2. Exact Duplicate Candidate Rules

| Rule name | Record type | Key extraction rule |
|---|---|---|
| `order_number` | sales_order | trimmed, upper-cased `order_number` |
| `invoice_number` | invoice | trimmed, upper-cased `invoice_number` |
| `payment_number` | payment | trimmed, upper-cased `payment_number` |
| `so_line_key` | so_line | `<parent_source_id>#<line_number>` |
| `invoice_line_key` | invoice_line | `<parent_source_id>#<line_number>` |

Matching is 100% exact and deterministic. Zero fuzzy scoring and zero automatic merging. All duplicate candidates are held for explicit human review in accordance with ClearShift V1 core rules.

---

## 3. Guarantees & Non-Destructive Invariants

- **Non-Destructive Guarantee**: Profiling is strictly read-only and non-destructive. Source CSV bytes and SHA-256 digest (`17d24675e9af4f6a763b06b5a09400b471d36523254450c139f31b2d1fd73e53`) remain unchanged. Input row objects in memory are never mutated.
- **OWASP Formula Injection Defense (PLT-12 / KIT-16)**: Values prefixed with `=`, `+`, `-`, `@`, `\t`, or `\r` are sanitized with a leading `'` in the generated CSV health report.
- **No API Changes**: No API endpoints are added, so the OpenAPI contract remains unchanged.

