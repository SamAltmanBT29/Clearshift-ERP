# ERP-2 Vendors & Purchasing — Security, Authorization & Audit Specification

**Module:** ERP-2 Vendors and Purchasing  
**Issue:** `24-erp2-09-erp-2-vendors-and-purchasing-authorization-sensitive-field-protection-audit-and-safe-logging`  
**Classification:** Confidential / Internal Security Architecture  
**Version:** V1.0  

---

## 1. Overview & Security Posture

ERP-2 Vendors and Purchasing manages sensitive vendor master data (bank accounts, corporate tax identifiers) and procurement lifecycle workflows (purchase orders and line items). In accordance with ClearShift ERP v2.0 Master Architecture, security and privacy are enforced at the server-side API boundary, before persistence, serialization, or log emission.

Key security requirements enforced:
- **Asymmetric JWT Verification:** Asymmetric EdDSA (Ed25519) JSON Web Tokens issued by ClearShift Hub Identity.
- **Route Authorization (RBAC):** Granular capability and role enforcement strictly matching the SDS endpoint matrix.
- **Sensitive Field Protection:** Strict server-side masking of bank details to `XXXX-XXXX-7890` (FR-ERP2-06).
- **Safe Logging & Sanitization:** Automated redaction preventing credentials, bearer tokens, or database internals from appearing in logs.
- **Append-Only Audit Trail:** Tamper-evident recording of all state mutations in `platform.audit`.

---

## 2. Authentication & Asymmetric Token Verification

Every request to `/api/v1/erp-vendors/*` must present a Bearer token in the `Authorization` HTTP header:

```http
Authorization: Bearer <Ed25519_JWT>
```

### 2.1 Verification Pipeline
1. **Signature Verification:** Validated using the Hub Identity public key (Ed25519) retrieved via `@cs/identity`.
2. **Issuer & Audience:**
   - Issuer (`iss`): must equal `clearshift-hub`.
   - Audience (`aud`): must equal `clearshift`.
3. **Expiration:** `exp` claim must be in the future (`exp > currentTime`). Expired tokens immediately return `401 Unauthorized`.
4. **Account Status:** Tokens issued to inactive or disabled users are rejected with `401 Unauthorized`.
5. **Context Population:** Upon verification, Fastify decorates `request.user` with `{ sub, roles, employee_id, jti }`.

---

## 3. RBAC Policy & Endpoint Matrix

The role matrix conforms strictly to the SDS ClearShift ERP v2.0 specification:

| Method | Endpoint | Description | Allowed Roles | Forbidden Roles (403) |
|---|---|---|---|---|
| `GET` | `/api/v1/erp-vendors/vendors` | Search & list vendors (paged) | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` (without elevation) |
| `POST` | `/api/v1/erp-vendors/vendors` | Create vendor | `editor`, `migration_runner`, `admin` | `viewer`, `analyst` |
| `PATCH` | `/api/v1/erp-vendors/vendors/:id` | Edit vendor | `editor`, `migration_runner`, `admin` | `viewer`, `analyst` |
| `GET` | `/api/v1/erp-vendors/purchase-orders` | Search & list purchase orders | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `GET` | `/api/v1/erp-vendors/purchase-orders/:id` | Get purchase order by ID | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `POST` | `/api/v1/erp-vendors/purchase-orders` | Create purchase order | `editor`, `migration_runner`, `admin` | `viewer`, `analyst` |
| `PATCH` | `/api/v1/erp-vendors/purchase-orders/:id` | Allowed status transition only | `editor`, `migration_runner`, `admin` | `viewer`, `analyst` |

### 3.1 Failure Response Codes
- **Missing or Invalid Token:** `401 Unauthorized`
  ```json
  {
    "code": "UNAUTHORIZED",
    "message": "Missing Authorization header. Bearer token required.",
    "details": [],
    "correlation_id": "corr-12345"
  }
  ```
- **Insufficient Role Permissions:** `403 Forbidden`
  ```json
  {
    "code": "FORBIDDEN",
    "message": "Access denied. Allowed roles: [editor, migration_runner, admin]. Current roles: [viewer].",
    "details": [],
    "correlation_id": "corr-12345"
  }
  ```

---

## 4. Sensitive Field Protection & Server-Side Masking

### 4.1 Bank Account Masking (FR-ERP2-06)
- **Standard format:** `XXXX-XXXX-7890`.
- **Server-side normalizer:** When saving or updating a vendor, any submitted bank details string is parsed:
  - If it contains at least 4 alphanumeric characters, the last 4 are preserved: `XXXX-XXXX-<last4>`.
  - If shorter or missing, the standard default `XXXX-XXXX-7890` is assigned.
- **Serialization guarantee:**
  - `GET /vendors` and `GET /vendors/:id` return `bank_masked: "XXXX-XXXX-7890"`.
  - Raw unmasked bank numbers are never stored in plain text or emitted to the client.
  - CSV exports and event emissions apply identical masking.

### 4.2 Salary Masking
- If employee references are serialized, salary values are masked as `XX,XXX` or omitted entirely.

---

## 5. Safe Logging & PII Redaction

Log serialization via Fastify/Pino is guarded by recursive sanitization:
1. **Redacted Headers:** `Authorization`, `Cookie`, `Set-Cookie`.
2. **Redacted Payload Keys:** `password`, `token`, `secret`, `jwt`, `bank_details`, `bank_account`, `salary`.
3. **Database Error Sanitization:** When unexpected database or system errors occur (`500 Internal Server Error`), error messages containing SQL syntax (`SELECT`, `INSERT`, `FROM`, `WHERE`) or sensitive tokens are masked to:
   ```json
   {
     "code": "INTERNAL_SERVER_ERROR",
     "message": "An unexpected internal error occurred.",
     "details": [],
     "correlation_id": "corr-uuid"
   }
   ```

---

## 6. Audit Trail Integration

State-changing actions write append-only records to `platform.audit`:

### 6.1 Audit Event Catalog
| Action Code | Triggering Endpoint | Entity | Diff Redacted Contents |
|---|---|---|---|
| `VENDOR_CREATED` | `POST /vendors` | `erp2_vendors` | `{ name, tax_number, bank_masked }` |
| `VENDOR_UPDATED` | `PATCH /vendors/:id` | `erp2_vendors` | Changed vendor fields (bank masked) |
| `PO_CREATED` | `POST /purchase-orders` | `erp2_purchase_orders` | `{ po_number, vendor_id, status, total, line_count }` |
| `PO_STATUS_CHANGED` | `PATCH /purchase-orders/:id` | `erp2_purchase_orders` | `{ previous_status, new_status }` |

### 6.2 Audit Invariants
- Audit records capture `actor` (user subject), `action`, `entity`, `entityId`, `correlationId`, and timestamp.
- Audit records never store raw bank account numbers or credentials.
- Audit failures are handled gracefully without aborting the business mutation.
