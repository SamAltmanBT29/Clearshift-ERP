# ERP-2 Vendors & Purchasing - V1 demo (about 5 minutes, synthetic data, no SQL)

Prereqs: clean checkout, Node 24, stack up (`npm run compose:up && npm run db:migrate`), API running (see `apps/api`).
```bash
export BASE_URL=http://localhost:3000          # wherever the API listens
export API=$BASE_URL/api/v1/erp-vendors
export AUTH="Authorization: Bearer demo-token" # drop if auth is off locally
```
Product ids must exist in ERP-1. Fixture ids are used below; override with `ERP2_PRODUCT_IDS=id1,id2,id3`.

**Automated version (no server needed):** `npx vitest run apps/erp/modules/erp-2/tests/e2e apps/erp/modules/erp-2/tests/seed`

## 0:00 Seed (idempotent)
```bash
ERP2_BASE_URL=$BASE_URL ERP2_AUTH_TOKEN=demo-token node sample-data/erp-2/seed.ts
```
Say: 3 vendors and 3 purchase orders loaded through the public API; run it again, nothing duplicates (idempotency keys + durable receipts).

## 1:00 Vendors: search + masking
```bash
curl -s "$API/vendors?search=north" -H "$AUTH" | jq '.items[] | {name, tax_number, bank_masked}'
```
Expect `bank_masked: "XXXX-XXXX-7890"`. Raw bank number never appears in any response.

## 1:45 Create a vendor, then a duplicate
```bash
curl -s -X POST $API/vendors -H "$AUTH" -H 'content-type: application/json' \
  -d '{"name":"Demo Vendor","tax_number":"TX-DEMO-1","email":"demo@vendor.example","bank_details":"123456787890","currency":"USD"}' | tee /tmp/v.json | jq
curl -s -X POST $API/vendors -H "$AUTH" -H 'content-type: application/json' \
  -d '{"name":"Dup","tax_number":"TX-DEMO-1","email":"d@vendor.example"}' | jq '{statusCode,code}'
```
Expect 201 then 409 `DUPLICATE_TAX_NUMBER`.

## 2:30 Purchase order, server-side total
```bash
VID=$(jq -r .id /tmp/v.json)
curl -s -X POST $API/purchase-orders -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"vendor_id\":\"$VID\",\"order_date\":\"2026-10-23\",\"currency\":\"USD\",\"total\":\"1.00\",
       \"lines\":[{\"product_id\":\"5eed0000-0000-4000-8000-0000000000a1\",\"quantity\":\"10.00\",\"price\":\"15.50\"},
                  {\"product_id\":\"5eed0000-0000-4000-8000-0000000000a2\",\"quantity\":\"3.00\",\"price\":\"20.25\"}]}" | tee /tmp/po.json | jq '{id,status,total}'
```
Expect `Draft`, total `215.75` (the client's `1.00` is ignored). Unknown product id -> 422 `UNKNOWN_PRODUCT`.

## 3:30 Status flow
```bash
PID=$(jq -r .id /tmp/po.json)
patch(){ curl -s -X PATCH $API/purchase-orders/$PID -H "$AUTH" -H 'content-type: application/json' -d "{\"status\":\"$1\"}" | jq -c '{statusCode,status,code}'; }
patch Received   # 422 INVALID_STATUS_TRANSITION (skip)
patch Sent; patch Received; patch Closed   # each 200
patch Draft      # 422 (no going back)
```
Say: no cancellation in V1; Received does not touch inventory (goods receipts are V2).

## 4:30 Wrap-up
```bash
curl -s "$API/purchase-orders?status=Closed" -H "$AUTH" | jq '{total, numbers: [.items[].po_number]}'
npx vitest run apps/erp/modules/erp-2
```
Point to: test results, `packages/contracts/openapi/erp-2.yaml`, `apps/erp/modules/erp-2/docs/data-dictionary.md`.
