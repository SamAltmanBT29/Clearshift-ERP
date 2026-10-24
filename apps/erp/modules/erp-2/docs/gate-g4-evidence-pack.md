# ERP-2 Vendors & Purchasing — Gate G4 Evidence Pack (ERP2-30 / #146)

Module: ERP-2 · Owner: Group 7 — Data / QA Lead · Gate: G4 (V1 Build Complete)
Fixture: `sample-data/erp-2/dirty-data-v1.csv` (synthetic, 173 rows) · Source system: `SYNTH-ERP2-DIRTY-V1`

> Fields marked **[FILL]** are completed by the team after the PR is merged. Nothing here is pre-signed.

## 1. Reconciliation proof (automated)

Produced by `src/migration/reconciliation.ts`, asserted in `tests/migration/reconciliation.test.ts`.

| Record type | Source | Loaded | Rejected | Merged | Skipped | Unaccounted |
|---|---|---|---|---|---|---|
| vendor | 46 | 26 | 15 | 0 | 5 | 0 |
| purchase_order | 44 | 22 | 18 | 0 | 4 | 0 |
| po_line | 83 | 46 | 35 | 0 | 2 | 0 |
| **Total** | **173** | **94** | **68** | **0** | **11** | **0** |

- Equation: `source = loaded + rejected + merged + skipped`; `unaccounted = 0`; result **OK** (shared kit `evaluateReconciliation`).
- Outcome mapping: evaluator `accepted→loaded`, `rejected→rejected`, `review→skipped` (held for human review; V1 has no auto-merge), `skipped→skipped`. A row becomes `merged` only through an explicit merge decision on an exact-duplicate review row.
- Link integrity over loaded rows: every PO references a loaded vendor, every line references a loaded PO and an ERP-1 reference SKU. Violations: **0**.
- Receipt verification rule: exactly one durable receipt per loaded row, none for other outcomes, unique idempotency keys.
- Live-database receipt/record verification run: **[FILL: date, environment, result, evidence link]**

## 2. Test evidence

| Item | Value |
|---|---|
| Full test run (`npx vitest run --coverage`) | **[FILL: files/tests passed, coverage %]** |
| Browser journeys (`npm run erp2:e2e`, ERP2-29 #145) | **[FILL: PR #145 merged? CI run URL]** |
| CI run URL(s) for this PR | **[FILL]** |
| Test report / artifact links | **[FILL]** |
| Live demo recording link (`docs/demo-scripts/erp-2-v1.md`) | **[FILL]** |

## 3. Checklist

- [ ] Every source row has exactly one terminal outcome (automated test)
- [ ] Reconciliation balances exactly, unaccounted = 0 (automated test)
- [ ] Link integrity: 0 violations (automated test)
- [ ] Target records and durable receipts verified complete on a live database **[FILL]**
- [ ] Data dictionary and OpenAPI reviewed for this gate **[FILL: confirm no change needed or link update]**
- [ ] Zero critical/high defects open against V1 scope **[FILL: issue list link]**
- [ ] Only synthetic data used; no real personal data in the pack

## 4. Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| Peer reviewer (other group) | [FILL] | [FILL] | [FILL] |
| Team Lead | [FILL] | [FILL] | [FILL] |
| Test Manager | [FILL] | [FILL] | [FILL] |
