```{=typst}
#page(header: none, numbering: none)[
  #align(center + horizon)[
    #text(size: 32pt, weight: "bold")[ClearShift]
    #v(8pt)
    #text(size: 14pt)[Data Migration and Cleanup for ERP and CRM]
    #v(26pt)
    #line(length: 38%, stroke: 0.8pt + black)
    #v(26pt)
    #text(size: 19pt, weight: "bold")[Software Design Specification:]
    #v(4pt)
    #text(size: 19pt, weight: "bold")[ClearShift ERP]
    #v(6pt)
    #text(size: 12pt)[White paper — Version 1.0]
    #v(30pt)
    #text(size: 10.5pt)[Prepared by: ClearShift PMO + ERP groups 6-10]
    #v(4pt)
    #text(size: 10.5pt)[Student software project — 12-week plan — 11 groups]
    #v(4pt)
    #text(size: 10.5pt)[Language level: B1 (simple English, technical words are explained)]
    #v(4pt)
    #text(size: 10.5pt)[Date: 15 October 2026 — Print style: black and white]
    #v(4pt)
    #text(size: 10.5pt)[Status: Draft for Gate G1 (Design Gate)]
  ]
]
#pagebreak()
#align(center)[#outline(title: [Table of Contents], depth: 3)]
#pagebreak()
```

# 1. Purpose and Scope

## 1.1 What this document is

This document is the **Software Design Specification (SDS)** for **ClearShift ERP**. An SDS is a detailed description of a software system: what it does, what data it keeps, what screens it shows, what APIs it offers, and what rules must always be true.

Read it together with:

| Document | What it gives you |
|---|---|
| Project Plan and Team Guide | People, roles, dates, gates, quality rules |
| SDS: ClearShift CRM | The same specification for the CRM side |
| SDS: ClearShift Migration Kit | The full detail of the pipeline that moves and cleans data |

## 1.2 What ClearShift ERP is

**ClearShift ERP** is a small Enterprise Resource Planning system (software that runs the inside of a business: stock, buying, orders, invoices, money, staff). It has 5 modules:

| Module | Group | What it holds |
|---|---|---|
| **ERP-1** Products and Inventory | Group 6 | What the company sells and how much stock it has (product master data) |
| **ERP-2** Vendors and Purchasing | Group 7 | Suppliers and purchase orders |
| **ERP-3** Sales Orders and Invoices | Group 8 | What customers ordered and what was billed |
| **ERP-4** Finance and Accounting | Group 9 | Accounts, journal entries, financial reports |
| **ERP-5** HR and Employees | Group 10 | Employees, departments, leave, and the user list |

## 1.3 Why this ERP exists in the project

ClearShift migrates data into ERP systems. To do that well, we must understand the target system. This ERP is our **test target system**. Real clients will use their own ERP (for example Odoo or ERPNext), and our Migration Kit will move data into those systems. Practising here proves that the Kit works.

> **The ERP is a test bed, not a product to sell.** The Migration Kit is the product.

## 1.4 Users and roles

| Role | What they can do |
|---|---|
| **Viewer** | Read records and reports. No changes. |
| **Editor** | Create, change records in the ERP modules. |
| **Migration runner** | Technical role for the Kit: load data, run dry runs. |
| **Analyst** | Read CRM-5 dashboards and finance reports. |
| **Admin** | Everything, plus users and settings. |

One shared login (JWT-based, run by the Hub) serves all modules.

## 1.5 What is out of scope (not in this SDS)

- Real banking, real tax filing, real payroll calculations.
- Barcode scanners and warehouse hardware.
- Multi-company groups (one company only).
- Real personal data — **fake or synthetic data only**.

## 1.6 The one rule that defines this ERP

**Debit = credit, always.** Every accounting entry must balance. An unbalanced entry is never loaded — it is rejected with a written reason. This single rule is what makes accounting data trustworthy, and it is tested in every version.

# 2. How to Read This Specification

## 2.1 The three parts

| Part | Chapter | Ready at | Gate |
|---|---|---|---|
| **V1 — Minimum deliverable** (small, but looks complete) | 4 | End of Week 8 | G4 |
| **V2 — Better enhancements** | 5 | End of Week 10 | G5 |
| **V3 — Complete version** (final demo) | 6 | End of Week 12 | G6 |

**Rule: never start V2 requirements while V1 requirements still have open critical bugs.**

## 2.2 Requirement IDs

| Prefix | Meaning | Example |
|---|---|---|
| `FR-<module>-nn` | Functional requirement (a feature) | `FR-ERP1-03` = ERP-1, requirement 3 |
| `BR-<module>-nn` | Business rule (a law of the data) | `BR-ERP4-01` = debit = credit |
| `NFR-nn` | Non-functional requirement (speed, security) | `NFR-02` |
| `EV-nn` | Event (message to the Hub) | `EV-05` |
| `TS-nn` | Test scenario (proof) | `TS-05` |

Priority words: **Must** (without it, no delivery), **Should** (if time allows), **Could** (bonus after all Must items work).

## 2.3 B1 note

This document uses simple English (level B1). Technical words are used when they are the correct word, and they are explained in the glossary (Chapter 10).

# 3. Overall Architecture (all three versions)

## 3.1 The shape of the system

```
 Browser (React + TypeScript screens)
            |
            v
 ERP API (NestJS / Node.js, one service per module)
            |
            +-------------------+
            |                   |
            v                   v
 PostgreSQL schema          ClearShift Hub
 erp1_products, ...         (login, Golden ID,
 erp5_hr, ...                events, batches)
```

Each module owns its own **schema** (a named group of tables) in one PostgreSQL database. Modules never read each other's tables — they use APIs and events. The only shared truth for a customer is the Golden ID from the Hub.

## 3.2 Shared technical rules (all modules)

| Area | Rule |
|---|---|
| API path style | `/api/v1/<module>/<resource>` |
| Data format | JSON only |
| Paging | Every list API accepts `page` and `pageSize` |
| Error format | `{ "code": "...", "message": "...", "details": [...] }` |
| Timestamps | ISO 8601, stored in UTC, shown in local time |
| Money | Stored as `numeric(19,4)` (exact decimal, never floating point), with a currency column |
| Quantities | `numeric(19,4)`; units follow the product's unit of measure |
| IDs | UUID for records; Golden ID from the Hub for customers |
| Naming | `snake_case` for tables and columns; events `<noun>.<past_verb>` |
| Audit fields | `created_at`, `updated_at`, `created_by` on every table |
| Secrets | Never in code. The DevOps Lead provides them safely. |
| Data | Fake or synthetic only. Real personal or salary data is forbidden. |

> **Why exact decimals for money:** floating point numbers (like 0.1 + 0.2) can produce 0.30000000000000004. In accounting this is a bug that destroys trust. Databases have an exact decimal type; we use it.

## 3.3 Data layers

| Layer | Schema | Rule |
|---|---|---|
| Raw copy | `raw_erp1`, ... | Exact copy of the source. Never edited. |
| Staging | `stg_erp1`, ... | Raw plus `batch_id`, `source_row`, `status`, `reject_reason` |
| Clean | `clean_erp1`, ... | Cleaned and mapped, ready to load |
| Target | `erp1_products`, ... | The real module tables |

# 4. Part V1 — Minimum Deliverable Specification

V1 is small but **complete**: the core entity of every module works, the kit runs on the Dirty Data Pack, and the demo passes.

## 4.1 V1 scope

| In V1 | Out of V1 (moves to V2/V3) |
|---|---|
| ERP-1: products, one-level categories, one warehouse, stock, one price | Adjustments, alerts, second price list |
| ERP-2: vendors, purchase orders with lines, status | Goods receipts, approvals |
| ERP-3: sales orders, invoices, payments, status | PDF, partial payments, credit notes |
| ERP-4: chart of accounts, journal entries, trial balance | Mapping screen, P&L, period close |
| ERP-5: employees, departments, leave record, users | Workflows, org chart |

## 4.2 Functional requirements V1 — ERP-1 Products and Inventory

| ID | Requirement | Priority |
|---|---|---|
| FR-ERP1-01 | Product list with search by name and SKU (stock code), paged. | Must |
| FR-ERP1-02 | Create and edit a product: name, SKU, category link, unit of measure, price, tax rate percent. | Must |
| FR-ERP1-03 | Categories: one level only (name, code). | Must |
| FR-ERP1-04 | Units of measure from a fixed list: pcs, kg, g, litre, metre, box. | Must |
| FR-ERP1-05 | One warehouse in V1; stock quantity per product. | Must |
| FR-ERP1-06 | Stock screen: product, warehouse, quantity, and a warning colour when quantity is 0. | Must |
| FR-ERP1-07 | Opening stock load: set the starting quantity per product (used by the kit). | Must |
| BR-ERP1-01 | **SKU is unique.** Two products can never share a SKU. | Must |
| BR-ERP1-02 | **No negative stock.** A stock quantity below 0 is blocked with a clear error. | Must |

## 4.3 Functional requirements V1 — ERP-2 Vendors and Purchasing

| ID | Requirement | Priority |
|---|---|---|
| FR-ERP2-01 | Vendor list with search by name. | Must |
| FR-ERP2-02 | Create and edit a vendor: name, tax number, email, phone, address, bank details (masked). | Must |
| FR-ERP2-03 | Purchase order with lines: vendor link, date, status, lines (product link, quantity, price). | Must |
| FR-ERP2-04 | Purchase order status: Draft / Sent / Received / Closed. | Must |
| FR-ERP2-05 | The order total is calculated from the lines (not typed by hand). | Must |
| FR-ERP2-06 | Bank details are masked everywhere: screens and logs show `XXXX-XXXX-7890`. | Must |
| BR-ERP2-01 | A purchase line must reference an existing product. Unknown product = rejected row. | Must |

## 4.4 Functional requirements V1 — ERP-3 Sales Orders and Invoices

| ID | Requirement | Priority |
|---|---|---|
| FR-ERP3-01 | Sales order with lines: customer Golden ID, date, status, lines (product, quantity, price). | Must |
| FR-ERP3-02 | Invoice: invoice number (unique), date, customer, lines, total, status (Open / Paid / Overdue). | Must |
| FR-ERP3-03 | Payment record: invoice link, amount, date, method (cash / bank / card). | Must |
| FR-ERP3-04 | When the sum of payments equals the invoice total, the invoice becomes Paid automatically. | Must |
| FR-ERP3-05 | Order status: Open / Invoiced / Closed. | Must |
| BR-ERP3-01 | **Line totals must equal the order total.** A mismatch is blocked. | Must |
| BR-ERP3-02 | Tax per line = line amount multiplied by the product tax rate, rounded to 2 decimals. | Must |
| BR-ERP3-03 | Every order must have a customer Golden ID. An order without a customer is rejected. | Must |

## 4.5 Functional requirements V1 — ERP-4 Finance and Accounting

| ID | Requirement | Priority |
|---|---|---|
| FR-ERP4-01 | Chart of accounts: list of accounts (code, name, type: asset / liability / income / expense). | Must |
| FR-ERP4-02 | Journal entry with lines: date, description, lines (account, debit amount, credit amount). | Must |
| FR-ERP4-03 | Trial balance report: per account the sum of debits and credits, plus totals. | Must |
| FR-ERP4-04 | Opening balances: load the starting balance per account once. | Must |
| FR-ERP4-05 | A closed period (month) rejects new entries with a clear message. | Must |
| BR-ERP4-01 | **Debit = credit in every journal entry.** The system must block an entry where the sums differ. | Must |
| BR-ERP4-02 | Every account code is unique in the chart of accounts. | Must |

## 4.6 Functional requirements V1 — ERP-5 HR and Employees

| ID | Requirement | Priority |
|---|---|---|
| FR-ERP5-01 | Employee list with search by name, paged. | Must |
| FR-ERP5-02 | Create and edit an employee: first name, last name, birth date, join date, department link, job title, salary (masked for viewers). | Must |
| FR-ERP5-03 | Departments: name, code, optional parent department. | Must |
| FR-ERP5-04 | Leave record: employee link, date from, date to, type (sick / holiday / other), status. | Must |
| FR-ERP5-05 | System user list: user, role, linked employee (for "created by" fields). | Must |
| FR-ERP5-06 | Payroll total per month: one number per department, no personal data. | Must |
| BR-ERP5-01 | Join date can never be before the birth date. | Must |
| BR-ERP5-02 | Salary is never shown in full to viewers or in any log: only `XX,XXX` or `salary hidden`. | Must |

## 4.7 Data model V1

### ERP-1 tables

| Table | Key columns |
|---|---|
| `erp1_categories` | id, name, code |
| `erp1_products` | id, name, sku, category_id, unit_of_measure, price, currency, tax_rate, source_system, source_id |
| `erp1_warehouses` | id, name, code |
| `erp1_stock_levels` | id, product_id, warehouse_id, quantity |

### ERP-2 tables

| Table | Key columns |
|---|---|
| `erp2_vendors` | id, name, tax_number, email, phone, address_line, city, country, bank_masked, source_system, source_id |
| `erp2_purchase_orders` | id, po_number, vendor_id, order_date, status, total |
| `erp2_po_lines` | id, po_id, product_id, quantity, price, line_total |

### ERP-3 tables

| Table | Key columns |
|---|---|
| `erp3_sales_orders` | id, order_number, customer_golden_id, order_date, status, total |
| `erp3_so_lines` | id, order_id, product_id, quantity, price, tax_rate, line_total |
| `erp3_invoices` | id, invoice_number, order_id, customer_golden_id, invoice_date, total, status |
| `erp3_payments` | id, invoice_id, amount, paid_at, method |

### ERP-4 tables

| Table | Key columns |
|---|---|
| `erp4_accounts` | id, code, name, type (asset/liability/income/expense) |
| `erp4_journal_entries` | id, entry_date, description, period (yyyy-mm), is_opening |
| `erp4_journal_lines` | id, entry_id, account_id, debit, credit |
| `erp4_opening_balances` | id, account_id, amount, currency |

### ERP-5 tables

| Table | Key columns |
|---|---|
| `erp5_departments` | id, name, code, parent_id |
| `erp5_employees` | id, first_name, last_name, birth_date, join_date, department_id, job_title, salary, source_system, source_id |
| `erp5_leave` | id, employee_id, date_from, date_to, type, status |
| `erp5_users` | id, username, role, employee_id |

## 4.8 API specification V1

| Method | Path | Purpose | Roles |
|---|---|---|---|
| GET | `/api/v1/erp-products/products` | List products (search, paged) | viewer, editor, analyst |
| POST | `/api/v1/erp-products/products` | Create product | editor, migration_runner |
| PATCH | `/api/v1/erp-products/products/{id}` | Edit product | editor, migration_runner |
| GET | `/api/v1/erp-products/categories` | List categories | viewer, editor |
| POST | `/api/v1/erp-products/stock/opening` | Load opening stock (batch) | migration_runner |
| GET | `/api/v1/erp-products/stock` | Stock per product and warehouse | viewer, analyst |
| GET | `/api/v1/erp-vendors/vendors` | List vendors | viewer, editor |
| POST | `/api/v1/erp-vendors/vendors` | Create vendor | editor, migration_runner |
| GET | `/api/v1/erp-vendors/purchase-orders` | List purchase orders | viewer, editor |
| POST | `/api/v1/erp-vendors/purchase-orders` | Create purchase order | editor, migration_runner |
| GET | `/api/v1/erp-orders/sales-orders` | List sales orders | viewer, editor |
| POST | `/api/v1/erp-orders/sales-orders` | Create sales order | editor, migration_runner |
| GET | `/api/v1/erp-orders/invoices` | List invoices | viewer, editor |
| POST | `/api/v1/erp-orders/invoices` | Create invoice | editor, migration_runner |
| POST | `/api/v1/erp-orders/payments` | Record a payment | editor, migration_runner |
| GET | `/api/v1/erp-finance/accounts` | Chart of accounts | viewer, editor, analyst |
| POST | `/api/v1/erp-finance/journal-entries` | Create journal entry (must balance) | editor, migration_runner |
| GET | `/api/v1/erp-finance/trial-balance?period={yyyy-mm}` | Trial balance | viewer, analyst |
| POST | `/api/v1/erp-finance/opening-balances` | Load opening balances | migration_runner |
| GET | `/api/v1/erp-hr/employees` | List employees | viewer, editor |
| POST | `/api/v1/erp-hr/employees` | Create employee | editor, migration_runner |
| GET | `/api/v1/erp-hr/departments` | List departments | viewer, editor |
| GET | `/api/v1/erp-hr/leave` | List leave records | viewer, editor |
| POST | `/api/v1/erp-hr/payroll-totals` | Load payroll totals (per department, per month) | migration_runner |

Sample answer for a blocked journal entry (the error format used everywhere):

```json
{
  "code": "BALANCE_ERROR",
  "message": "Journal entry does not balance. Debit and credit must be equal.",
  "details": [
    { "field": "debit_total", "value": "1200.00" },
    { "field": "credit_total", "value": "1150.00" },
    { "field": "difference", "value": "50.00" }
  ]
}
```

## 4.9 Screens V1

| Screen | Module | What it shows |
|---|---|---|
| Product list / Product form / Stock screen | ERP-1 | Search, create/edit, quantities with warning colour |
| Import wizard (upload, profile, run, result) | ERP-1 | The 4 steps of a kit run |
| Reject list | ERP-1, ERP-5 | Rejected rows with reasons, CSV download |
| Vendor list / Vendor form | ERP-2 | Vendors with masked bank details |
| Purchase order list / Purchase order form | ERP-2 | Orders with lines, calculated total |
| Sales order form / Invoice form / Payment form | ERP-3 | Orders, invoices, payments, status |
| Chart of accounts / Journal entry form / Trial balance | ERP-4 | Accounts, balanced entries, report |
| Employee list / Employee form / Leave list | ERP-5 | Staff data with masked salary |
| Import wizard + reject list | ERP-2 to ERP-5 | Same pattern as ERP-1 |

Every screen: loading state, empty state, error message in simple language.

## 4.10 Events V1

| ID | Event | When | Consumers |
|---|---|---|---|
| EV-01 | `batch.extracted` | Extract finished | Hub, CRM-5 |
| EV-02 | `batch.profiled` | Profile finished | Hub, CRM-5 |
| EV-03 | `batch.cleaned` | Clean finished | Hub, CRM-5 |
| EV-04 | `batch.mapped` | Map finished | Hub, CRM-5 |
| EV-05 | `batch.loaded` | Load finished | Hub, CRM-5, dependent modules |
| EV-06 | `batch.validated` | Validate finished | Hub, CRM-5 |
| EV-07 | `batch.failed` | A step failed hard | Hub, CRM-5, group chat |
| EV-08 | `stock.opening_loaded` | Opening stock loaded | ERP-4 (inventory value) |
| EV-09 | `deal.won` (consumed) | A deal was won in the CRM | ERP-3 creates a sales order |

## 4.11 Migration kit scope V1 (what the kit moves in V1)

| Entity | Source columns | Target table | Known problems in the Dirty Data Pack |
|---|---|---|---|
| Products | name, code, unit, price, category | `erp1_products` | Duplicate SKUs, units "kg/Kg/kilogram", empty prices |
| Opening stock | code, quantity, warehouse | `erp1_stock_levels` | Negative quantities |
| Vendors | name, tax, email, bank | `erp2_vendors` | Same vendor 3 spellings, wrong tax format |
| Purchase orders | number, vendor, date, lines | `erp2_purchase_orders`, `erp2_po_lines` | Lines with unknown products |
| Sales orders | number, customer email, date, lines | `erp3_sales_orders`, `erp3_so_lines` | Totals not matching lines, missing customer |
| Invoices and payments | number, order, amount, date | `erp3_invoices`, `erp3_payments` | Invoices without orders |
| Accounts and journal | code, name, date, debit, credit | `erp4_accounts`, `erp4_journal_entries` | Unbalanced entries, old account codes |
| Employees | name, birth, join, department, salary | `erp5_employees` | Date formats, duplicates, salary in notes |

## 4.12 Acceptance criteria V1 (the demo must pass these)

| ID | Criterion |
|---|---|
| TS-01 | A product CSV with 1,000 rows runs through all 7 steps; the SKU uniqueness rule catches the 30 known duplicate SKUs. |
| TS-02 | Negative stock in the file is rejected with the reason "negative quantity", and reconciliation is exact. |
| TS-03 | A journal entry with debit 1200 and credit 1150 is blocked with `BALANCE_ERROR`. |
| TS-04 | Opening balances load, and the trial balance shows total debit = total credit. |
| TS-05 | An invoice with payments summing to the total becomes Paid automatically. |
| TS-06 | Salary is masked on screen and in logs for every role except Admin and the employee themself. |
| TS-07 | An employee with join date before birth date is rejected with a clear reason. |
| TS-08 | The consent counterpart on the CRM side is not affected by ERP runs (no writes from ERP into CRM tables). |

# 5. Part V2 — Better Enhancements Specification

V2 makes the ERP **stronger and safer**: receipts, real reports, mapping with a human, and rollback.

## 5.1 V2 scope

| In V2 | Out of V2 (moves to V3) |
|---|---|
| Goods receipts, stock adjustments | Warehouse transfers, batch numbers |
| Invoice PDF, credit note, partial payments | Dunning, revenue recognition |
| Account mapping screen, P&L, balance sheet | Hard period close, budgets |
| Leave workflow, org chart | Onboarding, performance |
| Mapping screen + rollback in every module | Cutover rehearsal |

## 5.2 Functional requirements V2

| ID | Module | Requirement | Priority |
|---|---|---|---|
| FR-ERP1-10 | ERP-1 | Stock adjustment with a reason (damage, count, correction) and a log entry. | Must |
| FR-ERP1-11 | ERP-1 | Low stock alert: a card on the dashboard for products below their minimum quantity. | Should |
| FR-ERP1-12 | ERP-1 | Two price lists: sale price and purchase price per product. | Should |
| FR-ERP1-13 | ERP-1 | Category tree mapping in the kit: an old flat category list maps to a new tree with parents. | Must |
| FR-ERP2-10 | ERP-2 | Goods receipt: mark the received quantity per purchase order line; the status moves to Received. | Must |
| FR-ERP2-11 | ERP-2 | Payment terms field on the vendor (for example "30 days"). | Should |
| FR-ERP2-12 | ERP-2 | Purchase report: totals per vendor and per month, CSV export. | Should |
| FR-ERP3-10 | ERP-3 | Invoice PDF download (black and white, company header, lines, total, tax). | Must |
| FR-ERP3-11 | ERP-3 | Partial payments: a payment smaller than the total leaves the invoice Open with a remaining amount. | Must |
| FR-ERP3-12 | ERP-3 | Credit note: a negative invoice linked to the original invoice. | Should |
| FR-ERP3-13 | ERP-3 | Button "create invoice from order": the order lines become invoice lines. | Must |
| FR-ERP4-10 | ERP-4 | Account mapping screen: choose the old account, choose the new account, save as a template. | Must |
| FR-ERP4-11 | ERP-4 | Soft period lock: booking into a closed month shows a warning that must be confirmed. | Must |
| FR-ERP4-12 | ERP-4 | Profit & Loss report (income and expenses per period) and a basic balance sheet. | Should |
| FR-ERP4-13 | ERP-4 | CSV export of the trial balance and the P&L. | Should |
| FR-ERP5-10 | ERP-5 | Leave request workflow: request -> approve / reject, with a log. | Should |
| FR-ERP5-11 | ERP-5 | Simple org chart view (departments with employees). | Could |
| FR-ERP5-12 | ERP-5 | Employment history in the kit: several rows per employee over time become one employee with a history table. | Must |
| FR-ALL-10 | All | **Rollback**: undo a load and restore the tables, with an audit entry. | Must |
| FR-ALL-11 | All | **Mapping screen**: connect source columns to target fields, save the mapping as a named template. | Must |

## 5.3 Data model changes V2

| Change | Table | New columns |
|---|---|---|
| Receipts | `erp2_receipts` (new) | id, po_id, received_at, note |
| Receipt lines | `erp2_receipt_lines` (new) | id, receipt_id, po_line_id, quantity_received |
| Stock movements | `erp1_stock_movements` (new) | id, product_id, warehouse_id, quantity_change, reason, moved_at |
| Price lists | `erp1_prices` (new) | id, product_id, list_type (sale/purchase), price, currency |
| Credit notes | `erp3_credit_notes` (new) | id, invoice_id, amount, note, created_at |
| Mapping templates | `erp5_mappings`? no — `erp_control_mappings` (new) | id, module, name, mapping_json, created_by |
| Employment history | `erp5_employment_history` (new) | id, employee_id, department_id, job_title, from_date, to_date |

## 5.4 API changes V2

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/erp-vendors/receipts` | Create a goods receipt |
| POST | `/api/v1/erp-products/stock/adjustments` | Stock adjustment with reason |
| GET | `/api/v1/erp-products/alerts/low-stock` | Low stock list |
| GET | `/api/v1/erp-orders/invoices/{id}/pdf` | Invoice PDF |
| POST | `/api/v1/erp-orders/credit-notes` | Create credit note |
| POST | `/api/v1/erp-finance/mappings` | Save an account mapping template |
| GET | `/api/v1/erp-finance/reports/pl?period={yyyy-mm}` | Profit & Loss |
| GET | `/api/v1/erp-finance/reports/balance-sheet?period={yyyy-mm}` | Balance sheet |
| POST | `/api/v1/erp-hr/leave/{id}/decision` | Approve or reject leave |
| POST | `/api/v1/erp-control/rollback/{batch}` | Roll back a load |

## 5.5 Events V2

| ID | Event | When |
|---|---|---|
| EV-10 | `batch.rolled_back` | A load was undone |
| EV-11 | `stock.adjusted` | A stock adjustment was made |
| EV-12 | `invoice.paid` | An invoice became fully paid |

## 5.6 Acceptance criteria V2

| ID | Criterion |
|---|---|
| TS-10 | Rollback test: load 1,000 vendors, roll back, verify counts and tables are exactly as before. |
| TS-11 | Mapping template test: save the account mapping, apply it to a new file, the accounts map correctly. |
| TS-12 | Receipt test: order 100, receive 60, then 40, the status becomes Received and the stock is 40 higher. |
| TS-13 | Partial payment: invoice 1,000, pay 400, the invoice stays Open with remaining 600; pay 600 more, it becomes Paid. |
| TS-14 | P&L and trial balance agree on the totals of the same period. |

# 6. Part V3 — Complete Version Specification

V3 is the **final demo version**: all Must features, three-way checks, period close, and the full performance run.

## 6.1 V3 scope

| In V3 |
|---|
| Transfers between warehouses |
| Batch / serial numbers on products |
| Approval workflow on purchase orders (by amount) |
| Three-way match: order, receipt, invoice |
| Hard period close and reopen with a written reason |
| Budget vs actual report |
| Simple bank reconciliation (bank CSV vs payments) |
| Audit trail screen |
| 50,000-record performance run with published numbers |

## 6.2 Functional requirements V3

| ID | Module | Requirement | Priority |
|---|---|---|---|
| FR-ERP1-20 | ERP-1 | Transfer between two warehouses: move quantity from A to B with a log entry; stock is never negative. | Should |
| FR-ERP1-21 | ERP-1 | Batch or serial number per stock movement (text field, optional). | Could |
| FR-ERP2-20 | ERP-2 | Approval workflow: a purchase order above an amount needs a second person (Admin) to approve before it is Sent. | Should |
| FR-ERP2-21 | ERP-2 | Three-way match: the system compares order, receipt and invoice, and shows differences (quantity or price). | Should |
| FR-ERP3-20 | ERP-3 | Dunning list: invoices overdue by more than 30 days, with a printable reminder list (mock sending). | Could |
| FR-ERP3-21 | ERP-3 | Simple revenue recognition: an invoice marked "service" spreads its value over 12 months in the journal. | Could |
| FR-ERP4-20 | ERP-4 | Hard period close: a closed month cannot be changed; reopen needs Admin and a written reason. | Must |
| FR-ERP4-21 | ERP-4 | Budget vs actual: a budget per account per month, compared with the actual sums. | Should |
| FR-ERP4-22 | ERP-4 | Simple bank reconciliation: import a bank CSV, match rows to payments automatically (same amount, same day or plus/minus 3 days), the rest stays open. | Should |
| FR-ERP4-23 | ERP-4 | Audit trail screen: changes to accounts, entries and balances with user and time. | Must |
| FR-ERP5-20 | ERP-5 | Onboarding checklist per new employee (document list, first tasks), with status. | Could |
| FR-ERP5-21 | ERP-5 | Simple performance review: one score and one note per employee per year. | Could |
| FR-ALL-20 | All | Performance run: load 50,000 records in one batch; publish time and memory in the report. | Must |
| FR-ALL-21 | All | Documents: every screen in the user manual with a screenshot and one explanation. | Must |

## 6.3 Data model changes V3

| Change | Table | New columns |
|---|---|---|
| Transfers | `erp1_transfers` (new) | id, from_warehouse, to_warehouse, product_id, quantity, moved_at |
| Batches | `erp1_stock_movements` | `batch_number` (text, optional) |
| Approvals | `erp2_purchase_orders` | `approved_by`, `approved_at` |
| Budgets | `erp4_budgets` (new) | id, account_id, period, amount |
| Bank lines | `erp4_bank_lines` (new) | id, bank_date, amount, matched_payment_id, status |
| Reviews | `erp5_reviews` (new) | id, employee_id, year, score, note |

## 6.4 API changes V3

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/erp-products/transfers` | Warehouse transfer |
| POST | `/api/v1/erp-vendors/purchase-orders/{id}/approve` | Approve a purchase order |
| GET | `/api/v1/erp-vendors/three-way-match/{po}` | Compare order, receipt, invoice |
| POST | `/api/v1/erp-finance/periods/{period}/close` | Hard close a period |
| POST | `/api/v1/erp-finance/periods/{period}/reopen` | Reopen with a reason (Admin) |
| GET | `/api/v1/erp-finance/budget-vs-actual?period={yyyy-mm}` | Budget vs actual |
| POST | `/api/v1/erp-finance/bank/import` | Import a bank CSV |
| GET | `/api/v1/erp-finance/audit` | Audit trail |

## 6.5 Events V3

| ID | Event | When |
|---|---|---|
| EV-20 | `po.approved` | A purchase order was approved |
| EV-21 | `period.closed` | A period was closed |
| EV-22 | `run.alert` | A run failed or a mismatch limit was exceeded |

## 6.6 Acceptance criteria V3

| ID | Criterion |
|---|---|
| TS-20 | Three-way match: order 100, receipt 90, invoice 100 — the screen shows the quantity difference of 10 and blocks the payment suggestion. |
| TS-21 | Period close: close 2025-01, try to post an entry in 2025-01 — blocked; reopen with a reason — allowed; the reopen appears in the audit trail. |
| TS-22 | Bank reconciliation: a bank file with 100 rows matches 92 payments automatically; 8 stay open and are listed. |
| TS-23 | Performance: 50,000 products load in one batch; the time is published; reconciliation is exact. |
| TS-24 | Full end-to-end: products -> purchase -> receipt -> invoice -> journal -> trial balance that balances, with counts from CRM-5. |

# 7. Non-Functional Requirements (all versions)

| ID | Requirement | V1 | V2 | V3 |
|---|---|---|---|---|
| NFR-01 | A list screen with 10,000 rows loads in under 2 seconds. | Target | Measured | Must |
| NFR-02 | A migration run of 10,000 records finishes in under 10 minutes on the demo machine. | Target | Measured | Must |
| NFR-03 | Only logged-in users can call the API (401 otherwise, standard error format). | Must | Must | Must |
| NFR-04 | Role checks on every endpoint (see chapters 4-6). | Must | Must | Must |
| NFR-05 | Salary, bank details and ID numbers are masked in logs, screens and reports. | Must | Must | Must |
| NFR-06 | Secrets never appear in code, logs or the browser. | Must | Must | Must |
| NFR-07 | Money is stored and calculated with exact decimals, never floating point. | Must | Must | Must |
| NFR-08 | Only fake or synthetic data in every environment. | Must | Must | Must |
| NFR-09 | Demo environment works 100% during the final demo. | — | Should | Must |

# 8. Interfaces with Other Systems

| System | Direction | What flows | How |
|---|---|---|---|
| ClearShift Hub | ERP -> Hub | Batch events, run status | Events via the event bus |
| ClearShift Hub | Hub -> ERP-3 | Customer Golden ID | API `/api/v1/hub/id-map` |
| ClearShift Hub | Hub -> ERP | Login (JWT) | Shared login service |
| Migration Kit | Kit -> ERP | Clean records | Module APIs with role `migration_runner` |
| ClearShift CRM | CRM-2 -> ERP-3 | `deal.won` event (creates a sales order) | Event via the Hub |
| ClearShift CRM | CRM-3 <- ERP-3 | Order and invoice status | API `/api/v1/erp-orders/...` |
| ERP-1 -> ERP-2, ERP-3 | Product IDs and prices | Inside the ERP | API |

# 9. Test and Verification Plan Summary

| Level | Tool | Who | V1 | V2 | V3 |
|---|---|---|---|---|---|
| Unit tests | Vitest | Everyone for own code | 100% pass | 100% | 100% |
| API and contract tests | Postman/Newman | Role 2 + Role 4 | All V1 endpoints | All V2 | All |
| UI tests | React Testing Library | Role 3 | Forms and lists | Receipt and mapping screens | All screens |
| End-to-end tests | Playwright | Role 3 + Role 4 | Order to invoice | Rollback, receipts | Full money journey |
| Accounting rule tests | Vitest (money rules) | Role 1 + Role 4 | Debit = credit, totals | Partial payments | Period close |
| Peer testing | Partner group | Partner group | — | Yes (Sprint 5) | Yes |
| Performance test | k6 or a script | Role 4 + DevOps Lead | — | 10,000 records | 50,000 records |
| Security + masking audit | Checklist + OWASP ZAP | DevOps Lead | — | Basic | Full roles audit |

# 10. Glossary (B1 explanations)

| Term | Simple meaning |
|---|---|
| API | A way for two programs to talk with fixed rules. |
| Audit trail | A record of who changed what and when. |
| Chart of accounts | The list of all money accounts of a company. |
| Credit note | A document that reduces an invoice (a "negative invoice"). |
| Debit / Credit | The two sides of every booking. They must be equal. |
| Dry run | A test run that saves nothing. |
| Goods receipt | The moment goods arrive and are booked into stock. |
| Golden ID | One main ID for one real customer, even in many systems. |
| Invoice | The bill sent to a customer. |
| Journal entry | One booking in the accounting books with at least two lines. |
| Opening balance | The starting amount of an account when the system starts. |
| Period close | Locking a month so nothing can change in it. |
| Purchase order | The document that orders goods from a vendor. |
| Reconciliation | Proving with counts that nothing was lost. |
| Rollback | Undo a load safely. |
| SKU | Stock Keeping Unit: the unique code of a product. |
| Staging | A safe temporary area where data waits while it is cleaned. |
| Three-way match | Comparing order, receipt and invoice to catch mistakes. |
| Trial balance | A report that shows the sums of all accounts. |
| Unit of measure | The unit of a product: pcs, kg, litre. |

---

*End of document. Keep this file in the `clearshift-docs` repository. Owner: ERP-1 to ERP-5 Team Leads together with the Integration Lead. Update the version number when the PM approves a change.*
