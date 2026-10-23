# ERP-3 Sales Orders & Invoices — V1 Demo (5 Minutes, Synthetic Data, No Direct SQL)

Prereqs: clean checkout, Node 24, API running locally at `http://localhost:3000`.

```bash
export BASE_URL=http://localhost:3000
export API=$BASE_URL/api/v1/erp-orders
export AUTH="Authorization: Bearer demo-token"
```

**Automated test verification (no server needed):**
```bash
npx vitest run apps/erp/modules/erp-3/tests packages/contracts/tests/erp-3*
```

---

## 0:00 Seed (Idempotent via Public API)

```bash
ERP3_BASE_URL=$BASE_URL node sample-data/erp-3/seed.ts
```
**Talking point**: Loads baseline sales orders through the public API (`/api/v1/erp-orders/sales-orders`). Re-running is a no-op due to idempotent design.

---

## 1:00 Sales Order: Server-Computed Totals & Tax (`BR-ERP3-01`, `BR-ERP3-02`)

```bash
curl -s -X POST $API/sales-orders -H "$AUTH" -H 'content-type: application/json' \
  -d '{
    "order_number": "SO-DEMO-001",
    "customer_golden_id": "c0000000-0000-4000-8000-000000000001",
    "order_date": "2026-10-23",
    "currency": "USD",
    "total": "1.0000",
    "lines": [
      {
        "product_id": "5eed0000-0000-4000-8000-0000000000a1",
        "quantity": "2.0000",
        "price": "100.0000",
        "tax_rate": "10.0000"
      }
    ]
  }' | tee /tmp/so.json | jq '{id, order_number, status, total, lines}'
```
**Expected**: Status `Open`, line total `220.0000`, order total `220.0000`. The client's provided total of `1.0000` is completely ignored and overwritten by authoritative server-side calculation.

---

## 2:00 Customer Golden ID Validation (`BR-ERP3-03`)

```bash
# Missing customer golden ID
curl -s -X POST $API/sales-orders -H "$AUTH" -H 'content-type: application/json' \
  -d '{
    "order_date": "2026-10-23",
    "currency": "USD",
    "lines": [{"product_id": "5eed0000-0000-4000-8000-0000000000a1", "quantity": "1.0000", "price": "10.0000", "tax_rate": "0.0000"}]
  }' | jq '{statusCode, error, code}'
```
**Expected**: `400 VALIDATION_ERROR`. Every sales order and invoice must link to a valid customer Golden ID.

---

## 2:45 Sales Order Lifecycle & Status Transitions (`FR-ERP3-05`)

```bash
SO_ID=$(jq -r .id /tmp/so.json)

# Allowed forward transition: Open -> Invoiced
curl -s -X PATCH $API/sales-orders/$SO_ID -H "$AUTH" -H 'content-type: application/json' \
  -d '{"status":"Invoiced"}' | jq '{id, status}'

# Illegal backward transition: Invoiced -> Open
curl -s -X PATCH $API/sales-orders/$SO_ID -H "$AUTH" -H 'content-type: application/json' \
  -d '{"status":"Open"}' | jq '{statusCode, code, message}'
```
**Expected**: First update returns 200 with status `Invoiced`. The backward transition is rejected with `422 INVALID_STATUS_TRANSITION`.

---

## 3:30 Billing Invoice & 1:1 Invoicing Invariant (`FR-ERP3-02`)

```bash
curl -s -X POST $API/invoices -H "$AUTH" -H 'content-type: application/json' \
  -d "{
    \"invoice_number\": \"INV-DEMO-001\",
    \"order_id\": \"$SO_ID\",
    \"customer_golden_id\": \"c0000000-0000-4000-8000-000000000001\",
    \"invoice_date\": \"2026-10-23\",
    \"due_date\": \"2026-11-23\",
    \"currency\": \"USD\",
    \"lines\": [
      {
        \"product_id\": \"5eed0000-0000-4000-8000-0000000000a1\",
        \"quantity\": \"2.0000\",
        \"price\": \"100.0000\",
        \"tax_rate\": \"10.0000\"
      }
    ]
  }" | tee /tmp/inv.json | jq '{id, invoice_number, status, due_date, total}'

# Attempting duplicate invoice for the same sales order
curl -s -X POST $API/invoices -H "$AUTH" -H 'content-type: application/json' \
  -d "{
    \"order_id\": \"$SO_ID\",
    \"customer_golden_id\": \"c0000000-0000-4000-8000-000000000001\",
    \"invoice_date\": \"2026-10-23\",
    \"due_date\": \"2026-11-23\",
    \"lines\": [{\"product_id\": \"5eed0000-0000-4000-8000-0000000000a1\", \"quantity\": \"1.0000\", \"price\": \"10.0000\", \"tax_rate\": \"0.0000\"}]
  }" | jq '{statusCode, code, message}'
```
**Expected**: First call creates invoice with `Open` status and mandatory `due_date`. Second call returns `422 ORDER_ALREADY_INVOICED` (each sales order has at most one V1 invoice).

---

## 4:15 Payments & Automatic Settlement (`FR-ERP3-03`, `FR-ERP3-04`)

```bash
INV_ID=$(jq -r .id /tmp/inv.json)

# Partial payment rejected in V1
curl -s -X POST $API/payments -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"invoice_id\":\"$INV_ID\",\"amount\":\"100.0000\",\"payment_method\":\"bank\"}" | jq '{statusCode, code}'

# Full payment accepted (amount == invoice.total == 220.0000)
curl -s -X POST $API/payments -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"invoice_id\":\"$INV_ID\",\"amount\":\"220.0000\",\"payment_method\":\"bank\"}" | jq '{id, amount, method}'

# Verify invoice is now automatically Paid
curl -s $API/invoices/$INV_ID -H "$AUTH" | jq '{id, invoice_number, status, total}'
```
**Expected**: Partial payment rejected with `422 PARTIAL_PAYMENT_NOT_ALLOWED`. Full payment succeeds with 201 Created and transitions the invoice status automatically to `Paid`.

---

## 5:00 Wrap-Up

```bash
# Verify paged collections
curl -s "$API/sales-orders?pageSize=10" -H "$AUTH" | jq '{total, count: (.data | length)}'
curl -s "$API/invoices?status=Paid" -H "$AUTH" | jq '{total, paid_invoices: [.data[].invoice_number]}'
curl -s "$API/payments" -H "$AUTH" | jq '{total, payments: [.data[] | {id, amount}]}'
```
