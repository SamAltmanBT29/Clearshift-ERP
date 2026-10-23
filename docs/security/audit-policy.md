# ClearShift Audit Policy & Sensitive Data Protection Standard (PLT-10)

## 1. Overview & Architectural Principles

In accordance with **ClearShift Project Plan v3.0 §§9.3–9.6, 17** and **ADR-002**, all high-consequence operations, migration transitions, security boundaries, and accounting mutations must generate an indelible, append-only audit trail. At the same time, raw customer records, personal identifiers, and credentials must never leak into log aggregations, error messages, or audit payloads.

---

## 2. Immutability & Database Role Separation

1. **Append-Only Policy**:
   - The `platform.audit_logs` table is strictly append-only.
   - The standard application database user (`cs_app`) is granted `SELECT` and `INSERT` permissions only.
   - `UPDATE`, `DELETE`, and `TRUNCATE` permissions are explicitly revoked.
2. **Application-Level Enforcement**:
   - Any invocation of `update()` or `delete()` on `IAuditRepository` throws an explicit `AuditImmutabilityError`.
   - Modifying historical audit events is architecturally impossible.

```sql
-- Role Permissions Baseline for platform.audit_logs
REVOKE UPDATE, DELETE, TRUNCATE ON platform.audit_logs FROM cs_app;
GRANT SELECT, INSERT ON platform.audit_logs TO cs_app;
```

---

## 3. Mandatory Privileged Action Matrix

The following privileged operations are required to emit an audit record synchronously or within the same transaction:

| Action Identifier | Category | Trigger / Context | Required Reference Fields |
|---|---|---|---|
| `export.generated` | Data Export | User or service initiates CSV/Excel download or API export | `actor`, `exportType`, `recordCount`, `destination` |
| `merge.decided` | Deduplication | Operator approves or rejects Golden ID merge proposal | `survivingGoldenId`, `subsumedSourceId`, `decision` |
| `role.changed` | Access Control | User assigned or revoked roles | `targetUserId`, `oldRoles`, `newRoles` |
| `load.requested` | Migration | Operator requests batch load into core domain tables | `batchId`, `module`, `rowCount` |
| `rollback.requested` | Migration | Operator requests bounded rollback of staged load | `batchId`, `module`, `reason` |
| `journal.posted` | Accounting | Journal entry posted to general ledger | `journalEntryId`, `periodId`, `totalAmount` |
| `journal.reversed` | Accounting | Closed or erroneous journal entry reversed | `journalEntryId`, `periodId`, `reversalEntryId` |
| `auth.succeeded` | Security | Successful user login or token generation | `actor`, `authMethod`, `ipAddress` |
| `auth.failed` | Security | Authentication rejected (bad password, expired token) | `actor` (username), `reason`, `ipAddress` |

---

## 4. Sensitive Data Redaction Invariants (Non-Negotiables)

1. **Never Log Secrets or Credentials**:
   - Passwords, Argon2 hashes, signing keys, private keys, client secrets, and JWT tokens (Bearer strings or `eyJh...` patterns) are automatically stripped and replaced with `[REDACTED_SECRET]` or `[REDACTED_JWT]`.
2. **Never Log Complete Raw Rows**:
   - Migration dirty-data records and core entity dumps must NOT be recorded as raw blobs. Audit logs must capture **entity IDs and references** rather than complete records.
3. **Field-Level Masking Rules**:
   - **Bank Accounts / IBAN**: Masked to last 4 digits (e.g. `****1234`).
   - **Salary / Compensation**: Masked to `[REDACTED_FINANCIAL]`.
   - **Government IDs (SSN, PAN, Tax ID, National ID)**: Masked to `[REDACTED_ID]`.
4. **Error Message Sanitization**:
   - All uncaught errors and exception messages passed to `redactErrorMessage()` have bearer tokens, JWTs, and sentinel secrets removed before recording.

---

## 5. Structured Audit Schema

Every audit row conforms to the `auditLogs` schema in `packages/database/src/schema/audit.ts`:

- `id`: UUID (Primary Key)
- `occurredAt`: ISO 8601 Timestamp with timezone
- `actor`: Username, service name, or system process
- `actorRole`: Primary active role of the actor
- `action`: Standardized dot-notation action identifier
- `targetEntity`: Target resource type (`user`, `journal_entry`, `golden_id`, `batch`)
- `targetId`: Target entity identifier (UUID or reference string)
- `correlationId`: Distributed tracing / request correlation ID
- `batchId`: Optional migration or reconciliation batch ID
- `result`: `"success"` or `"failure"`
- `reason`: Safe machine/human readable status reason
- `metadata`: Sanitized JSON payload with sensitive attributes masked
- `ipAddress`: Client IP (masked/safe)
- `userAgent`: Client user-agent string
