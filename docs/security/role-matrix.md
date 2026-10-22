# ClearShift Role & Field-Level Authorization Matrix (PLT-06)

## 1. Overview & Policy Invariants

ClearShift enforces a central, server-side authorization policy across all modules in ERP and CRM. Per Project Plan v3.0 §§9.3–9.6 and SDS §9.3:

1. **Default Deny:** If an endpoint or operation does not explicitly grant access to a user's role(s), the request is unconditionally denied with HTTP `403 FORBIDDEN`.
2. **Server-Side Enforcement:** Hiding a button or navigation item in the UI is not treated as a security boundary. All API endpoints and mutation operations independently assert role capabilities.
3. **Field-Level Masking:** Sensitive data (salaries, bank accounts, government identifiers, password hashes) is sanitized server-side before serialization and CSV export. Admin rights do not grant clear-text access to credentials, bank accounts, or SSNs.

---

## 2. Central Role Permission Matrix

The five standard roles and their assigned domain capabilities are defined as follows:

| Resource / Route Group | Viewer | Editor | Migration Runner | Analyst | Admin | Constraint / Notes |
|---|:---:|:---:|:---:|:---:|:---:|---|
| **Finance Read** (Accounts, Ledger, TB) | ✅ Read | ✅ Read | ❌ Denied | ✅ Read | ✅ Read | General business ledger review |
| **Finance Mutate** (Create/Edit Entries) | ❌ Denied | ✅ Create/Edit | ❌ Denied | ❌ Denied | ✅ Create/Edit | Accounting mutations |
| **Finance Bulk Opening Balances** | ❌ Denied | ❌ Denied | ✅ Execute | ❌ Denied | ✅ Execute | Initial chart balance load |
| **HR Read** (Employees, Departments) | ✅ Read | ✅ Read | ❌ Denied | ✅ Read | ✅ Read | Salaries masked for non-Admin |
| **HR Mutate** (Employees, Roles) | ❌ Denied | ✅ Create/Edit | ❌ Denied | ❌ Denied | ✅ Create/Edit | Personnel management |
| **HR Payroll Bulk Totals** | ❌ Denied | ❌ Denied | ✅ Execute | ❌ Denied | ✅ Execute | Historical payroll ingestion |
| **Vendors & Purchasing** | ✅ Read | ✅ Create/Edit | ❌ Denied | ✅ Read | ✅ Create/Edit | Bank account masked for all |
| **Migration Execute** (Batches, Runs) | ❌ Denied | ❌ Denied | ✅ Execute | ❌ Denied | ✅ Execute | Ingestion pipeline runner |
| **Migration Approve Merge** | ❌ Denied | ❌ Denied | ❌ **DENIED** | ❌ Denied | ✅ **Approve** | **Runner cannot approve own merges** |
| **Control Center & Audit** | ✅ Read | ❌ Denied | ❌ Denied | ✅ Read | ✅ Read | Quality and reconciliations |
| **User Management & Key Rotation** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Admin | Hub administrative operations |
| **Undeclared Route** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | **Default Deny Invariant** |

---

## 3. Sensitive Field-Level Masking Rules

Field-level masking is applied uniformly across both JSON API responses and CSV tabular exports:

| Data Category | Target Fields | Viewer / Editor / Analyst / Runner | Admin | Sanitization Format |
|---|---|:---:|:---:|---|
| **Credentials & Tokens** | `password_hash`, `token`, `secret`, `access_token` | `[REDACTED]` | `[REDACTED]` | Never exposed to any role |
| **Bank Account Numbers** | `bank_account_number`, `iban`, `routing_number` | Masked | Masked | `****-****-1234` (last 4 digits only) |
| **Government Identifiers** | `ssn`, `tax_id`, `national_id` | Masked | Masked | `***-**-6789` (last 4 digits only) |
| **Salaries & Compensation** | `salary`, `base_pay`, `hourly_rate` | Masked (`0` / `[REDACTED]`) | **Visible** | Approved HR policy visibility |

---

## 4. Architectural Implementation

### 4.1 Permission Check (`packages/core/src/auth/permissions.ts`)
```typescript
import { hasPermission, Actions, Resources } from "@cs/core";

if (!hasPermission(user.roles, Actions.CREATE, Resources.JOURNAL_ENTRIES)) {
  throw new AppError("FORBIDDEN", "Unauthorized mutation attempt", 403);
}
```

### 4.2 Route Policy PreHandler Guard (`apps/hub/src/policies/route-policy.ts`)
```typescript
import { requireRoutePolicy } from "../policies/route-policy.js";

app.post(
  "/api/v1/erp-finance/opening-balances",
  { preHandler: [app.authenticate, requireRoutePolicy("finance.bulk_opening_balances")] },
  async (request) => { /* Migration Runner or Admin only */ }
);
```

### 4.3 Response Serialization Masking (`apps/hub/src/policies/field-masking-policy.ts`)
```typescript
app.register(fieldMaskingPlugin); // Automatically strips credentials and masks sensitive fields onSend
```

---

## 5. Verification & Test Evidence

Run the comprehensive table-driven authorization matrix and field-masking test suite:
```bash
npx vitest run packages/core/tests/permissions.test.ts
npm run typecheck
npm run lint
```
