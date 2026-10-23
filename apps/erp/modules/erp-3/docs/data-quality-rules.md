# ERP-3 Sales Orders & Invoices — V1 Data-Quality Rules

Rule catalogue version: **1.0.0**  
Code: [`apps/erp/modules/erp-3/src/migration/rules.ts`](../src/migration/rules.ts)  
Tests: [`apps/erp/modules/erp-3/tests/migration/rules.test.ts`](../tests/migration/rules.test.ts)  
Synthetic Dirty Pack: [`sample-data/erp-3/dirty-data-v1.csv`](../../../../sample-data/erp-3/dirty-data-v1.csv)  
Expected Profile: [`sample-data/erp-3/expected-profile.json`](../../../../sample-data/erp-3/expected-profile.json)  
Mapping Template: [`sample-data/erp-3/mapping-template.json`](../../../../sample-data/erp-3/mapping-template.json)  

**Traceability**: SDS ClearShift ERP v2.0 V1 — FR-ERP3-01..05, BR-ERP3-01..03; Project Plan v3.0 §7.8.

---

## 1. Principles & Non-Negotiable Invariants

1. **Raw Input Immutability (BR-KIT-03)**:
   Source CSV data is parsed into frozen raw records. Profiling, cleaning, and normalization create new projections; raw strings and input hashes are never mutated.
2. **Deterministic Profiling**:
   Executing the rule engine on the committed synthetic fixture with the same rule catalogue version yields a byte-equivalent profile report (`expected-profile.json`) with verified SHA-256 fingerprint.
3. **Deterministic Exact Duplicate Matching Only (No Fuzzy Auto-Merge)**:
   - Duplicates are evaluated strictly against normalized exact candidate keys:
     - Sales orders: `order_number` (`SO-030`)
     - Invoices: `invoice_number` (`INV-030`)
     - Payments: `payment_number` (`PAY-030`)
   - Candidate duplicates receive terminal outcome `review` and are held in the human review queue. No automatic or destructive merging occurs in V1.
4. **Mandatory Customer Golden ID (BR-ERP3-03 / ADR-003)**:
   Every sales order and invoice must reference a valid Hub Customer Golden ID (UUID). Missing or malformed customer IDs are rejected.
5. **Authoritative Server-Side Decimal Arithmetic (BR-ERP3-01, BR-ERP3-02)**:
   - Order and invoice totals are calculated server-side:
     $$\text{subtotal} = \text{quantity} \times \text{unit\_price}$$
     $$\text{tax\_amount} = \frac{\text{subtotal} \times \text{tax\_rate}}{100}$$
     $$\text{line\_total} = \text{subtotal} + \text{tax\_amount}$$
     $$\text{order\_total} = \sum \text{line\_total}$$
   - Decimal values are represented using exact 4-decimal-place scaled arithmetic (`NUMERIC(14,4)`).
6. **Mandatory Invoice Due Date & Overdue Derivation (FR-ERP3-02)**:
   Invoices require a valid `due_date` ($\ge \text{invoice\_date}$). An unpaid invoice transitions to `Overdue` when the current UTC calendar date is strictly after `due_date`, otherwise `Open`.
7. **Single V1 Invoice Per Sales Order (FR-ERP3-02)**:
   Each sales order may be linked to at most one invoice in V1. Subsequent invoices targeting the same sales order are rejected (`ORDER_ALREADY_INVOICED`).
8. **Single Full Payment Settlement (FR-ERP3-03, FR-ERP3-04)**:
   V1 accepts exactly one full payment per invoice ($\text{amount} = \text{invoice.total}$). Partial payments, overpayments, and subsequent payments on an already settled invoice are rejected (`PARTIAL_PAYMENT_NOT_ALLOWED`, `OVERPAYMENT_REJECTED`, `MULTIPLE_PAYMENTS_REJECTED`).
9. **Automatic Invoice Settlement (FR-ERP3-04)**:
   When an accepted full payment matches the invoice total, the invoice status transitions to `Paid` automatically.
10. **CSV Formula Injection Neutralization (PLT-12 / KIT-16)**:
    Fields starting with spreadsheet formula execution triggers (`=`, `+`, `-`, `@`, `\t`, `\r`) are rejected (`FORMULA_INJECTION_DETECTED`).

---

## 2. Row Outcomes & Reconciliation

Every parsed source row maps to exactly one terminal outcome:
- **`accepted`**: Validated and cleaned; ready for ingestion through module public REST endpoints.
- **`rejected`**: Failed one or more business/format rules; not loaded; lists stable reason codes.
- **`review`**: Exact duplicate candidate; held for human decision in the review queue; never loaded automatically.
- **`skipped`**: Source row skipped for an approved reason (0 in canonical V1 fixture).

Reconciliation equation:
$$\text{source} = \text{accepted} + \text{rejected} + \text{review} + \text{skipped}$$
$$\text{unaccounted} = 0$$

In the canonical V1 Dirty Data Pack (`sample-data/erp-3/dirty-data-v1.csv`):
- **Total rows**: 60
- **Reconciliation**:
  - `accepted`: 19
  - `rejected`: 37
  - `review`: 4
  - `skipped`: 0
  - `unaccounted`: 0 (`is_balanced: true`)

### Breakdown by Entity

| Record Type | Total | Accepted | Rejected | Review | Skipped |
|---|---|---|---|---|---|
| `sales_order` | 21 | 4 | 16 | 1 | 0 |
| `so_line` | 14 | 6 | 7 | 1 | 0 |
| `invoice` | 11 | 4 | 6 | 1 | 0 |
| `invoice_line` | 3 | 2 | 1 | 0 | 0 |
| `payment` | 11 | 3 | 7 | 1 | 0 |
| **Total** | **60** | **19** | **37** | **4** | **0** |

---

## 3. Fields, Required vs. Optional, and Enumerations

| Entity | Required Fields | Optional Fields | Enumerations / Allowed Sets |
|---|---|---|---|
| **Sales Order** | `source_id`, `order_number`, `customer_golden_id`, `order_date`, `currency`, `lines` ($\ge 1$) | `order_status` (default `Open`), `notes` | `order_status` $\in$ {`Open`, `Invoiced`, `Closed`}; `currency` $\in$ {`USD`, `EUR`, `INR`} |
| **SO Line** | `source_id`, `parent_source_id`, `product_id`, `quantity` ($> 0$), `unit_price` ($\ge 0$), `tax_rate` ($0..100$) | `line_number`, `description` | N/A |
| **Invoice** | `source_id`, `invoice_number`, `customer_golden_id`, `invoice_date`, `due_date` ($\ge \text{date}$), `currency` | `parent_source_id` (linked sales order), `notes` | `invoice_status` $\in$ {`Open`, `Paid`, `Overdue`}; `currency` $\in$ {`USD`, `EUR`, `INR`} |
| **Invoice Line** | `source_id`, `parent_source_id`, `product_id`, `quantity` ($> 0$), `unit_price` ($\ge 0$), `tax_rate` ($0..100$) | `line_number`, `description` | N/A |
| **Payment** | `source_id`, `parent_source_id` (invoice), `payment_date`, `payment_amount` ($> 0$), `payment_method` | `payment_number`, `payment_reference` | `payment_method` $\in$ {`cash`, `bank`, `card`} |

---

## 4. Normalization Rules

| Entity / Field | Rule ID | Transformation Applied |
|---|---|---|
| `sales_order.order_number` | `SO-010` | Trim leading/trailing whitespace; convert to uppercase. |
| `sales_order.currency` | `SO-011` | Trim whitespace; convert to uppercase. |
| `sales_order.order_status` | `SO-012` | Trim whitespace; map case-insensitively to title case (`Open`, `Invoiced`, `Closed`). |
| `sales_order.notes` | `SO-013` | Trim whitespace; collapse consecutive inner spaces. |
| `so_line.quantity` | `SOL-010` | Trim whitespace; strip commas (`1,000.00` $\to$ `1000.00`). |
| `so_line.unit_price` | `SOL-011` | Trim whitespace; strip commas. |
| `so_line.tax_rate` | `SOL-012` | Trim whitespace. |
| `invoice.invoice_number` | `INV-010` | Trim whitespace; convert to uppercase. |
| `invoice.currency` | `INV-011` | Trim whitespace; convert to uppercase. |
| `payment.payment_method` | `PAY-010` | Trim whitespace; convert to lowercase (`cash`, `bank`, `card`). |
| `payment.payment_number` | `PAY-011` | Trim whitespace; convert to uppercase. |

---

## 5. Candidate Keys & Duplicate Review Policy

V1 does not apply fuzzy deduplication or automatic destructive merging.
When an exact candidate key collision occurs:
- The earlier row is evaluated normally.
- Subsequent occurrences receive terminal outcome `review` and reason code `DUPLICATE_<ENTITY>_REVIEW`.
- Child rows of a header in review receive outcome `review` with reason `PARENT_<ENTITY>_IN_REVIEW`.

Candidate keys:
- Sales orders: `order_number` (`SO-030` $\to$ `DUPLICATE_ORDER_NUMBER_REVIEW`)
- Invoices: `invoice_number` (`INV-030` $\to$ `DUPLICATE_INVOICE_NUMBER_REVIEW`)
- Payments: `payment_number` (`PAY-030` $\to$ `DUPLICATE_PAYMENT_REVIEW`)

---

## 6. Financial Reconciliation by Currency

Accepted fixture rows aggregate deterministically by currency:

| Currency | Order Total | Invoice Total | Payment Total | Order Count | Invoice Count | Payment Count |
|---|---|---|---|---|---|---|
| **USD** | `787.0000` | `655.0000` | `655.0000` | 2 | 1 | 1 |
| **EUR** | `300.0000` | `300.0000` | `0.0000` | 1 | 1 | 0 |
| **INR** | `926.0000` | `1571.0000` | `1571.0000` | 1 | 2 | 2 |
