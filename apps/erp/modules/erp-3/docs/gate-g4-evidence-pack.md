# ERP-3 Sales Orders & Invoices — Gate G4 Evidence Pack (ERP3-30 / #166)

Module: ERP-3 · Owner: Group 8 — Role 4 — Data / QA Lead · Gate: G4 (V1 Build Complete)
Fixture: `sample-data/erp-3/dirty-data-v1.csv` (synthetic, 135 rows) · Source system: `SYNTH-ERP3-DIRTY-V1`

> Fields marked **[FILL]** are completed by the team after the PR is merged. Nothing here is pre-signed.

## 1. Reconciliation proof (automated)

Produced by `src/migration/reconciliation.ts`, asserted in `tests/migration/reconciliation.test.ts`.

| Record type | Source | Loaded | Rejected | Merged | Skipped | Unaccounted |
|---|---|---|---|---|---|---|
| sales_order | 51 | 11 | 38 | 0 | 2 | 0 |
| so_line | 38 | 13 | 23 | 0 | 2 | 0 |
| invoice | 21 | 5 | 14 | 0 | 2 | 0 |
| invoice_line | 5 | 2 | 2 | 0 | 1 | 0 |
| payment | 20 | 4 | 14 | 0 | 2 | 0 |
| **Total** | **135** | **35** | **91** | **0** | **9** | **0** |

- Equation: `source = loaded + rejected + merged + skipped`; `unaccounted = 0`; result **OK** (shared kit `evaluateReconciliation`).
- Outcome mapping: evaluator `accepted→loaded`, `rejected→rejected`, `review→skipped` (held for human review; V1 has no auto-merge), `skipped→skipped`. A row becomes `merged` only through an explicit merge decision on an exact-duplicate review row.
- Link integrity over loaded rows:
  • every sales order references a valid Golden customer (`KNOWN_CUSTOMERS`)
  • every SO line references a loaded sales order and a valid ERP-1 reference SKU (`KNOWN_PRODUCTS`)
  • every invoice references a loaded sales order (where linked) and a valid Golden customer
  • every invoice line references a loaded invoice and a valid ERP-1 reference SKU
  • every payment references a loaded invoice
  Violations: **0**.
- Receipt verification rule: exactly one durable receipt per loaded row (`SYNTH-ERP3-DIRTY-V1:${row_id}`), none for other outcomes, unique idempotency keys.
- Live-database receipt/record verification run: **[FILL: date, environment, result, evidence link]**

## 2. Test evidence

| Item | Value |
|---|---|
| Full test run (`npx vitest run --coverage`) | **[FILL: files/tests passed, coverage %]** |
| Browser journeys (`npm run erp3:e2e` / Playwright) | **[FILL: CI run URL]** |
| CI run URL(s) for this PR | **[FILL]** |
| Test report / artifact links | **[FILL]** |
| Live demo recording link (`docs/demo-scripts/erp-3-v1.md`) | **[FILL]** |

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
