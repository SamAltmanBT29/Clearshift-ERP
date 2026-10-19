# ClearShift V1 30-Issue Standardization Plan

**Document:** `V1_30_ISSUE_STANDARDIZATION_PLAN.md`  
**Product:** ClearShift Migration Kit, ClearShift CRM, and ClearShift ERP  
**Standardization Version:** 1.0  
**Baseline Date:** 17 October 2026  
**Target Milestone:** Gate G4 — V1 Build Complete (End of Week 8 / Sprint 4)  
**Status:** Approved Master Planning Specification (Review & Planning Baseline)  
**Rule:** Planning document only. Do not create, modify, or publish GitHub issues until formally authorized.

---

## 1. Decision

**Decision:** Approve the 30-issue standard as the planning baseline, subject to the corrections in this document. **Do not create GitHub issues yet.** The 30-issue count is a catalog standard, not proof of equal engineering effort. Every issue must describe a distinct, testable outcome; no filler issues may be added solely to reach 30.

The proposed arithmetic is accepted:
- **Ten Business Modules:** 10 modules × 30 issues = 300 issue specifications
- **Platform / Migration Kit (Group 11):** 30 issue specifications
- **PMO / Integration / QA / Release (Workstream 12):** 30 issue specifications
- **Total Catalog Scope:** **360 issue specifications**

The work remains ordered: **ERP-first, then CRM, then shared cross-cutting work**.

### Answers to the Cross-Questioning Items

1. **Role Split:** Accepted as the standard per business module:
   - **Role 1 (Team Lead & Core Backend):** 8 issues
   - **Role 2 (Integration & DevOps):** 7 issues
   - **Role 3 (Frontend & Review UI):** 8 issues
   - **Role 4 (Data Reliability & QA Lead):** 7 issues
   - **Total:** $8 + 7 + 8 + 7 = 30$ issues per module.  
   The ownership boundaries in Sections 5–7 are mandatory so teams do not rebuild shared platform components ten times.
2. **Team 11 (Platform & Migration Kit):** Keep 30 issue slots: `PLT-01`..`PLT-12` plus `KIT-01`..`KIT-18`.  
   *Important Correction:* `KIT-12` cannot deliver a compensating rollback saga as a V1 requirement. The Migration Kit SDS places rollback in V2. Keep the slot/ID, but define its V1 scope as **batch stop (>10% threshold), safe retry, and resumable failure handling without rollback**.
3. **Team 12 (PMO, QA, Integration & Release):** Keep the existing 18 cross-cutting issues (`INT-01`..`06`, `QA-01`..`08`, `REL-01`..`04`) and add `PMO-01`..`PMO-12`, for 30 total. Platform implements shared tooling; PMO enforces, verifies, and reports its use. This separation avoids duplicate Compose, CI, telemetry, and event-relay implementations.
4. **Documentation:** Use this Markdown file as the canonical review source. A PDF companion is provided for structured reading. This is a plan/standardization specification, not a statement that 360 final issue bodies have already been published to GitHub.

---

## 2. Corrections Required Before Issue Creation

### Schedule Correction
- **Draft Assumption:** Entire project is eight weeks.
- **Decision:** The ClearShift program remains **12 weeks / six two-week sprints**. V1 is Weeks 1–8 (Sprints 1–4, Gate G4); V2 is Week 10 (Gate G5); V3 is Week 12 (Gate G6).

### Staffing Correction
- **Draft Assumption:** 12 teams of four engineers.
- **Decision:** The source plan has ten module groups of four (40 people), Group 11 Platform with five people, and PMO with three people: **48 people across 12 delivery workstreams**, not 12 equal four-person teams. Do not silently rewrite the roster.

### V1 Rollback Correction
- **Draft Assumption:** Rollback saga is a V1 issue.
- **Decision:** Rollback/compensation is explicitly V2 in the Migration Kit SDS. V1 must stop safely, preserve ledgers/receipts, bound retries, and never silently lose rows. **Do not implement rollback in a V1 issue.**

### Shared UI Ownership Correction
- **Draft Assumption:** Each module builds its own migration-import and reject-review screens.
- **Decision:** Team 11 owns the generic migration wizard, profile, mapping, duplicate-review, reject, and reconciliation UI. Module Role 3 supplies module route/page UX and metadata/configuration for shared screens; it must not clone the wizard.

### Shared Infrastructure Ownership Correction
- **Draft Assumption:** Every module implements Docker, auth, event relay, and duplicate engine.
- **Decision:** Platform owns common Compose/toolchain, JWT verification, RBAC plugin, outbox relay, UI shell/components, exact-match engine, and telemetry. Module teams register module policies/configuration and emit domain events using shared helpers.

### Reconciliation Equation Correction
- **Draft Assumption:** $\text{Source} = \text{Loaded} + \text{Rejected} + \text{Merged}$ while load reports also include skipped.
- **Decision:** Use one terminal outcome per source row: `loaded`, `rejected`, `merged`, or `skipped`; enforce:
  $$\mathbf{Source = Loaded + Rejected + Merged + Skipped} \quad \text{and} \quad \mathbf{Unaccounted = 0}$$
  Amend any contradictory table/test before issue publication.

### Issue ID Correction
- **Draft Assumption:** The prior 148-issue catalog is the final module issue registry.
- **Decision:** The prior catalog is a draft, not a live issue registry. For this standard, generate module IDs by role block (`01`–`08`, `09`–`15`, `16`–`23`, `24`–`30`) before publishing. If a corresponding live GitHub issue is discovered later, update it in place and preserve its GitHub number; do not create a duplicate.

### Duplicate-Matching Correction
- **Draft Assumption:** Duplicate detection may imply fuzzy matching.
- **Decision:** V1 uses deterministic normalized exact keys and human approval for target-side merge decisions. Fuzzy matching/scoring and merge rollback stay strictly out of V1.

---

## 3. Planning Arithmetic and Capacity Rules

| Workstream | Count |
| :--- | :---: |
| CRM-1..CRM-5 (Five module teams) | 150 |
| ERP-1..ERP-5 (Five module teams) | 150 |
| Group 11 Platform + Migration Kit | 30 |
| PMO / Integration / QA / Release | 30 |
| **Total V1 Catalog Specifications** | **360** |

For ten business modules, each team distributes 30 issues across four roles:
$$8 + 7 + 8 + 7 = 30$$
At four developers per module team, that is 7.5 issue closures per developer over eight V1 weeks, or 0.9375 issues per developer-week on simple arithmetic. It is not exactly one issue per week, and issue count is not story points or person-days.

- **Sizing Policy:** Target **0.5–2 developer-days per issue** for a well-scoped V1 outcome. Larger outcomes must be split or explicitly approved by the PM and Integration Lead; trivial chores must be combined into a meaningful outcome. Never game the count with documentation-only or duplicate issues. If an issue’s independent outcome cannot be reasonably scoped inside that size range, record the exception in the issue body and have the PM approve the 30-count adjustment before publication.
- **Staffing Capacity Context:** The Platform team has five people and PMO has three. Their 30-issue totals are comparable catalogs, not equal staffing capacity; do not compare their issue counts directly with a four-person module group as a productivity metric.

---

## 4. Schedule and Gates

| Sprint | Weeks | Gate | Target Result | Issue Load per Workstream |
| :---: | :---: | :---: | :--- | :---: |
| **S1** | 1–2 | **G1 Design** | Approved contracts, schemas/ERDs, module data dictionaries, mock APIs, working monorepo/CI, fixture plans, architecture decisions recorded | **8** |
| **S2** | 3–4 | **G2 Extract/Profile** | List/read paths, extract/profile pipeline, module Dirty Data Packs, expected profile counts, baseline screens | **8** |
| **S3** | 5–6 | **G3 Clean/Map** | Mutation/domain rules, cleaning, mapping config, create/edit UI, adapter implementation, automated tests growing | **7** |
| **S4** | 7–8 | **G4 V1 Build Complete** | Safe dry-run/load, validation, exact reconciliation, integration/regression proof, no open critical defects, signed evidence | **7** |

The per-workstream target is $8 / 8 / 7 / 7 = 30$. The exact issue-to-sprint allocation is a starting schedule; a dependency may delay an issue, but a team must not bypass its dependency to preserve burndown. S4 excludes V2 rollback and fuzzy matching. V1 still includes manual field mapping/templates and exact duplicate review where required by the Migration Kit SDS.

---

## 5. Immutable Technical Baseline

- **Monorepo & Toolchain:** Node.js 24 LTS on a pinned patch; strict TypeScript; pnpm / Turborepo; Fastify 5; Zod / OpenAPI; PostgreSQL 18.6 with Drizzle; Redis Open Source 8.10.1; BullMQ for batch workers; Redis Streams for event delivery; transactional outbox in PostgreSQL.
- **Frontend Architecture:** React + TypeScript + Vite, shared accessible component library and design tokens. No per-team design system forks.
- **Testing Frameworks:** Vitest for unit/domain, Fastify injection for API tests, React Testing Library for components, Playwright for browser journeys, k6 for performance evidence. No live external service in automated tests.
- **Source Intake V1:** CSV (comma or semicolon, UTF-8) and XLSX first sheet, maximum 50 MB. Stream parsing; no unbounded buffering. No source database connector and no cloud file upload in V1.
- **Load Execution:** Batches of 500 rows; continue after row-level failures but **stop the run when failures exceed 10% of attempted rows**. Stable idempotency key = `batch ID + source row + target entity/schema version`; retries may not mint a new key to force a duplicate write.
- **Dry-Run Guarantee:** Dry run must not mutate target business rows or target import receipts. For an actual row write, the target row and its import receipt commit in one local PostgreSQL transaction.
- **Scope Boundary:** V1 contains exact duplicate detection, a human review path where defined, manual mapping templates, dry run, load, validation, and reconciliation. V1 does **not** contain fuzzy matching, rollback saga, old-database connectors, outbound marketing delivery, or real customer/employee data.

---

## 6. Ownership Contract — Avoid Duplicate Implementation

1. **Toolchain and CI:**
   - *Owner:* Platform (`PLT-*`). Platform owns the root Compose stack, workflow templates, toolchain, migrations, and shared scripts. Module teams add module configuration and tests. PMO enforces required checks and records gate evidence; it does not create a second pipeline.
2. **Identity and Authorization:**
   - *Owner:* Platform (`PLT-05/06`). Module Role 2 declares the module capability matrix and applies the shared guard. PMO verifies positive and negative role cases across modules.
3. **Event Transport and Telemetry:**
   - *Owner:* Platform (`PLT-09/11`). Module Role 1 writes domain outbox events through the shared helper. PMO verifies delivery, lag, replay, and integration evidence; it does not implement a second relay.
4. **Generic Migration Kit Pipeline and Screens:**
   - *Owner:* Migration Kit (`KIT-*`). It owns intake, profile, clean, mapping, exact duplicate review, reject, and reconciliation screens. Modules provide field registries, rule configuration, target adapters, reasons, and allowlisted fields.
5. **Domain Schema, API, and Screen:**
   - *Owner:* Each business module. The team owns its domain schema/API, invariants, domain screens, and module adapter integration. Common layout and shared widgets remain platform-owned.
6. **Exact Duplicate Engine:**
   - *Owner:* Shared Migration Kit / core. Modules declare key(s), normalization, expected matches, and human-review requirements. No module team ships a separate fuzzy engine in V1.
7. **Cross-Module Relationships and Waves:**
   - *Owner:* Hub / Integration Lead defines Golden ID and dependency contracts; PMO owns gate tracking. Modules expose/read the owning module’s records and pass valid references.
8. **Global QA and Release Sign-Off:**
   - *Owner:* QA / PMO (`QA-*`, `REL-*`). Every module supplies its own test matrix, fixture, test results, and reconciliation proof. PMO consolidates evidence and makes the GO/NO-GO decision.

---

## 7. Standard 30-Issue Blueprint for Each Business Module

Apply the following 30 issue slots independently to each of `CRM1`, `CRM2`, `CRM3`, `CRM4`, `CRM5`, `ERP1`, `ERP2`, `ERP3`, `ERP4`, and `ERP5`. Prefix each slot with the module ID (e.g., `ERP4-06` is Role 1’s domain-invariant issue for Finance and Accounting).

### Role 1 — Team Lead & Core Backend Developer (8 Issues)

- **`01. Schema contract and guarded database migration (Sprint 1)`**  
  *Owner:* Role 1 | *Target:* Sprint 1  
  *Scope:* Define module-owned tables, UUID primary keys, types, indexes, constraints, foreign keys, and forward-only Drizzle migration. Role 4 reviews data dictionary/ERD; Role 1 owns implementation.  
  *Acceptance:* Fresh database migration succeeds; a second run is safe; required unique/check/FK constraints are enforced by PostgreSQL; rollback of schema migrations is not assumed.
- **`02. Repository/query layer and deterministic factories (Sprint 1)`**  
  *Owner:* Role 1 | *Target:* Sprint 1  
  *Scope:* Implement type-safe Drizzle query functions, transaction boundaries, and deterministic test factories for module-owned entities.  
  *Acceptance:* Queries are parameterized; list/detail paths have no unbounded scans; factories produce repeatable fixtures; repository tests cover missing IDs and constraint failures.
- **`03. List/search API with bounded pagination (Sprint 2)`**  
  *Owner:* Role 1 | *Target:* Sprint 2  
  *Scope:* Implement collection endpoint and OpenAPI/Zod contract. Defaults: `page=1, pageSize=25`; `pageSize` range 1..100; allowlisted sort fields; deterministic ID tie-breaker.  
  *Acceptance:* Valid requests return stable data and meta; bad pagination/sort is 400; maximum page size is enforced; search is parameterized and tested.
- **`04. Detail/read API and linked-record projection (Sprint 2)`**  
  *Owner:* Role 1 | *Target:* Sprint 2  
  *Scope:* Implement GET-by-ID and read-only linked-record projections owned by other modules through their APIs or approved projections.  
  *Acceptance:* Existing records return 200; absent records return standard 404 envelope; cross-module data is not written or treated as locally owned.
- **`05. Create/update API with strict validation (Sprint 3)`**  
  *Owner:* Role 1 | *Target:* Sprint 3  
  *Scope:* Implement create/update mutations with Zod validation, domain service layer, safe transaction boundaries, and deterministic error codes.  
  *Acceptance:* Valid changes persist once; invalid fields return 400 with field-level errors; constraint conflicts return documented conflict status; no secrets appear in responses.
- **`06. Domain invariants and state transitions (Sprint 3)`**  
  *Owner:* Role 1 | *Target:* Sprint 3  
  *Scope:* Implement explicit valid states, transition matrix, computed values, and rejection messages for the module.  
  *Acceptance:* Every legal transition has a positive test; every illegal transition is rejected without partial mutation; computed fields are calculated server-side.
- **`07. Cross-module relational integrity and ownership boundaries (Sprint 4)`**  
  *Owner:* Role 1 | *Target:* Sprint 4  
  *Scope:* Implement/verify foreign-key existence and API-level ownership boundaries; consume master data through owning module rather than duplicating mutable master rows.  
  *Acceptance:* Missing/invalid references cannot be loaded; owning-module values are not mutated by consumers; integration tests cover each declared relationship.
- **`08. Domain audit and outbox event production (Sprint 4)`**  
  *Owner:* Role 1 | *Target:* Sprint 4  
  *Scope:* Emit required module domain events through shared transactional outbox helper and record actor/action audit data for material changes.  
  *Acceptance:* Domain mutation and outbox row commit atomically; event includes `event_id, event_type, schema_version, occurred_at, correlation_id`, and entity reference; duplicate event delivery is safe.

### Role 2 — Integration & DevOps Engineer (7 Issues)

- **`09. Module service/configuration registration (Sprint 1)`**  
  *Owner:* Role 2 | *Target:* Sprint 1  
  *Scope:* Register module routes, environment schema, readiness dependencies, and service configuration with shared application bootstrap. Do not create a second Compose stack.  
  *Acceptance:* Missing required configuration fails at startup with a safe message; readiness reports DB/required dependency state; module starts using shared local environment.
- **`10. Module raw/staging/clean field contract (Sprint 1)`**  
  *Owner:* Role 2 | *Target:* Sprint 1  
  *Scope:* Define module target field registry, raw JSON/source-row metadata, staging status, clean target projection, and batch/source-row traceability using shared Kit tables.  
  *Acceptance:* Every raw row retains `batch_id/source_row` and immutable original payload; staging records expose field-level errors; no dynamic CSV column becomes an unsafe SQL identifier.
- **`11. Module target adapter and durable import receipt (Sprint 2)`**  
  *Owner:* Role 2 | *Target:* Sprint 2  
  *Scope:* Implement module-specific Migration Kit target adapter over shared adapter interface; persist stable import receipts in same target transaction as each row mutation.  
  *Acceptance:* Retrying same batch/source row with same idempotency key cannot create second record; receipt maps source identity to target ID; conflict response is deterministic.
- **`12. Exact duplicate key policy for the module (Sprint 3)`**  
  *Owner:* Role 2 | *Target:* Sprint 3  
  *Scope:* Declare keys and normalization rules the shared exact-duplicate engine should apply. No module creates a separate fuzzy matching engine.  
  *Acceptance:* Exact matches are classified consistently; uncertain candidates are never automatically merged; key normalization and expected duplicate counts are covered by fixtures.
- **`13. Idempotent retry and partial-load stop behavior (Sprint 4)`**  
  *Owner:* Role 2 | *Target:* Sprint 4  
  *Scope:* Wire module adapter to bounded retries and V1 safety threshold. Stop batch immediately after completed batch reports failures greater than 10% of attempted rows; preserve all outcomes and resume only with same batch identity.  
  *Acceptance:* Transient failure can be retried without duplicate writes; >10% threshold stops subsequent writes; target receipts and outcome ledger agree; no V1 rollback/saga is introduced.
- **`14. OpenAPI, event and mock contract package (Sprint 1)`**  
  *Owner:* Role 2 | *Target:* Sprint 1  
  *Scope:* Publish complete module OpenAPI contract, event schemas, and deterministic mock data needed by dependent groups before implementation integration.  
  *Acceptance:* Integration Lead approves contract at G1; mock supports every required V1 endpoint; breaking changes require approved versioned change record.
- **`15. Module authorization policy integration (Sprint 2)`**  
  *Owner:* Role 2 | *Target:* Sprint 2  
  *Scope:* Declare module capability matrix and apply shared JWT/RBAC plugin to every route and action. Authentication itself remains platform-owned.  
  *Acceptance:* Viewer/Editor/Migration Runner/Analyst/Admin access matches approved matrix; unauthenticated requests are 401; forbidden operations are 403; object-level checks prevent ID-based access bypass.

### Role 3 — Frontend & Review Screen Engineer (8 Issues)

- **`16. Module route/page registration using the shared shell (Sprint 1)`**  
  *Owner:* Role 3 | *Target:* Sprint 1  
  *Scope:* Register module navigation, route guards, page titles, and breadcrumb/active-state behavior in common UI shell. Do not implement global tokens or shell again.  
  *Acceptance:* Module is reachable from agreed navigation; deep links work; route permission is enforced; keyboard focus and page heading are correct.
- **`17. Main paginated data table (Sprint 2)`**  
  *Owner:* Role 3 | *Target:* Sprint 2  
  *Scope:* Build module table using shared components with server-backed pagination and stable columns.  
  *Acceptance:* Table mirrors API paging/sorting; empty/loading/error states are delegated to shared state components; row actions are permission-aware; table does not load all records into memory.
- **`18. Search, filters and sorting controls (Sprint 2)`**  
  *Owner:* Role 3 | *Target:* Sprint 2  
  *Scope:* Provide supported query, filter, and sort controls mapped to OpenAPI allowlist.  
  *Acceptance:* Each control updates query state predictably; clear-all restores defaults; invalid sort/filter values are not sent; state works with keyboard and screen reader labels.
- **`19. Loading, empty, error and access-denied states (Sprint 1)`**  
  *Owner:* Role 3 | *Target:* Sprint 1  
  *Scope:* Integrate standard shared skeleton, empty-state CTA, retryable error banner, and forbidden state.  
  *Acceptance:* All four states are reachable in tests; errors never show stack traces/raw SQL; retry does not double-submit a mutation.
- **`20. Create form with field-level validation (Sprint 3)`**  
  *Owner:* Role 3 | *Target:* Sprint 3  
  *Scope:* Implement create form using React Hook Form and Zod/client schemas derived from API contract. Server remains authoritative.  
  *Acceptance:* Required fields and field formats are visible; API validation errors map to fields; double-click/submission races do not create duplicate records; success redirects/shows confirmation.
- **`21. Detail/edit workflow and linked records (Sprint 3)`**  
  *Owner:* Role 3 | *Target:* Sprint 3  
  *Scope:* Implement detail view, editable fields, and approved linked-record panels. History is read-only and shown only when supported by audit data.  
  *Acceptance:* Users cannot edit fields they lack permission to change; stale-update conflicts are explained; linked records navigate to their owning module.
- **`22. Module metadata integration with the shared Migration Kit wizard (Sprint 4)`**  
  *Owner:* Role 3 | *Target:* Sprint 4  
  *Scope:* Supply target field labels/types/required flags/enums and module-specific validation descriptions to shared import/mapping wizard. Do not create a second wizard.  
  *Acceptance:* Generic wizard displays module’s valid target fields; required unmapped fields block dry-run/load; templates cannot silently bind to incompatible schema versions.
- **`23. Module context in shared rejection/review/export screens (Sprint 4)`**  
  *Owner:* Role 3 | *Target:* Sprint 4  
  *Scope:* Configure module-specific reject labels, allowed display columns, and links from rejected row to module context. Shared Kit owns common review/export screen.  
  *Acceptance:* Reason text is understandable; sensitive fields are masked/omitted; CSV is formula-safe; export includes only allowlisted columns; view permission is enforced.

### Role 4 — Data Reliability & QA Lead (7 Issues)

- **`24. Data dictionary, ERD, traceability and Dirty Data Pack plan (Sprint 1)`**  
  *Owner:* Role 4 | *Target:* Sprint 1  
  *Scope:* Publish field-level meanings/nullability/examples, relationship diagram, module requirement/test matrix, and fixture-generation plan. Role 4 owns design evidence; Role 1 signs off implementation schema.  
  *Acceptance:* Every field has type, required/optional status, validation rule, and example; relationships and master-data owners are documented; all V1 requirements map to tests; fixture plan specifies expected defect counts.
- **`25. Canonical module Dirty Data Pack (Sprint 2)`**  
  *Owner:* Role 4 | *Target:* Sprint 2  
  *Scope:* Build at least 100 synthetic rows for module with manifest of expected valid/invalid/duplicate/relationship outcomes; shared integration pack remains 1,000 rows.  
  *Acceptance:* No real personal data; seeded defects are labelled by stable `source_row`; counts reproduce across runs; UTF-8, null, whitespace, malformed format, duplicate, and referential cases are included where relevant.
- **`26. Profiling configuration and expected-result assertions (Sprint 2)`**  
  *Owner:* Role 4 | *Target:* Sprint 2  
  *Scope:* Configure shared profiler for module fields and check column empties, invalid formats, common values, and exact duplicate keys.  
  *Acceptance:* Profile never changes source data; expected counts match Dirty Data Pack manifest; report is exportable and tests assert counts, not visual guesses.
- **`27. Cleaning/normalization rules and field-level audit (Sprint 3)`**  
  *Owner:* Role 4 | *Target:* Sprint 3  
  *Scope:* Configure only approved V1 rules from shared cleaning registry and assert before/after values and rule IDs.  
  *Acceptance:* Each changed value records source row, field, old/new value, and rule ID; required-field failures reject with reason; optional unfixable values are flagged, not silently discarded.
- **`28. Mapping/value translation configuration (Sprint 3)`**  
  *Owner:* Role 4 | *Target:* Sprint 3  
  *Scope:* Define source-to-target field mappings, enum translations, date/phone formats, and required-target guards for module.  
  *Acceptance:* Mapping templates are named/versioned; unmapped required target fields block load; unknown enum values become visible validation failures; mapping does not modify raw rows.
- **`29. Module contract, regression and browser test suite (Sprint 4)`**  
  *Owner:* Role 4 | *Target:* Sprint 4  
  *Scope:* Deliver automated unit/domain tests, API contract tests, and critical browser workflow tests with group.  
  *Acceptance:* All tests run in CI; all module Must requirements have at least one linked test; unit suite is green; core logic coverage is at least 60%; no test depends on live external services.
- **`30. Module reconciliation proof and G4 evidence pack (Sprint 4)`**  
  *Owner:* Role 4 | *Target:* Sprint 4  
  *Scope:* Prove row accounting, link integrity, target write counts, and test evidence for module; submit signed module gate checklist.  
  *Acceptance:* Every source row has exactly one terminal outcome; equation balances exactly; no unaccounted rows; no open critical defects; test report, fixture manifest, API contract, and demo evidence are attached.

### Required Issue Allocation by Sprint (Each Business Module)

| Sprint | Issue Slots Assigned | Total Issues |
| :---: | :--- | :---: |
| **S1** | `01, 02, 09, 10, 14, 16, 19, 24` | **8** |
| **S2** | `03, 04, 11, 15, 17, 18, 25, 26` | **8** |
| **S3** | `05, 06, 12, 20, 21, 27, 28` | **7** |
| **S4** | `07, 08, 13, 22, 23, 29, 30` | **7** |

---

## 8. Module-Specific Overlays for the 300 Business-Module Issues

### CRM-1 / Group 1 — Contacts, Companies and Leads
- **Owned Entities:** Contacts, companies, leads, source-to-Golden-ID links.
- **Non-Negotiable Rules:** Normalized email exact key; normalized phone + normalized name as exact combined key; company tax number exact key; potential ambiguous matches are human-reviewed, never fuzzy auto-merged. Lead status transitions use CRM SDS allowlist.
- **Dependencies:** CRM-2 deals/quotes; CRM-3 tickets; CRM-4 consent/list membership; ERP-3 order customer references.
- **Required Fixture Cases:** Fake contact/company/lead data; duplicate emails; same phone/name; missing required name; malformed email/phone; company tax-number variants; orphan lead links; UTF-8 names.

### CRM-2 / Group 2 — Deals, Pipeline and Quotes
- **Owned Entities:** Deals, pipeline stages, quotes, and quote lines.
- **Non-Negotiable Rules:** Every deal links to an existing CRM-1 contact/company; stages follow declared lifecycle; quote totals are server-computed with decimal arithmetic; product and price references come from ERP-1 API; Won event uses approved event schema.
- **Dependencies:** CRM-1 contacts/companies; ERP-1 products/prices; ERP-3 order creation via approved event/contract.
- **Required Fixture Cases:** Invalid contact/product references; unknown stages; decimal rounding; negative quantity; stale price snapshots; duplicate deal keys; Won transition retry.

### CRM-3 / Group 3 — Support Tickets and Activities
- **Owned Entities:** Support tickets, activities, and contact links.
- **Non-Negotiable Rules:** Each ticket links to a valid CRM-1 contact/company; status transitions follow documented ticket lifecycle; activity timestamps use declared formats; V1 records history but does not send email/SMS.
- **Dependencies:** CRM-1 contacts/companies; ERP-3 order/invoice status read projection where specified.
- **Required Fixture Cases:** Orphan contact; unknown priority/status; malformed timestamp; empty required subject; duplicate external key; safely escaped customer-visible text.

### CRM-4 / Group 4 — Marketing Lists and Campaign History
- **Owned Entities:** Lists, membership, campaign history, and consent state.
- **Non-Negotiable Rules:** Opt-out/unsubscribe is monotonic for migration: import/update may not overwrite a known no-consent with consent; campaigns are recorded only; no outbound email/SMS is sent; consent source/time is retained where provided.
- **Dependencies:** CRM-1 contacts; CRM-5 migration events/reporting.
- **Required Fixture Cases:** Opted-out plus opted-in duplicate rows; absent consent source; invalid timestamps; duplicate memberships; campaign rows without contact; formula-injection strings.

### CRM-5 / Group 5 — Migration Control Center and Reports
- **Owned Entities:** Batch event projections, quality scores, rejects, run summaries, and reports.
- **Non-Negotiable Rules:** Dashboard reads approved event/outcome projections; it is not a second batch engine; counts reconcile with source ledger; consumers are idempotent and can replay retained events.
- **Dependencies:** KIT events; PLT Hub/outbox; all CRM/ERP modules; PMO evidence.
- **Required Fixture Cases:** Duplicate/out-of-order events; delayed consumer; reconciliation failure; missing batch event; sensitive row payload must not be copied into dashboard/event logs.

### ERP-1 / Group 6 — Products and Inventory
- **Owned Entities:** Products, categories, one warehouse, stock levels.
- **Non-Negotiable Rules:** SKU is unique after documented normalization; units are from fixed V1 unit list; price/tax use decimal types; stock may not become negative; import never changes raw source values.
- **Dependencies:** ERP-2 purchase lines; ERP-3 order/invoice lines; CRM-2 quote product/price reads.
- **Required Fixture Cases:** Duplicate SKU; invalid unit; negative opening stock; decimal precision; missing category; malformed price/tax; repeated import must not duplicate opening stock.

### ERP-2 / Group 7 — Vendors and Purchasing
- **Owned Entities:** Vendors, purchase orders, and purchase-order lines.
- **Non-Negotiable Rules:** Vendor master is owned here; PO status transitions are explicit; each PO line references an existing ERP-1 product; total is computed from decimal line values with documented rounding; bank details are masked server-side and excluded from logs/exports.
- **Dependencies:** ERP-1 products; ERP-4 vendor bills/accounting references.
- **Required Fixture Cases:** Duplicate tax ID; invalid email; missing vendor; invalid PO transition; line total mismatch; import retry; bank-detail leakage negative test.

### ERP-3 / Group 8 — Sales Orders and Invoices
- **Owned Entities:** Sales orders, order lines, invoices, and invoice lines/status.
- **Non-Negotiable Rules:** Customer reference resolves through CRM-1/Golden ID mapping; products resolve through ERP-1; totals are computed, not trusted from raw source; due date is mandatory for overdue calculation; one exact decimal rounding rule applies; required dependencies must exist before posting.
- **Dependencies:** CRM-1 customers; CRM-2 Deal Won where used; ERP-1 products/prices; ERP-4 accounting/payment postings; CRM-3 status projection.
- **Required Fixture Cases:** Orphan customer/product; duplicate order/invoice numbers; invalid due date; paid/overdue conflict; decimal precision; partial line load; mismatched invoice total.

### ERP-4 / Group 9 — Finance and Accounting
- **Owned Entities:** Chart of accounts, journal entries, journal lines, financial reports.
- **Non-Negotiable Rules:** Every posted journal is balanced at currency precision; posting is atomic; concurrent posting cannot double-post; invalid/unbalanced journals are rejected with a reason; decimal arithmetic only; no live banking/tax filing in V1.
- **Dependencies:** ERP-2 vendor bills; ERP-3 invoices/payments; ERP-5 payroll totals; CRM-5 report projections where specified.
- **Required Fixture Cases:** Unbalanced journal; duplicate external journal ID; concurrent post retry; unknown account; currency precision; missing source reference; journal line count mismatch.

### ERP-5 / Group 10 — HR and Employees
- **Owned Entities:** Employees, departments, leave, and user list/roles.
- **Non-Negotiable Rules:** Employee identifiers are unique under declared key; department/user-role references exist; sensitive fields follow field-level authorization; bank and government ID values are never available via normal list/detail/export APIs, even to Admin; fake data only.
- **Dependencies:** ERP-4 payroll totals only; shared platform identity/RBAC.
- **Required Fixture Cases:** Duplicate employee number; missing department; invalid leave dates; unauthorized salary/PII access; bank/Government ID leakage; sensitive values in logs/CSV.

---

## 9. Team 11 — Platform and Migration Kit (30 Issues)

- **`PLT-01 - Monorepo bootstrap and pinned toolchain (Sprint 1)`**  
  *Acceptance:* One reproducible install/build/test command; Node/TypeScript/pnpm versions are pinned; strict typecheck passes.
- **`PLT-02 - CI gates, local Compose environment and controlled DB migrations (Sprint 1)`**  
  *Acceptance:* Clean checkout starts PostgreSQL and Redis healthily; migrations and CI lint/format/typecheck/unit tests run deterministically.
- **`PLT-03 - Database ownership, Drizzle schema registry and transaction helpers (Sprint 1)`**  
  *Acceptance:* Module-owned schemas are registered without collisions; shared transaction helpers and migration ordering are tested.
- **`PLT-04 - Shared Zod/OpenAPI API contract and error envelope (Sprint 1)`**  
  *Acceptance:* Generated/validated OpenAPI matches routes; standard error envelope and validation errors are contract-tested.
- **`PLT-05 - Hub Identity JWT verification and session safety (Sprint 1)`**  
  *Acceptance:* Signature, issuer, audience, expiry, and missing/invalid token paths tested; no sensitive token logged.
- **`PLT-06 - Central role and field-level authorization matrix (Sprint 2)`**  
  *Acceptance:* Viewer/Editor/Migration Runner/Analyst/Admin matrix is versioned and tested against route-level policy hooks.
- **`PLT-07 - Golden ID map and idempotent source identity service (Sprint 2)`**  
  *Acceptance:* Source-system/source-ID mapping is unique and replay-safe; a possible match never auto-merges without explicit approved policy.
- **`PLT-08 - Shared UI component library and accessible design tokens (Sprint 1)`**  
  *Acceptance:* Shared shell, table, input, skeleton, empty/error state, and modal have component tests and keyboard-accessibility evidence.
- **`PLT-09 - Transactional outbox, Redis Streams relay and consumer recovery (Sprint 2)`**  
  *Acceptance:* Outbox commits with domain mutation; relay retries safely; consumers deduplicate by `event_id`; replay/lag/runbook are tested.
- **`PLT-10 - Append-only audit trail and sensitive-data-safe logs (Sprint 2)`**  
  *Acceptance:* Material changes are attributable; protected fields are redacted; audit rows cannot be updated/deleted by normal app roles.
- **`PLT-11 - Health, structured logs, correlation IDs and metrics (Sprint 2)`**  
  *Acceptance:* Health/readiness endpoints distinguish dependency failure; request/batch/event correlation is end-to-end; core queue/stream lag is measurable.
- **`PLT-12 - Security baseline, secrets, dependency and export protections (Sprint 2)`**  
  *Acceptance:* Secrets are env-injected, dependency scan runs, exports are formula-safe, and no source row/PII is emitted in application logs.
- **`KIT-01 - Batch registry, state machine and immutable step ledger (Sprint 1)`**  
  *Acceptance:* Only declared state transitions are allowed; each step records input/output counts, timing, and safe error code.
- **`KIT-02 - Streamed source upload, parser limits and raw immutability (Sprint 1)`**  
  *Acceptance:* CSV/XLSX up to 50 MB parses without whole-file buffering; malformed file fails safely; raw source payload remains unchanged.
- **`KIT-03 - Column profiling, known-problem report and stable profile export (Sprint 2)`**  
  *Acceptance:* Empty/invalid/top-values/exact-duplicate counts match deterministic fixtures; profile is read-only; CSV export is formula-safe.
- **`KIT-04 - V1 cleaning rule registry and per-field audit log (Sprint 2)`**  
  *Acceptance:* Only approved 12 V1 rules run; every change records old/new/rule ID; required invalid fields reject and optional fields follow declared policy.
- **`KIT-05 - Field mapping, value-conversion templates and required-target enforcement (Sprint 3)`**  
  *Acceptance:* Manual mapping and named saved template work; missing required target mapping blocks dry run/load; incompatible template version is rejected.
- **`KIT-06 - Shared target validation and post-load integrity engine (Sprint 3)`**  
  *Acceptance:* Required-field, format, enum, relationship, and domain validators run consistently; each failure is linked to source row and rule ID.
- **`KIT-07 - Dry-run planner with strict no-target-mutation guarantee (Sprint 3)`**  
  *Acceptance:* Before/after target rows and receipts are byte/count-equivalent after dry run; report predicts load outcomes and threshold behavior.
- **`KIT-08 - Generic target adapter, stable idempotency and import receipts (Sprint 3)`**  
  *Acceptance:* Stable batch/source-row/target-version key; target row and receipt commit atomically; retries do not create duplicates.
- **`KIT-09 - Terminal outcome ledger and mathematically exact reconciliation (Sprint 4)`**  
  *Acceptance:* One terminal outcome per parsed row; `source = loaded + rejected + merged + skipped; unaccounted = 0` or batch is NOT OK.
- **`KIT-10 - Exact duplicate candidate review and audited merge decisions (Sprint 3)`**  
  *Acceptance:* V1 matching is exact after documented normalization; target-side duplicate choices require an authorized human; audit stores actor/time/IDs.
- **`KIT-11 - BullMQ worker execution, bounded retries and partial-load recovery (Sprint 2/3)`**  
  *Acceptance:* Worker concurrency is configurable; retries are bounded/backed off; retry preserves idempotency; worker failure does not silently drop batch.
- **`KIT-12 - V1 batch safety: stop threshold, retry guard and resumable failed-run state (Sprint 4)`**  
  *Acceptance:* When row failures exceed 10%, new writes stop; completed row receipts/outcomes survive; resume uses same batch/idempotency keys; no rollback endpoint or compensating saga exists in V1.
- **`KIT-13 - Transactional event envelope, batch event contracts and CRM-5 projections (Sprint 3)`**  
  *Acceptance:* Events use versioned envelope and stable `event_id`; batch counts/status are derived from ledger; duplicate delivery does not inflate CRM-5 counts.
- **`KIT-14 - Generic Migration Kit screens and safe operator workflow (Sprint 4)`**  
  *Acceptance:* Batch wizard, profile, rules, mapping, duplicate review, results, rejects, and reconciliation use shared components; permission and state transitions are enforced.
- **`KIT-15 - CLI commands sharing the same batch engine (Sprint 4)`**  
  *Acceptance:* Documented create/run/report commands call same service layer as UI; flags are validated; exit codes distinguish pass, validation failure, and system failure.
- **`KIT-16 - Reject, profiling and reconciliation reports with formula-safe CSV (Sprint 4)`**  
  *Acceptance:* Exports contain allowed columns, safe cell prefixes, counts, and source-row references; protected values are masked/omitted; report numbers match ledger.
- **`KIT-17 - Canonical Dirty Data Pack and deterministic seven-step regression suite (Sprint 4)`**  
  *Acceptance:* 1,000-row shared pack includes known 80 duplicates, 60 bad formats, and 50 empty required fields; repeated runs reproduce expected counts and final equation.
- **`KIT-18 - Migration engine performance, limits and security evidence (Sprint 4)`**  
  *Acceptance:* 50 MB input test stays within documented memory ceiling; no raw rows in logs; parser boundary tests, k6 run profile, and measured results are attached.

> **Scope correction for KIT-12:** The former draft title “resumable compensating-saga rollback” is rejected for V1 because the Migration Kit SDS explicitly places rollback in V2. Rollback requires a separate V2 scope/gate decision. V1’s recovery means preserving the ledger/receipts and restarting safely, not undoing committed business changes.

---

## 10. Team 12 — Integration, QA, PMO and Release (30 Issues)

- **`INT-01 - Freeze cross-module API contracts and change approval (Sprint 1)`**  
  *Acceptance:* G1 contains approved OpenAPI files, versioned event schemas, sample payloads, and mock fixtures for every cross-module dependency; changes require reviewed change record.
- **`INT-02 - Enforce master-data ownership and cross-module read boundaries (Sprint 1)`**  
  *Acceptance:* Ownership matrix is machine-readable; consumers read CRM-1 customers, ERP-1 products/prices, ERP-2 vendors, ERP-4 chart of accounts, and ERP-5 staff through approved APIs/projections only.
- **`INT-03 - Define V1 migration waves and dependency preflight rules (Sprint 2)`**  
  *Acceptance:* Wave plan is explicit; a dependent batch cannot load until its master-data prerequisites are validated; blocked dependencies return deterministic errors.
- **`INT-04 - Golden ID and contact/product/vendor relationship integration tests (Sprint 2)`**  
  *Acceptance:* Cross-module source identities resolve deterministically; foreign references exist before load; exact duplicate and human-review cases are tested.
- **`INT-05 - Verify outbox event wiring from modules to Hub and CRM-5 (Sprint 3)`**  
  *Acceptance:* Each module emits only approved events through shared outbox; relay retries and consumer dedup are tested; projection count equals ledger count.
- **`INT-06 - Cross-system V1 end-to-end demo and partial-failure recovery (Sprint 4)`**  
  *Acceptance:* A synthetic scenario crosses CRM and ERP relationships, injects a row-level failure, and proves safe restart/no duplicate writes plus exact reconciliation.
- **`QA-01 - V1 test strategy, requirement traceability and test-data policy (Sprint 1)`**  
  *Acceptance:* All Must requirements map to at least one test; test levels and defect severity policy are documented; no real personal data is permitted.
- **`QA-02 - API security, schema and contract conformance suite (Sprint 1/2)`**  
  *Acceptance:* All OpenAPI contracts validate in CI; unauthorized/forbidden/invalid-payload cases are tested; module mocks match versioned contracts.
- **`QA-03 - Integrated V1 end-to-end acceptance suite (Sprint 2/3)`**  
  *Acceptance:* Automated journey covers create/edit, file upload, seven pipeline steps, rejects, reports, and module-linked integrity using synthetic fixtures.
- **`QA-04 - Failure injection, retry, replay and V1 stop-threshold campaign (Sprint 3)`**  
  *Acceptance:* Inject DB disconnect/worker crash/event duplicate/row failures; confirm bounded retries, >10% stop threshold, durable evidence, and no duplicate targets. Rollback tests are explicitly V2 and excluded.
- **`QA-05 - Privacy, authorization, CSV/XSS/SQL injection and secret scans (Sprint 3)`**  
  *Acceptance:* Positive/negative role tests pass; logs/export/UI do not expose restricted fields; formula injection, XSS, SQL injection, and secret scanning findings are triaged.
- **`QA-06 - Performance tests with reproducible machine profile (Sprint 4)`**  
  *Acceptance:* k6 scripts, concurrency, row counts, environment, and raw results are attached; performance is compared against thresholds approved at G1; no unsupported scale claims.
- **`QA-07 - Peer testing, regression triage and defect severity policy (Sprint 3)`**  
  *Acceptance:* Each module receives peer review by another group; every defect has severity, reproduction, and owner; no open critical defect at G4.
- **`QA-08 - Acceptance evidence archive and Gate G4 sign-off pack (Sprint 4)`**  
  *Acceptance:* CI links, test results, coverage, dirty-pack counts, security scans, reconciliation reports, demo evidence, and outstanding-risk disposition are archived.
- **`REL-01 - Complete module README, data dictionary and reproducible local setup (Sprint 1/4)`**  
  *Acceptance:* A clean developer can install, configure, migrate, seed, test, and start the module from written steps; all required env vars are documented without secrets.
- **`REL-02 - Freeze synthetic demo dataset and repeatable reset/seed process (Sprint 2)`**  
  *Acceptance:* Shared 1,000-row dataset and each module’s 100+ row pack are reproducible; seed reset is repeatable and refuses non-test database targets.
- **`REL-03 - Final security, dependency and privacy release review (Sprint 4)`**  
  *Acceptance:* Human reviewer signs security checklist; Critical/High findings have documented disposition and no prohibited data remains in fixtures, logs, or exports.
- **`REL-04 - Gate G4 V1 release decision and demo rehearsal (Sprint 4)`**  
  *Acceptance:* Go/no-go checklist is signed; all 30 issues for each workstream are closed with evidence; no critical defect; V1 demo succeeds from clean environment.
- **`PMO-01 - Compose startup-order and service-network smoke acceptance (Sprint 2)`**  
  *Acceptance:* PMO runs Platform-owned Compose stack from clean checkout; every service reaches health state and service-to-service DNS works; no duplicate Compose implementation is created.
- **`PMO-02 - Pull-request policy and branch-protection enforcement (Sprint 1)`**  
  *Acceptance:* Required CI checks cannot be bypassed by ordinary contributors; formatting, lint, typecheck, unit, and contract checks are enforced; emergency bypass requires recorded approval.
- **`PMO-03 - OpenAPI/Prism mock contract CI coverage audit (Sprint 2)`**  
  *Acceptance:* CI produces report listing every module’s spec, mock, and contract tests; missing or stale contract blocks merge; Platform owns validator code, PMO owns policy/evidence.
- **`PMO-04 - Safe automated database reset/migrate/seed verification (Sprint 2)`**  
  *Acceptance:* One documented command resets only test database, runs migrations, and seeds fixtures; safeguards refuse production-like connection strings; repeated runs are deterministic.
- **`PMO-05 - Redis Streams consumer lag and event recovery operations check (Sprint 4)`**  
  *Acceptance:* Dashboard/metrics show consumer lag, failed deliveries, and replay outcome; threshold and escalation owner are documented; event transport implementation remains Platform-owned.
- **`PMO-06 - Gate G1 design scorecard and architecture baseline sign-off (Sprint 1)`**  
  *Acceptance:* Every workstream has approved charter, data dictionary/ERD, OpenAPI, fixture plan, and dependencies; unresolved architecture conflicts are resolved in ADR before code contracts freeze.
- **`PMO-07 - Gate G2 Extract/Profile demonstration and milestone sign-off (Sprint 3)`**  
  *Acceptance:* Each module’s Dirty Data Pack extracts and profiles; profile counts match manifest; blocked teams receive explicit remediation owner/date.
- **`PMO-08 - Gate G3 Clean/Map demonstration and screen audit (Sprint 3)`**  
  *Acceptance:* Every module demonstrates cleaning/mapping on known fixtures; required-target guards work; review UI follows shared components; tests run in CI.
- **`PMO-09 - Automated dependency graph and cross-module preflight validation (Sprint 2)`**  
  *Acceptance:* Validator detects missing IDs, cycles, invalid module owners, and unmet wave dependencies from machine-readable manifest; CI fails for graph errors.
- **`PMO-10 - Weekly burndown, velocity and defect severity board (Sprint 3)`**  
  *Acceptance:* Board shows issue status by workstream/sprint, blocked age, critical defects, and scope changes; raw issue count is not reported as productivity without size/effort context.
- **`PMO-11 - Architecture Decision Record and scope-change control log (Sprint 1)`**  
  *Acceptance:* Every cross-team stack/scope choice has decision, status, owner, rationale, affected issue IDs, and review date; no team silently swaps queue, DB, ORM, or API framework.
- **`PMO-12 - V1 recovery runbook, demo rehearsal and incident roles (Sprint 4)`**  
  *Acceptance:* Runbook identifies stop conditions, safe restart, logs/evidence, communication owner, and demo fallback; it must not claim a V1 rollback capability that does not exist.

### Team 12 Sprint Allocation

| Sprint | Assigned Issue IDs | Total Issues |
| :---: | :--- | :---: |
| **S1** | `INT-01, INT-02, QA-01, QA-02, REL-01, PMO-02, PMO-06, PMO-11` | **8** |
| **S2** | `INT-03, INT-04, QA-03, REL-02, PMO-01, PMO-03, PMO-04, PMO-09` | **8** |
| **S3** | `INT-05, QA-04, QA-05, QA-07, PMO-07, PMO-08, PMO-10` | **7** |
| **S4** | `INT-06, QA-06, QA-08, REL-03, REL-04, PMO-05, PMO-12` | **7** |

---

## 11. Priority, Dependencies, Readiness and Completion Policy

- **P0:** Blocks safe data movement, cross-module integrity, authorization, accounting correctness, or Gate G4. A P0 issue blocks dependent work until Done.
- **P1:** V1 Must outcome required for Gate G4, but not necessarily a hard blocker for unrelated work. P1 is not optional and cannot be deferred to V2 if marked V1 Must.
- **Status at Creation:** Open. Allowed workflow: `Open -> In Progress -> In Review -> Done`. Blocked is a flag/reason, not permission to bypass dependencies. Reopen if post-merge evidence fails.
- **Owner:** Assign actual GitHub account only after matching source-roster name to an account. Until then, use role/team ownership in planning docs; never invent a handle.
- **Depends On:** List only hard prerequisites. Dependency graph must be acyclic; no issue starts while a hard dependency is open. PRs may be prepared in parallel against approved mocks/contracts.
- **Definition of Ready:** Scope/in-scope/out-of-scope fixed; source SDS/requirement IDs cited; API/schema contracts known; acceptance criteria testable; files/interfaces listed; dependency IDs valid; synthetic fixture plan defined; owner and review role assigned.
- **Definition of Done:** Every acceptance checkbox is evidenced; tests are merged and green in CI; schema/OpenAPI/data dictionary/docs are updated; security and accessibility rules are met where applicable; no TODO/deferred decision changes behavior; peer reviewer approves; issue closes only after evidence links are attached.

---

## 12. Cross-Cutting Behavior Contracts That Must Be Identical Across Teams

### 12.1 Batch Outcome and Reconciliation Contract

Each parsed source row receives **exactly one terminal outcome**:
- **`loaded`:** A target record was successfully created/updated with a durable receipt.
- **`rejected`:** Row was attempted or validated and cannot be loaded; stable reason code and readable reason text exist.
- **`merged`:** Row was deterministically merged into another row/record through approved exact-match/human-review policy; kept and merged IDs are audited.
- **`skipped`:** An authorized user or explicit approved pre-load filter excluded the row before any target mutation; actor/policy, time, and reason are recorded. Ignoring a column never skips a row. A row already subject to a target mutation may not be reclassified as skipped.

$$\mathbf{source\_rows = loaded + rejected + merged + skipped} \quad \text{and} \quad \mathbf{unaccounted = 0}$$

If the equation fails, reconciliation is **NOT OK**, batch cannot be marked successful, and Gate G4 evidence must show the failure.

### 12.2 File and Load Limits

- **File Formats:** CSV (UTF-8, comma or semicolon delimiter); XLSX (first sheet only); source file maximum 50 MB; source formats/dates/phone country declared at batch creation.
- **Raw Immutability:** Preserve row number and exact raw payload; dynamic source columns are represented safely (e.g., JSONB / field registry), never turned directly into SQL identifiers.
- **Chunking & Threshold:** 500 rows per load chunk. Stop before beginning subsequent chunk once cumulative attempted-row failures exceed 10% of attempted rows. Keep all per-row results and receipts already committed; do not silently reset batch or generate new idempotency key.
- **Dry-Run Guarantee:** Dry run performs parsing/rules/target-preflight and creates report but writes neither target business data nor target import receipts. Tests compare target counts and receipts before/after.

### 12.3 Security and Personal Data

- **Data Privacy:** Synthetic fixture data only. No data leaves local project systems in V1.
- **Role Permissions:** Viewer (read-only); Editor (allowed domain mutations); Migration Runner (runs import/dry-run/load within Migration Kit boundary); Analyst (reads dashboards/reports); Admin (manages system settings but does not receive protected bank/government identity values).
- **Sensitive Fields:** Vendor bank data is server-side masked and excluded from logs/exports. Employee bank/government identity values are never exposed in ordinary API/UI/CSV responses, even for Admin. Consent opt-out cannot be overwritten into opt-in by migration.
- **Defense in Depth:** All CSV exports are formula-safe; UI renders untrusted input as text; SQL uses parameterized queries; event/log payloads exclude raw row PII and secrets.

---

## 13. Canonical GitHub Issue Body Format

Every published issue uses the following headings in order:

1. `## [ISSUE-ID] Clear, outcome-based title`
2. Field table: Status, Type, Priority, Owner, Target Sprint/Gate, Depends On, Estimates.
3. `### Context` — Problem, current observed behavior, source requirement, and business impact.
4. `### Decision` — One chosen implementation, not a menu of alternatives.
5. `### Constraints (Non-Negotiable)` — Stack pins, contracts, security, and failure invariants.
6. `### Out of Scope` — Specifically name V2/V3 and shared work owned elsewhere.
7. `### Technical Specification` — Route/schema/state transitions/data types, error cases, and logic flow.
8. `### Files to Create/Modify` — Concrete paths or explicit directories with reason.
9. `### Acceptance Criteria` — Observable, checkable checkboxes with fixtures/tests/commands/evidence.
10. `### Required Closure Evidence` — PR/CI links, tests, screenshots/logs, schema/API docs, and reviewer approval.
11. `### Dependencies` — Direct issue IDs and exact unblock condition.
12. `### Deferred Decisions` — None for a well-defined V1 issue.

---

## 14. Gate G4 Release Criteria for the Full V1

- All 360 planned V1 issue slots are **Done with required evidence**, or any approved issue-count exception has a written PM + Integration Lead decision and equivalent acceptance outcome.
- All ten business modules demonstrate complete seven-step pipeline: **Extract, Profile, Clean, Map, Load (dry-run and actual), Validate, Reconcile**, using deterministic synthetic Dirty Data Packs.
- Each module contributes at least 25 written test cases; automated unit/API/UI tests run in CI. Unit tests are green, core logic coverage is at least 60%, and no critical defects remain open.
- Shared 1,000-row integration Dirty Data Pack finds expected counts (80 exact duplicates, 60 bad formats, 50 empty required fields).
- Every batch reconciles exactly with four terminal outcomes; all expected relationships exist; CRM-5 event counts match batch ledger projections; replay/retry does not duplicate target rows.
- Security/privacy scan and negative-role tests pass; no raw source PII/secrets are logged or improperly exported.
- A clean environment can be started from README; migrations, seed, and demo are deterministic; G4 test summary, reconciliation reports, demo recording/notes, and sign-offs are archived.

---

## 15. Change Control and No-GitHub Rule

> [!IMPORTANT]
> **Change Control Directive:**  
> This document authorizes **review and planning only**. It does **not** create, update, assign, label, close, or otherwise change any GitHub issue. No repository-side actions are implied.
>
> Before publication, the PM and Integration Lead must approve this document, resolve any discovered live-issue duplicates by updating them in place, verify actual assignees, and run the issue index/dependency checker. The final issue-body catalog should then be generated from this standard without changing domain rules or version scope silently.

---

## 16. Review Checklist

- [x] 30 issues per each business module: 8/7/8/7 by Role 1/2/3/4.
- [x] 30 issues for Platform/Migration Kit: 12 PLT + 18 KIT.
- [x] 30 issues for PMO workstream: 6 INT + 8 QA + 4 REL + 12 PMO.
- [x] V1 is Week 8/G4 of the existing 12-week plan; V2/V3 remain in Weeks 10/12.
- [x] V1 rollback-saga conflict corrected; V1 safe stop/retry is mandatory, rollback deferred to V2.
- [x] Generic migration UI/auth/outbox/duplicate engine infrastructure has one owner; modules configure/integrate it instead of duplicating it.
- [x] Reconciliation equation includes every terminal outcome and resolves the skipped ambiguity ($Source = Loaded + Rejected + Merged + Skipped$).
- [x] **No GitHub issues were created or changed as part of this documentation task.**

---

## Appendix A — Inventory and Identifier Rules

Business module IDs use:
- `CRM1-01..30`, `CRM2-01..30`, `CRM3-01..30`, `CRM4-01..30`, `CRM5-01..30`
- `ERP1-01..30`, `ERP2-01..30`, `ERP3-01..30`, `ERP4-01..30`, `ERP5-01..30`

Role ranges are consistent across modules:
- **Role 1:** `01–08`
- **Role 2:** `09–15`
- **Role 3:** `16–23`
- **Role 4:** `24–30`

Shared IDs remain:
- `PLT-01..12`, `KIT-01..18`
- `INT-01..06`, `QA-01..08`, `REL-01..04`, `PMO-01..12`

| Family | Workstreams | Issues per Workstream | Subtotal |
| :--- | :---: | :---: | :---: |
| **CRM** | 5 | 30 | **150** |
| **ERP** | 5 | 30 | **150** |
| **Platform / Migration Kit** | 1 | 30 | **30** |
| **PMO / Integration / QA / Release** | 1 | 30 | **30** |
| **Total Organization Catalog** | **12 Delivery Workstreams** | | **360** |

---

## Appendix B — Source Traceability

| Plan Decision in this Document | Source Section Used |
| :--- | :--- |
| V1 at Week 8/G4; V2 Week 10/G5; V3 Week 12/G6 | ClearShift Project Plan v3.0, version/gate schedule and six-sprint plan |
| Ten module teams, Group 11 Platform, three-person PMO, 48 people | ClearShift Project Plan v3.0, roster/team model |
| Four roles and responsibilities | ClearShift Project Plan, Role 1–4 definitions and group delivery pattern |
| Seven-step migration, CSV/XLSX 50 MB, 500-row chunks, >10% fail stop, mapping and exact duplicate review | SDS ClearShift Migration Kit v2.0, V1 requirements |
| Rollback is V2, fuzzy matching is V2 | SDS ClearShift Migration Kit v2.0, V1/V2 scope tables |
| CRM and ERP entity ownership and domain invariants | SDS ClearShift CRM v2.0 and SDS ClearShift ERP v2.0 |

> **Maintainer Note:** The 30-issue standard is accepted as a planning convention only. Quality, safe data movement, and tested user-visible outcomes remain the completion criteria; the count never overrides the SDS or the V1/V2 boundary.
