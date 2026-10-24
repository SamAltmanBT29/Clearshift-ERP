# ERP-1 Products & Inventory — V1 Demo (About 5 minutes, synthetic data, no manual SQL)

Prerequisites: clean checkout, Node 24, stack running (`npm run compose:up && npm run db:migrate`), API running (see `apps/api`).

```bash
export BASE_URL=http://localhost:3000          # wherever the Fastify API listens
export API=$BASE_URL/api/v1/erp-products
export AUTH="Authorization: Bearer demo-token" # optional if auth is bypassed locally
```

**Automated in-process version (no external server required):**
```bash
npx vitest run apps/erp/modules/erp-1/tests/e2e apps/erp/modules/erp-1/tests/seed
```

---

## 0:00 Seed Execution (Deterministic & Idempotent)
```bash
ERP1_BASE_URL=$BASE_URL node sample-data/erp-1/seed.ts
```
**Talk track:**
- 3 categories, 3 products, and 3 opening stock levels loaded strictly through the public API (`/api/v1/erp-products/*`).
- Re-run the command immediately: returns the exact same IDs without duplicating rows or raising unique constraint errors.

---

## 1:00 Category and Product Catalog: Search & Filter
```bash
curl -s "$API/products?search=hammer" -H "$AUTH" | jq '.items[] | {name, sku, unitOfMeasure, price, currency, quantity}'
```
**Expected response:**
```json
{
  "name": "Professional Claw Hammer 16oz",
  "sku": "SKU-HAMMER-01",
  "unitOfMeasure": "pcs",
  "price": "24.5000",
  "currency": "USD",
  "quantity": "150.0000"
}
```
**Talk track:**
- All prices are formatted with exact 4-decimal NUMERIC precision.
- Quantity represents stock-on-hand in the single default warehouse (WH-01).

---

## 2:00 Product Creation with Explicit Currency
```bash
curl -s -X POST $API/products -H "$AUTH" -H 'content-type: application/json' \
  -d '{
    "name": "Standard Steel Hex Nut M8",
    "sku": "SKU-NUT-M8",
    "unitOfMeasure": "pcs",
    "price": "0.1500",
    "currency": "USD",
    "taxRate": "5.00",
    "description": "Zinc-plated grade 8 hex nut"
  }' | tee /tmp/prod.json | jq '{id, name, sku, price, currency}'
```
**Expected response:**
- HTTP `201 Created` with UUID and version 1.
- Validates explicit uppercase ISO 4217 currency `USD` and allowed unit of measure `pcs`.

---

## 2:45 Duplicate SKU Enforcement (BR-ERP1-01)
```bash
curl -s -X POST $API/products -H "$AUTH" -H 'content-type: application/json' \
  -d '{
    "name": "Conflicting Nut SKU",
    "sku": "sku-nut-m8",
    "unitOfMeasure": "pcs",
    "price": "0.2000",
    "currency": "USD"
  }' | jq '{statusCode, code, message}'
```
**Expected response:**
- HTTP `409 Conflict`:
```json
{
  "statusCode": 409,
  "code": "DUPLICATE_SKU",
  "message": "Product with SKU \"sku-nut-m8\" already exists in the database (BR-ERP1-01)"
}
```
**Talk track:**
- Enforces normalized uppercase exact-key matching. Case variation is rejected before write.

---

## 3:30 Non-Negative Stock Balance (BR-ERP1-02)
```bash
PROD_ID=$(jq -r .id /tmp/prod.json)

# Attempt negative stock quantity (rejected by invariant)
curl -s -X POST $API/stock/opening -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"productId\": \"$PROD_ID\", \"quantity\": \"-25.0000\"}" | jq '{statusCode, code, message}'

# Apply valid positive opening stock
curl -s -X POST $API/stock/opening -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"productId\": \"$PROD_ID\", \"quantity\": \"500.0000\", \"notes\": \"Initial inventory\"}" | jq '{productId, warehouseId, quantity}'
```
**Expected response:**
- First request returns HTTP `422 Unprocessable Entity` (`NEGATIVE_STOCK`).
- Second request returns HTTP `200 OK` with quantity `500.0000`.

---

## 4:15 Category Hierarchy Rule (FR-ERP1-03)
```bash
# Valid category
curl -s -X POST $API/categories -H "$AUTH" -H 'content-type: application/json' \
  -d '{"name": "Fasteners & Fixings", "code": "CAT-FAST"}' | jq '{id, name, code}'

# Attempt nested subcategory (prohibited in V1)
curl -s -X POST $API/categories -H "$AUTH" -H 'content-type: application/json' \
  -d '{"name": "Bolts Subcategory", "code": "CAT-BOLT", "parentId": "00000000-0000-4000-8000-000000000002"}' | jq '{statusCode, code, message}'
```
**Expected response:**
- Nested category rejected with `INVALID_CATEGORY_HIERARCHY`.

---

## 4:45 Verification Suite Summary
```bash
npm run erp1:test
```
**Talk track:**
- Full suite of contract parity, domain invariants, seed idempotency, and error envelope tests passes cleanly.
