# 7. The 11 Groups and Their Modules (Deep Dive)

This chapter explains, for every group: **what the module is, how the team works every week, what the module's interface is (what data goes in and out), and what each group delivers in V1, V2 and V3.**

## 7.0 How every group works (the common pattern)

All 11 groups follow the same working pattern. This makes support easy: when one group learns something, all groups can use it.

### 7.0.1 The weekly rhythm of a group

| Day | What the group does |
|---|---|
| Monday | Sprint planning: pick tasks from the backlog (the list of planned work). Update the board. |
| Every day | 10-15 minute stand-up: what I did, what I will do, what blocks me. Then build. |
| Tuesday + Thursday | Integration Clinic (Role 2 attends): fix API and event problems with other groups. |
| Wednesday | Mid-sprint check-in: the PM looks at the board and flags risks. |
| Thursday (last of sprint) | Code freeze: only bug fixes. No new features. |
| Friday | Sprint review and demo (60-90 min), then retrospective (30 min). |

### 7.0.2 The "vertical slice" rule (how a group starts)

A **vertical slice** means: build ONE small piece of the module from top to bottom — one database table, one API, one screen, and the full 7-step pipeline for that one entity — before you build anything else.

Example for CRM-1 (Contacts):

```
Week 3-4: ONE entity end to end = contacts
  CSV file -> Extract -> Profile -> Clean -> Map -> Load -> Validate -> Reconcile
       + 1 table (contacts)  + 1 API (/contacts)  + 1 screen (list + add)
Week 5-6: repeat the same pattern for companies (copy the pattern, faster)
Week 7-8: repeat for leads; add review screens
```

**Why?** A half-built pipeline for three entities is worth nothing. A complete pipeline for one entity is a demo. The pattern is built once and then repeated — this is how 4 people can deliver a complete-looking product.

### 7.0.3 Interface first, code second (contract-first)

No group writes code for an API until the API description (OpenAPI file) is approved by the Integration Lead (Gate G1). While other groups are not ready, Role 2 builds a **mock API** (a fake version) so nobody waits. This is the single biggest reason projects of beginners succeed or fail.

### 7.0.4 What every group delivers (the 12 deliverables)

| # | Deliverable | Owner (role) | Due at gate |
|---|---|---|---|
| 1 | Group charter (1-2 pages): purpose, scope, Must/Should/Could, risks | Role 1 | G1 |
| 2 | Data dictionary and ER diagram (the table structure picture) | Role 4 | G1 |
| 3 | OpenAPI file and event list | Role 2 | G1 |
| 4 | Dirty Data Pack (fake messy data with known problems) + problem list | Role 4 | G2 |
| 5 | Working pipeline, steps 1-7 | Roles 1, 2, 4 | G4 |
| 6 | Module screens, review screen, mapping screen | Role 3 | G4 |
| 7 | Test plan and at least 25 test cases | Role 4 | G3 |
| 8 | Automated tests (unit, API, UI) in the repository | All | G4 |
| 9 | Defect log | Role 4 | Ongoing |
| 10 | User manual and README with setup steps | Roles 3 + 2 | G6 |
| 11 | Test summary report | Roles 4 + 1 | G6 |
| 12 | Demo script (5 minutes) | Roles 1 + 3 | G6 |

The next sections (7.1 - 7.11) give the deep detail for each group.

---

## 7.1 CRM-1: Contacts, Companies and Leads (Group 1: Arya, Janmesh, Ajit, Yuvraj)

**Purpose.** The base of the CRM (Customer Relationship Management system). This module holds **who the customers are**. Every other CRM module links to it, and ERP-3 (orders) uses it too.

### What this team does every week

- **Role 1 (Arya):** defines the duplicate rules ("when are two rows the same person?"). Builds cleaning rules for names, emails, phones. Runs the sprint plan.
- **Role 2 (Janmesh):** builds the CSV/Excel extract and the load into contacts, the OpenAPI file, and the events to the Hub.
- **Role 3 (Ajit):** builds list/search/add/edit screens and the merge review screen (where a human decides "same person or not").
- **Role 4 (Yuvraj):** designs the tables, builds the Profile step, and creates the Dirty Data Pack (1,000 rows with 80 known duplicates).

### Interface contract

| Direction | What | From / To |
|---|---|---|
| IN | Golden ID service (one ID per real customer) | ClearShift Hub (Group 11 + Integration Lead) |
| IN | Unsubscribe status (never overwrite a "no") | CRM-4 (Group 4) |
| OUT | Contact IDs and company IDs | CRM-2, CRM-3, CRM-4, ERP-3 |
| API | `/api/v1/crm-contacts/contacts`, `/companies`, `/leads`, `/contacts/import` | All groups |
| Events | `contact.created`, `contact.merged`, `batch.cleaned`, `batch.loaded` | Hub |

### Module features (A)

| Version | Features |
|---|---|
| **V1** | Contact list and company list. Search by name/email. Add and edit. Lead status (New / Working / Qualified / Closed). Simple CSV import screen. |
| **V2** | Merge duplicates screen (human decides). Company hierarchy (parent company). Bulk edit. Address standardisation view. Import history. |
| **V3** | Admin screen for duplicate rules. Custom fields. Advanced filters. Full audit trail (who changed what, when). |

### Migration Kit (B)

| Version | Features |
|---|---|
| **V1** | Read CSV/Excel. Profile the file. Clean names, emails, phones, addresses. Find duplicates (exact + simple). Merge with human review screen. Load. Reconcile counts. |
| **V2** | Fuzzy matching (similar names, not exact). Safe auto-merge rules (only when email matches exactly). Batch scheduler (run at night). |
| **V3** | Golden ID auto-assignment. Cross-system matching (CRM contact vs ERP customer). Quality score trend. 50,000 records in one run. |

**Typical dirty data:** "john smith", "John Smith", "J. Smith" (same person); phone numbers in 5 formats; emails without "@"; empty country; extra spaces; wrong upper/lower case.

**Mini version first, then scale.** In V1, contacts and companies are flat lists with a text field "company name" on the contact. In V2, the company becomes a real entity with a hierarchy. In V3, contacts are master data with Golden IDs. Never build V3 structures in V1 — you will not finish V1.

---

## 7.2 CRM-2: Deals, Pipeline and Quotes (Group 2: Aditya Yadav, Saudamini, Devanshee, Daksh)

**Purpose.** Holds sales deals (sales opportunities) and the steps they follow until they are won or lost.

### What this team does every week

- **Role 1 (Aditya Yadav):** defines the pipeline rules (stage order, what "Won" means) and the date/currency rules.
- **Role 2 (Saudamini):** connectors, OpenAPI file, the `deal.won` event to ERP-3.
- **Role 3 (Devanshee):** deal list screen, simple pipeline board (columns per stage), quote screen.
- **Role 4 (Daksh):** tables (deals, stages, quotes), Profile step, Dirty Data Pack (ambiguous dates, strange amounts).

### Interface contract

| Direction | What | From / To |
|---|---|---|
| IN | Contact IDs (a deal must belong to a contact) | CRM-1 (Group 1) |
| IN | Product prices (for quotes) | ERP-1 (Group 6) |
| OUT | `deal.won` event (so an order can be created) | ERP-3 (Group 8) |
| OUT | Deal status for reports | CRM-5 (Group 5) |
| API | `/api/v1/crm-deals/deals`, `/stages`, `/quotes` | All groups |

### Module features (A)

| Version | Features |
|---|---|
| **V1** | Deal list. Pipeline stages (fixed list of 6). Deal value and date. Simple quote linked to a deal. |
| **V2** | Pipeline board with drag and drop. Quote line items linked to products. Win/loss reasons. Expected close date. |
| **V3** | Weighted forecasting (pipeline value by probability). Quote PDF. Handoff screen: "deal won" creates the order in ERP-3. Target per salesperson. |

### Migration Kit (B)

| Version | Features |
|---|---|
| **V1** | Map old stage names to new stage names ("Won", "Closed-Won", "WON" -> "Won"). Fix dates (03/04/2025: is it March or April? rule + review list). Fix amounts (currency symbols, commas). Link deals to contacts. Report deals with missing contacts. |
| **V2** | Currency conversion table. Stage history migration (where was the deal last year). Quote migration with line items. |
| **V3** | Full pipeline history (3 years). Lost reason mapping. Performance run on 20,000 deals. |

**Typical dirty data:** different stage names; dates like 03/04/2025; amounts with symbols ("$1,200.00", "1200 USD"); deals without a contact.

**Mini version first, then scale.** V1 has fixed stages and one value field. V2 makes stages configurable. V3 adds forecasting. If stages are configurable too early, the mapping screen becomes a project inside the project.

---

## 7.3 CRM-3: Support Tickets and Activities (Group 3: Ashutosh, Zoha, Anant, Aditya Kumbhar)

**Purpose.** Holds customer problems (tickets) and all notes, calls and emails (activities). This is the memory of the customer relationship.

### What this team does every week

- **Role 1 (Ashutosh):** defines status and priority rules; defines what a "valid" ticket link is.
- **Role 2 (Zoha):** connectors, OpenAPI file, links to CRM-1 (customer) and ERP-3 (order).
- **Role 3 (Anant):** ticket list, ticket detail with notes, activity timeline screen.
- **Role 4 (Aditya Kumbhar):** tables (tickets, notes, activities), text cleaning (strip HTML), Dirty Data Pack (orphan tickets, HTML garbage).

### Interface contract

| Direction | What | From / To |
|---|---|---|
| IN | Contact IDs (who reported the problem) | CRM-1 (Group 1) |
| IN | Order and invoice IDs (what the customer bought) | ERP-3 (Group 8) |
| OUT | Ticket statistics | CRM-5 (Group 5) |
| API | `/api/v1/crm-tickets/tickets`, `/notes`, `/activities` | All groups |

### Module features (A)

| Version | Features |
|---|---|
| **V1** | Ticket list. Status and priority. Notes. Link to a customer and to an order. |
| **V2** | Activity timeline (calls, emails, meetings in date order). Attachments by reference (file list, not file content). Ticket linked to a deal. Canned answers (saved text blocks). |
| **V3** | SLA timers (answer within X hours) with warnings. Escalation rules. Customer satisfaction survey (mock). Full-text search. |

### Migration Kit (B)

| Version | Features |
|---|---|
| **V1** | Map ticket statuses and priorities. Clean text fields (remove HTML and strange symbols). Link tickets to contacts and orders. Move activity history in the right order (by date). Move file attachments by reference. |
| **V2** | Time zone normalisation (all times in UTC, shown in local time). Thread grouping (old email conversations become one ticket). |
| **V3** | Sentiment tags migration. Large history (100,000 activities) with measured speed. |

**Typical dirty data:** orphan tickets (no customer); different status names ("open", "Open", "NEW"); very long text with HTML; wrong time zones.

**Mini version first, then scale.** V1 migrates tickets and notes only. V2 adds activities and time zones. V3 adds SLA history. Attachments are never migrated as files in V1 — only their names and links (this saves weeks of work).

---

## 7.4 CRM-4: Marketing Lists and Campaign History (Group 4: Kartik, Manan, Harish, Jui)

**Purpose.** Holds marketing lists and the results of past campaigns. This module owns one very sensitive thing: **consent** (the permission of a person to be contacted, and the "unsubscribe" flag).

### What this team does every week

- **Role 1 (Kartik):** defines consent rules. The rule "a person who said NO must never be put back on a list" is the hardest rule in the project.
- **Role 2 (Manan):** connectors, OpenAPI file, consent API for all other CRM groups.
- **Role 3 (Harish):** list screens, campaign screens, consent status visible everywhere.
- **Role 4 (Jui):** tables (lists, campaigns, members, consents), Dirty Data Pack (same email in 10 lists, lost unsubscribe flags).

### Interface contract

| Direction | What | From / To |
|---|---|---|
| IN | Contact IDs | CRM-1 (Group 1) |
| OUT | Campaign data and response rates | CRM-5 (Group 5) |
| OUT | Consent status — **must be read by CRM-1, CRM-2, CRM-3 before any contact action** | All CRM groups |
| API | `/api/v1/crm-marketing/lists`, `/campaigns`, `/consents` | All groups |

### Module features (A)

| Version | Features |
|---|---|
| **V1** | Lists. Campaigns (name, date). Simple response tracking (opened / clicked flags). Unsubscribe status visible on the contact. |
| **V2** | List membership rules (manual + filter-based). Campaign performance statistics. Consent history (when did the person say no?). |
| **V3** | Segment builder (target group by rules). Simple automated journeys (follow-up after X days). Double opt-in flow (mock). |

### Migration Kit (B)

| Version | Features |
|---|---|
| **V1** | Clean and merge marketing lists. Remove duplicates **across lists**. **Keep "unsubscribed" status safe — a hard rule, tested every run.** Move campaign history and link it to contacts. |
| **V2** | Consent provenance (record where the "no" came from: source system, file, date). Archive inactive contacts instead of deleting them. |
| **V3** | Full consent audit report (for a real client this is legally required). Channel preferences (email / SMS / post). |

**Typical dirty data:** the same email in many lists; lost unsubscribe flags; old test emails (`test@`, `admin@`); mixed consent status.

**Mini version first, then scale.** V1 = lists + campaigns + consent protection. V2 = statistics + history. V3 = automation. Consent protection exists in **all** versions, from day one — it is not an enhancement.

---

## 7.5 CRM-5: Migration Control Center and Reports (Group 5: Dhruv, Alina, Ashish, Dharmit)

**Purpose.** One screen to control and watch **all** migrations, from both CRM and ERP. This is the face of ClearShift for clients. It is **read-only**: it never writes data into other modules.

### What this team does every week

- **Role 1 (Dhruv):** defines the quality measures (Chapter 11.3) and the rules for the quality score.
- **Role 2 (Alina):** receives events from the Hub, builds the aggregation APIs, CSV/PDF export.
- **Role 3 (Ashish):** dashboard screens: runs list, quality score cards, reject list, reconciliation report.
- **Role 4 (Dharmit):** the calculation logic (does the score match the data?), test data with known numbers, verification tests.

### Interface contract

| Direction | What | From / To |
|---|---|---|
| IN | Status events from **all** groups (`batch.*`, `run.*`) | Via the Hub |
| IN | Quality numbers per batch (counts in, out, rejected) | Via the Hub |
| OUT | Dashboards, quality scores, reconciliation reports (CSV + PDF) | PM, Test Manager, clients |
| API | `/api/v1/crm-control/runs`, `/scores`, `/rejects`, `/reports` | PMO, all leads |

### Module features (A)

| Version | Features |
|---|---|
| **V1** | Dashboard. List of migration runs with status. Quality score per module. Reject list with reasons. Reconciliation report. Download as CSV. |
| **V2** | PDF export. Filters (date, module, user). Compare two runs (before/after cleaning). Drill-down: click a score, see the problem records. |
| **V3** | Quality trend charts over time. Client view (read-only share link, mock). Alerts when a run fails or the reject rate rises. |

### Migration Kit (B) — the reporting pipeline

| Version | Features |
|---|---|
| **V1** | Collect status events from all groups through the Hub. Calculate the quality measures (Chapter 11.3). Show before-and-after numbers per module. |
| **V2** | Cross-module Golden ID statistics (how many real customers after merging?). Run comparison API. Alert events. |
| **V3** | Predictive warning ("reject rate rising — check the source file"). Benchmark view across modules. |

**Typical problems to solve:** showing clear numbers for a non-technical user; handling big runs (100,000+ records) without a slow dashboard; showing errors in simple language, not in code language.

**Mini version first, then scale.** V1 shows numbers as cards and tables — no charts. Charts (V2/V3) are pretty but they do not prove anything. Numbers first, pictures later.

---

## 7.6 ERP-1: Products and Inventory (Group 6: Atharva D, Samarth, Pratik, Aditya C)

**Purpose.** Holds what the company sells and how much stock it has. This is the **product master data**: all other groups that need a product read it from here.

### What this team does every week

- **Role 1 (Atharva D):** defines product rules (what is a valid SKU, what is a duplicate product), unit conversion rules.
- **Role 2 (Samarth):** connectors (CSV/Excel; V2: old database), OpenAPI file, product IDs to ERP-2, ERP-3, CRM-2.
- **Role 3 (Pratik):** product list, category screens, stock overview screen.
- **Role 4 (Aditya C):** tables (products, categories, warehouses, stock levels, prices), Dirty Data Pack (duplicate SKUs, mixed units, negative stock).

### Interface contract

| Direction | What | From / To |
|---|---|---|
| IN | Nothing in Wave 1 (this is a master data module) | — |
| OUT | Product IDs and prices | CRM-2 (quotes), ERP-2 (purchase lines), ERP-3 (order lines) |
| OUT | Opening stock quantities | ERP-4 (inventory value in opening balances) |
| API | `/api/v1/erp-products/products`, `/categories`, `/stock`, `/prices` | All groups |

### Module features (A)

| Version | Features |
|---|---|
| **V1** | Product list. Categories (one level). Units of measure (kg, pcs, litre). Stock quantity per warehouse. Price. |
| **V2** | Stock adjustments (with reason). Low stock alert. Two price lists (sale / purchase). Bulk edit. |
| **V3** | Transfers between warehouses. Batch / serial numbers. Simple landed cost. Product variants (size, colour). |

### Migration Kit (B)

| Version | Features |
|---|---|
| **V1** | Clean product names and codes. Find duplicate SKUs. Standardise units ("kg", "Kg", "kilogram" -> "kg"). Fix categories. Check prices and stock (no negative stock, no missing price). Load products first, then opening stock. |
| **V2** | Category tree mapping (old flat list -> new tree). Unit conversion table (1 box = 12 pcs). Supplier price list load. |
| **V3** | Full catalogue with variants. Stock movement history. 50,000 SKUs with measured speed. |

**Typical dirty data:** same product with two codes; mixed units; empty prices; negative stock numbers; category spelled many ways ("Electronics", "electronics ", "ELEC").

**Mini version first, then scale.** V1: flat categories, one warehouse, one price. V2: two warehouses, two prices. V3: variants and transfers. Inventory without clean products is impossible — this group's Wave 1 work blocks ERP-2 and ERP-3, so it starts first.

---

## 7.7 ERP-2: Vendors and Purchasing (Group 7: Mahek, Ninad, Rishi, Shankar)

**Purpose.** Holds suppliers (vendors) and what the company buys from them (purchase orders).

### What this team does every week

- **Role 1 (Mahek):** vendor duplicate rules, tax number format rules, bank detail masking rules.
- **Role 2 (Ninad):** connectors, OpenAPI file, purchase data to ERP-4.
- **Role 3 (Rishi):** vendor list, purchase order screens, status overview.
- **Role 4 (Shankar):** tables (vendors, purchase orders, lines), Dirty Data Pack (same vendor 3 ways, wrong tax numbers).

### Interface contract

| Direction | What | From / To |
|---|---|---|
| IN | Product IDs (a purchase line must reference a product) | ERP-1 (Group 6) |
| OUT | Purchase totals and vendor bills | ERP-4 (Group 9) |
| API | `/api/v1/erp-vendors/vendors`, `/purchase-orders`, `/po-lines` | ERP-4, ERP-1 |

### Module features (A)

| Version | Features |
|---|---|
| **V1** | Vendor list. Purchase order with lines. Status (Draft / Sent / Received / Closed). |
| **V2** | Goods receipt (mark received quantity per line). Payment terms field. Purchase reports (by vendor, by month). |
| **V3** | Approval workflow (who can approve which amount). Blanket orders (one order, many deliveries). Three-way match (order, receipt, invoice). Vendor scorecard (delivery time, quality). |

### Migration Kit (B)

| Version | Features |
|---|---|
| **V1** | Clean vendor names and tax numbers (check the format). Find duplicate vendors. **Protect bank details: mask them in logs and screens** (for example `XXXX-XXXX-7890`). Link purchase orders to vendors and products. Report orders with missing links. |
| **V2** | Bank detail migration with field-level protection. Payment terms mapping. |
| **V3** | Contract migration. Price agreements between vendor and product. |

**Typical dirty data:** the same vendor written 3 ways ("Tata Steel Ltd", "TATA STEEL", "TataSteel"); wrong tax number format; purchase lines with unknown products.

**Mini version first, then scale.** V1: one purchase order type, no receipts. V2: receipts. V3: approvals and three-way match. Bank masking exists from day one — it is a safety rule, not a feature.

---

## 7.8 ERP-3: Sales Orders and Invoices (Group 8: Prince, Tanmay Sherkar, Pranav, Hazel)

**Purpose.** Holds what customers ordered and what the company billed them. This is the module where CRM and ERP really meet.

### What this team does every week

- **Role 1 (Prince):** order and invoice rules (totals must match, tax must be correct, dates must be in order).
- **Role 2 (Tanmay Sherkar):** connectors, OpenAPI file, consumes `deal.won` from CRM-2, sends order status to CRM-3.
- **Role 3 (Pranav):** order screens, invoice screens, payment screen, mismatch report screen.
- **Role 4 (Hazel):** tables (orders, lines, invoices, invoice lines, payments), Dirty Data Pack (totals that do not match, missing products).

### Interface contract

| Direction | What | From / To |
|---|---|---|
| IN | Customer Golden ID (every order needs a real customer) | Hub / CRM-1 (Group 1) |
| IN | Product IDs and prices | ERP-1 (Group 6) |
| IN | `deal.won` event (creates the sales order) | CRM-2 (Group 2) |
| OUT | Invoice and payment data | ERP-4 (Group 9) |
| OUT | Order and invoice status (so support can answer the customer) | CRM-3 (Group 3) |
| API | `/api/v1/erp-orders/sales-orders`, `/invoices`, `/payments` | ERP-4, CRM-3 |

### Module features (A)

| Version | Features |
|---|---|
| **V1** | Sales order with lines. Invoice. Payment record. Status (Open / Paid / Overdue). |
| **V2** | Invoice PDF. Partial payments (allocate a payment to an invoice). Credit note. Button: "create invoice from order". |
| **V3** | Returns (simple RMA). Dunning reminders (mock: reminder list). Simple revenue recognition (income over 12 months). |

### Migration Kit (B)

| Version | Features |
|---|---|
| **V1** | Link orders to customers (Golden ID) and products. Check that line totals equal order totals. Check tax calculation. Fix dates. Move invoices and payments **after** orders (order matters). Report mismatches. |
| **V2** | Partial payment allocation migration. Credit notes. Open item ageing (what is unpaid since 90 days). |
| **V3** | Three years of history. 100,000 invoices with measured speed. |

**Typical dirty data:** order lines with missing products; totals that do not match the sum of lines; tax rounding differences; invoices without orders.

**Mini version first, then scale.** V1: one tax rate, one currency. V2: partial payments and credit notes. V3: returns and revenue recognition. A wrong invoice destroys trust faster than any other bug — this module is conservative on purpose.

---

## 7.9 ERP-4: Finance and Accounting (Group 9: Tejas, Kaushal, Aaroh, Harsh Kumar)

**Purpose.** Holds the money records of the company. Everything that happens in the other ERP modules ends here as a journal entry (a booking in the accounting books).

### What this team does every week

- **Role 1 (Tejas):** accounting rules. The strongest rule: **debit = credit** in every entry, always.
- **Role 2 (Kaushal):** connectors, OpenAPI file, receives totals from ERP-2, ERP-3, ERP-5.
- **Role 3 (Aaroh):** chart of accounts screen, journal entry screen, trial balance report screen.
- **Role 4 (Harsh Kumar):** tables (accounts, journal entries, journal lines, opening balances), Dirty Data Pack (unbalanced entries, old accounts).

### Interface contract

| Direction | What | From / To |
|---|---|---|
| IN | Invoice and payment totals | ERP-3 (Group 8) |
| IN | Purchase totals | ERP-2 (Group 7) |
| IN | Payroll totals (one number per month, no personal data) | ERP-5 (Group 10) |
| OUT | Financial reports (trial balance, later P&L) | CRM-5 (Group 5), PMO |
| API | `/api/v1/erp-finance/accounts`, `/journal-entries`, `/opening-balances`, `/trial-balance` | ERP-2, ERP-3, ERP-5 |

### Module features (A)

| Version | Features |
|---|---|
| **V1** | Chart of accounts (list of accounts). Simple journal entries (header + lines). Trial balance report (sum per account). |
| **V2** | Account mapping screen (old account -> new account). Soft period lock (warning when booking in the past). Profit & Loss and Balance Sheet (basic). CSV export. |
| **V3** | Hard period close (closed period cannot be changed). Budget vs actual. Simple bank reconciliation (match bank CSV to entries). Audit trail screen. |

### Migration Kit (B)

| Version | Features |
|---|---|
| **V1** | Map the old account list to the new chart of accounts. Check that **debit = credit** in every entry (reject if not, with a reason). Load **opening balances** correctly. Block entries in closed periods. Report differences. |
| **V2** | Mapping suggestions by account name similarity. Duplicate entry detection. |
| **V3** | Full history load (3 years). Multi-currency (simple). |

**Typical dirty data:** old accounts that do not exist in the new chart; entries that do not balance; wrong dates; duplicated entries.

**Mini version first, then scale.** V1: one currency, no locks, trial balance only. V2: mapping screen + soft lock. V3: hard close + budgets. Finance is the last wave for good reasons: it needs clean data from everyone else.

---

## 7.10 ERP-5: HR and Employees (Group 10: Aditya Kadam, Antara, Ayush Singh, Saad)

**Purpose.** Holds the staff data. Also owns the user and role list for the systems (who can log in and what they may do).

### What this team does every week

- **Role 1 (Aditya Kadam):** employee rules (what is a duplicate employee), job title mapping rules, sensitive data rules.
- **Role 2 (Antara):** connectors, OpenAPI file, employee IDs to all groups ("assigned to", "created by").
- **Role 3 (Ayush Singh):** employee list, department screens, attendance/leave screens.
- **Role 4 (Saad):** tables (employees, departments, attendance, leave, system users), Dirty Data Pack (date formats, duplicate employees, salary in free text).

### Interface contract

| Direction | What | From / To |
|---|---|---|
| IN | Nothing in Wave 1 (master data) | — |
| OUT | Employee IDs (used in "assigned to" and "created by" fields in all modules) | All groups |
| OUT | Payroll totals per month (a sum, **no personal data**) | ERP-4 (Group 9) |
| OUT | User accounts and roles | Integration Lead (shared login) |
| API | `/api/v1/erp-hr/employees`, `/departments`, `/leave`, `/users` | All groups |

### Module features (A)

| Version | Features |
|---|---|
| **V1** | Employee list. Department. Role. Simple attendance or leave record. |
| **V2** | Leave request workflow (request -> approve). Simple org chart. Document list (names only, no files). |
| **V3** | Onboarding checklist. Simple performance review. Payroll totals import screen. |

### Migration Kit (B)

| Version | Features |
|---|---|
| **V1** | Clean employee names and dates (birth date, join date). Find duplicate employees. **Protect sensitive data (salary, ID numbers): mask them in logs, screens and reports.** Map old job titles to new roles. |
| **V2** | Department tree mapping. Employment history (several rows per employee over time). Consent record for data processing. |
| **V3** | Full HR history. Simple benefits enrolment. |

**Typical dirty data:** different date formats (12/03/1990 vs 1990-03-12); the same employee twice; old departments that no longer exist; sensitive data written in free-text notes.

**Mini version first, then scale.** V1: one row per employee, no history. V2: employment history. V3: HR processes. Sensitive data masking exists from day one.

---

## 7.11 PLT-1: Platform Group — Hub, Shared Library, DevOps (Group 11: Shubham, Vaishnavi, Saiyash, Kunwar, Tanay Shelar)

**Purpose.** The Platform Group builds and runs the **shared parts** that all other groups depend on: the ClearShift Hub, the shared cleaning library `clearshift-core`, the mock APIs, and the DevOps templates. It works under the Integration Lead. (If the PM decides differently in Week 1, this group becomes the PMO support group — the tasks below stay the same.)

### What this team does every week

- **Shubham (proposed Integration Lead):** Hub architecture, ID Map, event bus, review of every group's OpenAPI file.
- **Vaishnavi:** `clearshift-core` library: clean email, phone, date, currency, name, tax number — used by all groups so we do not write them 10 times.
- **Saiyash:** mock APIs and the API gateway (one entrance with one login).
- **Kunwar:** CI templates, Docker Compose templates, environment health dashboard.
- **Tanay Shelar:** demo environment, support duty (any group blocked for more than 1 day gets a pairing session), documents for the shared parts.

### Interface contract

| Direction | What | From / To |
|---|---|---|
| IN | Approved OpenAPI files and event lists | All 10 module groups |
| OUT | Hub APIs: ID Map, batch registry, run registry | All groups |
| OUT | Events: `batch.extracted`, `batch.profiled`, `batch.cleaned`, `batch.mapped`, `batch.loaded`, `batch.validated`, `batch.failed` | All groups |
| OUT | `clearshift-core` library, CI template, Docker template, mock API server | All groups |
| API | `/api/v1/hub/id-map`, `/batches`, `/runs`, `/events` | All groups |

### Shared parts (A) and support (B)

| Version | Delivered |
|---|---|
| **V1** | Hub v0.1: shared login (JWT with roles), ID Map, event bus, batch registry. `clearshift-core` v0.1 (email, phone, date, currency, name). CI + Docker template. Mock API server with the first 10 mock endpoints. |
| **V2** | Hub v0.2: wave state machine (a wave cannot start before the previous wave is validated), run registry, per-group statistics. `clearshift-core` v0.2 (fuzzy match, tax number check, address clean). API gateway with one login. |
| **V3** | Hub v1.0: cutover rehearsal mode (a full dry run of the real day), ID Map screen (a human can fix a wrong match), audit log. `clearshift-core` v1.0 (rule packs per industry). Monitoring of run health. |

**Mini version first, then scale.** The Hub is the biggest integration risk of the project. That is why it starts in Sprint 1 (not in Sprint 5), and why Wave 1 integration uses only 2-3 groups. The Hub must be boring and stable before all 10 groups touch it.
