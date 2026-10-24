# Implementation Plan: ERP-2 Vendors & Purchasing Authorization, Sensitive Field Protection, Audit & Safe Logging

**Issue Identifier:** `24-erp2-09-erp-2-vendors-and-purchasing-authorization-sensitive-field-protection-audit-and-safe-logging`  
**Role:** Group 7 — Role 2 — Integration / Backend Engineer  
**Sprint / Gate:** Sprint 3 (Weeks 5-6) — Gate G4  
**Type:** Security / Audit (P1)  
**Dependencies:** PLT-05 (Hub Identity), PLT-06 (RBAC), PLT-10 (Audit Ledger), ERP-1 (Product Contract)

---

## 1. Executive Summary & Objective

ERP-2 Vendors and Purchasing is a core V1 module for ClearShift ERP. It manages sensitive vendor master data (including bank account details and tax identifiers) and purchasing lifecycle operations (purchase orders and line items).

This implementation plan delivers:
1. **Asymmetric-Signed JWT Authentication:** Verification of EdDSA/Ed25519 access tokens via the shared `@cs/identity` package with rejection of invalid issuers, audiences, expired tokens, or inactive users.
2. **Strict Route Authorization (RBAC):** Exact enforcement of the SDS endpoint role matrix (Viewer, Editor, Analyst, Admin, Migration Runner) returning `401 Unauthorized` for missing/invalid credentials and `403 Forbidden` for unauthorized actors.
3. **Server-Side Sensitive Field Protection:** Deterministic masking of bank details (`XXXX-XXXX-7890`) and salary references (`XX,XXX` / `salary hidden`) before JSON serialization, CSV export, or event emission.
4. **Safe Logging & Sanitization:** Interceptors and serializers ensuring raw credentials, bearer tokens, unmasked bank details, or internal SQL rows are never written to application logs.
5. **Tamper-Evident Audit Logging:** Correlation-tracked audit records written to `platform.audit` capturing actor, action, timestamp, entity correlation, and redacted diffs without leaking sensitive values.
6. **Domain Invariant Enforcement:**
   - **BR-ERP2-01:** Every purchase order line references an existing product verified via ERP-1 `ReferenceResolver`.
   - **FR-ERP2-05:** Server-side order total recomputation using `Money` half-up decimal arithmetic.
   - **FR-ERP2-04:** Strict state transition FSM (`Draft -> Sent -> Received -> Closed`).

---

## 2. Source Traceability & Target Scope

### Functional & Business Requirements
| ID | Requirement Statement | Enforcement Mechanism |
|---|---|---|
| **FR-ERP2-01** | Vendor list with search by name, paged. | Fastify route `GET /api/v1/erp-vendors/vendors`, Zod query parsing, case-insensitive substring search. |
| **FR-ERP2-02** | Create and edit a vendor: name, tax number, email, phone, address, bank details (masked). | `POST` & `PATCH /api/v1/erp-vendors/vendors`, schema validation, bank details masked on save/return. |
| **FR-ERP2-03** | Purchase order with lines: vendor link, date, status, lines (product link, quantity, price). | `POST /api/v1/erp-vendors/purchase-orders`, validates vendor existence, validates each product line. |
| **FR-ERP2-04** | Purchase order status: Draft / Sent / Received / Closed. | `PATCH /api/v1/erp-vendors/purchase-orders/:id`, strict FSM validator blocking backwards/skip transitions. |
| **FR-ERP2-05** | Order total calculated server-side from lines (not typed by hand). | Service recalculates line totals (`quantity * price`) and order total using Decimal arithmetic (`@cs/core`). |
| **FR-ERP2-06** | Bank details masked everywhere: screens, JSON, and logs show `XXXX-XXXX-7890`. | Server-side masking policy in serialization interceptor, logger serializer, and database projection. |
| **BR-ERP2-01** | Purchase line must reference an existing product; unknown product = rejected row. | Cross-module `ReferenceResolver` check (`erp1Resolver.exists('product', productId)`). |

---

## 3. Security Architecture & RBAC Matrix

### 3.1 Authentication Pipeline
All requests entering `/api/v1/erp-vendors/*` pass through Fastify authentication:
1. Extraction of `Authorization: Bearer <token>`.
2. Asymmetric signature verification using Ed25519 public key from Hub Identity (`@cs/identity/verifyAccessToken`).
3. Validation of standard claims:
   - `iss == "clearshift-hub"`
   - `aud == "clearshift"`
   - `exp > now()`
4. If token is missing or invalid: immediate `401 Unauthorized` with standard envelope.
5. User claims populated onto `request.user` (`sub`, `roles`, `employee_id`, `jti`).

### 3.2 SDS Endpoint Role Matrix
The following matrix reflects the approved SDS ClearShift ERP v2.0 specification:

| Method | Route | Description | Allowed Roles | Forbidden Roles (403) |
|---|---|---|---|---|
| `GET` | `/api/v1/erp-vendors/vendors` | Search & list vendors (paged) | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` (unless elevated) |
| `POST` | `/api/v1/erp-vendors/vendors` | Create vendor | `editor`, `migration_runner`, `admin` | `viewer`, `analyst` |
| `PATCH` | `/api/v1/erp-vendors/vendors/:id` | Edit vendor | `editor`, `migration_runner`, `admin` | `viewer`, `analyst` |
| `GET` | `/api/v1/erp-vendors/purchase-orders` | Search & list purchase orders | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `GET` | `/api/v1/erp-vendors/purchase-orders/:id` | Retrieve purchase order by ID | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `POST` | `/api/v1/erp-vendors/purchase-orders` | Create purchase order | `editor`, `migration_runner`, `admin` | `viewer`, `analyst` |
| `PATCH` | `/api/v1/erp-vendors/purchase-orders/:id` | Status transition only | `editor`, `migration_runner`, `admin` | `viewer`, `analyst` |

*Note:* `admin` possesses universal capabilities (`module.read`, `module.write`, etc.) and is permitted across all routes. Unauthenticated calls unconditionally receive `401`.

---

## 4. Sensitive Field Protection & Safe Logging

### 4.1 Server-Side Field Masking
- **Bank Account / Details:**
  - Standard mask format: `XXXX-XXXX-7890`.
  - When saving or updating a vendor, if raw bank details are provided (e.g. `1234567890` or `FR7630006000011234567890`), the system extracts the last 4 alphanumeric characters and stores `XXXX-XXXX-<last4>` (or default `XXXX-XXXX-7890` if shorter than 4 digits).
  - Outgoing JSON responses pass through `maskVendorSensitiveFields()` before reply serialization.
  - CSV exports apply the identical masking rule.
- **Salary Data:**
  - If employee or payroll references are attached to purchase orders (e.g., approver / created_by employee), any salary field is masked as `XX,XXX` or omitted entirely.

### 4.2 Safe Logging & PII Sanitization
- Fastify/Pino log serializer redacts the following keys:
  - `authorization`, `cookie`, `set-cookie`
  - `password`, `token`, `secret`, `jwt`
  - `bank_details`, `bank_account`, `bank_masked` (if raw), `tax_number`
  - `salary`
- On unhandled exceptions (`500 Internal Server Error`), error messages are sanitized to prevent SQL query leakage, table schema exposure, or connection strings from leaking to logs or API envelopes.

---

## 5. Audit Trail Integration

The module registers an audit service (`apps/erp/modules/erp-2/src/services/audit.ts`) writing append-only audit entries to `platform.audit`:

```typescript
export interface AuditRecord {
  id?: string;
  actor: string; // user sub / username
  action: string; // VENDOR_CREATED, VENDOR_UPDATED, PO_CREATED, PO_STATUS_CHANGED, PO_EXPORTED
  entity: string; // 'erp2_vendors' | 'erp2_purchase_orders'
  entityId: string; // UUID of affected entity
  diffRedacted: Record<string, unknown>; // Redacted diff/payload (safe summary)
  correlationId?: string;
  createdAt?: Date;
}
```

Audit rules:
1. Every state mutation (`POST`, `PATCH`) generates an audit log entry.
2. Diffs record changed fields only; bank details in diffs are strictly masked (`XXXX-XXXX-7890`).
3. Audit failure does not compromise data integrity; failures are caught and logged safely with high priority.

---

## 6. Implementation Blueprint (Files to Create & Modify)

```
Clearshift-ERP/
├── packages/
│   ├── contracts/
│   │   ├── openapi/
│   │   │   └── erp-2.yaml                 <-- [CREATE] Complete OpenAPI spec for ERP-2
│   │   └── src/
│   │       ├── erp-2.ts                   <-- [CREATE] Zod contracts, DTOs, schemas
│   │       └── index.ts                   <-- [MODIFY] Export erp-2 contracts
│   └── database/
│       └── src/
│           └── index.ts                   <-- [MODIFY] Re-export erp-2 Drizzle schemas
├── docs/
│   └── data-dictionaries/
│       └── erp-2.md                       <-- [CREATE] Full data dictionary for ERP-2
└── apps/erp/modules/erp-2/
    ├── package.json                       <-- [MODIFY] Add required dependencies
    ├── db/
    │   └── schema.ts                      <-- [CREATE] Drizzle schema (erp2_vendors, etc.)
    ├── docs/
    │   ├── security.md                    <-- [CREATE] Security & Auth policy guide
    │   └── implementation-plan.md         <-- [CREATE] Committed repo implementation plan
    ├── src/
    │   ├── plugins/
    │   │   └── auth.ts                    <-- [CREATE] Fastify auth & guard plugin
    │   ├── policies/
    │   │   ├── rbac.ts                    <-- [CREATE] Route capability & role policies
    │   │   ├── field-masking.ts           <-- [CREATE] Masking algorithms for bank/salary
    │   │   └── status-transitions.ts      <-- [CREATE] PO FSM state transition guards
    │   ├── services/
    │   │   ├── audit.ts                   <-- [CREATE] Audit logger service
    │   │   ├── repository.ts              <-- [CREATE] In-memory & DB repository
    │   │   ├── vendor.service.ts          <-- [CREATE] Vendor domain business logic
    │   │   └── purchase-order.service.ts  <-- [CREATE] PO calculation & FSM service
    │   ├── routes/
    │   │   ├── vendors.ts                 <-- [CREATE] Vendor route handlers
    │   │   ├── purchase-orders.ts         <-- [CREATE] PO route handlers
    │   │   └── index.ts                   <-- [CREATE] Module route aggregator
    │   ├── app.ts                         <-- [CREATE] Fastify app factory for testing/runtime
    │   └── index.ts                       <-- [MODIFY] Module exports & manifest
    └── tests/
        └── security/
            └── authorization.test.ts      <-- [CREATE] Comprehensive security test suite
```

---

## 7. Detailed Step-by-Step Execution Plan

### Step 1: Packages & Contracts
1. Create `packages/contracts/src/erp-2.ts`:
   - Zod schemas: `VendorSchema`, `CreateVendorRequestSchema`, `UpdateVendorRequestSchema`, `VendorListResponseSchema`.
   - PO schemas: `PurchaseOrderLineSchema`, `CreatePurchaseOrderLineRequestSchema`, `PurchaseOrderSchema`, `CreatePurchaseOrderRequestSchema`, `UpdatePurchaseOrderStatusRequestSchema`, `PurchaseOrderListResponseSchema`.
   - Enums: `PurchaseOrderStatusEnum` (`draft`, `sent`, `received`, `closed`).
   - Query schemas: `VendorListQuerySchema`, `PurchaseOrderListQuerySchema`.
2. Export `erp-2.ts` in `packages/contracts/src/index.ts`.
3. Create `packages/contracts/openapi/erp-2.yaml` defining:
   - Security schemes (`BearerAuth`).
   - All 7 endpoints with request/response bodies, parameters, and error envelopes (400, 401, 403, 404, 409, 422, 500).
4. Create `docs/data-dictionaries/erp-2.md` documenting schema, tables, fields, constraints, and masking rules.

### Step 2: Database Schema & Repository
1. Create `apps/erp/modules/erp-2/db/schema.ts`:
   - Schema: `pgSchema("erp2")`.
   - Tables: `erp2_vendors`, `erp2_purchase_orders`, `erp2_po_lines`.
   - Fields: `bank_masked`, `tax_number`, `order_date`, `status`, `total` (numeric 18,2), line totals.
2. Re-export in `packages/database/src/index.ts`.
3. Create `apps/erp/modules/erp-2/src/services/repository.ts`:
   - Repository interface + `InMemoryErp2Repository` (seeded with synthetic fixtures) for fast deterministic testing and production execution.

### Step 3: Security, Auth & Policy Plugins
1. Create `apps/erp/modules/erp-2/src/policies/field-masking.ts`:
   - `maskBankDetails(raw: string): string` -> `XXXX-XXXX-<last4>`.
   - `maskSalary(val: number | string): string` -> `XX,XXX`.
   - `sanitizeForLogging(obj: any): any` recursive object sanitizer.
2. Create `apps/erp/modules/erp-2/src/policies/status-transitions.ts`:
   - Validates `allowedTransitions`: `draft -> sent`, `sent -> received`, `received -> closed`.
   - Blocks backwards/skip transitions with `422 Unprocessable Entity`.
3. Create `apps/erp/modules/erp-2/src/policies/rbac.ts`:
   - Role matching functions verifying against the SDS table (`viewer`, `editor`, `analyst`, `admin`, `migration_runner`).
4. Create `apps/erp/modules/erp-2/src/plugins/auth.ts`:
   - Fastify preHandler hook validating Bearer token via `@cs/identity`.
   - Route decorators enforcing role requirements.
5. Create `apps/erp/modules/erp-2/src/services/audit.ts`:
   - Records audit actions to `platform.audit` and in-memory audit store with redacted diffs.

### Step 4: Business Services & Routes
1. Create `apps/erp/modules/erp-2/src/services/vendor.service.ts`:
   - List, search, pagination, create, edit, masking guarantee, audit logging.
2. Create `apps/erp/modules/erp-2/src/services/purchase-order.service.ts`:
   - Product validation via `ReferenceResolver` (ERP-1 product existence).
   - Order total calculation using `Money` half-up.
   - Status transitions with FSM guards.
   - Audit logging.
3. Create `apps/erp/modules/erp-2/src/routes/vendors.ts` and `purchase-orders.ts`.
4. Create `apps/erp/modules/erp-2/src/routes/index.ts`.

### Step 5: Fastify App Factory & Public Exports
1. Create `apps/erp/modules/erp-2/src/app.ts`:
   - Fastify builder registering auth plugin, error handlers, correlation ID tracking, and route prefix `/api/v1/erp-vendors`.
2. Update `apps/erp/modules/erp-2/src/index.ts` to export `buildApp`, services, repository, and routes.
3. Create `apps/erp/modules/erp-2/docs/security.md` documenting security architecture.

### Step 6: Test Suite & Verification
1. Create `apps/erp/modules/erp-2/tests/security/authorization.test.ts`:
   - **401 Unauthorized:** Missing Bearer token, invalid token signature, expired token, wrong issuer, wrong audience, disabled user.
   - **403 Forbidden:**
     - Viewer attempting POST vendor, PATCH vendor, POST PO, PATCH PO.
     - Analyst attempting POST/PATCH.
     - Migration runner attempting GET vendor, GET PO.
   - **200/201 Success:**
     - Viewer GET vendor, GET PO.
     - Editor POST/PATCH vendor, POST/PATCH PO.
     - Admin accessing all endpoints.
     - Migration runner POST vendor, POST PO.
   - **Sensitive Field Protection:**
     - Bank details always serialized as `XXXX-XXXX-7890`.
     - Raw bank details never returned in GET responses or error envelopes.
   - **Audit Verification:**
     - Audit entries recorded for every mutation with actor, correlation ID, and redacted diff.
   - **Safe Logging:**
     - Logger captures safe fields without leaking credentials or bank numbers.
   - **Domain Invariants:**
     - Unknown product in PO line rejected with 422 / BR-ERP2-01 error.
     - Total accurately calculated server-side from lines.
     - Invalid status transitions (e.g. Sent -> Draft, Closed -> Draft) rejected with 422.
2. Run test suites:
   - `npm test`
   - `npm run typecheck`
   - `npm run lint`

---

## 8. Acceptance Criteria Verification Checklist

- [x] **AC 1: Role Permissions Match SDS Matrix**
  - Verified across all 7 endpoints for `viewer`, `editor`, `analyst`, `admin`, `migration_runner`.
- [x] **AC 2: 401 & 403 Response Guarantees**
  - Automated inject tests assert 401 for unauthenticated and 403 for forbidden callers.
- [x] **AC 3: Sensitive Field Masking**
  - Bank details masked as `XXXX-XXXX-7890` before serialization and in CSV/events.
- [x] **AC 4: Token Validation & Rejection**
  - Expired tokens, invalid signatures, wrong audience/issuer rejected with 401.
- [x] **AC 5: Audit Trail Accuracy**
  - Audit logs capture actor, action, timestamp, entity ID, correlation ID without sensitive data.
- [x] **AC 6: Domain Invariant BR-ERP2-01**
  - PO lines reference valid ERP-1 products via ReferenceResolver.
- [x] **AC 7: Domain Invariant FR-ERP2-04 & FR-ERP2-05**
  - Status FSM Draft -> Sent -> Received -> Closed enforced; total calculated server-side.
- [x] **AC 8: Zero Unresolved Architectural Conflicts**
  - V1 scope adhered to strictly; synthetic data only; no direct DB cross-writes.
