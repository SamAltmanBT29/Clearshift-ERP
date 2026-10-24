# ERP-5 HR & Employees: Cleaning Rules & Field-Level Audit (ERP5-27 / KIT-04)

Configuration: `apps/erp/modules/erp-5/src/migration/cleaning-config.ts`
Fixture: `sample-data/erp-5/dirty-data-v1.csv` (130 synthetic rows, ERP5-25)

The module configures the shared `@cs/kit` cleaning engine (`cleanDataset`, standard cleaners, and the V1 cleaning rule registry). It adds no custom local platform infrastructure. Rule IDs in audits and rejections come from the shared registry (`V1_CLEANING_RULES`).

## Cleaning rules per field

Entries marked "reject" stop the row with the listed reason code. Entries marked "fix" change the value and write an audit entry with `rule_id`.

| Record type | Field | Fixes (rule id) | Rejects (reason code) |
|---|---|---|---|
| department | department_code | trim, upper-case (RL-TEXT-01) | empty `DEPARTMENT_CODE_REQUIRED`; over 32 chars or invalid format `DEPARTMENT_CODE_REQUIRED`; formula prefix `FORMULA_INJECTION_REJECTED` |
| department | department_name | control characters (RL-TEXT-02); trim and collapse spaces (RL-TEXT-01) | empty `DEPARTMENT_NAME_REQUIRED`; over 255 chars `DEPARTMENT_NAME_REQUIRED`; formula prefix `FORMULA_INJECTION_REJECTED` |
| department | parent_code | trim, upper-case (RL-TEXT-01) | self-parenting `DEPARTMENT_SELF_PARENT`; formula prefix `FORMULA_INJECTION_REJECTED` |
| employee | employee_no | trim, upper-case (RL-TEXT-01) | empty `EMPLOYEE_NO_REQUIRED`; formula prefix `FORMULA_INJECTION_REJECTED` |
| employee | first_name | control characters (RL-TEXT-02); trim & collapse spaces (RL-TEXT-01); proper name title casing (RL-NAME-01) | empty `EMPLOYEE_NAME_REQUIRED`; formula prefix `FORMULA_INJECTION_REJECTED` |
| employee | last_name | control characters (RL-TEXT-02); trim & collapse spaces (RL-TEXT-01); proper name title casing (RL-NAME-01) | empty `EMPLOYEE_NAME_REQUIRED`; formula prefix `FORMULA_INJECTION_REJECTED` |
| employee | email | control characters (RL-TEXT-02); trim, lower-case (RL-EMAIL-01) | invalid email syntax `INVALID_EMAIL_FORMAT`; formula prefix `FORMULA_INJECTION_REJECTED` |
| employee | phone | control characters (RL-TEXT-02); normalize digits & prefix country code `+1` (RL-PHONE-01) | formula prefix `FORMULA_INJECTION_REJECTED` |
| employee | department_code | trim, upper-case (RL-TEXT-01) | empty `DEPARTMENT_CODE_REQUIRED`; formula prefix `FORMULA_INJECTION_REJECTED` |
| employee | job_title | control characters (RL-TEXT-02); trim & collapse spaces (RL-TEXT-01) | formula prefix `FORMULA_INJECTION_REJECTED` |
| employee | birth_date | trim (RL-TEXT-01); coerce `YYYY/M/D`, `DD-MM-YYYY`, padded `YYYY-00M-DD` -> `YYYY-MM-DD` (RL-DATE-01) | empty or impossible date `BIRTH_DATE_REQUIRED`; formula prefix `FORMULA_INJECTION_REJECTED` |
| employee | join_date | trim (RL-TEXT-01); coerce calendar date to ISO 8601 (RL-DATE-01) | empty or impossible date `JOIN_DATE_REQUIRED`; join date before birth date `JOIN_DATE_BEFORE_BIRTH_DATE` (BR-ERP5-01) |
| employee | salary | trim (RL-TEXT-01); currency symbols and thousands separators removed (RL-CURRENCY-01) | negative amount `NEGATIVE_SALARY`; malformed number `INVALID_SALARY` |
| employee | currency_code | trim, upper-case (RL-TEXT-01) | empty `CURRENCY_CODE_REQUIRED`; unsupported currency `INVALID_CURRENCY` |
| leave | employee_no | trim, upper-case (RL-TEXT-01) | empty `EMPLOYEE_NO_REQUIRED`; formula prefix `FORMULA_INJECTION_REJECTED` |
| leave | leave_type | trim, lower-case (RL-TEXT-01) | empty `LEAVE_TYPE_REQUIRED`; not annual/sick/unpaid `INVALID_LEAVE_TYPE`; formula prefix `FORMULA_INJECTION_REJECTED` |
| leave | date_from | trim (RL-TEXT-01); coerce to ISO 8601 (RL-DATE-01) | empty `DATE_FROM_REQUIRED`; impossible date `INVALID_LEAVE_DATES` |
| leave | date_to | trim (RL-TEXT-01); coerce to ISO 8601 (RL-DATE-01) | empty `DATE_TO_REQUIRED`; impossible date or `date_to < date_from` `INVALID_LEAVE_DATES` (FR-ERP5-04) |
| leave | leave_reason | control characters (RL-TEXT-02); trim & collapse spaces (RL-TEXT-01) | formula prefix `FORMULA_INJECTION_REJECTED` |
| leave | leave_status | trim, lower-case (RL-TEXT-01) | empty `LEAVE_STATUS_REQUIRED`; not pending/approved/rejected `INVALID_LEAVE_STATUS` |
| payroll_total | employee_no | none | non-empty `EMPLOYEE_LINES_FORBIDDEN` (FR-ERP5-06) |
| payroll_total | department_code | trim, upper-case (RL-TEXT-01) | empty `DEPARTMENT_CODE_REQUIRED`; formula prefix `FORMULA_INJECTION_REJECTED` |
| payroll_total | month | trim (RL-TEXT-01) | empty `MONTH_REQUIRED`; not matching YYYY-MM `INVALID_MONTH_FORMAT` |
| payroll_total | gross_total | trim (RL-TEXT-01); currency symbols and thousands separators removed (RL-CURRENCY-01) | negative amount `NEGATIVE_GROSS_TOTAL` |
| payroll_total | net_total | trim (RL-TEXT-01); currency symbols and thousands separators removed (RL-CURRENCY-01) | negative amount `NEGATIVE_NET_TOTAL`; net exceeds gross `NET_EXCEEDS_GROSS` |
| payroll_total | employee_count | trim (RL-TEXT-01) | negative count `NEGATIVE_EMPLOYEE_COUNT` |

## Registry rules not applied

| Rule | Reason |
|---|---|
| RL-TAX-01 | ERP-5 internal HR records do not store external vendor or customer tax numbers. |
| RL-ADDR-01 | V1 HR records do not store structured street addresses or city dictionaries. |
| RL-DUP-01 | Exact duplicate detection is owned by the candidate key profiler (ERP5-26). |

## Field-level audit

Every modified value produces an audit entry with `source_row` (the fixture `row_id`), `field_name`, `original_value`, `cleaned_value`, and `rule_id`. A field requiring multiple transformations (trim, then upper-case) produces sequentially ordered audit entries. Rows are classified as `new` (no changes), `cleaned` (at least one change), or `rejected` (at least one structured rejection with rule ID, reason code, and message). The audit export generates the shared formula-safe CSV (`kit_clean_log`).

## Guarantees

- **Non-destructive**: Raw input rows are never mutated; transformations exist in a separate projection while preserving the original input.
- **Privacy & Masking**: Salary display is masked as `XX,XXX` on serialization (BR-ERP5-02, DR-5); bank credentials (if any) never enter the audit log or cleaning projections.
- **Formula Injection Immunity**: Free-text and identifier fields starting with spreadsheet formula prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) are rejected outright rather than silently coerced.
- **Deterministic**: Exact matching and rule enforcement only; no fuzzy scoring and no automatic merge.
