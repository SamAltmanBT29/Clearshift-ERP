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

### 6. KIT-14 Operator Workflow (Screens)

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

## 7. CLI Usage (KIT-15)

The CLI shares the same batch engine as the UI. See `docs/runbooks/cli.md` for command reference, flags, and exit codes.
