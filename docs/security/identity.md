# ClearShift Hub Identity Security Specification & Operator Runbook

## 1. Overview & Architecture

Hub Identity is the central authentication and identity authority for all ClearShift modules across ERP and CRM. Per ClearShift Project Plan v3.0 §§9.3–9.6 and 17, no business module implements app-local user databases or local login flows. All user accounts, credential verification, cryptographic signing keys, and session lifecycles are owned exclusively by Hub Identity.

APIs validate asymmetric JSON Web Tokens (JWT) using `jose` over the Ed25519 (EdDSA) algorithm.

---

## 2. Password Hashing (Argon2id)

All user passwords stored in Hub Identity are hashed with Argon2id using the RFC 9106 recommended parameters:

| Parameter | Value | Rationale |
|---|---|---|
| **Variant** | `argon2id` | Hybrid defense against side-channel and GPU cracking attacks |
| **Memory Cost** (`m`) | `65536` (64 MB) | Memory-hard defense against ASIC hardware attacks |
| **Time Cost** (`t`) | `3` iterations | Computational bound balancing security and login throughput |
| **Parallelism** (`p`) | `4` lanes | Multi-core hardware utilization |

Passwords are never logged, never returned in API envelopes, and never stored in plain text anywhere in source, environment fixtures, or system logs.

---

## 3. JWT Claims Specification

Access tokens have a **15-minute expiration target** (`exp = iat + 900`). Every access token strictly includes all non-negotiable claims:

| Claim | Type | Description | Example (Fake Data) |
|---|---|---|---|
| `iss` | `string` | Issuer identifier | `"clearshift-hub"` |
| `aud` | `string` | Target audience | `"clearshift"` |
| `sub` | `string` | Subject user ID | `"user-admin-01"` |
| `iat` | `number` | Issued-at epoch (seconds) | `1730000000` |
| `exp` | `number` | Expiration epoch (seconds, +900s) | `1730000900` |
| `jti` | `string` | Unique JWT identifier | `"jti_f3b9c7a1-8d2e-4b5c-a1d2-9f8e7b6c5a4d"` |
| `kid` | `string` (header) | Key ID of the signing key | `"cs-hub-key-v1"` |
| `roles` | `string[]` | Assigned system roles | `["admin"]` |
| `employee_id` | `string` (optional) | Linked employee ID | `"EMP-001"` |

### Example Decoded JWT (Fake Synthetic Data)

**Protected Header:**
```json
{
  "alg": "EdDSA",
  "kid": "cs-hub-key-v1"
}
```

**Payload:**
```json
{
  "iss": "clearshift-hub",
  "aud": "clearshift",
  "sub": "user-admin-01",
  "jti": "jti_4a7192bf-084e-4e4b-97e2-04db9ffef571",
  "iat": 1776850000,
  "exp": 1776850900,
  "roles": ["admin"],
  "employee_id": "EMP-001"
}
```

---

## 4. Session Safety & Browser Storage Policy

### Non-Negotiable Storage Invariants
- **NEVER store access tokens in `localStorage` or `sessionStorage`:** Storing tokens in client web storage exposes them to cross-site scripting (XSS) exfiltration. Single Page Applications (SPAs) must retain access tokens strictly in volatile in-memory state.
- **Refresh Session Cookies:** Refresh tokens are dispatched strictly via cookies configured with:
  - `HttpOnly`: Inaccessible to client JavaScript
  - `Secure`: Transmitted only over TLS/HTTPS (in production)
  - `SameSite=Strict`: Immune to standard CSRF navigation attacks
  - `Max-Age=604800` (7 days)

### State-Changing Cookie CSRF Protection
Any state-changing refresh request (`POST /hub/auth/refresh`) using cookie-based authentication mandates an anti-CSRF check. The client supplies the `x-csrf-token` header matching the session CSRF secret issued upon login.

---

## 5. Key Rotation Protocol & Old-Key Grace Window

Hub Identity implements zero-downtime key rotation:

1. **Active Key:** Tokens are signed exclusively by the current active `kid` (e.g., `cs-hub-key-v2`).
2. **Grace-Period Keys:** When a new key is introduced, previous keys enter a `grace_period` (default 24 hours). APIs continue to verify tokens signed with old keys until their 15-minute TTL lapses.
3. **Public JWKS:** Active and grace-period public keys are served at `/hub/.well-known/jwks.json`.
4. **Retired Keys:** Keys removed from the grace period are marked `retired` and immediately rejected by verification plugins.

---

## 6. Audit Logging & Credential Redaction

Hub Identity records all authentication events via `IdentityAuditLogger`.

### Audited Events
- `LOGIN_SUCCESS`: Records `user_id`, `identifier`, `ip_address`, `timestamp`.
- `LOGIN_FAILURE`: Records `identifier`, `reason`, `ip_address`, `timestamp`.
- `LOGOUT`: Records `user_id`, `timestamp`.
- `TOKEN_REFRESH_SUCCESS` & `TOKEN_REFRESH_FAILURE`: Records session transitions.
- `ACCOUNT_DISABLED_ATTEMPT`: Triggered when an inactive account attempts authentication.
- `KEY_ROTATION`: Records timestamp and key transition (`oldKid -> newKid`).

### Security Redaction Guarantee
Passwords, raw token strings, and Authorization header values are **strictly forbidden** from log records.

---

## 7. Synthetic Mock User Directory

For local development, integration, and CI testing, Hub Identity provides the following synthetic user seeds:

| User ID | Email / Identifier | Password | Roles | Active |
|---|---|---|---|---|
| `user-admin-01` | `admin@clearshift.internal` (alias: `admin`) | `AdminSecret2026!` (dev fallback: `admin123`) | `admin` | Yes |
| `user-analyst-01` | `analyst@clearshift.internal` (alias: `analyst`) | `AnalystSecret2026!` | `analyst` | Yes |
| `user-runner-01` | `runner@clearshift.internal` (alias: `runner`) | `RunnerSecret2026!` (dev fallback: `runner123`) | `migration_runner` | Yes |
| `user-editor-01` | `editor@clearshift.internal` (alias: `editor`) | `EditorSecret2026!` | `editor` | Yes |
| `user-viewer-01` | `viewer@clearshift.internal` (alias: `viewer`) | `ViewerSecret2026!` | `viewer` | Yes |
| `user-disabled-01`| `disabled@clearshift.internal` | `DisabledSecret2026!` | `viewer` | **No (Disabled)** |

---

## 8. Operator Runbook

### Run Verification Suite
```bash
npx vitest run apps/hub/tests/identity.test.ts
npm run typecheck
npm run lint
```

### Trigger Key Rotation
To rotate signing keys programmatically or via operator endpoint:
```bash
curl -X POST http://localhost:3000/api/v1/hub/auth/rotate-keys
```

### Query Active Public Keys (JWKS)
```bash
curl http://localhost:3000/api/v1/hub/.well-known/jwks.json
```

### Emergency Account Deactivation
Deactivating a compromised user account in `AccountStore` immediately invalidates token verification on all protected endpoints, even before the 15-minute JWT expiration:
```typescript
import { accountStore } from "@cs/identity";
await accountStore.setUserActive("user-id", false);
```
