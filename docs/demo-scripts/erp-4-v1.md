# ERP-4 Finance & Accounting — V1 Demo Script (5 Minutes, Synthetic Data, No SQL)

Prerequisites: Clean checkout, Node.js 24 LTS, stack running (`npm run compose:up && npm run db:migrate`), API listening on `http://localhost:3000`.

```bash
export BASE_URL=http://localhost:3000
export API=$BASE_URL/api/v1/erp-finance
export AUTH="Authorization: Bearer demo-finance-token"
```

**Automated version (runs complete demo in-process without live server):**
```bash
npx vitest run apps/erp/modules/erp-4/tests/e2e/demo-journey.test.ts apps/erp/modules/erp-4/tests/seed/seed.test.ts
```

---

## 0:00 Seed Execution & Replay Idempotency

Execute the deterministic seed script against the public API:
```bash
ERP4_BASE_URL=$BASE_URL ERP4_AUTH_TOKEN=role:admin node sample-data/erp-4/seed.ts
```
**Talk Track:**
"The seed helper executes exclusively through public endpoints (`/api/v1/erp-finance/*`). It loads 8 accounts, 4 opening balances, and 4 journal entries. When re-executed, every operation produces `replayed: true` with zero duplicate rows created."

---

## 1:00 Chart of Accounts: Query & Account Creation

Query accounts by asset classification:
```bash
curl -s "$API/accounts?type=asset" -H "$AUTH" | jq '{total, items: [.data[] | {code, name, type, currency_code}]}'
```

Create a new petty cash account:
```bash
curl -s -X POST "$API/accounts" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"code":"1090-FLOAT","name":"Petty Cash Float","type":"asset","currency_code":"INR","is_active":true}' | tee /tmp/acc.json | jq
```

Attempt duplicate creation with same code:
```bash
curl -s -X POST "$API/accounts" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"code":"1090-FLOAT","name":"Duplicate Float","type":"asset","currency_code":"INR"}' | jq '{statusCode, code, message}'
```
**Expected Output:** HTTP 201 created on initial request; HTTP 409 `DUPLICATE_CODE` on duplicate attempt.

---

## 2:00 One-Time Opening Balance Load (FR-ERP4-04)

Load opening balance for the new account:
```bash
ACC_ID=$(jq -r .id /tmp/acc.json)
curl -s -X POST "$API/opening-balances" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"batch_id\":\"b4000000-0000-4000-8000-000000000099\",\"balances\":[{\"account_id\":\"$ACC_ID\",\"currency_code\":\"INR\",\"balance_amount\":\"500.0000\",\"as_of_date\":\"2026-04-01\"}]}" | jq '{created: .created | length, skipped: .skipped | length}'
```

Attempt second load on same account:
```bash
curl -s -X POST "$API/opening-balances" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"batch_id\":\"b4000000-0000-4000-8000-000000000099\",\"balances\":[{\"account_id\":\"$ACC_ID\",\"currency_code\":\"INR\",\"balance_amount\":\"300.0000\",\"as_of_date\":\"2026-04-01\"}]}" | jq '{created: .created | length, skipped: .skipped | length, reason: .skipped[0].reason}'
```
**Talk Track:**
"Per ClearShift Migration Kit rules (`source = loaded + rejected + merged + skipped`), opening balances are strictly one-time per account/currency. The second load reports `created: 0, skipped: 1` with a clear explanation rather than corrupting ledger balances."

---

## 3:00 Double-Entry Journal Entry Creation (BR-ERP4-01)

Attempt to create an unbalanced journal entry:
```bash
PERIOD_ID="bbbbbbbb-0001-0001-0001-000000000001"
CASH_ID=$(curl -s "$API/accounts?search=1010-CASH" -H "$AUTH" | jq -r '.data[0].id')

curl -s -X POST "$API/journal-entries" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"period_id\":\"$PERIOD_ID\",\"posting_date\":\"2026-04-15\",\"currency_code\":\"INR\",\"description\":\"Unbalanced entry\",\"lines\":[{\"account_id\":\"$ACC_ID\",\"debit_amount\":\"100.0000\",\"credit_amount\":\"0.0000\"},{\"account_id\":\"$CASH_ID\",\"debit_amount\":\"0.0000\",\"credit_amount\":\"80.0000\"}]}" | jq '{statusCode, code, message}'
```
**Expected Output:** HTTP 400 `VALIDATION_ERROR` stating debits must equal credits.

Now create a valid balanced entry:
```bash
curl -s -X POST "$API/journal-entries" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"period_id\":\"$PERIOD_ID\",\"posting_date\":\"2026-04-15\",\"currency_code\":\"INR\",\"description\":\"Petty cash replenishment\",\"lines\":[{\"account_id\":\"$ACC_ID\",\"debit_amount\":\"150.0000\",\"credit_amount\":\"0.0000\"},{\"account_id\":\"$CASH_ID\",\"debit_amount\":\"0.0000\",\"credit_amount\":\"150.0000\"}]}" | tee /tmp/je.json | jq '{id, entry_number, status, currency_code}'
```
**Expected Output:** HTTP 201 with status `draft`.

---

## 3:45 Posting Guard & Period Controls (BR-ERP4-02)

Post the draft entry to finalize it:
```bash
JE_ID=$(jq -r .id /tmp/je.json)
curl -s -X POST "$API/journal-entries/$JE_ID/post" -H "$AUTH" | jq '{id, entry_number, status, posted_at}'
```
**Expected Output:** Status transitions to `posted` with `posted_at` recorded.

Attempt to modify the posted entry:
```bash
curl -s -X PATCH "$API/journal-entries/$JE_ID" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"description":"Attempt to modify posted entry"}' | jq '{statusCode, code, message}'
```
**Expected Output:** HTTP 422 `ENTRY_IMMUTABLE`. Posted entries can never be modified directly.

---

## 4:30 Trial Balance Verification

Query the trial balance for the current period:
```bash
curl -s "$API/trial-balance?period=2026-04" -H "$AUTH" | jq '{totals: .totals, rowCount: .rows | length}'
```
**Expected Output:**
`totals: { total_debit: "...", total_credit: "...", difference: "0.0000", is_balanced: true }`.

---

## 5:00 Compensating Reversal Entry

Reverse the posted journal entry:
```bash
curl -s -X POST "$API/journal-entries/$JE_ID/reverse" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"reversal_reason":"Correction of erroneous cash replenishment"}' | jq '{original_status: .original.status, reversed_by: .original.reversed_by_entry_id, reversal_status: .reversal.status}'
```
**Expected Output:**
`original_status: "reversed"`, original linked to reversal, `reversal_status: "posted"`.

Re-query the trial balance to confirm net-zero effect:
```bash
curl -s "$API/trial-balance?period=2026-04" -H "$AUTH" | jq '.totals'
```
**Expected Output:**
`difference: "0.0000", is_balanced: true`.

---

## Summary of Gate G4 Evidence

Run all automated test suites to inspect live evidence:
```bash
npm run erp4:test
npm run erp4:e2e
```
All contracts conform, invariants pass, and zero SQL queries or secrets leak in error responses.
