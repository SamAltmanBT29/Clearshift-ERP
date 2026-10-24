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
