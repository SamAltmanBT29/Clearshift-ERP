# ERP-4 Finance & Accounting — Security, Authorization, Sensitive-Field Protection & Audit

**SDS Reference**: ClearShift System Design Specification §4.8, §7.9  
**Issue**: [#44](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/44) — `[ERP4-09] ERP-4 Finance and Accounting: Authorization, sensitive-field protection, audit and safe logging`  
**Dependencies**: PLT-05 (Authentication & JWT Verification), PLT-06 (Role-Based Access Control), PLT-10 (Audit Service & Logging)  
**Status**: Implemented & Verified  

---

## 1. Overview & Architectural Boundaries

Financial systems are high-risk trust domains. The ERP-4 Finance & Accounting module requires defense-in-depth across:
1. **Asymmetric Server-Side Authentication**: Cryptographic token verification using EdDSA public keys from `@cs/identity` (PLT-05).
2. **Endpoint-Level Authorization & Default-Deny**: Strict alignment with the SDS §4.8 matrix via preHandler policy guards (PLT-06).
3. **Field-Level Sensitive Data Masking**: Dynamic data masking and redaction for banking identifiers, compensation figures, government IDs, and credentials.
4. **Append-Only Immutable Audit Trail**: Structured event emission via `@cs/core` `AuditService` capturing who, what, when, and outcome without secret leakage (PLT-10).
5. **Enforced Domain Invariants**: Exact double-entry balancing (`BR-ERP4-01`) and accounting period posting guards (`BR-ERP4-02`).

```
                    ┌───────────────────────────────┐
                    │       ClearShift Hub          │
                    │   EdDSA Private Key (Ed25519) │
                    └───────────────┬───────────────┘
                                    │ Issues Asymmetric JWT
                                    ▼
       ┌─────────────────────────────────────────────────────────┐
       │             ERP-4 Finance Module Gateway                │
       │                                                         │
       │  1. onRequest Hook:                                     │
       │     verifyAccessToken(jwt) using Hub Public Key         │
       │     Check user active status (reject disabled)          │
       │                                                         │
       │  2. preHandler Hook:                                    │
       │     requireFinancePolicy(policy)                        │
       │     Checks request.user.roles against SDS matrix        │
       │                                                         │
       │  3. Route Handlers & FinanceService:                    │
       │     BR-ERP4-01: Double-Entry Exact Balance Assertion   │
       │     BR-ERP4-02: Period Status Guard                     │
       │     Erp4AuditService: Append-Only Immutable Audit Event │
       │                                                         │
       │  4. onSend Hook:                                        │
       │     maskSensitiveFields(payload, user.roles)            │
       │     Mask bank (XXXX-XXXX-7890), salary, credentials     │
       └─────────────────────────────────────────────────────────┘
```

---

## 2. Asymmetric EdDSA JWT Authentication (PLT-05)

### Verification Mechanism
- Verification is performed server-side using `@cs/identity` `verifyAccessToken`.
- Algorithm: **EdDSA** (Ed25519 curve).
- Claims validated:
  - **Issuer (`iss`)**: Must equal `clearshift-hub`.
  - **Audience (`aud`)**: Must equal `clearshift`.
  - **Expiration (`exp`)**: Verified with strict clock validation; expired tokens rejected immediately with HTTP 401.
  - **Subject (`sub`)**: User UUID or internal principal ID.
  - **Roles (`roles`)**: Array of assigned user roles (`RoleType[]`).
- **Account Active Verification**: The plugin intercepts tokens belonging to known deactivated accounts or flagged disabled states and immediately issues HTTP 401:
  ```json
  {
    "statusCode": 401,
    "error": "Unauthorized",
    "message": "User account 'user-disabled-01' is disabled",
    "correlation_id": "corr-uuid"
  }
  ```

### HTTP 401 Error Standard
When an authentication header is absent, malformed, expired, untrusted, or issued to a disabled account, the gateway responds with HTTP 401 and an `ApiError` envelope containing a traceable `correlation_id`.

---

## 3. Role-Based Access Control Matrix (SDS §4.8 / PLT-06)

The ERP-4 module enforces the authoritative SDS §4.8 permission matrix with a strict **default-deny** policy. Any unassigned role or empty role array receives HTTP 403 `INSUFFICIENT_PERMISSIONS`.

| Endpoint | Method | Policy Key | Viewer | Editor | Analyst | Runner | Admin | Auditor / Staff Notes |
|---|---|---|:---:|:---:|:---:|:---:|:---:|---|
| `/accounts` | `GET` | `finance.accounts.read` |  |  |  | ❌ |  | Auditor allowed |
| `/accounts/:id` | `GET` | `finance.accounts.read` |  |  |  | ❌ |  | Auditor allowed |
| `/accounts` | `POST` | `finance.accounts.create` | ❌ |  | ❌ | ❌ |  | Admin & Editor only |
| `/accounts/:id` | `PATCH` | `finance.accounts.update` | ❌ |  | ❌ | ❌ |  | Admin & Editor only |
| `/journal-entries` | `GET` | `finance.journal.read` |  |  |  | ❌ |  | Auditor allowed |
| `/journal-entries/:id` | `GET` | `finance.journal.read` |  |  |  | ❌ |  | Auditor allowed |
| `/journal-entries` | `POST` | `finance.journal.create` | ❌ |  | ❌ |  |  | Runner & Editor can draft |
| `/journal-entries/:id` | `PATCH` | `finance.journal.update` | ❌ |  | ❌ | ❌ |  | Editor & Admin only |
| `/journal-entries/:id/post` | `POST` | `finance.journal.post` | ❌ |  | ❌ | ❌ |  | Staff can post in open periods |
| `/journal-entries/:id/reverse` | `POST` | `finance.journal.reverse` | ❌ |  | ❌ | ❌ |  | Editor & Admin only |
| `/journal-entries/:id/void` | `POST` | `finance.journal.void` | ❌ |  | ❌ | ❌ |  | Editor & Admin only |
| `/trial-balance` | `GET` | `finance.trial_balance.read` |  |  |  | ❌ |  | Read-only analytical view |
| `/opening-balances` | `GET` | `finance.opening_balances.read` |  |  |  |  |  | All roles can inspect |
| `/opening-balances/:id` | `GET` | `finance.opening_balances.read` |  |  |  |  |  | All roles can inspect |
| `/opening-balances` | `POST` | `finance.opening_balances.load` | ❌ | ❌ | ❌ |  |  | Migration Runner & Admin |
| `/periods` | `GET` | `finance.periods.read` |  |  |  | ❌ |  | General read |
| `/periods/:id` | `GET` | `finance.periods.read` |  |  |  | ❌ |  | General read |
| `/periods/:id` | `PATCH` | `finance.periods.update` | ❌ | ❌ | ❌ | ❌ |  | Admin only |

### HTTP 403 Forbidden Contract
```json
{
  "statusCode": 403,
  "error": "Forbidden",
  "code": "INSUFFICIENT_PERMISSIONS",
  "message": "Access denied. Role(s) [viewer] lack permission for policy 'finance.accounts.create'. Required roles: [editor, admin]",
  "correlation_id": "corr-uuid"
}
```

---

## 4. Field-Level Sensitive Data Protection & Masking

Financial records often carry personal identifiable information (PII), employee compensation details, and banking credentials. Dynamic field-level masking is enforced across JSON API responses, tabular CSV exports, error envelopes, and audit logs.

### 4.1 Masking Specifications

| Data Category | Field Patterns | Applied Transformation | Visibility Rule |
|---|---|---|---|
| **Bank Account Numbers** | `bank_account_number`, `iban`, `account_no` | Retains last 4 digits: `XXXX-XXXX-7890` | Masked for **all** roles (including Admin) |
| **Salary & Compensation** | `salary`, `compensation`, `pay_rate`, `wage` | String: `"XX,XXX"`<br>Numeric: `0` | Revealed **only** to `admin` / `finance_admin`; masked for all other roles |
| **Government IDs** | `tax_id`, `ssn`, `national_id`, `pan` | Retains last 4 digits: `***-**-6789` | Masked for non-admin roles |
| **Credentials & Secrets** | `password`, `password_hash`, `token`, `secret`, `api_key` | Hard replaced with `"[REDACTED]"` | **Never** visible to any role under any circumstance |

### 4.2 CSV Tabular Export Protection
When exporting trial balance or journal ledger datasets via CSV:
- Sensitive columns are processed through `maskCsvExportRecords` before serialization.
- Bank accounts appear as `XXXX-XXXX-7890`.
- Salary amounts are zeroed for non-admin callers.
- An append-only audit event (`export.generated`) is recorded capturing row count, export format, actor, and correlation ID.

### 4.3 Safe Logging & HTTP 500 Sanitization
- Internal server error (HTTP 500) messages strip raw SQL queries, stack traces, and database connection strings.
- Outbound 500 envelopes return:
  ```json
  {
    "statusCode": 500,
    "error": "Internal Server Error",
    "code": "INTERNAL_SERVER_ERROR",
    "message": "An unexpected internal error occurred.",
    "correlation_id": "corr-uuid"
  }
  ```

---

## 5. Append-Only Audit Trail (PLT-10)

The ERP-4 module integrates with `@cs/core` `AuditService` via the `Erp4AuditService` adapter.

### 5.1 Audited Events

1. `journal.posted`: Emitted upon posting a draft journal entry. Captures entry number, period ID, currency code, and total amount.
2. `journal.reversed`: Emitted upon creating a compensating reversal entry. Captures original entry ID, reversal entry ID, actor, and reason.
3. `load.requested`: Emitted upon bulk-loading opening balances. Captures batch ID, loaded record count, and skipped count.
4. `account.created`: Emitted upon creating a new Chart of Accounts record. Captures account code, name, and classification.
5. `account.updated`: Emitted upon patching mutable account attributes. Captures modified field names.
6. `period.status_changed`: Emitted when an accounting period transitions status (e.g. `open` -> `soft_closed` -> `locked`).
7. `export.generated`: Emitted when financial data exports are generated.

### 5.2 Privacy Guarantee in Audit Metadata
All audit event metadata passes through `redactSensitiveData` from `@cs/core`. Secrets, passwords, full bank account numbers, and personal tokens are scrubbed before storage in the append-only audit log.

---

## 6. Mandatory Domain Invariant: Double-Entry Exact Balancing (BR-ERP4-01)

1. **Exact Balancing Rule**:
   $$\sum \text{debits} = \sum \text{credits}$$
   Enforced at 4 decimal places (`NUMERIC(20,4)`).
2. **Per-Line Constraints**:
   - Every line must have either `debit_amount > 0` OR `credit_amount > 0`.
   - Lines with both debit and credit positive, or both zero, are rejected with HTTP 400.
3. **Draft Balancing Check**:
   Creating or updating a draft entry validates that total debits match total credits (`VALIDATION_ERROR`).
4. **Post Immutability**:
   Once an entry transitions from `draft` to `posted`, it is permanently immutable (`ENTRY_IMMUTABLE`). Any update attempt yields HTTP 422. Adjustments require an authorized compensating reversal entry.
