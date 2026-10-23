# ERP-4 Finance & Accounting — V1 Data-Quality Rules

Rule catalogue version **1.0.0**.  
Code: [`apps/erp/modules/erp-4/src/migration/rules.ts`](../src/migration/rules.ts)  
Tests: [`apps/erp/modules/erp-4/tests/migration/rules.test.ts`](../tests/migration/rules.test.ts)  
Synthetic Dirty Pack: [`sample-data/erp-4/dirty-data-v1.csv`](../../../../sample-data/erp-4/dirty-data-v1.csv)  
Expected Profile: [`sample-data/erp-4/expected-profile.json`](../../../../sample-data/erp-4/expected-profile.json)  
Mapping Template: [`sample-data/erp-4/mapping-template.json`](../../../../sample-data/erp-4/mapping-template.json)  

**Traceability**: SDS ClearShift ERP v2.0 V1 — FR-ERP4-01..05, BR-ERP4-01..02; Project Plan v3.0 §7.9.

---

## 1. Principles & Non-Negotiable Invariants

1. **Raw input is never changed (BR-KIT-03)**: The CSV fixture is parsed into frozen raw rows. Profiling and cleaning generate normalized and clean target projections; raw cells and the raw SHA-256 checksum are strictly immutable.
2. **Deterministic execution**: Evaluating the same fixture with the same rule catalogue version yields a byte-equivalent profile (`expected-profile.json`).
3. **No fuzzy matching, no automatic merge**: Duplicates are detected only on exact candidate keys after normalization:
   - Accounts: normalized `code` (`ACC-050`)
   - Opening balances: `(account_code, currency_code)` (`OPB-030`)
   - Journal entries: `entry_number` (`JRN-030`)
   Candidate duplicates receive the terminal outcome `review` and are held for human decision; they are never merged destructively.
4. **Stable rule IDs and reason codes**: Every rule has a unique, stable `rule_id`, version (`1.0.0`), input condition, result (`reject`, `normalize`, `review`, `derive`), reason code, and human-readable explanation.
5. **Double-entry exact balancing (BR-ERP4-01)**: Every journal entry must balance exactly (`SUM(debits) == SUM(credits)`) at currency precision (cents/paise, 2 decimal places; stored in `numeric(20,4)`). Unbalanced entries are rejected (`UNBALANCED_JOURNAL_ENTRY`).
6. **Closed period posting guard (BR-ERP4-02)**: Closed/locked accounting periods reject postings unconditionally (`PERIOD_LOCKED`).
7. **Single currency isolation & no FX conversion**: Each journal entry has an explicit currency; all lines must match that currency. Trial balance groups debit and credit totals by account and currency and never adds unlike currencies.
8. **One-time opening balance load (FR-ERP4-04)**: Opening balances are loaded once per account/currency pair. Subsequent attempts are held for review or rejected (`DUPLICATE_OPENING_BALANCE_REVIEW`).
9. **All-or-nothing entry atomicity**: A journal entry is loaded with all its lines or rejected completely. If any child line fails validation, the header is rejected (`LINE_REJECTED`) and peer lines are marked `PARENT_ENTRY_REJECTED`.
10. **Synthetic fixture only**: Never upload real customer or financial data to an external service.

---

## 2. Row Outcomes & Reconciliation

Every parsed source row maps to exactly one terminal outcome:
- **`accepted`**: Validated and cleaned; ready for ingestion through module public REST endpoints.
- **`rejected`**: Failed one or more business/format rules; not loaded; lists stable reason codes.
- **`review`**: Exact duplicate candidate; held for human review in the review queue; never loaded automatically.

Reconciliation equation:
$$\text{source} = \text{accepted} + \text{rejected} + \text{review} + \text{skipped}$$
$$\text{unaccounted} = 0$$

In the V1 Dirty Data Pack (`sample-data/erp-4/dirty-data-v1.csv`):
- **Total rows**: 143
- **Accounts**: 14 accepted, 16 rejected, 1 review (31 total)
- **Opening Balances**: 5 accepted, 13 rejected, 1 review (19 total)
- **Journal Entries**: 4 accepted, 26 rejected, 1 review (31 total)
- **Journal Lines**: 9 accepted, 54 rejected, 2 review (62 total)

---

## 3. Fields, Required vs. Optional, and Enumerations

| Entity | Required Fields | Optional Fields | Enumerations / Value Sets |
|---|---|---|---|
| **Account** | `source_id`, `code`, `name`, `type`, `currency_code` | `parent_code`, `description`, `is_active` (default `true`), `is_posting_account` (default `true`) | `type` $\in$ {`asset`, `liability`, `income`, `expense`}; `currency_code` $\in$ {`INR`, `USD`, `EUR`} |
| **Opening Balance** | `source_id`, `code`, `currency_code`, `balance_amount`, `as_of_date` | `description` (source reference) | `currency_code` $\in$ {`INR`, `USD`, `EUR`} |
| **Journal Entry** | `source_id`, `entry_number`, `period_label`, `posting_date`, `currency_code`, `description`, `lines` ($\ge 2$) | `source_reference`, `idempotency_key` | `currency_code` $\in$ {`INR`, `USD`, `EUR`}; `status` $\in$ {`draft`, `posted`, `reversed`, `voided`} |
| **Journal Line** | `parent_source_id`, `code`, `debit_amount`, `credit_amount` | `line_narration`, `department_ref` | Mutually exclusive: exactly one of `debit_amount > 0` OR `credit_amount > 0` |

---

## 4. Normalization Rules

Cleaning normalizes raw text without mutating source rows:

| Field | Rule ID | Transformation Applied |
|---|---|---|
| `account.code` | `ACC-010` | Trim leading/trailing whitespace; convert to UPPERCASE. |
| `account.name` | `ACC-011` | Trim leading/trailing whitespace; collapse consecutive inner spaces into a single space. |
| `account.type` | `ACC-012` | Trim whitespace; convert to lowercase. |
| `account.currency_code` | `ACC-013` | Trim whitespace; convert to UPPERCASE. |
| `account.parent_code` | `ACC-014` | Trim whitespace; convert to UPPERCASE; empty string converts to `null`. |
| `opening_balance.code` | `OPB-010` | Trim whitespace; convert to UPPERCASE. |
| `opening_balance.currency_code` | `OPB-011` | Trim whitespace; convert to UPPERCASE. |
| `opening_balance.balance_amount` | `OPB-012` | Trim whitespace; strip commas (`150,000.00` $\to$ `150000.00`). |
| `opening_balance.as_of_date` | `OPB-013` | Normalize `YYYY/MM/DD` to ISO 8601 `YYYY-MM-DD`. |
| `journal_entry.entry_number` | `JRN-010` | Trim whitespace; convert to UPPERCASE. |
| `journal_entry.period_label` | `JRN-011` | Trim whitespace (`2026-04`). |
| `journal_entry.posting_date` | `JRN-012` | Normalize `YYYY/MM/DD` to ISO 8601 `YYYY-MM-DD`. |
| `journal_entry.currency_code` | `JRN-013` | Trim whitespace; convert to UPPERCASE. |
| `journal_entry.description` | `JRN-014` | Trim whitespace; collapse multiple consecutive spaces. |
| `journal_line.code` | `JRL-010` | Trim whitespace; convert to UPPERCASE. |
| `journal_line.debit_amount` | `JRL-011` | Trim whitespace; strip commas; empty/blank defaults to `0.0000`. |
| `journal_line.credit_amount` | `JRL-012` | Trim whitespace; strip commas; empty/blank defaults to `0.0000`. |
| `journal_line.line_narration` | `JRL-013` | Trim leading/trailing whitespace. |
| `journal_line.department_ref` | `JRL-014` | Trim whitespace; convert to UPPERCASE. |

---

## 5. Relationship Resolution

| Relationship | Resolution Mechanism | Failure Code |
|---|---|---|
| Account $\to$ Parent Account | Self-referential match on normalized `code` in the chart of accounts | `PARENT_ACCOUNT_NOT_FOUND`, `CYCLE_DETECTED`, `CURRENCY_MISMATCH` |
| Opening Balance $\to$ Account | Exact match on normalized `code` in the chart of accounts | `ACCOUNT_NOT_FOUND`, `CURRENCY_MISMATCH` |
| Journal Line $\to$ Journal Entry | Parent match on `parent_source_id == journal_entry.source_id` | `ORPHAN_LINE`, `PARENT_SOURCE_ID_REQUIRED` |
| Journal Line $\to$ Account | Exact match on normalized `code` | `ACCOUNT_NOT_FOUND`, `ACCOUNT_INACTIVE`, `CANNOT_POST_TO_HEADER_ACCOUNT` |
| Journal Line $\to$ Department | Cross-module reference resolved via `ReferenceResolver` | `DEPARTMENT_NOT_FOUND` |
| Journal Entry $\to$ Period | Resolved against fiscal calendar | `PERIOD_NOT_FOUND`, `PERIOD_LOCKED` |

---

## 6. Complete Rule Catalogue

### 6.1 Chart of Accounts (`account`)

| Rule ID | Ver | Field | Kind | Result | Reason Code | Human-Readable Reason |
|---|---|---|---|---|---|---|
| `ACC-001` | 1.0.0 | `code` | required | reject | `ACCOUNT_CODE_REQUIRED` | Account code is required. |
| `ACC-002` | 1.0.0 | `name` | required | reject | `ACCOUNT_NAME_REQUIRED` | Account name is required. |
| `ACC-003` | 1.0.0 | `type` | required | reject | `ACCOUNT_TYPE_REQUIRED` | Account type is required. |
| `ACC-004` | 1.0.0 | `currency_code` | required | reject | `CURRENCY_REQUIRED` | Currency code is required; V1 performs no FX conversion. |
| `ACC-005` | 1.0.0 | `source_id` | required | reject | `SOURCE_ID_REQUIRED` | Source ID is required for account migration lineage. |
| `ACC-010` | 1.0.0 | `code` | normalize | normalize | — | Account code is trimmed and upper-cased. |
| `ACC-011` | 1.0.0 | `name` | normalize | normalize | — | Account name is trimmed and inner whitespace collapsed. |
| `ACC-012` | 1.0.0 | `type` | normalize | normalize | — | Account type is trimmed and lower-cased. |
| `ACC-013` | 1.0.0 | `currency_code` | normalize | normalize | — | Currency code is trimmed and upper-cased. |
| `ACC-014` | 1.0.0 | `parent_code` | normalize | normalize | — | Parent account code is trimmed and upper-cased. |
| `ACC-020` | 1.0.0 | `code` | format | reject | `INVALID_ACCOUNT_CODE_FORMAT` | Account code must be alphanumeric with hyphens or underscores. |
| `ACC-021` | 1.0.0 | `code` | length | reject | `ACCOUNT_CODE_TOO_LONG` | Account code cannot exceed 32 characters. |
| `ACC-022` | 1.0.0 | `name` | length | reject | `ACCOUNT_NAME_TOO_LONG` | Account name cannot exceed 255 characters. |
| `ACC-023` | 1.0.0 | `description` | length | reject | `DESCRIPTION_TOO_LONG` | Account description cannot exceed 2000 characters. |
| `ACC-030` | 1.0.0 | `type` | enum | reject | `INVALID_ACCOUNT_TYPE` | Account type must be one of asset, liability, income, expense. |
| `ACC-031` | 1.0.0 | `currency_code` | enum | reject | `INVALID_CURRENCY` | Currency code must be an accepted ISO 4217 currency (INR, USD, EUR). |
| `ACC-032` | 1.0.0 | `is_active` | format | reject | `INVALID_BOOLEAN` | is_active must be true or false. |
| `ACC-033` | 1.0.0 | `is_posting_account` | format | reject | `INVALID_BOOLEAN` | is_posting_account must be true or false. |
| `ACC-040` | 1.0.0 | `parent_code` | reference | reject | `PARENT_ACCOUNT_NOT_FOUND` | Referenced parent account does not exist. |
| `ACC-041` | 1.0.0 | `parent_code` | invariant | reject | `CYCLE_DETECTED` | Parent account reference forms a self-reference or circular hierarchy. |
| `ACC-042` | 1.0.0 | `parent_code` | invariant | reject | `CURRENCY_MISMATCH` | Parent and child accounts must have the same currency code. |
| `ACC-050` | 1.0.0 | `code` | duplicate | review | `DUPLICATE_ACCOUNT_CODE_REVIEW` | Exact duplicate account code candidate; held for explicit human review. |

### 6.2 Opening Balances (`opening_balance`)

| Rule ID | Ver | Field | Kind | Result | Reason Code | Human-Readable Reason |
|---|---|---|---|---|---|---|
| `OPB-001` | 1.0.0 | `source_id` | required | reject | `SOURCE_ID_REQUIRED` | Source ID is required for opening balance lineage. |
| `OPB-002` | 1.0.0 | `code` | required | reject | `ACCOUNT_CODE_REQUIRED` | Account code is required for opening balance. |
| `OPB-003` | 1.0.0 | `currency_code` | required | reject | `CURRENCY_REQUIRED` | Currency code is required for opening balance. |
| `OPB-004` | 1.0.0 | `balance_amount` | required | reject | `BALANCE_AMOUNT_REQUIRED` | Balance amount is required for opening balance. |
| `OPB-005` | 1.0.0 | `as_of_date` | required | reject | `AS_OF_DATE_REQUIRED` | as_of_date is required for opening balance. |
| `OPB-010` | 1.0.0 | `code` | normalize | normalize | — | Opening balance account code is trimmed and upper-cased. |
| `OPB-011` | 1.0.0 | `currency_code` | normalize | normalize | — | Opening balance currency is trimmed and upper-cased. |
| `OPB-012` | 1.0.0 | `balance_amount` | normalize | normalize | — | Balance amount is trimmed and commas removed. |
| `OPB-013` | 1.0.0 | `as_of_date` | normalize | normalize | — | as_of_date is normalized to ISO YYYY-MM-DD. |
| `OPB-020` | 1.0.0 | `code` | reference | reject | `ACCOUNT_NOT_FOUND` | Opening balance references an account that does not exist in chart of accounts. |
| `OPB-021` | 1.0.0 | `currency_code` | invariant | reject | `CURRENCY_MISMATCH` | Opening balance currency does not match account currency. |
| `OPB-022` | 1.0.0 | `balance_amount` | format | reject | `INVALID_BALANCE_AMOUNT` | Balance amount must be a valid signed numeric decimal. |
| `OPB-023` | 1.0.0 | `balance_amount` | format | reject | `EXCESS_DECIMAL_PLACES` | Balance amount cannot exceed 4 decimal places. |
| `OPB-024` | 1.0.0 | `balance_amount` | length | reject | `AMOUNT_OVERFLOW` | Balance amount exceeds PostgreSQL numeric(20,4) maximum range. |
| `OPB-025` | 1.0.0 | `as_of_date` | format | reject | `INVALID_DATE` | as_of_date must be a valid calendar date. |
| `OPB-026` | 1.0.0 | `as_of_date` | format | reject | `AMBIGUOUS_DATE_FORMAT` | Ambiguous date format; explicit YYYY-MM-DD required. |
| `OPB-027` | 1.0.0 | `currency_code` | enum | reject | `INVALID_CURRENCY` | Opening balance currency must be an accepted ISO 4217 currency. |
| `OPB-030` | 1.0.0 | `code` | duplicate | review | `DUPLICATE_OPENING_BALANCE_REVIEW` | Opening balance loaded once per account/currency (FR-ERP4-04); duplicate held for review. |

### 6.3 Journal Entries (`journal_entry`)

| Rule ID | Ver | Field | Kind | Result | Reason Code | Human-Readable Reason |
|---|---|---|---|---|---|---|
| `JRN-001` | 1.0.0 | `source_id` | required | reject | `SOURCE_ID_REQUIRED` | Source ID is required for journal entry lineage. |
| `JRN-002` | 1.0.0 | `entry_number` | required | reject | `ENTRY_NUMBER_REQUIRED` | Entry number is required for journal entry. |
| `JRN-003` | 1.0.0 | `period_label` | required | reject | `PERIOD_LABEL_REQUIRED` | Period label is required (YYYY-MM). |
| `JRN-004` | 1.0.0 | `posting_date` | required | reject | `POSTING_DATE_REQUIRED` | Posting date is required for journal entry. |
| `JRN-005` | 1.0.0 | `currency_code` | required | reject | `CURRENCY_REQUIRED` | Journal entry currency is required. |
| `JRN-006` | 1.0.0 | `description` | required | reject | `DESCRIPTION_REQUIRED` | Journal entry description is required. |
| `JRN-010` | 1.0.0 | `entry_number` | normalize | normalize | — | Entry number is trimmed and upper-cased. |
| `JRN-011` | 1.0.0 | `period_label` | normalize | normalize | — | Period label is trimmed. |
| `JRN-012` | 1.0.0 | `posting_date` | normalize | normalize | — | Posting date is normalized to ISO YYYY-MM-DD. |
| `JRN-013` | 1.0.0 | `currency_code` | normalize | normalize | — | Currency code is trimmed and upper-cased. |
| `JRN-014` | 1.0.0 | `description` | normalize | normalize | — | Description is trimmed and inner spaces collapsed. |
| `JRN-020` | 1.0.0 | `entry_number` | length | reject | `ENTRY_NUMBER_TOO_LONG` | Entry number cannot exceed 64 characters. |
| `JRN-021` | 1.0.0 | `period_label` | format | reject | `INVALID_PERIOD_FORMAT` | Period label must be in YYYY-MM format. |
| `JRN-022` | 1.0.0 | `period_label` | reference | reject | `PERIOD_NOT_FOUND` | Referenced accounting period does not exist in fiscal calendar. |
| `JRN-023` | 1.0.0 | `period_label` | invariant | reject | `PERIOD_LOCKED` | Accounting period is locked; closed period rejects posting (BR-ERP4-02). |
| `JRN-024` | 1.0.0 | `posting_date` | format | reject | `INVALID_POSTING_DATE` | Posting date must be a valid calendar date. |
| `JRN-025` | 1.0.0 | `currency_code` | enum | reject | `INVALID_CURRENCY` | Journal entry currency must be an accepted ISO 4217 currency. |
| `JRN-030` | 1.0.0 | `entry_number` | duplicate | review | `DUPLICATE_ENTRY_NUMBER_REVIEW` | Exact duplicate entry_number candidate; held for human review. |
| `JRN-040` | 1.0.0 | `lines` | invariant | reject | `NO_LINES` | Journal entry has no child lines. |
| `JRN-041` | 1.0.0 | `lines` | invariant | reject | `MINIMUM_LINES_REQUIRED` | Double-entry journal must have at least 2 lines (debit and credit). |
| `JRN-042` | 1.0.0 | `lines` | invariant | reject | `UNBALANCED_JOURNAL_ENTRY` | Journal entry is unbalanced: total debits must equal total credits. |
| `JRN-043` | 1.0.0 | `lines` | invariant | reject | `LINE_REJECTED` | Journal entry rejected because one or more child lines failed validation. |

### 6.4 Journal Lines (`journal_line`)

| Rule ID | Ver | Field | Kind | Result | Reason Code | Human-Readable Reason |
|---|---|---|---|---|---|---|
| `JRL-001` | 1.0.0 | `parent_source_id` | required | reject | `PARENT_SOURCE_ID_REQUIRED` | parent_source_id is required to link line to journal entry. |
| `JRL-002` | 1.0.0 | `parent_source_id` | reference | reject | `ORPHAN_LINE` | Orphan journal line references a non-existent parent journal entry. |
| `JRL-003` | 1.0.0 | `code` | required | reject | `ACCOUNT_CODE_REQUIRED` | Account code is required on journal line. |
| `JRL-004` | 1.0.0 | `code` | reference | reject | `ACCOUNT_NOT_FOUND` | Journal line references an account not found in chart of accounts. |
| `JRL-005` | 1.0.0 | `code` | invariant | reject | `ACCOUNT_INACTIVE` | Cannot post journal entries to an inactive account. |
| `JRL-006` | 1.0.0 | `code` | invariant | reject | `CANNOT_POST_TO_HEADER_ACCOUNT` | Cannot post journal entries to a non-posting header account. |
| `JRL-010` | 1.0.0 | `code` | normalize | normalize | — | Account code on journal line is trimmed and upper-cased. |
| `JRL-011` | 1.0.0 | `debit_amount` | normalize | normalize | — | Debit amount is trimmed and commas removed. |
| `JRL-012` | 1.0.0 | `credit_amount` | normalize | normalize | — | Credit amount is trimmed and commas removed. |
| `JRL-013` | 1.0.0 | `line_narration` | normalize | normalize | — | Line narration is trimmed. |
| `JRL-014` | 1.0.0 | `department_ref` | normalize | normalize | — | Department reference is trimmed and upper-cased. |
| `JRL-020` | 1.0.0 | `debit_amount` | invariant | reject | `NEGATIVE_AMOUNT` | Debit amount cannot be negative. |
| `JRL-021` | 1.0.0 | `credit_amount` | invariant | reject | `NEGATIVE_AMOUNT` | Credit amount cannot be negative. |
| `JRL-022` | 1.0.0 | `debit_amount` | invariant | reject | `LINE_DEBIT_AND_CREDIT` | A journal line cannot have both debit and credit positive (mutually exclusive). |
| `JRL-023` | 1.0.0 | `debit_amount` | invariant | reject | `LINE_ZERO_AMOUNTS` | A journal line must have at least one non-zero side. |
| `JRL-024` | 1.0.0 | `debit_amount` | format | reject | `EXCESS_DECIMAL_PLACES` | Journal line amount cannot exceed 4 decimal places. |
| `JRL-025` | 1.0.0 | `debit_amount` | length | reject | `AMOUNT_OVERFLOW` | Journal line amount exceeds numeric(20,4) precision. |
| `JRL-026` | 1.0.0 | `line_narration` | length | reject | `LINE_NARRATION_TOO_LONG` | Line narration cannot exceed 255 characters. |
| `JRL-027` | 1.0.0 | `department_ref` | reference | reject | `DEPARTMENT_NOT_FOUND` | Referenced department does not exist in ERP-5. |
| `JRL-030` | 1.0.0 | `parent_source_id` | invariant | review | `PARENT_ENTRY_IN_REVIEW` | Parent journal entry is held for review; line cannot be loaded. |
| `JRL-031` | 1.0.0 | `parent_source_id` | invariant | reject | `PARENT_ENTRY_REJECTED` | Parent journal entry was rejected; line cannot be loaded. |
