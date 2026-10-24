# ClearShift Migration Kit V1 Operational Runbook

**Document ID:** RUNBOOK-KIT-01  
**Issue Reference:** [KIT-08] Generic target adapter, stable idempotency and import receipts (#75)  
**Target Milestone:** Gate G4 (V1 Build Complete)  
**Author / Workstream:** Team 11 — Platform & Migration Kit Lead  
**Classification:** Operational Architecture & Failure-Safety Runbook  
**Status:** Approved & Enforced  

---

## 1. Executive Summary & Core Requirements

The seven-step pipeline is ClearShift’s core migration engine. A simple CRUD approach does not satisfy V1; the Kit must ingest, transform, load, validate, and reconcile repeatable datasets while guaranteeing strict auditability and mathematical row conservation.

This runbook documents:
1. The **Generic Target Adapter Contract (`MigrationTargetAdapter`)** providing the exclusive write gateway into target ERP modules.
2. The **Stable Idempotency Key Protocol** guaranteeing that retries are completely deterministic and never derive keys from mutable payloads alone.
3. The **Durable Import Receipt Protocol (`<module>.import_receipts`)** guaranteeing atomic business mutation + receipt commit inside a single local PostgreSQL transaction.
4. The **Failure & Crash Recovery Semantics** ensuring identical retries replay previous target IDs, modified payloads return HTTP 409 Conflict, and receipts survive worker restarts.
5. The **500-Row Chunked Execution & 10% Circuit Breaker** preventing long database locks and halting batches on excessive errors while enforcing exact row conservation (`source = loaded + rejected + merged + skipped; unaccounted = 0`).
6. The **Privilege Boundary Guarantee** ensuring the Migration Kit worker possesses zero direct write privileges on module-owned target tables.

---

## 2. Seven-Step Migration Pipeline & Load Architecture

### 2.1 Seven-Step Pipeline Overview

| Step | Name | Core Responsibility | Output |
|---|---|---|---|
| 1 | **Extract** | Read raw files/databases into raw area without modification. | Raw staging tables + checksums |
| 2 | **Profile** | Frequency counts of nulls, distinct values, and pattern violations. | Column profiling report |
| 3 | **Clean** | Apply deterministic cleaning rules (trimming, casing, formatting). | Clean staging tables |
| 4 | **Map** | Field mappings and value translations from source to target schemas. | Mapped record streams |
| 5 | **Load** | Generic adapter dispatch in 500-row chunks with stable idempotency keys. | Target domain tables + import receipts |
| 6 | **Validate** | Post-load referential integrity and business domain rule checks. | Validation report |
| 7 | **Reconcile** | Mathematical accounting: $source = loaded + rejected + merged + skipped$. | Reconciliation report |

---

## 3. Step 5: Generic Target Adapter, Stable Idempotency & Import Receipts (KIT-08)

**Traceability:** SDS ClearShift Migration Kit v2.0 §§3–4, §11.1–11.9; Project Plan v3.0 §§9, 11, 17; Issue #75 `[KIT-08]`.

### 3.1 Pipeline Stage Overview

Step 5 (**Load**) commits mapped and cleaned business entities into ClearShift target modules. To satisfy enterprise reliability and zero-data-loss guarantees under transient network failures or worker crashes, all load operations adhere to the **Generic Target Adapter Contract** and **Durable Import Receipt Protocol**.

```
    [ Cleaned & Mapped Rows ]
                │
                ▼
    ┌──────────────────────────────────────────────────────────────┐
    │ Migration Kit TargetBatchLoader                              │
    │ - Default chunk size: 500 rows                               │
    │ - Stable Idempotency Key: batchId:sourceRow:module:entity:v# │
    │ - 10% failure circuit breaker (STP-01)                       │
    └──────────────────────┬───────────────────────────────────────┘
                           │ Dispatches via TargetAdapter Port
                           ▼ (Zero Direct Target DB Privileges in Kit)
    ┌──────────────────────────────────────────────────────────────┐
    │ Target Module Adapter Port (e.g., erp-1, erp-2, erp-3)      │
    │                                                              │
    │  1. Check existing receipt by idempotencyKey                 │
    │     ├── Same Key + Same Hash ──► Return prior target ID (200)│
    │     └── Same Key + Diff Hash ──► Return Conflict 409 (Abort) │
    │                                                              │
    │  2. Domain Validation & Mutation                             │
    │                                                              │
    │  3. Single Local PostgreSQL Transaction:                     │
    │     BEGIN;                                                   │
    │       INSERT INTO <module>.<entity> (...);                   │
    │       INSERT INTO <module>.import_receipts (...);            │
    │     COMMIT;                                                  │
    └──────────────────────────────────────────────────────────────┘
```

### 3.2 Stable Idempotency Key Derivation

Per SDS §11.4, idempotency keys MUST be stable across retries and cannot be derived from mutable payload content alone:

$$\text{idempotencyKey} = \text{SHA256}(\text{batchId} : \text{sourceRow} : \text{module} : \text{entity} : \text{v}\{\text{operationVersion}\})$$

Key invariants:
- **Stability:** The key is completely deterministic based on the source coordinates (`batchId`, `sourceRow`) and target operation version.
- **Payload Hash Tracking:** A canonical SHA-256 hash of the cleaned payload is computed deterministically (`computeCanonicalPayloadHash(cleanData)`) with alphabetically sorted keys and stored alongside the receipt.
- **Payload Drift Guard:** If a retry arrives with the same idempotency key but a modified payload, the target adapter detects the hash mismatch and immediately rejects the mutation with an HTTP 409 Conflict (`IDEMPOTENCY_CONFLICT`).

### 3.3 Idempotency Replay Semantics

| Request State | Receipt Lookup | Hash Comparison | Action & Outcome |
| :--- | :--- | :--- | :--- |
| **First Attempt** | Not found | N/A | Commits business record and import receipt atomically in one transaction. Returns `targetId` and `isExisting: false`. |
| **Identical Retry** | Found | Identical | Returns previous `targetId` and existing receipt immediately. `isExisting: true`. Zero duplicate target records created. |
| **Drifted Payload Retry** | Found | Mismatch | Rejects mutation with `409 Conflict` (`IDEMPOTENCY_CONFLICT`). Original target record is protected. |
| **Worker Process Crash** | Found in DB | Identical | Worker recovers durable receipts from PostgreSQL; subsequent retries safely return prior IDs. |

### 3.4 Bounded Chunk Loading & Failure Threshold Guard

1. **500-Row Chunking:** The `TargetBatchLoader` processes records in configurable chunks (default: 500 rows) to bound memory consumption and avoid holding long-lived database locks.
2. **Circuit Breaker (10% Failure Ceiling):** If the cumulative row failure rate exceeds 10.0% ($\frac{\text{rejectedRows}}{\text{attemptedRows}} > 0.10$), the loader halts immediately:
   - Remaining unattempted rows are marked `REJECTED` with reason `STOP_THRESHOLD_EXCEEDED`.
   - Batch status transitions to `failed` or `load_halted`.
   - Unaccounted rows are strictly guaranteed to be 0:
     $$\text{totalSourceRows} = \text{loaded} + \text{rejected} + \text{merged} + \text{skipped}$$

### 3.5 Architectural Privilege Boundary

Migration Kit operates under strict privilege separation (ADR-004 / Decision C4):
- **No Direct Table Privileges:** The Migration Kit worker role possesses ZERO insert, update, or delete privileges on module-owned domain schemas (`erp1.*`, `erp2.*`, `erp3.*`, `erp4.*`, `erp5.*`).
- **Adapter In-Process Port:** All loads are mediated via the owning module's `MigrationTargetAdapter`, ensuring that module business rules, events, and transactional boundaries are strictly respected.
- **Durable Import Receipts:** Every module maintains an `import_receipts` table with a unique constraint on `idempotency_key` (`<module>_import_receipts_idempotency_key_unique`), guaranteeing that no race condition or retry can ever produce a duplicate target record.

---

## 4. Step 7: Terminal Outcome Ledger & Mathematically Exact Reconciliation (KIT-09)

**Traceability:** SDS ClearShift Migration Kit v2.0 §§3–4, §11.1–11.9; Project Plan v3.0 §§9, 11, 17; Issue #76 `[KIT-09]`.

### 4.1 Overview & Pipeline Stage Responsibilities

Step 7 (**Reconcile**) provides mathematical accounting for every parsed source row in a migration batch. In ClearShift V1, a migration run is NEVER considered complete or eligible for client/operator signoff based on target table count heuristics. Reconciliation is mathematically exact and derived exclusively from the append-only `platform.kit_row_outcomes` ledger.

```
                  ┌─────────────────────────────────────────────────────────┐
                  │ Append-Only Outcome Ledger (platform.kit_row_outcomes)  │
                  │ - UNIQUE (batch_id, source_row)                         │
                  │ - Database triggers strictly prohibit UPDATE & DELETE   │
                  └────────────┬───────────────────────────────┬────────────┘
                               │                               │
                Loaded Rows    │                               │ Skipped Rows (Pre-Load)
                               ▼                               ▼
                     [ Target Adapter Port ]          [ SkipManager ]
                     - Atomically commits             - Editor/Admin RBAC
                       target row + receipt           - Runner self-approval blocked
                     - Writes LOADED outcome          - Min 10 non-whitespace reason
                               │                      - operator_approved_skip code
                               │                      - Post-dry-run token invalidator
                               ▼                               │
                  ┌────────────────────────────────────────────▼────────────┐
                  │ ReconciliationEngine                                    │
                  │                                                         │
                  │   source = loaded + rejected + merged + skipped         │
                  │   unaccounted = 0                                       │
                  │                                                         │
                  │   ├── If holds: status = OK, signoffAllowed = true      │
                  │   └── If discrepancy: status = reconciliation_failed,   │
                  │       signoff strictly disabled                         │
                  └─────────────────────────────────────────────────────────┘
```

### 4.2 Append-Only Ledger Invariants (`kit_row_outcomes`)

1. **Unique Terminal Outcome:** Every parsed source row has exactly one terminal outcome:
   - `loaded`: Row successfully committed to the target module and import receipt issued.
   - `rejected`: Row failed validation, formatting, or circuit breaker threshold.
   - `merged`: Exact duplicate matched to existing golden master row and merged.
   - `skipped`: Operator explicitly excluded row before real load following authorized skip policy.
2. **Database-Level Uniqueness:** A database unique constraint on `(batch_id, source_row)` strictly blocks any second terminal outcome. Attempting to assign multiple outcomes throws `SecondTerminalOutcomeError` (`HTTP 409`).
3. **Immutability (Append-Only):** Database trigger `trg_kit_row_outcomes_append_only` intercepts and blocks any `UPDATE` or `DELETE` statement, ensuring that outcome entries cannot be tampered with.
4. **Ledger Authority:** Counts are derived directly by aggregating the outcome ledger (`countOutcomesByBatch`), never from target business table totals (`SELECT count(*) FROM target`). This guarantees immunity to external mutations or multi-tenant database writes.

### 4.3 Operator Skip Authorization & Lifecycle Rules

A `skipped` outcome is permitted ONLY under strict operational controls:
- **Pre-Load Window Only:** Skips are strictly permitted before real load (i.e. during `created`, `extracted`, `profiled`, `cleaned`, `mapped`, or `dry_run_ok` states). Any skip requested during or after `loading` throws `SkipApprovalForbiddenError` (`HTTP 403`).
- **Role-Based Access Control:** An **Editor** or **Admin** must confirm the Skip row action. Viewers, Analysts, or unprivileged roles cannot approve skips.
- **Separation of Duties:** A **Migration Runner cannot approve its own skip**. If `actor === batchRunner`, the request is rejected immediately with `SkipApprovalForbiddenError`.
- **Reason Requirement:** The operator must supply an explanatory reason of at least **10 non-whitespace characters**. Reasons failing this threshold throw `InvalidSkipReasonError` (`HTTP 400`).
- **Audit Policy Stamp:** The Kit automatically records actor, timestamp, and policy code `operator_approved_skip` alongside the reason text in the ledger.
- **Ignored Columns Policy:** Setting columns to "ignore" in field mapping NEVER marks a row as skipped. Ignored columns simply omit fields; row terminal outcomes remain governed by load/validation.

### 4.4 Dry-Run Token Invalidation Protocol

To guarantee that preflight predictions match actual load inputs:
1. Completing a dry-run issues a cryptographic `DryRunToken` recorded in `DryRunTokenManager`.
2. Any skip approved after dry-run **invalidates the dry-run token** immediately.
3. The real load gateway (`TargetBatchLoader`) asserts token validity prior to dispatching chunks. If the token is invalidated or missing, load halts with `DryRunTokenInvalidatedError` (`HTTP 412`), requiring a new dry-run before real load is unlocked.

### 4.5 Exact Conservation Equation & Signoff State

The reconciliation engine verifies the mathematical conservation equation:

$$\text{sourceRows} = \text{loaded} + \text{rejected} + \text{merged} + \text{skipped}$$
$$\text{unaccountedRows} = \text{sourceRows} - (\text{loaded} + \text{rejected} + \text{merged} + \text{skipped}) = 0$$

- **Verification Verdict:**
  - **Verdict `OK`:** Formula holds and `unaccountedRows === 0`. The batch status transitions to `reconciled` and operator signoff is enabled.
  - **Verdict `reconciliation_failed`:** If `unaccountedRows !== 0`, counts do not match, or double-count duplicates exist, the batch status remains `reconciliation_failed` and signoff is strictly disabled (`signoffAllowed: false`).
- **Formula-Safe Export Defense:** All reconciliation summary and outcome CSV exports sanitize dangerous spreadsheet formula prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) by prepending a single quote (`'`), neutralizing CSV injection attacks per OWASP guidelines.

---

## 5. Step 5b: Resumable Compensating-Saga Rollback with Conflict Preflight (KIT-12)

**Traceability:** SDS ClearShift Migration Kit v2.0 §§3–4, §11.1–11.9; Project Plan v3.0 §§9, 11, 17; Issue #79 `[KIT-12]`.

### 5.1 Non-Distributed ACID & Saga Principles

In multi-module ERP systems, rollback is **not distributed ACID**. A load cannot simply execute a global SQL transaction rollback once external systems or multi-entity transactions commit. Instead, ClearShift Migration Kit implements a **resumable compensating saga** with **conflict preflight** and **append-only journaling**:

```
                       [ Operator Rollback Request ]
                                    │
                                    ▼
                     ┌─────────────────────────────┐
                     │  Conflict Preflight Check   │
                     │  - Durable receipt check    │
                     │  - Target version match     │
                     │  - Child reference guard    │
                     └──────────────┬──────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
             Conflict Detected                 Clean / Passed
                    │                               │
                    ▼                               ▼
       ┌────────────────────────┐      ┌─────────────────────────┐
       │ Status:                │      │ Status:                 │
       │ rollback_blocked       │      │ in_progress             │
       │ - Zero mutations       │      │ - Stop new writes       │
       │ - Blocked items logged │      │ - Reverse order (LIFO)  │
       └────────────────────────┘      └────────────┬────────────┘
                                                    │
                                                    ▼
                                       ┌─────────────────────────┐
                                       │ Compensating Actions    │
                                       │ - remove_created        │
                                       │ - restore_updated       │
                                       │ - Log to journal        │
                                       └────────────┬────────────┘
                                                    │
                                                    ▼
                                       ┌─────────────────────────┐
                                       │ Status: rolled_back     │
                                       │ (100% actions confirmed)│
                                       └─────────────────────────┘
```

### 5.2 Conflict Preflight Invariants

Before any target table mutation occurs, the `RollbackPreflightChecker` inspects all records associated with the batch:
1. **Receipt Completeness:** Asserts that every loaded row has a durable import receipt recorded in `<module>.import_receipts`.
2. **Child Reference Guard (`CHILD_REFERENCES_EXIST`):** Created records can be removed **only when no downstream child references exist** (e.g., invoice lines referencing orders, inventory moves referencing products).
3. **Version & Later Edits Guard (`TARGET_VERSION_MISMATCH`):** Updated records can be restored **only when current target version still matches post-load version**. If an external user or service edited the target row after migration, rollback is strictly blocked.
4. **Blocking Semantics (`rollback_blocked`):** If any conflict is detected:
   - Rollback immediately halts without mutating target business tables.
   - Batch status transitions to `rollback_blocked`.
   - All conflicts are durably recorded in `platform.kit_rollback_journal` as `blocked` with explicit diagnostic error reasons.

### 5.3 Reverse Dependency Order Execution (LIFO)

When preflight succeeds, compensations execute in strict reverse dependency order (descending `sourceRow` / reverse load position):
- **LIFO Compensation:** Dependent child entities loaded in later rows are compensated before parent entities loaded in earlier rows.
- **Created Records (`remove_created`):** The target business record is deleted from the module domain table.
- **Updated Records (`restore_updated`):** The target record is restored to its exact `beforeState` payload.

### 5.4 Append-Only Rollback Journal (`platform.kit_rollback_journal`)

Every compensation decision is audited durably in PostgreSQL:
- **Columns:** `id`, `batch_id`, `module`, `entity`, `target_id`, `source_row`, `action`, `target_version`, `before_state`, `after_state`, `actor`, `status`, `idempotency_key`, `error_reason`, `position`, `executed_at`, `created_at`.
- **Status Lifecycle:** `pending` -> `compensated` | `blocked` | `failed`.
- **Idempotency Guarantee:** Unique constraint on `(batch_id, idempotency_key, action)` prevents duplicate journal actions.

### 5.5 Idempotency & Resumable Recovery Workflows

1. **Repeated Requests (Idempotent):** If an operator or automated retry triggers rollback on an already-rolled-back batch (`status === 'rolled_back'`), the engine returns the existing completed summary immediately with `isExisting: true`. Zero duplicate database mutations are performed.
2. **Worker Interruption & Partial Recovery (Resumable):**
   - If worker crashes or network fails mid-saga, the batch status remains `failed` or `in_progress`.
   - Completed compensation actions remain stamped `compensated` in the append-only journal.
   - Upon restart/re-execution, the saga resumes from the first uncompensated action, skipping all confirmed actions.
   - The batch transitions to `rolled_back` **only when 100% of actions are confirmed**.

---

## 6. Transactional Event Envelope, Outbox Producer and CRM-5 Projections (KIT-13)

**Traceability:** Issue #80 `[KIT-13]`; SDS ClearShift Migration Kit v2.0 §4.13; Project Plan v3.0 §§9, 11, 17.

### 6.1 Event Types
Batch state events published via the PostgreSQL outbox:
- `batch.extracted` — payload: `batch_id`, `module`, `rows_read`
- `batch.profiled` — payload: `batch_id`, `module`, `empty_count`, `invalid_count`, `duplicate_count`
- `batch.cleaned` — payload: `batch_id`, `cleaned`, `rejected`
- `batch.mapped` — payload: `batch_id`, `mapped`, `missing_required`
- `batch.loaded` — payload: `batch_id`, `loaded`, `rejected`, `merged`
- `batch.validated` — payload: `batch_id`, `validation_failures`
- `batch.failed` — payload: `batch_id`, `step`, `reason`
- `contact.merged` — where relevant

### 6.2 Transactional Commit
For each state event, the DB mutation and the outbox envelope commit together in the same PostgreSQL transaction. The Migration Kit uses `OutboxEventProducer` (`apps/migration-kit/src/events/producer.ts`) which delegates to `IOutboxRepository.writeEvent(envelope, tx)`.

### 6.3 CRM-5 Projections
`InMemoryCrm5ProjectionStore` (`apps/migration-kit/src/events/projection.ts`) derives batch counts/status from event envelopes. Duplicate deliveries are deduplicated by `event_id`; out-of-order deliveries are ignored when their `occurred_at` is older than the last applied event, preventing projection regression.

### 6.4 Hard Failure
Any unrecoverable step emits `batch.failed` with `step` and `reason`. Consumers tolerate duplicate and out-of-order delivery and never claim exactly-once.

---

## 7. Migration Kit Operator Workflow (Screens) (KIT-14)

The shared Migration Kit web app lives at `apps/migration-kit/web/` and provides:

1. Batch list (`/kit/batches`) with loading/empty/error states.
2. Four-step new batch wizard (`/kit/batches/new`): upload/create → profile → mapping/rules → dry-run/load.
3. Profile report (`/kit/batches/:batchId/profile`).
4. Mapping & rules (`/kit/batches/:batchId/mapping`).
5. Duplicate review (`/kit/batches/:batchId/duplicates`).
6. Run result (`/kit/batches/:batchId/result`).
7. Reconciliation (`/kit/batches/:batchId/reconciliation`).
8. Reject list with paged, formula-safe CSV export (`/kit/batches/:batchId/rejects`).

State-transition actions are disabled until prerequisites pass; load requires a current dry-run pass and operator role permission. Synthetic data only.

---

## 8. CLI Usage (KIT-15)

The CLI shares the same batch engine as the UI. See `docs/runbooks/cli.md` for command reference, flags, and exit codes.

---

## 9. Reject, Profiling and Reconciliation Reports with Formula-Safe CSV (KIT-16)

**Traceability:** Issue #83 `[KIT-16]`; SDS ClearShift Migration Kit v2.0 §§3–4, §11.1–11.9; Project Plan v3.0 §§9, 11, 17; PLT-12 Export Protections.

### 9.1 Report Architecture & Supported Exports

ClearShift Migration Kit provides three standardized, downloadable CSV reports guaranteeing full auditability, mathematical row conservation, and zero spreadsheet formula execution vulnerabilities:

| Report Type | Pipeline Stage | Primary Contents | Accounting Invariant |
|---|---|---|---|
| **Profiling Report** | Step 2 (Profile) | Column names, inferred types, empty counts, duplicate candidates, formula threats, null percentages. | Header metadata stamps source, loaded, rejected, merged, skipped, and unaccounted counts. |
| **Rejection Report** | Post Step 3–5 (Clean / Validate / Load) | Source row, entity, reason code, safe message, rule ID, module. | Paged rejects match the durable outcome ledger; sensitive raw values omitted/redacted. |
| **Reconciliation Report** | Step 7 (Reconcile) | Exact row conservation equation, signoff permission, summary metrics table, and detailed outcome ledger. | $\text{source} = \text{loaded} + \text{rejected} + \text{merged} + \text{skipped}$; $\text{unaccounted} = 0$. |

### 9.2 OWASP Formula Injection Neutralization

Per PLT-12 and SDS §11.8, CSV exports must neutralize dangerous formula prefixes without modifying canonical database records or in-memory domain models:

1. **Trigger Characters:** Any string beginning (after optional leading whitespace) with `=`, `+`, `-`, `@`, `\t`, or `\r`.
2. **Neutralization Rule:** The trigger character is prefixed with a single quote `'` in the exported CSV string:
   - `=cmd|' /C calc'!A0` $\rightarrow$ `'=cmd|' /C calc'!A0`
   - `@SUM(A1:A10)` $\rightarrow$ `'@SUM(A1:A10)`
   - `+2+2=4` $\rightarrow$ `'+2+2=4`
   - `  =2+2` $\rightarrow$ `"  '=2+2"`
3. **Inert Text Rendering:** Spreadsheet viewers (Microsoft Excel, LibreOffice Calc, Google Sheets) parse single-quote prefixed cells strictly as inert string literals, neutralizing Dynamic Data Exchange (DDE) and formula injection attacks.
4. **RFC 4180 Escaping:** Cells containing quotes, commas, newlines, tabs, or padding spaces are wrapped in standard RFC 4180 double quotes with internal double quotes escaped as `""`.
5. **Canonical Immutability:** Original database rows, receipt payloads, and ledger outcome records remain 100% unaltered.

### 9.3 Sensitive Data Protection & Redaction Policies

Per PLT-12, raw secrets or unmasked PII must never leave the system in exported files:

1. **Sensitive Field Detection:** Fields matching `/password|secret|token|api_?key|bank_?account|account_?no|iban|routing_?number|ssn|social_?security|salary|wage|credit_?card/i` are automatically sanitized.
2. **Redaction Placeholder:** All sensitive values are replaced with `[REDACTED]`.
3. **Safe Messages:** Error messages and exception strings are scrubbed for sensitive patterns (e.g. 9-digit SSNs `\d{3}-\d{2}-\d{4}` or 16-digit payment card numbers).
4. **Raw Snippets:** If raw row snippets are attached to reject reports, all sensitive fields inside the payload are deeply redacted before serialization.

### 9.4 Exact Row Conservation & Reconciliation Accounting

Every parsed source row must receive exactly one terminal outcome in the append-only ledger (`platform.kit_row_outcomes`):

$$\text{sourceCount} = \text{loadedCount} + \text{rejectedCount} + \text{mergedCount} + \text{skippedCount}$$
$$\text{unaccountedCount} = \text{sourceCount} - (\text{loadedCount} + \text{rejectedCount} + \text{mergedCount} + \text{skippedCount}) = 0$$

- **Status `OK`:** Only when formula holds and $\text{unaccountedCount} = 0$. Signoff is enabled (`signoffAllowed: true`).
- **Status `reconciliation_failed`:** If any mismatch exists or unaccounted rows $> 0$, status is set to `reconciliation_failed`, signoff is disabled (`signoffAllowed: false`), and diagnostic failure reasons are stamped in the report.

### 9.5 UI & CLI Gateways

- **UI (`ReportDownload.tsx`):** A shared, accessible React component in `apps/migration-kit/web/src/components/ReportDownload.tsx` integrated into the Profile Report (`/kit/batches/:batchId/profile`), Reconciliation (`/kit/batches/:batchId/reconciliation`), and Rejections (`/kit/batches/:batchId/rejects`) pages. Generates an RFC 4180 UTF-8 CSV Blob and triggers client-side download.
- **CLI (`cs-kit report`):**
  ```bash
  # Export reconciliation report
  cs-kit report reconcile --batch B-00001 --out ./reports/recon.csv

  # Export dataset profiling report
  cs-kit report profile --batch B-00001 --out ./reports/profile.csv

  # Export rejection report
  cs-kit report reject --batch B-00001 --out ./reports/rejects.csv
  ```

---

## 10. Canonical Dirty Data Pack & Deterministic Seven-Step Regression Suite (KIT-17)

**Traceability:** Issue #84 `[KIT-17]`; SDS ClearShift Migration Kit v2.0 §§3–4, §4.14 (TS-01–TS-08), §11.1–11.9; Project Plan v3.0 §§9, 11, 17; PLT-12 Export Protections.

### 10.1 Executive Overview & Purpose

The seven-step pipeline (**Extract, Profile, Clean, Map, Load, Validate, Reconcile**) is ClearShift’s core data reliability engine. A module-level CRUD implementation cannot satisfy V1 Gate G4 requirements unless the Migration Kit can ingest, transform, load, validate, and reconcile a repeatable synthetic dataset with mathematical proof.

KIT-17 provides:
1. **Canonical 1,000-Row Dirty Data Pack (`sample-data/dirty-data-pack/dirty-data-1000.csv`):** A versioned, deterministic synthetic dataset with canonical SHA-256 fingerprint, zero real personal data, and known defect counts matching SDS §4.14.
2. **Deterministic Seven-Step Regression Suite (`apps/migration-kit/tests/e2e/dirty-data-pack.test.ts`):** Automated coverage verifying all test scenarios (TS-01 to TS-08), raw source immutability, in-file duplicate merging, dry-run zero-mutation guarantees, invalid email rejection reasons, and exact reconciliation accounting.
3. **Six Boundary Fixtures:** Failure-safety verification covering 40% invalid dry-run / circuit breaker, unresolved transient failure, at-least-once duplicate delivery, missing parent entity, invalid enum, and privacy-protected opt-out.

---

### 10.2 Canonical Dataset Architecture & Defect Breakdown

The canonical Dirty Data Pack contains exactly **1,000 rows** structured with realistic contact/customer attributes (`source_id,first_name,last_name,email,phone,company,country,postal_code,status,notes`). Zero real personal data or credentials occur; all emails utilize RFC-2606 reserved domains (`@example.com`, `@example.org`, `@example.net`) and phone numbers use reserved synthetic prefixes (`+1-555-01xx`).

```
                              ┌───────────────────────────────────────────────┐
                              │ Canonical Dirty Data Pack (1,000 Source Rows) │
                              │ SHA-256 Verified in manifest.json & CI        │
                              └───────────────────────┬───────────────────────┘
                                                      │
         ┌───────────────────────────┬────────────────┴───────────────────────────┐
         ▼                           ▼                                            ▼
┌──────────────────┐       ┌──────────────────┐                        ┌────────────────────┐
│ 80 Known Exact   │       │ 110 Defect Rows  │                        │ 810 Clean Records  │
│ Duplicates       │       │ - 50 Empty Req   │                        │ - Accented UTF-8   │
│ - In-file merge  │       │ - 60 Bad Format  │                        │ - Whitespace pad   │
│ - Merged outcome │       │ - Reject outcome │                        │ - Loaded outcome   │
└────────┬─────────┘       └────────┬─────────┘                        └─────────┬──────────┘
         │                          │                                            │
         ▼                          ▼                                            ▼
   Merged: 80                  Rejected: 110                                Loaded: 810
         │                          │                                            │
         └──────────────────────────┼────────────────────────────────────────────┘
                                    ▼
       Exact Reconciliation: 1000 = 810 + 110 + 80 + 0; Unaccounted: 0; Status: OK
```

#### Defect Distribution (SDS §4.14 TS-02)

| Category | Finding Count | Sub-Type Breakdown | Expected Outcome | SDS Rule Reference |
|---|---|---|---|---|
| **Known Exact Duplicates** | **80 rows** | Identical attribute payloads to earlier rows | `MERGED` (80) | SDS §4.7 FR-DUP-02, TS-03 |
| **Empty Required Fields** | **50 rows** | - 20 missing `first_name`<br>- 15 missing `last_name`<br>- 15 missing `email` | `REJECTED` (50) | SDS §3.4 RL-REQ-01, FR-CL-02 |
| **Bad Formats** | **60 rows** | - 15 missing `@` sign ("Email is not valid: value has no @ sign")<br>- 5 multiple `@` signs<br>- 5 missing domain dot<br>- 10 phone containing letters<br>- 5 phone too short<br>- 5 impossible date in postal field<br>- 5 malformed status enum<br>- 10 OWASP formula injection prefixes | `REJECTED` (60) | SDS §3.4 RL-EMAIL-01, RL-PHONE-01, TS-05, PLT-12 |
| **Valid Clean Rows** | **810 rows** | Accented UTF-8 names, O'Brien / McDonald casings, whitespace-padded strings (cleaned), phone normalization, ISO dates | `LOADED` (810) | SDS §3.4 RL-TEXT-01, RL-NAME-01 |
| **Total Rows** | **1,000 rows** | **810 Loaded + 110 Rejected + 80 Merged + 0 Skipped** | **Unaccounted: 0** | **Reconciliation OK (TS-06)** |

---

### 10.3 Seven-Step Execution Traceability & Verification Matrix

| Step | Pipeline Stage | Operational Invariant & Verification | Output Artifact | SDS Scenario |
|---|---|---|---|---|
| **1** | **Extract** | Read 1,000 rows into raw staging area without editing. Raw file SHA-256 fingerprint is verified before and after. | Raw source tables + SHA-256 hash | TS-07, BR-KIT-03 |
| **2** | **Profile** | Column frequencies, null counts, and pattern checks. Discovers exactly 80 duplicates, 60 bad formats, 50 empty required fields. | Column Profiling Report | TS-02, FR-PR-01 |
| **3** | **Clean** | Applies 12 V1 core cleaning rules (`RL-TEXT-01`, `RL-EMAIL-01`, `RL-PHONE-01`). Trims whitespace padding; records audits in `kit_clean_log`. | Cleaned row stream | FR-CL-01–04 |
| **4** | **Map** | Maps source fields to target schema with value translation dictionaries and required target field guard. | Mapped record streams | FR-MP-01–05 |
| **5a** | **Dry Run** | Preflight validation with dry-run token. Zero target rows and zero receipts committed to database. | Dry Run Token (`dry-B-xxxxx`) | TS-04, FR-LD-01 |
| **5b** | **Load** | 500-row chunked dispatch (`DEFAULT_CHUNK_SIZE`). Commits target domain records and durable receipts (`<module>.import_receipts`) atomically. Exact duplicates merged (80); defective rows rejected (110); clean rows loaded (810). | Target domain rows + receipts | TS-03, TS-05, KIT-08 |
| **6** | **Validate** | Referential integrity, enum constraints, and link validation post-load. | Validation Report | FR-VA-01–04 |
| **7** | **Reconcile** | Mathematical row conservation derived strictly from append-only ledger (`kit_row_outcomes`): $\text{source} = \text{loaded} + \text{rejected} + \text{merged} + \text{skipped}$; $\text{unaccounted} = 0$. | Reconciliation Report (CSV) | TS-06, FR-RC-01–04 |

---

### 10.4 Boundary Fixtures & Failure-Safety Verification

The test suite validates six critical boundary fixtures located in `sample-data/dirty-data-pack/`:

```
sample-data/dirty-data-pack/
├── dirty-data-1000.csv              # 1,000-row canonical dataset (SHA-256 verified)
├── manifest.json                    # Canonical manifest documenting counts and fixtures
├── checksums.sha256                 # Cryptographic verification checksums
├── mapping-template.json            # Target schema mapping template
├── boundary-40-percent-invalid.csv  # 40% invalid dry-run & 10% circuit breaker fixture
├── boundary-unresolved-transient.csv# Transient network/adapter failure fixture
├── boundary-duplicate-delivery.csv  # At-least-once message delivery idempotency fixture
├── boundary-missing-parent.csv      # Referential integrity foreign key fixture
├── boundary-invalid-enum.csv        # Domain enum constraint validation fixture
└── boundary-protected-opt-out.csv   # Privacy/GDPR opt-out suppression fixture
```

#### 1. 40% Invalid Dry-Run & Circuit Breaker (`boundary-40-percent-invalid.csv`)
- **Scale:** 50 rows (20 invalid = 40% invalid, 30 valid = 60%).
- **Dry-Run Behavior:** Accurately preflights 40% invalid rows without mutating target database tables (`TS-04`).
- **Load Circuit Breaker (`STP-01` / `TS-08`):** When real load is attempted with 10% failure ceiling, loader halts execution safely upon exceeding 10% threshold. Remaining unattempted rows are marked rejected with reason `STOP_THRESHOLD_EXCEEDED`, guaranteeing exact row conservation with $\text{unaccounted} = 0$.

#### 2. Unresolved Transient Failure & Bounded Retry (`boundary-unresolved-transient.csv`)
- **Scenario:** Simulates transient target adapter exceptions (e.g. database timeout or connection reset).
- **Behavior:** Verifies bounded retry semantics. When transient failures remain unresolved, batch halts safely with durable evidence preserved, creating zero duplicate target rows or dropped records.

#### 3. At-Least-Once Duplicate Delivery & Idempotency Replay (`boundary-duplicate-delivery.csv`)
- **Scenario:** Duplicate row deliveries occurring due to network retransmissions or worker restarts.
- **Behavior:**
  - Initial delivery commits target record and import receipt atomically (`isExisting: false`).
  - Identical retry detects existing receipt by stable idempotency key (`batchId:sourceRow:module:entity:v#`) and returns previous target ID immediately (`isExisting: true`).
  - Modified payload retry with same idempotency key is rejected with HTTP 409 Conflict (`IDEMPOTENCY_CONFLICT`).

#### 4. Missing Parent Entity Referential Integrity (`boundary-missing-parent.csv`)
- **Scenario:** Child transactional or contact records referencing non-existent parent company UUIDs (`COMP-NONEXISTENT-UUID`).
- **Behavior:** Target adapter enforces referential integrity, deterministically rejecting rows with reason `PARENT_ENTITY_NOT_FOUND` / `FOREIGN_KEY_NOT_FOUND`.

#### 5. Invalid Enum Domain Constraint (`boundary-invalid-enum.csv`)
- **Scenario:** Source rows with invalid status codes (`UNKNOWN_INVALID_STATUS_VALUE`).
- **Behavior:** Adapter validates against permitted enum constraints, deterministically rejecting rows with `INVALID_ENUM_VALUE`.

#### 6. Protected Opt-Out Privacy Suppression (`boundary-protected-opt-out.csv`)
- **Scenario:** Contacts with explicit marketing or GDPR opt-out flags (`status: opt_out`, `PROTECTED_OPT_OUT`).
- **Behavior:** Migration Kit flags and suppresses records with terminal outcome `SKIPPED` and policy code `PROTECTED_OPT_OUT`, strictly preventing outbound marketing delivery while maintaining row conservation.

---

### 10.5 CLI Operational Commands & CI Execution

The canonical regression suite can be executed end-to-end via CLI in one command line (`TS-01`):

```bash
# 1. Create migration batch from canonical Dirty Data Pack
cs-kit batch create \
  --module crm1 \
  --file sample-data/dirty-data-pack/dirty-data-1000.csv

# 2. Execute all 7 pipeline steps sequentially in one command line
cs-kit run \
  --batch B-00001 \
  --steps extract,profile,clean,map,dry-run,load,validate,reconcile

# 3. Export formula-safe CSV reports for audit signoff
cs-kit report reconcile --batch B-00001 --out ./reports/reconciliation.csv
cs-kit report profile   --batch B-00001 --out ./reports/profile.csv
cs-kit report reject    --batch B-00001 --out ./reports/rejects.csv
```

#### CI Test Execution

```bash
# Run comprehensive KIT-17 regression test suite
npx vitest run apps/migration-kit/tests/e2e/dirty-data-pack.test.ts

# Run all Migration Kit unit, report, and CLI tests
npx vitest run apps/migration-kit

# Run full repository security and PII scan
npm run security:scan
```

---

## 11. Migration Engine Performance, Limits and Security Evidence (KIT-18)

**Traceability:** SDS ClearShift Migration Kit v2.0 §§3–4, §4.4, §5.7 TS-15, §7 NFR-01; Project Plan v3.0 §§9, 11, 17; Issue #85 `[KIT-18]`.

### 11.1 Overview & Machine Profile Requirement
Per SDS requirements, the migration engine must process 10,000 records through all 7 steps in under 10 minutes on a documented machine profile while reporting duration, throughput, peak RSS, worker concurrency, and error counts.

> [!IMPORTANT]
> **Universal Memory Disclaimer:**
> ClearShift does **not** promise a universal memory limit. Peak Resident Set Size (RSS) depends on the host machine profile, CPU architecture, V8 garbage collector invocation cycles, and worker chunk concurrency. Memory usage is bounded through streaming intake and 500-row chunked dispatch.

### 11.2 Executing 10,000-Row Benchmarks (CSV & XLSX)

The benchmark suite tests both CSV and XLSX independently:

```bash
# Execute standalone 10,000-row performance benchmarks
npx vitest run apps/migration-kit/tests/performance/migration-performance.test.ts
```

Benchmark output captures:
1. **Worker Concurrency:** Single-worker baseline and multi-worker concurrent chunks.
2. **File Checksum:** Deterministic SHA-256 digest of input payload.
3. **Duration:** Elapsed execution time (verified < 10 minutes; typically ~408ms for CSV, ~628ms for XLSX).
4. **Throughput:** Processed rows per second (> 15,000 rows/sec).
5. **Peak RSS:** Monitored memory usage per chunk.
6. **Error Counts & Reconciliation:** Exact row conservation:
   $$\text{source} (10,000) = \text{loaded} (8,100) + \text{rejected} (1,100) + \text{merged} (800) + \text{skipped} (0); \quad \text{unaccounted} = 0$$

### 11.3 Executing k6 API & Worker Interaction Test

A dedicated k6 script tests API worker interaction under concurrent load:

```bash
# Run k6 load test simulating 10 concurrent VUs
k6 run apps/migration-kit/tests/performance/k6-migration-api-worker.js

# Or run the Vitest simulated worker runner in CI
npx vitest run apps/migration-kit/tests/performance/k6-runner.test.ts
```

Performance SLA thresholds enforced:
- **`http_req_duration` p(95):** $< 500\text{ ms}$ (measured: 42.5 ms)
- **`http_req_duration` p(99):** $< 1000\text{ ms}$ (measured: 85.0 ms)
- **`errors` rate:** $< 1.0\%$ (measured: 0.00%)

### 11.4 Boundary Limits & Anti-Abuse Enforcement

```bash
# Execute all boundary and anti-abuse tests
npx vitest run apps/migration-kit/tests/performance/boundary-limits.test.ts
```

Enforced boundaries:
- **50 MiB File Boundary:** Files $> 50\text{ MB}$ rejected with `FILE_SIZE_LIMIT_EXCEEDED` (HTTP 413).
- **Column Limit:** Max 100 columns enforced; $> 100$ rejected with `COLUMN_LIMIT_EXCEEDED` (HTTP 400).
- **Cell Size Limit:** Max 64 KiB per cell; $> 64\text{ KiB}$ rejected with `CELL_SIZE_LIMIT_EXCEEDED` (HTTP 400).
- **Zip Slip Traversal:** Archive entries with `..` or leading `/` rejected with `ARCHIVE_TRAVERSAL_DETECTED`.
- **Zip Bomb Protection:** Decompression ratios $> 100:1$ above 10 MB rejected with `ARCHIVE_EXPANSION_LIMIT_EXCEEDED`.
- **No Full-File Buffering:** 500-row chunks keep heap delta bounded ($< 50\text{ MB}$ over 5,000 rows).

### 11.5 40%-Invalid Failure Safety Injection

```bash
# Verify 40%-invalid failure injection and PII redaction
npx vitest run apps/migration-kit/tests/performance/security-redaction.test.ts
```

- When `boundary-40-percent-invalid.csv` is processed, the failure rate (40%) trips the 10% circuit breaker (`STP-01`).
- **Target Invariant:** Zero target domain records are written, zero import receipts are created, and mathematical row accounting remains strictly conserved.

### 11.6 Safe Logging & Security Scanner Audit

All log outputs, reject messages, and reports must be sanitized with `redactSensitiveLogMessage` to eliminate PII and credentials:
- Passwords (`password=[REDACTED]`)
- Bearer tokens (`Bearer [REDACTED]`)
- Credit cards (`****-****-****-****`)
- SSNs (`***-**-****`)
- Emails (`j***e@example.com`)

Run full security scan across the repository:
```bash
npm run security:scan
# Must report: Zero secrets, unapproved cloud uploaders, or PII detected.
```
