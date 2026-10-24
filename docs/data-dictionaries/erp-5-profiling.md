# ERP-5 Profiling Configuration (ERP5-26 / KIT-03)

Configuration: `apps/erp/modules/erp-5/src/migration/profiling-config.ts`  
Fixture: `sample-data/erp-5/dirty-data-v1.csv` (130 synthetic rows, ERP5-25)  
Manifest: `sample-data/erp-5/expected-profile.json`

The module configures the shared `@cs/kit` profiler (`profileDataset`, `exportProfileReportToCsv`). It adds no profiling engine of its own. Profile keys are `<record_type>.<column>`.

## Profiled Columns

| Record type | Column | Required | Invalid-format rule |
|---|---|---|---|
| `department` | `department_code` | yes | empty, longer than 32 chars, or formula prefix |
| `department` | `department_name` | yes | empty, longer than 255 chars, or formula prefix |
| `department` | `parent_code` | no | formula prefix, or parent code equals own department code |
| `employee` | `employee_no` | yes | empty, longer than 32 chars, or formula prefix |
| `employee` | `first_name` | yes | empty, longer than 120 chars, or formula prefix |
| `employee` | `last_name` | yes | empty, longer than 120 chars, or formula prefix |
| `employee` | `birth_date` | yes | not an ISO date string (YYYY-MM-DD) |
| `employee` | `join_date` | yes | not an ISO date string, or join_date earlier than birth_date (BR-ERP5-01) |
| `employee` | `department_code` | yes | empty or formula prefix |
| `employee` | `job_title` | yes | empty, longer than 120 chars, or formula prefix |
| `employee` | `currency_code` | yes | not one of INR, USD, EUR |
| `leave` | `employee_no` | yes | empty or formula prefix |
| `leave` | `leave_type` | yes | not in annual, sick, unpaid |
| `leave` | `date_from` | yes | not an ISO date string (YYYY-MM-DD) |
| `leave` | `date_to` | yes | not an ISO date string, or date_to earlier than date_from |
| `leave` | `leave_status` | yes | not in pending, approved, rejected |
| `payroll_total` | `department_code` | yes | empty or formula prefix |
| `payroll_total` | `month` | yes | not in format YYYY-MM or formula prefix |
| `payroll_total` | `gross_total` | yes | not a non-negative decimal or formula prefix |
| `payroll_total` | `net_total` | yes | not a non-negative decimal, net exceeds gross, or formula prefix |
| `payroll_total` | `employee_count` | yes | not a non-negative integer |
| `payroll_total` | `currency_code` | yes | not one of INR, USD, EUR |

`salary` is intentionally **not** profiled. The profiler reports top values, which would expose compensation details. The serialized projection always masks salary as `salary_display = "XX,XXX"` (BR-ERP5-02, DR-5).

## Exact Duplicate Candidate Rules

| Rule name | Record type | Key extraction |
|---|---|---|
| `department_code` | `department` | normalized uppercase trimmed `department_code` |
| `employee_no` | `employee` | normalized uppercase trimmed `employee_no` |
| `leave_request` | `leave` | `<employee_no>#<date_from>#<date_to>` |
| `payroll_aggregate` | `payroll_total` | `<department_code>#<month>` |

Matching is exact and deterministic. There is no fuzzy scoring and no automatic merge. Duplicate candidates are reported for human review only.
