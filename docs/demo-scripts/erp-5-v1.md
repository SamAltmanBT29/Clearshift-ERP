# ERP-5 HR & Employees — V1 Demo (About 5 minutes, synthetic data, no manual SQL)

Prerequisites: clean checkout, Node 24 LTS, stack running (`npm run compose:up && npm run db:migrate`), API running (see `apps/api`).

```bash
export BASE_URL=http://localhost:3000          # wherever the Fastify API listens
export API=$BASE_URL/api/v1/erp-hr
export AUTH="Authorization: Bearer role:editor" # or role:admin for payroll/admin routes
```

**Automated in-process version (no external server required):**
```bash
npx vitest run apps/erp/modules/erp-5/tests/seed apps/erp/modules/erp-5/tests/api
```

---

## 0:00 Seed Execution (Deterministic & Idempotent)
```bash
ERP5_BASE_URL=$BASE_URL ERP5_AUTH_TOKEN=role:admin node sample-data/erp-5/seed.ts
```
**Talk track:**
- 3 departments (`ENG`, `OPS`, `HR`), 3 employees (`EMP-001`, `EMP-002`, `EMP-003`), 2 leave records, and 2 payroll aggregates loaded strictly through the public API (`/api/v1/erp-hr/*`).
- Re-run the command immediately: returns the exact same IDs (HTTP 200) without duplicating rows or raising unique constraint errors due to deterministic idempotency keys and dual-written import receipts.

---

## 1:00 Employee Search, Bounded Pagination & Sensitive-Field Masking
```bash
curl -s "$API/employees?search=ananya" -H "$AUTH" | jq '.data[] | {employee_no, first_name, last_name, job_title, salary_display}'
```
**Expected response:**
```json
{
  "employee_no": "EMP-001",
  "first_name": "Ananya",
  "last_name": "Sharma",
  "job_title": "Senior Software Engineer",
  "salary_display": "XX,XXX"
}
```
**Talk track:**
- Employee list enforces bounded pagination (`limit <= 100`, default 20) with total count metadata.
- **Salary Masking (BR-ERP5-02 / DR-5)**: Raw numeric salary is stored with `NUMERIC(20,4)` precision in PostgreSQL but is masked as `salary_display: "XX,XXX"` on serialization before network transmission and audit logging.

---

## 2:00 Department Hierarchy & Cycle Detection
```bash
# Create a child department under Engineering (ENG)
ENG_ID=$(curl -s "$API/departments?search=ENG" -H "$AUTH" | jq -r '.data[0].id')
curl -s -X POST "$API/departments" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"name\": \"Platform Infrastructure\", \"code\": \"ENG-INFRA\", \"parent_id\": \"$ENG_ID\"}" | jq '{id, name, code, parent_id}'

# Attempting a circular hierarchy returns HTTP 422 with structured domain error
curl -s -X PATCH "$API/departments/$ENG_ID" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"parent_id\": \"$ENG_ID\"}" | jq '{code, message}'
```
**Expected response:**
```json
{
  "code": "DEPARTMENT_CYCLE_DETECTED",
  "message": "A department cannot be its own ancestor or parent"
}
```

---

## 3:00 Employee Creation & Temporal Domain Invariant
```bash
# Valid employee creation
curl -s -X POST "$API/employees" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"employee_no\": \"EMP-DEMO-01\", \"first_name\": \"Kavita\", \"last_name\": \"Rao\", \"birth_date\": \"1992-04-10\", \"join_date\": \"2021-08-01\", \"department_id\": \"$ENG_ID\", \"job_title\": \"DevOps Specialist\", \"salary\": \"105000.00\", \"currency_code\": \"INR\"}" | jq '{id, employee_no, first_name, salary_display}'

# Temporal Invariant Violation: join_date precedes birth_date (BR-ERP5-01)
curl -s -X POST "$API/employees" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"employee_no\": \"EMP-INVALID\", \"first_name\": \"Time\", \"last_name\": \"Traveler\", \"birth_date\": \"2000-01-01\", \"join_date\": \"1995-01-01\", \"department_id\": \"$ENG_ID\", \"job_title\": \"Paradox Engineer\", \"salary\": \"80000.00\"}" | jq '{code, message}'
```
**Expected response:**
```json
{
  "code": "JOIN_DATE_BEFORE_BIRTH_DATE",
  "message": "join_date must not be before birth_date"
}
```

---

## 3:45 Leave Recording & Forward-Only State Transitions
```bash
EMP_ID=$(curl -s "$API/employees?search=EMP-DEMO-01" -H "$AUTH" | jq -r '.data[0].id')

# Create leave request
curl -s -X POST "$API/leave" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"employee_id\": \"$EMP_ID\", \"type\": \"annual\", \"date_from\": \"2026-07-01\", \"date_to\": \"2026-07-05\", \"status\": \"pending\"}" | tee /tmp/leave.json | jq '{id, type, date_from, date_to, status}'

LEAVE_ID=$(jq -r .id /tmp/leave.json)

# Transition to approved
curl -s -X PATCH "$API/leave/$LEAVE_ID" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"status": "approved"}' | jq '{id, status}'

# Terminal state cannot be rolled back
curl -s -X PATCH "$API/leave/$LEAVE_ID" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"status": "pending"}' | jq '{code, message}'
```
**Talk track:**
- Leave status transitions are forward-only (`pending` $\to$ `approved` / `rejected`).
- Inverted date ranges (`date_to < date_from`) are rejected with `INVALID_LEAVE_DATES` (FR-ERP5-04).

---

## 4:30 Monthly Payroll Totals & Boundary Enforcement
```bash
# Upload monthly department aggregate (requires role:admin or role:migration_runner)
curl -s -X POST "$API/payroll-totals" \
  -H "Authorization: Bearer role:admin" \
  -H 'content-type: application/json' \
  -d "{\"department_id\": \"$ENG_ID\", \"month\": \"2026-05\", \"total_amount\": \"1650000.00\", \"headcount\": 16, \"currency_code\": \"INR\"}" | jq '{id, department_id, month, total_amount, headcount}'
```
**Talk track:**
- **Boundary Enforcement (FR-ERP5-06)**: V1 payroll output is strictly department-level aggregates per calendar month. Individual employee payslips or salary line items are rejected by schema and domain policy (`EMPLOYEE_LINES_FORBIDDEN`).

---

## 5:00 Wrap-up & Automated Verification
```bash
# Run all ERP-5 automated verification suites:
npx vitest run apps/erp/modules/erp-5
```
**Key artifacts referenced:**
- OpenAPI Contract: [`packages/contracts/openapi/erp-5.yaml`](../../packages/contracts/openapi/erp-5.yaml)
- TypeScript Contracts: [`packages/contracts/src/erp-5.ts`](../../packages/contracts/src/erp-5.ts)
- Field Data Dictionary: [`docs/data-dictionaries/erp-5.md`](../data-dictionaries/erp-5.md)
- Data Quality Rules: [`apps/erp/modules/erp-5/docs/data-quality-rules.md`](../../apps/erp/modules/erp-5/docs/data-quality-rules.md)
- Gate G4 Evidence Pack: [`apps/erp/modules/erp-5/docs/gate-g4-evidence-pack.md`](../../apps/erp/modules/erp-5/docs/gate-g4-evidence-pack.md)
