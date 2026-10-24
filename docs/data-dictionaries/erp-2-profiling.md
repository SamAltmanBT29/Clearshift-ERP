# ERP-2 Profiling Configuration (ERP2-26 / KIT-03)

Configuration: `apps/erp/modules/erp-2/src/migration/profiling-config.ts`
Fixture: `sample-data/erp-2/dirty-data-v1.csv` (173 synthetic rows, ERP2-25)
Manifest: `sample-data/erp-2/expected-profile.json`

The module configures the shared `@cs/kit` profiler (`profileDataset`, `exportProfileReportToCsv`). It adds no profiling engine of its own. Profile keys are `<record_type>.<column>`.

## Profiled columns

| Record type | Column | Required | Invalid-format rule |
|---|---|---|---|
| vendor | vendor_code | yes | empty, or longer than 64 characters |
| vendor | vendor_name | yes | longer than 255 characters, or starts with a formula prefix |
| vendor | tax_number | no | normalised value (trim, upper-case, strip spaces and hyphens) is not 4-32 alphanumerics |
| vendor | email | no | not a basic `local@domain.tld` address |
| vendor | currency | yes | not one of USD, EUR, GBP, INR (exact upper-case) |
| vendor | payment_terms_days | no | not a whole number from 0 to 365 |
| purchase_order | po_number | yes | empty, longer than 64 characters, or starts with a formula prefix |
| purchase_order | po_vendor_code | yes | empty, or longer than 64 characters |
| purchase_order | po_status | yes | not Draft, Sent, Received or Closed |
| purchase_order | status_path | no | not a valid Draft -> Sent -> Received -> Closed path ending at po_status |
| purchase_order | po_date | yes | not a real ISO calendar date (ambiguous DD/MM/YYYY counts as invalid) |
| purchase_order | expected_date | no | not ISO, or earlier than po_date |
| purchase_order | currency | yes | not an accepted currency |
| purchase_order | po_total | yes | not a non-negative decimal |
| po_line | po_number | yes | empty, or longer than 64 characters |
| po_line | line_no | yes | not a positive whole number |
| po_line | product_sku | yes | not in the ERP-1 SKU snapshot, or starts with a formula prefix |
| po_line | quantity | yes | not a positive decimal |
| po_line | unit_price | yes | not a non-negative decimal |
| po_line | line_total | no | not a non-negative decimal |

`bank_account` is deliberately **not** profiled. The profiler reports top values, which would expose bank details. The profiled row copy carries only the masked value, and the report and CSV export never contain raw bank data.

Profile metrics per column: total rows, populated count, null count, distinct count, invalid-format count and rate (percent, 2 dp) and the top 5 values.

## Exact duplicate candidate rules

| Rule name | Record type | Key |
|---|---|---|
| vendor_code | vendor | trimmed, upper-cased vendor_code |
| vendor_tax_number | vendor | tax_number, upper-cased, spaces and hyphens stripped |
| po_number | purchase_order | trimmed, upper-cased po_number |
| po_line_key | po_line | `<PO NUMBER>#<line_no>` |

Matching is exact and deterministic. There is no fuzzy scoring and no automatic merge. Duplicate candidates are reported for human review only.

## Guarantees

- Profiling is non-destructive. The source CSV and parsed rows are unchanged, and the report SHA-256 equals the manifest `fixture_sha256`.
- Cells in the CSV export that begin with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'`.
- No API endpoints are added, so the OpenAPI contract is unchanged.
