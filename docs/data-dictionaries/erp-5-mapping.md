# ERP-5 HR & Employees: Mapping & Value Translation Configuration (ERP5-28 / KIT-05)

Configuration: `apps/erp/modules/erp-5/src/migration/mapping-config.ts`
Canonical Templates: `sample-data/erp-5/mapping-template.json`

The module registers its target entity metadata and source-to-target field mapping templates with the shared Migration Kit wizard (`@cs/kit`, SDS §4.5). It integrates with `validateFieldMapping` and `registerModuleKitMetadata`.

## 1. Target Entity Metadata

ERP-5 exposes 4 target entities with declared natural keys, strict types, and required field constraints:

| Entity Name | Target Table | Primary Key | Natural Key | Key Required Fields |
|---|---|---|---|---|
| `department` | `erp5.departments` | `id` | `code` | `code`, `name` |
| `employee` | `erp5.employees` | `id` | `employee_no` | `employee_no`, `first_name`, `last_name`, `department_id`, `job_title`, `birth_date`, `join_date`, `salary`, `currency_code` |
| `leave` | `erp5.leave` | `id` | `employee_id,date_from` | `employee_id`, `leave_type`, `date_from`, `date_to`, `status` |
| `payroll_total` | `erp5.payroll_totals` | `id` | `department_id,month` | `department_id`, `month`, `gross_total`, `net_total`, `employee_count`, `currency_code` |

## 2. Enum Translation Tables

Mapping translates legacy strings, abbreviations, and regional symbols into canonical enum allowlists. Unmapped values trigger a structured `EnumTranslationError`.

### Currency Code (`currency_code`)
- Allowlist: `INR`, `USD`, `EUR`
- Mappings: `inr`, `rs`, `rs.`, `₹`, `rupee` -> `INR`; `usd`, `$`, `dollar`, `us$` -> `USD`; `eur`, `€`, `euro` -> `EUR`.

### Leave Type (`leave_type`)
- Allowlist: `annual`, `sick`, `unpaid`, `maternity`, `paternity`, `bereavement`
- Mappings:
  - `annual`, `vacation`, `holiday`, `paid leave`, `pto`, `al` -> `annual`
  - `sick`, `medical`, `illness`, `sick leave`, `sl` -> `sick`
  - `unpaid`, `loss of pay`, `lop`, `leave without pay`, `lwop` -> `unpaid`
  - `maternity`, `mat leave`, `maternity leave` -> `maternity`
  - `paternity`, `pat leave`, `paternity leave` -> `paternity`
  - `bereavement`, `compassionate`, `bereavement leave` -> `bereavement`

### Leave Status (`leave_status` / `status`)
- Allowlist: `pending`, `approved`, `rejected`, `cancelled`
- Mappings:
  - `pending`, `draft`, `submitted`, `awaiting`, `open` -> `pending`
  - `approved`, `accepted`, `granted`, `confirmed` -> `approved`
  - `rejected`, `declined`, `refused`, `denied` -> `rejected`
  - `cancelled`, `canceled`, `revoked`, `withdrawn` -> `cancelled`

### Employment Status (`employment_status`)
- Allowlist: `active`, `inactive`, `probation`, `terminated`, `on_leave`
- Mappings:
  - `active`, `current`, `employed`, `working` -> `active`
  - `inactive`, `suspended`, `dormant` -> `inactive`
  - `probation`, `trainee`, `probationary` -> `probation`
  - `terminated`, `resigned`, `ex-employee`, `separated` -> `terminated`
  - `on_leave`, `on leave`, `leave`, `sabbatical` -> `on_leave`

## 3. Type Coercion Rules

- **Decimal Amounts (`salary`, `gross_total`, `net_total`)**:
  - Strips currency symbols (`₹`, `$`, `€`, `£`), commas, and whitespace.
  - Formats to fixed 4-decimal precision (`NUMERIC(20,4)`), eliminating IEEE-754 binary floating-point drift.
  - Parses accounting parentheses `(100.50)` as negative `-100.5000`.
- **Dates (`birth_date`, `join_date`, `date_from`, `date_to`)**:
  - Coerces `YYYY/MM/DD`, `DD-MM-YYYY`, `YYYY-00M-DD` to ISO 8601 `YYYY-MM-DD`.
  - Rejects malformed dates before attempting downstream database insertion.
- **Integers (`employee_count`)**:
  - Strips commas, parses radix 10 integers, verifies non-negative bounds.

## 4. Enforcement & Invariants

- **Unmapped Required Target Fields**: Validation detects any unmapped mandatory field and blocks execution (`valid: false`, `missingRequiredFields`).
- **Privacy & Masking**: Salary is transformed to `NUMERIC(20,4)` internally but masked as `salary_display = "XX,XXX"` on public serialization (BR-ERP5-02, DR-5).
- **Exact Matching Only**: No fuzzy auto-matching or automatic merging; duplicate candidate keys route to explicit human review.
- **Non-Destructive Execution**: Source input records are never mutated; pure transformed projections are generated.
