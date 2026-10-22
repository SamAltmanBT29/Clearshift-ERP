# ADR-003: Hub Golden ID Map & Idempotent Source Identity Service

## Status
**Accepted** (Sprint 1-2 / Gate G2 Baseline)

## Date
2026-10-22

## Context
Entities such as customers, vendors, contacts, and employees are referenced across multiple systems (Salesforce CRM, SAP/QuickBooks ERP, legacy CSV files, and Hub). Customer IDs frequently differ across platforms (e.g., Salesforce `0015g00000XyZ`, SAP `10042`, legacy CSV `"00042"`). An unstable identity mapping or fuzzy duplicate merge can inadvertently attach ledger entries, invoices, and purchase orders to the wrong business customer, causing material financial and compliance violations.

## Decision
Hub Identity provides an authoritative Golden ID mapping service (`apps/hub/src/golden-id/` and `packages/contracts/src/golden-id.ts`) governed by the following architectural invariants:

1. **UUID Primary Keys & Display-Only GIDs:**
   - The authoritative Primary Key for every Golden ID record is a standard UUID (v4/v7).
   - Display values (`GID-<ENTITY_PREFIX>-<HEX>`, e.g., `GID-CUST-A1B2C3D4`) are formatted strictly for human UI presentation.
   - **Non-Negotiable Invariant:** Display GIDs are never used as database primary keys, foreign keys, or API relation identifiers.

2. **Composite Natural Unique Key:**
   - Identity uniqueness is defined by the 3-tuple `(entity_type, source_system, source_id)`.
   - Distinct entity types within the same source system (e.g., `customer:sap:1001` vs `vendor:sap:1001`) reside in isolated namespaces and cannot collide.

3. **Verbatim String Preservation (No Lossy Numeric Coercion):**
   - Source identifiers are stored as arbitrary strings. Leading zeros (e.g., `"00014020"`) and large numeric IDs exceeding JavaScript's 53-bit integer limit (`"9007199254740993"`) are never converted to numbers.

4. **Deterministic Exact Matching Only (No Fuzzy Auto-Merge):**
   - V1 strictly prohibits fuzzy duplicate matching or automatic merging of records.
   - When conflicting secondary evidence is detected (e.g., matching normalized `tax_id`, `email`, or `phone` belonging to a different source key), the engine flags the record as `status: "needs_review"`, documents `review_reason`, links `conflicting_ids`, and requires explicit authorized human approval via the PMO/Admin review workflow before any merge occurs.

5. **Concurrency & Idempotency:**
   - Concurrent upsert calls for the same composite key are guarded with in-flight request deduplication, ensuring that exactly one Golden ID row is committed.
   - Repeated calls with the same key idempotently return the existing Golden ID.

6. **Explicit Not Found Semantics:**
   - Failed lookups return explicit HTTP `404 NOT_FOUND` with standard `AppError` envelopes rather than fallback null mutations.

## Consequences
- **Positive:** Guarantees repeatable, deterministic cross-module identity reconciliation during migration loads. Eliminates split-ledger corruption caused by accidental duplicate merging.
- **Trade-off:** Potential duplicate candidates with slightly mismatched spelling require manual human review rather than automatic heuristic merging. This is an intentional V1 safety constraint.
