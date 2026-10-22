# ERP-4 Finance & Accounting — Security & Authorization Architecture

## Overview

The ERP-4 Finance and Accounting module processes sensitive financial, ledger, and period data. Its security implementation integrates strictly with ClearShift platform packages (`@cs/identity`, `@cs/rbac`, `@cs/core`, `@cs/kernel`) and enforces:
1. Cryptographic Hub JWT validation (Ed25519) with token expiration and disabled account checking.
2. Server-side Role-Based Access Control (RBAC) following the **Default Deny** security invariant.
3. Standardized ClearShift error envelopes for 401 Unauthorized and 403 Forbidden with distributed correlation tracking.
4. Object-level multi-tenant boundary isolation and cross-user draft mutation protection.
5. Invariant preservation: Double-entry exact balance (`BR-ERP4-01`) and closed accounting period posting guards.

---

## 1. Authentication Layer (PLT-05)

### JWT Verification
All HTTP requests to `/api/v1/erp-finance/*` require an `Authorization: Bearer <token>` header containing a Hub-issued JWT.
Token verification is delegated to `@cs/identity` (`verifyAccessToken`):
- **Algorithm**: EdDSA (`Ed25519`).
- **Signing Key**: `cs-hub-key-v1` from Hub JWKS.
- **Issuer**: `clearshift-hub`.
- **Audience**: `clearshift`.
- **Clock Tolerance / Expiration**: Active tokens must have `exp` in the future.
- **Account Status**: Explicitly checks `DISABLED_USER_IDS` to immediately block revoked accounts.

### Authentication Failures
Missing, malformed, expired, invalidly signed, or revoked tokens return HTTP 401 with standard error code `UNAUTHORIZED`.

---

## 2. Role Capability Matrix & Policy Integration (PLT-06)

ERP-4 implements five standard caller roles:

| Role | Permitted Capabilities & Endpoints | Prohibited Actions (HTTP 403) |
|---|---|---|
| **Viewer** (`viewer`) | Read-only access to Chart of Accounts, Journal Entries, Trial Balance, Accounting Periods, and Opening Balances. | Any entity creation, draft modification, posting, or period updates. |
| **Editor** (`editor`) | Manage Chart of Accounts, create/edit draft journal entries, post entries, reverse posted entries, void drafts. | Bulk loading opening balances (migration only) and modifying accounting period status. |
| **Migration Runner** (`migration_runner`) | Bulk load opening balances during cutover (`POST /opening-balances`); create draft journal entries for ingestion. | Mutating Chart of Accounts, posting journal entries, updating accounting periods. |
| **Analyst** (`analyst`) | Read-only reporting access: Chart of Accounts, Journal Entries, Trial Balance, Accounting Periods. | All entity mutations. |
| **Admin** (`admin`) | Full capabilities: Chart of Accounts, Journal Entries, Opening Balances, and Period Lifecycle (`open` -> `soft_closed` -> `locked`). | None. |

---

## 3. Object-Level Authorization Guards

### Multi-Tenant Boundary Isolation (`assertTenantAccess`)
- Evaluates caller tenant context against resource tenant bindings.
- Tenant context is read from JWT claims and `X-Tenant-Id` headers.
- If caller tenant mismatches resource tenant, the request is aborted with HTTP 403 `OBJECT_ACCESS_DENIED`.

### Cross-User Draft Mutation Protection (`assertObjectMutationAccess`)
- Non-admin users cannot mutate or void journal entry drafts created by a different user (`created_by` / `created_by_user_id`).
- Unauthorized modification attempts reject with HTTP 403 `CROSS_USER_MUTATION_FORBIDDEN`.
- Administrators possess tenant-wide management override to modify or void drafts when necessary.

---

## 4. Error Handling & Audit Traceability

All authorization and security exceptions format responses with the standard envelope:
```json
{
  "statusCode": 403,
  "error": "Forbidden",
  "code": "INSUFFICIENT_PERMISSIONS",
  "message": "Access denied. Action requires write permissions.",
  "details": [],
  "correlation_id": "req-xyz-123"
}
```
`X-Correlation-Id` is propagated on all responses for distributed audit logging.
