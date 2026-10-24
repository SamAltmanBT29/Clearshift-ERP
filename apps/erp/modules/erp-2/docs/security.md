# ERP-2 Vendors & Purchasing — Security Note

**Issue**: [#131](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/131) — `[ERP2-15] ERP-2 Vendors and Purchasing: Module authorization policy integration`  
**Scope**: V1 · **Module**: ERP-2 Vendors & Purchasing  
**Central matrix**: PLT-06 (`packages/core/src/auth/permissions.ts`, `packages/rbac/src/matrix.ts`)  
**Token verification**: PLT-05 (`@cs/identity` → `verifyAccessToken`)  

This note describes the authorization and security posture of the ERP-2 module: who may do what, how callers are authenticated, multi-tenant and cross-user guard invariants, and protected field policies.

---

## 1. The Declared Policy Matrix

The module owns **no** independent identity or custom role list. Every route is bound to declared capability guards (`src/policies/rbac.ts`), and the allowed role sets strictly mirror the central matrix of PLT-06 and SDS §4.2, §4.9:

| Policy | Entity / Resource | Central Capability | Allowed Roles | Default Deny Roles |
|---|---|---|---|---|
| `vendors.read` | `vendors` | `records:read` (`module.read`) | Viewer, Editor, Migration Runner, Analyst, Admin | None (with valid token) |
| `vendors.create` | `vendors` | `records:write` / `migrations:run` | Editor, Migration Runner, Admin | Viewer, Analyst |
| `vendors.update` | `vendors` | `records:write` (`module.write`) | Editor, Admin | Viewer, Migration Runner, Analyst |
| `purchase_orders.read` | `purchase_orders` | `records:read` (`module.read`) | Viewer, Editor, Migration Runner, Analyst, Admin | None (with valid token) |
| `purchase_orders.create` | `purchase_orders` | `records:write` / `migrations:run` | Editor, Migration Runner, Admin | Viewer, Analyst |
| `purchase_orders.update` | `purchase_orders` | `records:write` (`module.write`) | Editor, Admin | Viewer, Migration Runner, Analyst |
| `duplicates.read` | `duplicates` | `records:read` (`module.read`) | Viewer, Editor, Migration Runner, Analyst, Admin | None (with valid token) |
| `duplicates.review` | `duplicates` | `duplicates:review` / `records:write` | Editor, Migration Runner, Admin | Viewer, Analyst |
| `import.load` | `import` | `migrations:run` / `records:write` | Editor, Migration Runner, Admin | Viewer, Analyst |

**Invariant: DEFAULT DENY.** Any route without an explicit policy, an unauthenticated request, or an identity holding insufficient capabilities fails closed with HTTP `401 Unauthorized` or `403 Forbidden`.

The Migration Runner holds load/ingest and duplicate review capabilities for batch migration pipelines, but cannot perform normal operational record mutations (`vendors.update`, `purchase_orders.update`).

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
| `bank_details` | Banking coordinates are masked in all read outputs (`XXXX-XXXX-7890`). Plaintext coordinates are never stored in unhashed form or returned to callers. | `src/domain/rules.ts` / `src/services/erp2.service.ts` |
| `tax_number` | Verified against format rules; exact-match key for duplicate candidate detection. | `src/domain/rules.ts` |
| Internal tokens / secrets / SQL | Erp2 application error handler scrubs database messages and connection strings. Uncaught errors return a sanitized generic message with a correlation ID handle. | `src/app.ts` |

---

## 5. Audit Logging (PLT-10)

High-consequence deduplication decisions (`POST /duplicates/review`) and bulk load ingestion emit structured, immutable audit log events complying with PLT-10 and Section 11.5:

```json
{
  "action": "merge.decided",
  "actor": "operator-user-id",
  "actorRole": "migration_runner",
  "targetEntity": "erp2.vendors",
  "targetId": "<kept_id>",
  "correlationId": "<correlation_id>",
  "result": "success",
  "reason": "Confirmed duplicate legal entity; retaining master account.",
  "metadata": {
    "candidateId": "<candidate_uuid>",
    "keptId": "<kept_id>",
    "mergedId": "<merged_id>",
    "decision": "MERGE",
    "matchingKey": "tax_number",
    "matchingValue": "TX-998877"
  }
}
```

---

## 6. Test Evidence

| Suite | Description |
|---|---|
| `apps/erp/modules/erp-2/tests/api/authorization-and-policy.test.ts` | Tests Hub JWT verification (valid, forged, expired, disabled), the 5-role capability matrix across endpoints (Viewer, Editor, Migration Runner, Analyst, Admin), multi-tenant boundary checks, and cross-user mutation safety (16 tests). |
| `apps/erp/modules/erp-2/tests/contract/openapi-parity.test.ts` | Tests OpenAPI parity ensuring all registered routes conform to `erp-2.yaml`. |
