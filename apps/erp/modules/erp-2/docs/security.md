# ERP-2 Vendors & Purchasing — Security & Authorization Architecture

**Issues**:
- [#24](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/24) — `[ERP2-09] ERP-2 Vendors & Purchasing: Authorization, Sensitive-Field Protection, Audit and Safe Logging`
- [#131](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/131) — `[ERP2-15] ERP-2 Vendors and Purchasing: Module authorization policy integration`

**Scope**: V1 · **Module**: ERP-2 Vendors & Purchasing  
**Central matrix**: PLT-06 (`packages/core/src/auth/permissions.ts`, `packages/rbac/src/matrix.ts`)  
**Token verification**: PLT-05 (`@cs/identity` → `verifyAccessToken`)  

This note describes the authorization, security posture, data protection, and audit logging of the ERP-2 module.

---

## 1. The Declared Policy Matrix

The module owns **no** independent identity or custom role list. Every route is bound to declared capability guards (`src/policies/rbac.ts`), and the allowed role sets strictly mirror the central matrix of PLT-06 and SDS §4.2, §4.9:

| Policy | Entity / Resource | Central Capability | Allowed Roles | Default Deny Roles |
|---|---|---|---|---|
| `vendors.read` | `vendors` | `records:read` (`module.read`) | Viewer, Editor, Migration Runner, Analyst, Admin | None (with valid token) |
| `vendors.create` | `vendors` | `records:write` / `migrations:run` | Editor, Migration Runner, Admin | Viewer, Analyst |
| `vendors.update` | `vendors` | `records:write` (`module.write`) | Editor, Migration Runner, Admin | Viewer, Analyst |
| `purchase_orders.read` | `purchase_orders` | `records:read` (`module.read`) | Viewer, Editor, Migration Runner, Analyst, Admin | None (with valid token) |
| `purchase_orders.create` | `purchase_orders` | `records:write` / `migrations:run` | Editor, Migration Runner, Admin | Viewer, Analyst |
| `purchase_orders.update` | `purchase_orders` | `records:write` (`module.write`) | Editor, Migration Runner, Admin | Viewer, Analyst |
| `duplicates.read` | `duplicates` | `records:read` (`module.read`) | Viewer, Editor, Migration Runner, Analyst, Admin | None (with valid token) |
| `duplicates.review` | `duplicates` | `duplicates:review` / `records:write` | Editor, Migration Runner, Admin | Viewer, Analyst |
| `import.load` | `import` | `migrations:run` / `records:write` | Editor, Migration Runner, Admin | Viewer, Analyst |

**Invariant: DEFAULT DENY.** Any route without an explicit policy, an unauthenticated request, or an identity holding insufficient capabilities fails closed with HTTP `401 Unauthorized` or `403 Forbidden`.

---

## 2. Authentication & Token Verification

| Path | Behavior |
|---|---|
| Real access token (three-part Ed25519 signed JWT) | Verified with the **shared** Hub verifier (`verifyAccessToken` from `@cs/identity`): EdDSA signature, issuer (`clearshift-hub`), audience (`clearshift`), and token expiration (`exp`) are validated. Inactive or disabled accounts are refused with `401 Unauthorized`. |
| Synthetic local test token (`role:<role>`, `valid-test-token`) | Accepted for hermetic unit and local integration tests. It is a **test affordance, not a production credential**, granting role assignments only within the test process. |
| Malformed, tampered, or expired token | Refused with `401 Unauthorized` and standard error envelope `{ statusCode: 401, error: 'Unauthorized', code: 'UNAUTHORIZED' }`. |
| Missing `Authorization` header | `401 Unauthorized` when authentication is enforced; otherwise local development fallback. |
| Unknown role | Yields zero capabilities → `403 Forbidden`. |

---

## 3. Object-Level Authorization & Boundary Guards

ERP-2 enforces two layers of object-level protection:

### 3.1 Multi-Tenant Boundary Isolation (`assertTenantAccess`)
- If a tenant identity is established (via `x-tenant-id` header or JWT `tenant_id` claim), any operation attempting to access or mutate records belonging to a different tenant is rejected with `403 Forbidden` (`OBJECT_ACCESS_DENIED`).
- Dual-write ingestion (`POST /vendors`, `POST /purchase-orders`, `POST /import/batch`) binds created target records and dual-write receipts to the active tenant ID (`registerEntityTenant`).

### 3.2 Cross-User Mutation Safety (`assertObjectMutationAccess`)
- Updates to existing records (`PATCH /vendors/:id`, `PATCH /purchase-orders/:id`) enforce creator ownership.
- If a record has an associated creator ID (`created_by`), only the user who created the record or a user holding the `Roles.ADMIN` role is permitted to modify it.
- Non-admin attempts to overwrite another operator's record are rejected with `403 Forbidden` (`CROSS_USER_MUTATION_FORBIDDEN`).

---

## 4. Field-Level Protection & Data Masking

| Field | Rule | Implementation |
|---|---|---|
| `bank_details` | Banking coordinates are masked in all read outputs (`XXXX-XXXX-7890`). Plaintext coordinates are never stored in unhashed form or returned to callers. | `src/policies/field-masking.ts` / `src/services/vendor.service.ts` |
| `tax_number` | Verified against format rules; exact-match key for duplicate candidate detection. | `src/domain/rules.ts` |
| Internal tokens / secrets / SQL | Erp2 application error handler scrubs database messages and connection strings. Uncaught errors return a sanitized generic message with a correlation ID handle. | `src/app.ts` |

---

## 5. Safe Error Sanitization

500 Internal Server Error responses never leak database details, SQL snippets, connection strings, or secrets. Uncaught exceptions return a sanitized generic message:

```json
{
  "statusCode": 500,
  "error": "Internal Server Error",
  "code": "INTERNAL_SERVER_ERROR",
  "message": "An unexpected internal error occurred.",
  "details": [],
  "correlation_id": "corr-uuid"
}
```

---

## 6. Audit Trail Integration (PLT-10)

State-changing actions write append-only records to `platform.audit`:

### 6.1 Audit Event Catalog
| Action Code | Triggering Endpoint | Entity | Diff Redacted Contents |
|---|---|---|---|
| `VENDOR_CREATED` | `POST /vendors` | `erp2_vendors` | `{ name, tax_number, bank_masked }` |
| `VENDOR_UPDATED` | `PATCH /vendors/:id` | `erp2_vendors` | Changed vendor fields (bank masked) |
| `PO_CREATED` | `POST /purchase-orders` | `erp2_purchase_orders` | `{ po_number, vendor_id, status, total, line_count }` |
| `PO_STATUS_CHANGED` | `PATCH /purchase-orders/:id` | `erp2_purchase_orders` | `{ previous_status, new_status }` |
| `merge.decided` | `POST /duplicates/review` | `erp2_vendors` | `{ candidateId, keptId, mergedId, decision, matchingKey }` |

### 6.2 Audit Invariants
- Audit records capture `actor` (user subject), `action`, `entity`, `entityId`, `correlationId`, and timestamp.
- Audit records never store raw bank account numbers or credentials.
- Audit failures are handled gracefully without aborting the business mutation.

---

## 7. Test Evidence

| Suite | Description |
|---|---|
| `apps/erp/modules/erp-2/tests/security/authorization.test.ts` | Complete suite for ERP2-09: 43 tests verifying SDS matrix, masking, audit events, token variants, error scrubbing, and client role helpers. |
| `apps/erp/modules/erp-2/tests/api/authorization-and-policy.test.ts` | Tests Hub JWT verification (valid, forged, expired, disabled), the 5-role capability matrix across endpoints (Viewer, Editor, Migration Runner, Analyst, Admin), multi-tenant boundary checks, and cross-user mutation safety (16 tests). |
| `apps/erp/modules/erp-2/tests/contract/openapi-parity.test.ts` | Tests OpenAPI parity ensuring all registered routes conform to `erp-2.yaml`. |
