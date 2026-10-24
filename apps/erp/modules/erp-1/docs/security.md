# ERP-1 Security, Authorization and Safe Logging

ERP-1 uses the shared Hub Identity EdDSA (Ed25519) access-token verifier (`@cs/identity`). Tokens must have the configured Hub issuer (`clearshift-hub`), ClearShift audience (`clearshift`), and a valid, unexpired signature. Requests without a valid bearer token receive HTTP `401 Unauthorized`; authenticated callers lacking the requisite capability/role for a given route receive HTTP `403 Forbidden`. The API integrates `isUserDisabled` and `DISABLED_USER_IDS` so revoked or disabled accounts are terminated before any route handler executes.

---

## 1. Route Permission Matrix

The endpoint permissions map directly to the SDS endpoint permission matrix and the shared `@cs/core` / `@cs/rbac` capability framework:

| Capability / Action | Endpoint | Roles |
| :--- | :--- | :--- |
| **List & Read Products** | `GET /api/v1/erp-products/products`<br>`GET /api/v1/erp-products/products/{id}`<br>`GET /api/v1/erp-products/products/{id}/linked-records` | `viewer`, `editor`, `analyst`, `admin` |
| **Create Product** | `POST /api/v1/erp-products/products` | `editor`, `migration_runner`, `admin` |
| **Update Product** | `PATCH /api/v1/erp-products/products/{id}` | `editor`, `admin` |
| **List & Read Categories** | `GET /api/v1/erp-products/categories`<br>`GET /api/v1/erp-products/categories/{id}` | `viewer`, `editor`, `analyst`, `admin` |
| **Create Category** | `POST /api/v1/erp-products/categories` | `editor`, `migration_runner`, `admin` |
| **Update Category** | `PATCH /api/v1/erp-products/categories/{id}` | `editor`, `admin` |
| **List Stock Levels** | `GET /api/v1/erp-products/stock` | `viewer`, `editor`, `analyst`, `admin` |
| **Opening Stock Load** | `POST /api/v1/erp-products/stock/opening` | `editor`, `migration_runner`, `admin` |
| **Migration Kit Import** | `POST /api/v1/erp-products/import`<br>`POST /api/v1/erp-products/import/batch` | `migration_runner`, `admin` |
| **Duplicate Checking & Listing** | `POST /api/v1/erp-products/duplicates/check`<br>`GET /api/v1/erp-products/duplicates/candidates`<br>`GET /api/v1/erp-products/duplicates/candidates/{id}` | `viewer`, `editor`, `analyst`, `admin` |
| **Duplicate Human Review** | `POST /api/v1/erp-products/duplicates/review` | `editor`, `admin` |
| **Migration Metadata & Rejections** | `GET /api/v1/erp-products/migration-metadata`<br>`GET /api/v1/erp-products/rejections` | `viewer`, `editor`, `analyst`, `migration_runner`, `admin` |

### Role Constraints
- **`viewer` & `analyst`**: Strictly read-only; denied all mutation verbs (`POST`, `PATCH`, `DELETE`).
- **`migration_runner`**: Authorized for bulk ingestion (`POST /import`, `POST /import/batch`, `POST /products`, `POST /stock/opening`). Denied interactive UI edits (`PATCH /products/{id}`) and cannot decide duplicate candidate merges (`POST /duplicates/review`).
- **`editor`**: Interactive catalog and inventory authoring and duplicate review; cannot execute bulk migration runner endpoints.
- **`admin`**: Full administrative authority across all read, write, bulk ingest, and duplicate review pathways.

---

## 2. Sensitive Field Protection & Masking

Responses are automatically sanitized at the Fastify HTTP layer (`onSend` hook via `erp1FieldMaskingPlugin`) before JSON serialization, preventing data leakage regardless of client presentation:
- **Bank Account Identifiers**: Masked as `XXXX-XXXX-7890` (preserving only the terminal 4 digits) or `XXXX-XXXX-XXXX` for shorter sequences (`supplier_bank_account`, `account_number`, `iban`, `routing_number`).
- **Salary & Compensation Values**: Masked as `XX,XXX` or suppressed unless caller possesses the `admin` role.
- **Credentials & Cryptographic Secrets**: Strictly redacted to `[REDACTED]` (`password`, `token`, `secret`, `credential`, `private_key`).
- **Formula Injection Mitigation**: Neutralizes spreadsheet formula prefixes (`=`, `+`, `-`, `@`) during parsing and export.

---

## 3. Safe Audit Logging (PLT-10)

The `Erp1AuditService` records immutable, structured audit entries for all sensitive and state-changing events:
- **Logged Events**:
  - `auth.failed`: Missing credentials, token expiration, forged signatures, disabled user accounts, authorization denials.
  - `merge.decided`: Authorized human duplicate review decisions (`MERGE`, `REJECT`, `KEEP_BOTH`) recording actor, decision, rationale, kept ID, and merged ID.
  - State changes and batch load executions.
- **Data Safety Guarantees**:
  - Audit records capture `actor`, `actorRole`, `action`, `targetEntity`, `targetId`, `correlationId`, `timestamp`, and `result`.
  - Raw rows, full passwords, bearer tokens, or sensitive unmasked values are **never** persisted in audit logs or application logs.

---

## 4. Verification

Run the security and authorization test suites from repository root:

```bash
# 1. Dedicated ERP-1 Security Suite
npx vitest run apps/erp/modules/erp-1/tests/security/authorization.test.ts

# 2. ERP-1 Module Authorization & Policy Suite
npx vitest run apps/erp/modules/erp-1/tests/api/authorization-and-policy.test.ts

# 3. Full ERP-1 Module Test Suite
npx vitest run apps/erp/modules/erp-1/tests

# 4. Strict Typecheck & Lint
npm run typecheck
npm run lint
```
