# ERP-4 Finance & Accounting: Dirty Data Pack Plan

**Issue**: [ERP4-24 / #180](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/180), Gate G1 Design Artifact  
**Scope**: Fixture specification and synthetic defect profile plan for migration validation.  
**Reference Document**: ClearShift Core Rules & SDS ClearShift ERP v2.0 §7.9  

---

## 1. Fixture Strategy

| Parameter | Specification | Compliance Rationale |
|---|---|---|
| **Planned Path** | `sample-data/erp-4/dirty-data-v1.csv` & `sample-data/erp-4/expected-profile.json` | Standard shared fixture layout |
| **Row Count** | 120 source rows: 40 accounts, 30 opening balances, 25 journal entries, 25 journal lines | Covers complete general ledger lifecycle |
| **Determinism** | Fixed row indices, deterministic seed ordering, zero pseudo-random generation | Guarantees identical profiling results across CI runs |
| **100% Synthetic** | Invented corporate accounts, fictional codes (`1010-CASH`, `2010-AP`), synthetic bank accounts, dummy UUIDs | **Strict Compliance**: Zero real customer, financial, or personal data |
| **Formula-Safe** | Injection vectors (`=`, `+`, `-`, `@`) included for sanitization testing | Validates AC4 export escaping |
| **Exact Duplicate Policy**| Deterministic normalized key matching (trimmed lowercase account codes). Conflicting candidates held for human review | ClearShift Core Rules: No fuzzy auto-merge |

---

## 2. Planned Source Columns

`row_id, record_type, case_tags, source_system, source_id, code, name, type, currency_code, parent_code, description, is_active, is_posting_account, balance_amount, as_of_date, entry_number, period_label, posting_date, debit_amount, credit_amount, expect_outcome, expect_reasons`

- `record_type`: `account`, `opening_balance`, `journal_entry`, `journal_line`
- `expect_outcome`: `loaded`, `loaded_cleaned`, `merged`, `rejected`, `skipped`
- `expect_reasons`: Pipe-separated reason codes (`TRIMMED`, `TYPE_NORMALIZED`, `EXACT_DUPLICATE`, `JOURNAL_UNBALANCED`, `PERIOD_LOCKED`, etc.)

---

## 3. Scenario Catalogue & Defect Distributions

### 3.1 Chart of Accounts (40 rows)

| Scenario ID | Edge-Case Scenario Description | Row Count | Expected Outcome | Assigned Reason Code |
|---|---|---|---|---|
| **ACC-CLEAN** | Well-formed standard account records across asset, liability, income, expense | 22 | `loaded` | None |
| **ACC-CLN-01** | Leading/trailing whitespace in account code and name (` 1010-CASH `) | 3 | `loaded_cleaned` | `TRIMMED` |
| **ACC-CLN-02** | Legacy classification variants (`current asset` -> `asset`, `revenue` -> `income`) | 3 | `loaded_cleaned` | `TYPE_NORMALIZED` |
| **ACC-CLN-03** | Currency symbol or lowercase representation (`₹`, `inr` -> `INR`) | 2 | `loaded_cleaned` | `CURRENCY_STANDARDIZED` |
| **ACC-DUP-01** | Exact normalized code collision with earlier row (`1010-cash` vs `1010-CASH`) | 3 | `merged` | `EXACT_DUPLICATE` |
| **ACC-REJ-01** | Missing mandatory account name or code | 2 | `rejected` | `MISSING_REQUIRED_FIELD` |
| **ACC-REJ-02** | Invalid classification type not in allowlist (`cryptocurrency`) | 2 | `rejected` | `INVALID_ACCOUNT_TYPE` |
| **ACC-REJ-03** | Invalid currency not in ISO-4217 allowlist (`BTC`, `XYZ`) | 1 | `rejected` | `INVALID_CURRENCY` |
| **ACC-REJ-04** | Self-referencing parent account hierarchy loop (`code == parent_code`) | 2 | `rejected` | `CYCLIC_PARENT_HIERARCHY` |

### 3.2 Opening Balances (30 rows)

| Scenario ID | Edge-Case Scenario Description | Row Count | Expected Outcome | Assigned Reason Code |
|---|---|---|---|---|
| **OPB-CLEAN** | Valid opening balance loads tied to valid accounts | 18 | `loaded` | None |
| **OPB-CLN-01** | Number formatted with commas / currency symbols (`$150,000.00`) | 4 | `loaded_cleaned` | `DECIMAL_PARSED` |
| **OPB-CLN-02** | Date formatted as `DD/MM/YYYY` instead of ISO `YYYY-MM-DD` | 2 | `loaded_cleaned` | `DATE_NORMALIZED` |
| **OPB-REJ-01** | References nonexistent account code not loaded in Chart of Accounts | 3 | `rejected` | `UNRESOLVED_ACCOUNT_REFERENCE` |
| **OPB-REJ-02** | Non-numeric invalid balance amount string (`UNKNOWN_AMOUNT`) | 2 | `rejected` | `INVALID_DECIMAL` |
| **OPB-REJ-03** | Duplicate opening balance for already loaded (account_id, currency) pair | 1 | `rejected` | `DUPLICATE_OPENING_BALANCE` |

### 3.3 Journal Entries & Lines (50 rows: 25 headers, 25 lines)

| Scenario ID | Edge-Case Scenario Description | Row Count | Expected Outcome | Assigned Reason Code |
|---|---|---|---|---|
| **JRN-CLEAN** | Balanced journal entries with matching debits and credits | 30 | `loaded` | None |
| **JRN-CLN-01** | Period label with spaces or lowercase (` 2026-04 `) | 4 | `loaded_cleaned` | `TRIMMED` |
| **JRN-REJ-01** | Asymmetric double-entry transaction: debits != credits (difference > 0) | 6 | `rejected` | `JOURNAL_UNBALANCED` |
| **JRN-REJ-02** | Posting targeted to closed or locked fiscal period (`2026-03`) | 4 | `rejected` | `PERIOD_LOCKED` |
| **JRN-REJ-03** | Negative line debit or credit amount (`-500.00`) | 2 | `rejected` | `NEGATIVE_AMOUNT` |
| **JRN-REJ-04** | Journal line with both debit and credit amounts populated | 2 | `rejected` | `BOTH_DEBIT_AND_CREDIT` |
| **JRN-REJ-05** | Formula injection string in transaction notes (`=SUM(1,2)`) | 2 | `loaded_cleaned` | `FORMULA_NEUTRALIZED` |

---

## 4. Expected Defect Distribution Summary

| Metric | Planned Target Value |
|---|---|
| **Total Ingestion Rows** | 120 |
| **Expected Clean Loads (`loaded`)** | 70 (58.3%) |
| **Expected Cleaned Loads (`loaded_cleaned`)** | 18 (15.0%) |
| **Expected Merged Rows (`merged`)** | 3 (2.5%) |
| **Expected Rejected Rows (`rejected`)** | 29 (24.2%) |
| **Unaccounted Rows** | **0 (Strict Invariant: `source = loaded + rejected + merged + skipped` and `unaccounted = 0`)** |
| **Failure Rate Threshold (Batch Load)** | Halt triggered when consecutive batch row failures exceed 10% after 10 rows |
