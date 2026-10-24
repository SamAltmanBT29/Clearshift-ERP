# ERP-5 HR & Employees — V1 Data-Quality Rules

Rule catalogue version **1.0.0**.  
Code: [`apps/erp/modules/erp-5/src/migration/rules.ts`](../src/migration/rules.ts)  
Tests: [`apps/erp/modules/erp-5/tests/migration/rules.test.ts`](../tests/migration/rules.test.ts)  
Synthetic Dirty Pack: [`sample-data/erp-5/dirty-data-v1.csv`](../../../../sample-data/erp-5/dirty-data-v1.csv)  
Expected Profile: [`sample-data/erp-5/expected-profile.json`](../../../../sample-data/erp-5/expected-profile.json)  
Mapping Template: [`sample-data/erp-5/mapping-template.json`](../../../../sample-data/erp-5/mapping-template.json)  
Data Dictionary: [`docs/data-dictionaries/erp-5.md`](../../../../docs/data-dictionaries/erp-5.md)  

**Traceability**: SDS ClearShift ERP v2.0 V1 — FR-ERP5-01..06, BR-ERP5-01..02; Project Plan v3.0 §7.10.

---

## 1. Principles & Non-Negotiable Invariants

1. **Raw input is never changed (BR-KIT-03)**: The CSV fixture is parsed into frozen raw rows. Profiling and cleaning generate normalized and clean target projections; raw cells and the raw SHA-256 checksum (`af37a293b5109c3874bee91b059486cdaa1e81bae289881becfde512917d3be5`) are strictly immutable.
2. **Deterministic execution**: Evaluating the same fixture with the same rule catalogue version yields a byte-equivalent profile (`expected-profile.json`).
3. **No fuzzy matching, no automatic merge**: Duplicates are detected only on exact candidate keys after normalization:
   - Departments: normalized `department_code` (`DEP-007`)
   - Employees: normalized `employee_no` (`EMP-009`)
   - Leave requests: `(employee_no, date_from, date_to)` (`LEV-009`)
   - Payroll totals: `(department_code, month)` (`PAY-008`)  
   Candidate duplicates receive the terminal outcome `review` and are held for human decision in the review queue; they are never merged destructively.
4. **Stable rule IDs and reason codes**: Every rule has a unique, stable `rule_id`, version (`1.0.0`), input condition, result (`reject`, `normalize`, `review`, `derive`), reason code, and human-readable explanation.
5. **Employment Join Date Invariant (BR-ERP5-01)**: An employee's `join_date` must not precede their `birth_date`. Any violation is rejected with `JOIN_DATE_BEFORE_BIRTH_DATE`.
6. **Salary Masking and Non-Negativity (BR-ERP5-02, DR-5)**: Employee salary must be non-negative (`NEGATIVE_SALARY`). Salary values are masked as `XX,XXX` on API responses, CSV exports, error payloads, and audit logs.
7. **Leave Date Range Ordering (FR-ERP5-04)**: Leave `date_to` must be on or after `date_from`. Inverted date ranges are rejected with `INVALID_LEAVE_DATES`.
8. **Payroll Output Boundary (FR-ERP5-06)**: V1 payroll output is strictly department-level monthly aggregates (`gross_total`, `net_total`, `employee_count`). Individual employee salary or payslip line items in payroll uploads are rejected with `EMPLOYEE_LINES_FORBIDDEN`.
9. **OWASP Formula Injection Defense (PLT-12 / KIT-16)**: Free-text fields starting with `=`, `+`, `-`, `@`, `\t`, or `\r` are rejected with `FORMULA_INJECTION_REJECTED`.
10. **Synthetic Fixture Only**: Never add credentials, `.env`, or real personal/employee datasets.

---

## 2. Row Outcomes & Reconciliation

Every parsed source row maps to exactly one terminal outcome:
- **`accepted`**: Validated and cleaned; ready for ingestion through module public REST endpoints.
- **`rejected`**: Failed one or more business/format rules; not loaded; lists stable reason codes.
- **`review`**: Exact duplicate candidate; held for human review in the review queue; never loaded automatically.
- **`skipped`**: Unused source row skipped with an approved reason.

Reconciliation equation:
$$\text{source} = \text{accepted} + \text{rejected} + \text{review} + \text{skipped}$$
$$\text{unaccounted} = 0$$

In the V1 Dirty Data Pack (`sample-data/erp-5/dirty-data-v1.csv`):
- **Total rows**: 130
- **Accepted**: 42 (32.31%)
- **Rejected**: 78 (60.00%)
- **Review**: 10 (7.69%)
- **Skipped**: 0 (0.00%)
- **Unaccounted**: 0 (0.00%)
- **Is Balanced**: `true`

### Breakdown by Record Type

| Record Type | Accepted | Rejected | Review | Skipped | Total |
|---|---|---|---|---|---|
| **Department** | 8 | 10 | 2 | 0 | 20 |
| **Employee** | 18 | 38 | 4 | 0 | 60 |
| **Leave** | 10 | 18 | 2 | 0 | 30 |
| **Payroll Total** | 6 | 12 | 2 | 0 | 20 |
| **Total** | **42** | **78** | **10** | **0** | **130** |

---

## 3. Fields, Required vs. Optional, and Enumerations

| Entity | Required Fields | Optional Fields | Enumerations / Value Sets |
|---|---|---|---|
| **Department** | `department_code`, `department_name` | `parent_code` | N/A |
| **Employee** | `employee_no`, `first_name`, `last_name`, `birth_date`, `join_date`, `department_code` | `job_title`, `salary`, `currency_code` | `currency_code` $\in$ {`INR`, `USD`, `EUR`} |
| **Leave** | `employee_no`, `leave_type`, `date_from`, `date_to`, `leave_status` | `leave_reason` | `leave_type` $\in$ {`annual`, `sick`, `unpaid`}; `leave_status` $\in$ {`pending`, `approved`, `rejected`} |
| **Payroll Total** | `department_code`, `month`, `gross_total`, `net_total`, `currency_code`, `employee_count` | N/A | `currency_code` $\in$ {`INR`, `USD`, `EUR`}; `month` format `YYYY-MM` |

---

## 4. Normalization Rules

Cleaning normalizes raw text without mutating source rows:

| Field | Rule ID | Transformation Applied |
|---|---|---|
| `department.department_code` | `DEP-003` | Trim whitespace; convert to UPPERCASE. |
| `department.parent_code` | `DEP-003` | Trim whitespace; convert to UPPERCASE; empty string converts to `null`. |
| `employee.employee_no` | `EMP-003` | Trim whitespace; convert to UPPERCASE. |
| `employee.first_name` | `EMP-012` | Trim leading/trailing whitespace; collapse consecutive inner spaces into a single space. |
| `employee.last_name` | `EMP-012` | Trim leading/trailing whitespace; collapse consecutive inner spaces into a single space. |
| `employee.department_code` | `EMP-005` | Trim whitespace; convert to UPPERCASE. |
| `employee.currency_code` | `EMP-008` | Trim whitespace; convert to UPPERCASE. |
| `employee.birth_date` | `EMP-013` | Normalize `YYYY/MM/DD` or ISO strings to `YYYY-MM-DD`. |
| `employee.join_date` | `EMP-013` | Normalize `YYYY/MM/DD` or ISO strings to `YYYY-MM-DD`. |
| `leave.employee_no` | `LEV-001` | Trim whitespace; convert to UPPERCASE. |
| `leave.leave_type` | `LEV-005` | Trim whitespace; convert to lowercase. |
| `leave.leave_status` | `LEV-007` | Trim whitespace; convert to lowercase. |
| `payroll_total.department_code` | `PAY-001` | Trim whitespace; convert to UPPERCASE. |
| `payroll_total.currency_code` | `PAY-009` | Trim whitespace; convert to UPPERCASE. |

---

## 5. Validation and Rejection Rules

| Entity | Rule ID | Field | Condition | Result | Reason Code | Explanation |
|---|---|---|---|---|---|---|
| Department | `DEP-001` | `department_code` | Empty after trimming | Reject | `DEPARTMENT_CODE_REQUIRED` | Department code is mandatory. |
| Department | `DEP-002` | `department_name` | Empty after trimming | Reject | `DEPARTMENT_NAME_REQUIRED` | Department name is mandatory. |
| Department | `DEP-004` | `parent_code` | Equals department_code | Reject | `DEPARTMENT_SELF_PARENT` | Department cannot be its own parent. |
| Department | `DEP-005` | `parent_code` | Circular ancestor cycle | Reject | `DEPARTMENT_CYCLE_DETECTED` | Hierarchy cycle detected. |
| Department | `DEP-006` | `parent_code` | Missing ancestor | Reject | `PARENT_DEPARTMENT_NOT_FOUND` | Parent department code does not exist. |
| Department | `DEP-007` | `department_code` | Exact duplicate code | Review | `DUPLICATE_DEPARTMENT_CODE_REVIEW` | Candidate duplicate held for review. |
| Department | `DEP-008` | `department_name` | Formula prefix | Reject | `FORMULA_INJECTION_REJECTED` | CSV injection risk prevented. |
| Employee | `EMP-001` | `employee_no` | Empty after trimming | Reject | `EMPLOYEE_NO_REQUIRED` | Employee number is mandatory. |
| Employee | `EMP-002` | `first_name` | Empty first/last name | Reject | `EMPLOYEE_NAME_REQUIRED` | Employee name is mandatory. |
| Employee | `EMP-003` | `birth_date` | Empty / invalid date | Reject | `BIRTH_DATE_REQUIRED` | Valid birth date is mandatory. |
| Employee | `EMP-004` | `join_date` | Empty / invalid date | Reject | `JOIN_DATE_REQUIRED` | Valid join date is mandatory. |
| Employee | `EMP-005` | `department_code` | Unresolved department | Reject | `DEPARTMENT_NOT_FOUND` | Department reference must exist. |
| Employee | `EMP-006` | `join_date` | `join_date < birth_date` | Reject | `JOIN_DATE_BEFORE_BIRTH_DATE` | Join date must not precede birth date (BR-ERP5-01). |
| Employee | `EMP-007` | `salary` | `salary < 0` | Reject | `NEGATIVE_SALARY` | Salary must be non-negative (BR-ERP5-02). |
| Employee | `EMP-008` | `currency_code` | Invalid currency code | Reject | `INVALID_CURRENCY` | Must be INR, USD, or EUR. |
| Employee | `EMP-009` | `employee_no` | Exact duplicate number | Review | `DUPLICATE_EMPLOYEE_NO_REVIEW` | Candidate duplicate held for review. |
| Employee | `EMP-010` | `first_name` | Formula prefix | Reject | `FORMULA_INJECTION_REJECTED` | CSV injection risk prevented. |
| Leave | `LEV-001` | `employee_no` | Unresolved employee | Reject | `EMPLOYEE_NOT_FOUND` | Employee reference must exist. |
| Leave | `LEV-002` | `leave_type` | Empty leave type | Reject | `LEAVE_TYPE_REQUIRED` | Leave type is mandatory. |
| Leave | `LEV-003` | `date_from` | Empty / invalid date | Reject | `DATE_FROM_REQUIRED` | Start date is mandatory. |
| Leave | `LEV-004` | `date_to` | Empty / invalid date | Reject | `DATE_TO_REQUIRED` | End date is mandatory. |
| Leave | `LEV-005` | `leave_type` | Invalid leave type | Reject | `INVALID_LEAVE_TYPE` | Must be annual, sick, or unpaid. |
| Leave | `LEV-006` | `date_to` | `date_to < date_from` | Reject | `INVALID_LEAVE_DATES` | Date range inverted (FR-ERP5-04). |
| Leave | `LEV-007` | `leave_status` | Invalid status enum | Reject | `INVALID_LEAVE_STATUS` | Must be pending, approved, or rejected. |
| Leave | `LEV-008` | `leave_status` | Invalid transition | Reject | `INVALID_LEAVE_STATUS_TRANSITION` | Terminal state cannot be transitioned. |
| Leave | `LEV-009` | `employee_no` | Exact duplicate request | Review | `DUPLICATE_LEAVE_REQUEST_REVIEW` | Candidate duplicate held for review. |
| Leave | `LEV-010` | `leave_reason` | Formula prefix | Reject | `FORMULA_INJECTION_REJECTED` | CSV injection risk prevented. |
| Payroll Total | `PAY-001` | `department_code` | Unresolved department | Reject | `DEPARTMENT_NOT_FOUND` | Department reference must exist. |
| Payroll Total | `PAY-002` | `month` | Empty month | Reject | `MONTH_REQUIRED` | Month is mandatory. |
| Payroll Total | `PAY-003` | `month` | Non YYYY-MM format | Reject | `INVALID_MONTH_FORMAT` | Format must be YYYY-MM. |
| Payroll Total | `PAY-004` | `gross_total` | Negative gross total | Reject | `NEGATIVE_GROSS_TOTAL` | Gross total must be non-negative. |
| Payroll Total | `PAY-005` | `net_total` | Net exceeds gross | Reject | `NET_EXCEEDS_GROSS` | Net total cannot exceed gross total. |
| Payroll Total | `PAY-006` | `employee_count` | Negative employee count | Reject | `NEGATIVE_EMPLOYEE_COUNT` | Employee count must be non-negative. |
| Payroll Total | `PAY-007` | `employee_no` | Individual employee lines | Reject | `EMPLOYEE_LINES_FORBIDDEN` | Aggregates only in V1 (FR-ERP5-06). |
| Payroll Total | `PAY-008` | `department_code` | Duplicate dept + month | Review | `DUPLICATE_PAYROLL_TOTAL_REVIEW` | Candidate duplicate held for review. |

---

## 6. Exact Duplicate Candidate Keys (No Fuzzy Matching)

In accordance with ClearShift Core Rules and Decision ADR-02:
- **No fuzzy auto-merging** is allowed in V1.
- Candidate duplicates are identified exclusively via deterministic, normalized exact key matching.
- Any merge requires explicit human approval in the Migration Review UI.

| Entity | Natural Key / Candidate Key |
|---|---|
| **Department** | `department_code` |
| **Employee** | `employee_no` |
| **Leave** | `(employee_no, date_from, date_to)` |
| **Payroll Total** | `(department_code, month)` |
