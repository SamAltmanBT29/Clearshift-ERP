# 8. How ERP and CRM Work Together

## 8.1 The big idea

CRM and ERP see the **same business from two sides**. CRM knows the customer and the deal. ERP knows the stock, the invoice, and the money. If they do not agree on who the customer is and what the product is, the company gets wrong reports and angry customers.

Our rule: **one customer, one product, one truth.**

## 8.2 Who owns which master data

**Master data** is data that many modules use again and again (customers, products, accounts). Only **one group** owns each type of master data. All others **read it through an API**; they do not make their own copy. A copy would become a second version of the truth, and the two copies would differ after one week.

| Master data | Owner | Used by |
|---|---|---|
| Customers (contacts, companies) | CRM-1 (Group 1) | CRM-2, CRM-3, CRM-4, ERP-3 |
| Products and prices | ERP-1 (Group 6) | CRM-2, ERP-2, ERP-3 |
| Vendors | ERP-2 (Group 7) | ERP-4 |
| Employees and user roles | ERP-5 (Group 10) | All groups |
| Chart of accounts | ERP-4 (Group 9) | ERP-2, ERP-3, ERP-5 |
| Golden ID map | Integration Lead (Hub, Group 11) | All groups |

## 8.3 The Golden ID

A real customer can be in many places: a CRM contact, an ERP customer, a support ticket, an invoice. Each place may use a different ID. The **Hub** keeps a table called the **ID Map**:

| golden_id | source_system | source_id |
|---|---|---|
| G-000123 | old_excel | row 55 |
| G-000123 | crm | contact-9001 |
| G-000123 | erp | cust-77 |

How matching works (in this order):

1. Same tax number -> same company.
2. Same email -> same person.
3. Same phone + very similar name -> possible match, **send to a human review screen**.
4. Anything else -> new Golden ID.

The same idea works for products (match by SKU and name). Rule 3 is important: a computer never merges a "possible match" alone. A human decides. A wrong merge is worse than two duplicates, because a wrong merge destroys data.

## 8.4 The links between CRM and ERP

| From -> To | Data | Why |
|---|---|---|
| CRM-1 -> ERP-3 | Customer (Golden ID) | Orders and invoices need a real customer |
| ERP-1 -> CRM-2 | Product list and prices | Quotes need correct prices |
| CRM-2 -> ERP-3 | "Deal won" event | Create the sales order |
| ERP-3 -> CRM-3 | Order and invoice status | Support sees what the customer bought and paid |
| ERP-3 -> ERP-4 | Invoices and payments | Money records |
| ERP-2 -> ERP-4 | Vendor bills | Money records |
| ERP-5 -> ERP-4 | Payroll totals | Money records |
| CRM-1 -> CRM-4 | Contacts | Marketing lists |
| All -> CRM-5 | Status events | Reports and dashboard |

## 8.5 Migration waves (the order of loading)

Data must be loaded in the right order. A deal cannot be loaded before its contact exists. This order is called the **wave plan**.

| Wave | What is loaded | Groups |
|---|---|---|
| **Wave 1 — Master data** | Contacts and companies, products, vendors, employees, chart of accounts | CRM-1, ERP-1, ERP-2, ERP-5, ERP-4 |
| **Wave 2 — Business data** | Deals, sales orders, purchase orders, tickets | CRM-2, ERP-3, ERP-2, CRM-3 |
| **Wave 3 — History and money** | Invoices and payments, opening balances and journal, campaign history | ERP-3, ERP-4, CRM-4 |
| **Wave 4 — Check** | Full reconciliation, quality reports, cutover rehearsal | CRM-5, Test Manager, all groups |

The PM and the Integration Lead publish the wave plan. A group cannot start loading its Wave 2 data until its Wave 1 dependencies are marked "validated" in the Hub.

## 8.6 Meetings and communication

| Meeting | Who | When | Length | Purpose |
|---|---|---|---|---|
| **Daily stand-up** | Each group | Every working day | 10-15 min | What I did, what I will do, what blocks me |
| **Leads Meeting** | 10 Team Leads + PLT-1 + PMO | Once a week (same day) | 45 min | Progress, risks, dependencies |
| **Integration Clinic** | Role 2 engineers + Integration Lead | Twice a week | 45 min | Fix API and event problems together |
| **Test Sync** | Role 4 QA Leads + Test Manager | Once a week | 30 min | Bugs, test plans, peer testing |
| **Sprint Review and Demo** | Everyone | End of each sprint | 60-90 min | Show working results |
| **Retrospective** | Each group | After each sprint | 30 min | What to keep, what to change |

**Channels**

- One chat group per project group.
- One chat group for Team Leads + PMO.
- One chat channel `#integration` for API and Hub questions.
- One chat channel `#bugs` for defects.
- Important decisions are written in the shared decision log, not only in chat.

**Response time rule:** a question to another group must get an answer within **24 hours** on working days. If not, the Team Lead tells the PM.

## 8.7 Rules for working together

1. **Contract first.** No group writes code for an API until the API description is approved by the Integration Lead (Gate G1).
2. **Fake it until it is ready.** If another group's module is not ready, use a mock API. The PM and the Platform Group publish mocks in Week 2.
3. **Version your API.** Never change an API without telling the groups that use it. Use version numbers (v1, v2).
4. **Small, often.** Merge small changes every day. Avoid big merges at the end (this is where projects die).
5. **No surprises.** Tell the PM about any risk **when you see it**, not when it is a disaster.

# 9. Technical Framework

## 9.1 The 7-step pipeline

Every group builds the same seven steps for its data. This is the **ClearShift Pipeline**. It is the technical heart of the project, and it is the same for every module — only the details differ.

| Step | Name | What it does |
|---|---|---|
| 1 | **Extract** | Read data from the source (CSV, Excel, old database) into the **raw** area. Never change raw data. |
| 2 | **Profile** | Look at the data and count the problems: empty values, strange formats, duplicates. Produce a "data health report". |
| 3 | **Clean** | Fix the data with rules: trim spaces, fix formats, standardise values, find duplicates. |
| 4 | **Map** | Connect old fields to new fields. Convert values (for example old status -> new status). |
| 5 | **Load** | Put the clean data into the target module. Support **dry run** (test run without saving) and **rollback** (undo). |
| 6 | **Validate** | Check business rules after loading (for example "every order has a customer"). |
| 7 | **Reconcile** | Count records: **source = loaded + rejected + merged**. Prove that nothing is lost. |

Every step writes a **log** and sends an **event** to the Hub.

## 9.2 Data layers

Data moves through four areas. Each module has its own set (its own **schema**, its own group of tables) in PostgreSQL.

| Layer | Name | Rule |
|---|---|---|
| 1 | `raw_<module>` | Exact copy of source data. **Never edited.** |
| 2 | `stg_<module>` | Staging: data with extra columns (`batch_id`, `source_row`, `status`). |
| 3 | `clean_<module>` | Cleaned and mapped data, ready to load. |
| 4 | `target_<module>` | The real module tables. |
| — | `hub` | Owned by the Integration Lead: ID Map, batches, logs. |

Every record keeps: `source_system`, `source_id`, `batch_id`, `status` (new, cleaned, rejected, merged, loaded) and a `reject_reason` if rejected. This is the base of the **audit trail** (a record of every change).

## 9.3 Technology (the same for all groups)

| Area | Choice |
|---|---|
| Language | TypeScript everywhere (frontend and backend) |
| Frontend | React + TypeScript, shared component library |
| Backend | Node.js with NestJS (or Express) |
| Database | PostgreSQL (one schema per module) |
| File reading | CSV and Excel libraries (for example `csv-parse`, `exceljs`) |
| Validation | A schema library such as `zod` |
| Duplicate matching | A text-similarity library (for example `fuse.js`) plus rules |
| API description | OpenAPI (Swagger) |
| Events | RabbitMQ or Redis Streams (Integration Lead decides in Week 1) |
| Login | One shared JWT-based login service, with roles |
| Containers | Docker and Docker Compose |
| CI/CD | GitHub Actions |
| Testing | Jest or Vitest (unit), Postman/Newman (API), Playwright (UI and end-to-end) |
| Design | Figma (simple wireframes) |

If your teacher requires another stack (for example Java or Python), keep the **rules** in this document and change the tools. The key point is: **all groups use the same stack.**

## 9.4 Standards (all groups must follow)

**Naming**

- Tables and columns: `snake_case` (for example `customer_name`).
- API paths: `/api/v1/<module>/<resource>` (for example `/api/v1/crm-contacts/contacts`).
- Events: `<noun>.<past_verb>` (for example `batch.cleaned`).

**API rules**

- JSON only. Use standard HTTP status codes (200 = ok, 400 = bad request, 401 = not logged in, 403 = not allowed, 404 = not found, 500 = server error).
- Same error format for all groups: `{ "code": "...", "message": "...", "details": [...] }`.
- Every list API supports paging (`page`, `pageSize`).
- Every API has an OpenAPI file in the repository.

**Logging**

- Log every pipeline step with `batch_id`, number of records in, out, rejected.
- **Never** log passwords, bank details, salary, or full ID numbers. Mask them (for example `XXXX-XXXX-1234`).

**Data privacy and security**

- **Use only fake or synthetic data in the project.** Never use real customer or employee data.
- Role-based access: not every user can see every field.
- Secrets (passwords, keys) are never stored in the code repository. The DevOps Lead provides a safe way.
- Run a basic security check before the final demo (login, roles, input checks).

## 9.5 Repository and branch rules

- One Git repository per group, plus `clearshift-hub`, `clearshift-core`, and `clearshift-docs`.
- Branches: `main` (always working), `develop` (current work), `feature/<name>`.
- Nobody pushes directly to `main`. Use **pull requests** with at least **one review** from another group member.
- The CI pipeline must pass (build + tests) before merging.
- Commit messages: short and clear, for example `feat: add phone cleaning rule`.

Standard folder structure:

```
/src            code
/tests          unit, API and UI tests
/docs           README, OpenAPI file, data dictionary, user manual
/sample-data    Dirty Data Pack (fake data)
/docker         Dockerfile and compose files
```

## 9.6 Environments

| Environment | Use | Who controls it |
|---|---|---|
| **Local** | Each person's computer, with Docker Compose | The person |
| **Dev (group)** | Each group's own test setup | Role 2 of the group |
| **Integration** | All modules together through the Hub | Integration Lead + DevOps Lead |
| **Demo** | Stable version for the final demo | PM + DevOps Lead |

# 10. Project Plan (12 Weeks)

## 10.1 Phases at a glance

| Phase | Weeks | Goal |
|---|---|---|
| **1. Plan and Design** | 1-2 | Everyone knows what to build. Contracts are ready. |
| **2. Build** | 3-8 | Each module and its pipeline work with mock APIs. **V1 is finished at the end of Week 8.** |
| **3. Integrate** | 9-10 | Modules work together through the Hub. Peer testing. **V2 is finished at the end of Week 10.** |
| **4. Finish** | 11-12 | Final fixes, documents, demo. **V3 is the final demo.** |

## 10.2 Sprint plan (6 sprints of 2 weeks)

| Sprint | Weeks | Sprint goal | Group output | PMO + PLT-1 output | Gate at the end |
|---|---|---|---|---|---|
| **S1** | 1-2 | Design and setup | Group charter, data dictionary, ER diagram, OpenAPI draft, Dirty Data Pack plan, repository and CI ready | Hub design, event list, shared data model, mock APIs, master plan, tool setup | **G1 Design Gate** |
| **S2** | 3-4 | Extract and Profile | Steps 1-2 work on the Dirty Data Pack. Basic screens. | Hub v0.1 (login, ID Map, event bus). `clearshift-core` v0.1. | **G2 Sprint 2 Demo** |
| **S3** | 5-6 | Clean and Map | Steps 3-4 work. Review screens and mapping screen. Unit tests growing. | `clearshift-core` v0.2. Test plan approved. | **G3 Mid-project Review** |
| **S4** | 7-8 | Load, Validate, Reconcile | Steps 5-7 work. Module "Must" features done = **V1** | Wave plan tested with 2-3 groups. Security checks start. | **G4 Build Complete (V1)** |
| **S5** | 9-10 | Integration and peer testing | Work through the Hub. Peer testing. Bug fixing = **V2** | Waves 1-3 run end to end. End-to-end tests. Defect triage. | **G5 Release Candidate (V2)** |
| **S6** | 11-12 | Hardening, documents, demo | Final fixes, user manual, test report, demo script = **V3** | Wave 4 rehearsal. Final reports. Demo environment. | **G6 Final Demo (V3)** |

## 10.3 Gates (the checkpoints)

A **gate** is a checkpoint. The PM decides **Go** or **No-Go** with advice from the Test Manager. If a group says No-Go, it gets a short fix plan (one week at most).

| Gate | Conditions to pass |
|---|---|
| **G1 Design** | All 11 groups have: charter, approved OpenAPI file, data dictionary, ER diagram, Dirty Data Pack plan. The Hub design is approved. Repositories and CI work. |
| **G2 Sprint 2 Demo** | Each group can extract and profile its Dirty Data Pack and show a data health report. |
| **G3 Mid-project** | Clean and Map steps work on the Dirty Data Pack. Test plan exists. Unit tests run in CI. Risks are updated. |
| **G4 Build Complete (V1)** | All "Must" features of module and kit work. Unit test pass rate is 100%. Coverage on core logic is at least 60%. No open critical bugs. Test report v1 submitted. |
| **G5 Release Candidate (V2)** | Waves 1-3 run through the Hub. Peer testing finished. No open critical bugs. Reconciliation passes on the test data. |
| **G6 Final Demo (V3)** | End-to-end scenarios pass. No open critical or major bugs. All documents delivered. Known issues are listed. |

## 10.4 Sprint routine (what happens every sprint)

| Day | Activity |
|---|---|
| Day 1 (Monday, week 1 of the sprint) | **Sprint planning:** the group picks tasks from its backlog. |
| Every day | Stand-up. Code, test, review. |
| Middle of sprint | **Check-in:** the PM looks at the board and flags risks. |
| Last Thursday | **Code freeze:** only bug fixes. |
| Last Friday | **Sprint review and demo**, then **retrospective**. |

# 11. Testing and Quality

For a migration company, **quality means proof**. We must show the client numbers that prove the data is correct. Testing is the heart of the project. A team that cannot prove its data is correct has nothing to sell.

## 11.1 Testing levels

| Level | Who | Tools |
|---|---|---|
| Unit tests | Everyone, for own code | Jest / Vitest |
| API and contract tests | Role 2 + Role 4 | Postman/Newman, OpenAPI checks |
| UI and component tests | Role 3 | React Testing Library, Playwright |
| Module system test | Whole group, led by Role 4 | Test plan |
| **Peer testing** | A partner group | Partner's test cases |
| Integration and end-to-end | Test Manager + all QA Leads | Integration environment |
| Performance (basic) | Role 4 + DevOps Lead | k6 or a simple script (for example 10,000 records) |
| Security (basic) | DevOps Lead + QA Leads | Checklist, OWASP ZAP |
| Final acceptance | Teachers or mentors as "client" | Demo script |

## 11.2 Peer testing pairs

Every group tests the module of a partner group. The pairs are chosen because the modules connect.

| Pair | Why |
|---|---|
| CRM-1 <-> CRM-2 | Contacts and deals |
| CRM-3 <-> ERP-3 | Tickets and orders/invoices |
| CRM-4 <-> CRM-5 | Campaign data and reports |
| ERP-1 <-> ERP-2 | Products and purchasing |
| ERP-4 <-> ERP-5 | Finance and payroll totals |
| PLT-1 <-> CRM-1 | Hub and the first master data module |

Rules for peer testing:

- The testers receive the OpenAPI file, the user manual, and the Dirty Data Pack, but **not the source code**.
- Testers write defect reports with: steps, expected result, actual result, severity.
- The owner group answers critical bugs in 2 days and major bugs in 5 days.
- Bug quality counts in the tester group's grade. The fix rate counts in the owner group's grade.
- Plan 2-3 days per group during Sprint 5. If it is not on the calendar, it will not happen.

## 11.3 Data quality measures (the numbers we show a client)

| Measure | Meaning | Target in the test data |
|---|---|---|
| **Completeness** | Percentage of required fields that are filled | At least 98% after cleaning |
| **Validity** | Percentage of values with the correct format (email, phone, date, tax number) | At least 98% |
| **Duplicate rate** | Percentage of records that are duplicates, before and after | Below 1% after cleaning |
| **Reject rate** | Percentage of records that could not be loaded (with a reason for each) | Reported, never hidden |
| **Link integrity** | Percentage of records with valid links (for example order -> customer) | 100% for loaded records |
| **Reconciliation** | source count = loaded + rejected + merged | **Must be exactly equal (100%)** |
| **Speed** | Time to process 10,000 records | Reported (set a target in Sprint 4) |

## 11.4 The Dirty Data Pack

Role 4 in each group creates a **Dirty Data Pack**: a fake but realistic file with **known problems**. For example 1,000 records with exactly:

- 80 duplicates (exact and similar),
- 60 wrong formats,
- 50 empty required fields,
- 30 broken links,
- 20 strange values (for example negative stock).

Why? Because we know the problems in advance, we can **measure** how many the pipeline found and fixed. This gives us a clear pass/fail score and a strong demo.

Keep the pack in `/sample-data`, with a document that lists the problems. Another group can also use it for peer testing.

## 11.5 Defect severity and fix time

| Level | Meaning | Fix time |
|---|---|---|
| **Critical** | Data loss, crash, security hole, or blocks integration | 48 hours |
| **Major** | Feature broken and no workaround | 5 days |
| **Minor** | Small problem or has a workaround | Before final demo |
| **Cosmetic** | Spelling, colours, alignment | If time allows |

## 11.6 Entry and exit rules

**To enter integration (G4 -> Sprint 5):**

- APIs match the OpenAPI files.
- Unit tests: 100% pass.
- No open critical bugs.
- Test report v1 submitted.

**To finish the project (G6):**

- All end-to-end scenarios pass.
- No open critical or major bugs.
- Known problems are written down.

## 11.7 End-to-end scenarios (owned by the Test Manager)

1. **Customer journey:** an old Excel file with customers -> clean -> Golden IDs -> CRM contacts -> ERP customers. Check that duplicates are merged once and counts match.
2. **Product to quote:** products loaded in ERP-1 -> price visible in a CRM-2 quote -> deal won -> ERP-3 order created.
3. **Order to money:** orders and invoices loaded -> payments -> entries in ERP-4 -> trial balance balances.
4. **Support link:** a ticket in CRM-3 shows the right order and invoice status.
5. **Consent safety:** a person who was "unsubscribed" in the source stays "unsubscribed" after migration in CRM-4.
6. **Opening balance:** old accounts mapped -> opening balances loaded -> debit = credit.
7. **Fail-safe:** a broken file is uploaded -> the pipeline rejects bad rows with reasons -> **rollback** works -> nothing is half-loaded.
8. **Control center:** CRM-5 shows the correct counts and quality score for every module run.

# 12. Project Management Rules

## 12.1 Tools

| Need | Tool (suggestion) |
|---|---|
| Task board | GitHub Projects, Trello, or Jira (one board per group + one master board) |
| Code | GitHub |
| Documents | Shared drive or Notion |
| Chat | WhatsApp, Slack, or Discord (with channels, see Chapter 8.6) |
| Meetings | Google Meet or in person |
| Wireframes | Figma |
| API tests | Postman |

## 12.2 Weekly status report (RAG)

Every Team Lead sends a short report **before the Leads Meeting**. Use colours:

- **Green:** on track.
- **Amber:** small delay or risk, we have a plan.
- **Red:** blocked or very late, need help.

The PM keeps one master table for all 11 groups. A group that is **Red twice in a row** gets help from the PMO (a pairing session with PLT-1, or a scope reduction).

## 12.3 Risk register (main risks)

| # | Risk | Chance | Impact | What we do |
|---|---|---|---|---|
| 1 | The scope is too big for 4 people | High | High | Must/Should/Could. Kit first. Cut module features, not kit features. V1 before V2. |
| 2 | Groups wait for each other | High | High | Mock APIs in Week 2. Contract-first rule. Integration Clinic. |
| 3 | A member leaves or is absent | Medium | High | Backups for every role. Everything in Git and shared documents. |
| 4 | Testing is dropped when time is short | High | High | QA is a named role. Testing is graded. Gates require test results. |
| 5 | Integration problems at the end | High | High | Hub starts in Sprint 1. Integration starts early with 2-3 groups. |
| 6 | Real personal data is used by mistake | Low | High | Fake data only. DevOps Lead checks. Masking rules. |
| 7 | Weak communication between groups | Medium | Medium | Fixed meetings. 24-hour answer rule. `#integration` channel. |
| 8 | One group is much slower than others | Medium | Medium | RAG report. Pairing with PLT-1. Scope reduction with PM approval. |
| 9 | Tool or environment breaks | Medium | Medium | Docker Compose. DevOps Lead keeps a backup and a setup guide. |
| 10 | Over-dependence on AI tools without understanding | High | High | Rules in Chapter 13. Code review. The author must be able to explain their code. |
| 11 | Disagreement about design | Medium | Low | Decision table (Chapter 6.3). Decisions written in the log. |

The PM reviews the risk register **every week**.

## 12.4 Change control

Changes will happen. Control them like this:

1. Anyone can ask for a change in writing: what, why, and what it affects.
2. The Integration Lead checks the technical impact.
3. The PM decides: **accept, reject, or move to later**.
4. If accepted, the PM updates the plan, and the decision log shows the change.

A change that moves a "Must" feature out of scope needs a reason and the PM's written approval.

## 12.5 Definition of Ready and Definition of Done

**A task is "Ready" when:**

- It is clear, small (1-3 days), and has an owner.
- We know how to test it.
- Its dependencies are available (or a mock exists).

**A task is "Done" when:**

- The code is merged by pull request with one review.
- Tests are written and passing in CI.
- Documentation is updated (README, API file, data dictionary).
- The result was shown to the team (or at the sprint demo).

## 12.6 Fair grading for each person

Each person gets a grade for the **group result** and an **individual part**.

| Part | Weight | How it is checked |
|---|---|---|
| Module quality | 25% | Demo, code review |
| Migration Kit quality and data quality numbers | 30% | Dirty Data Pack results, reconciliation |
| Testing and documents | 20% | Test plan, tests, reports, peer testing result |
| Individual work and teamwork | 25% | Git history, pull-request reviews, role deliverables, short individual talk, peer feedback |

The individual part makes sure that one weak member does not pull down the others, and that one strong member does not hide the others.

# 13. Working with AI Tools (Responsible Use)

This project is the first software project for many members. AI assistants (for example ChatGPT, GitHub Copilot, Claude) are powerful helpers. They are also a risk. This chapter gives the rules of ClearShift.

## 13.1 What AI is good at

| Use AI for | Why |
|---|---|
| Explaining an error message | Fast learning, saves hours. |
| Writing the first draft of a unit test | You fix the details and understand it. |
| Generating sample fake data | Fast, and safe (it is fake data). |
| Writing documentation drafts | You check facts and rewrite in B1 English. |
| Suggesting a function structure | A second opinion on design. |
| Reviewing your pull request text | Clearer commits and descriptions. |

## 13.2 What AI must not do

| Never | Why |
|---|---|
| Paste real client or employee data into an AI tool | Privacy law and our fake-data-only rule. |
| Accept AI code you cannot explain | In the individual talk, you must explain every line you committed. |
| Let AI write "the whole module" in one go | Nobody reviews it, nobody understands it, it will not pass the gates. |
| Use AI to bypass tests or to "make the test pass" without fixing the cause | This is how fake quality enters the product. |
| Share secrets, passwords, or API keys with an AI tool | Security rule (Chapter 9.4). |

## 13.3 The ClearShift AI rules

1. **You own your code.** If you commit it, you can explain it. In the sprint demo, the PM can ask anyone: "show me how this works."
2. **AI output is a draft, not a result.** Every AI-generated piece must be reviewed, tested and understood before it is merged.
3. **Say that you used AI** in the pull request description (one line is enough). This is honest, and it helps the reviewers to check harder.
4. **AI never writes the final test report.** Numbers in reports come from real runs of the pipeline, not from a language model.
5. **One person, one AI session, one task.** Do not paste the whole project into a chat and ask for "the complete system". Small questions, small answers, small reviews.

> **Why these rules exist:** in the real company, clients pay ClearShift for **trust and proof**. A consultant who cannot explain their own work loses the client in the first meeting. Practice this from week 1.

# 14. From Project to Company

This project is a **training ground** for a real business. Do not sell the student project itself as a product. Sell the **skill and the method**.

## 14.1 Services ClearShift can sell

| Service | What the client gets |
|---|---|
| **1. Data Health Check** | A report that shows how bad the data is (using the Profile step). A small, fast, low-price service that opens doors. |
| **2. Data Cleanup** | Cleaned data: duplicates merged, formats fixed, with a report. |
| **3. Migration** | Data moved into the client's ERP or CRM (for example Odoo, ERPNext, Zoho, HubSpot), with mapping, dry run, and rollback plan. |
| **4. Validation and Cutover Support** | Reconciliation reports and help during the switch-over day. |
| **5. Support Plan (monthly)** | Ongoing data quality checks and fixes. This gives **repeat income**. |

## 14.2 How to grow (suggested path)

1. **Months 0-3 (during and after this project):** finish the Migration Kit. Write 2-3 **case studies** from the Dirty Data Pack results (before/after numbers).
2. **Months 3-9:** sell **Data Health Checks** and small cleanups to small businesses. Learn real client problems. Ask for references.
3. **Months 9-18:** add full migrations and monthly support. Turn repeated work into reusable tools and templates.
4. **Later:** choose **one industry** (for example distributors, clinics, schools) and specialise. A focused offer sells better than "we do everything".

## 14.3 Honest warnings

- **Trust is the hardest part.** Clients give you their business data. You need NDAs (confidentiality agreements), clear contracts, and references.
- **Data privacy is serious.** Learn the rules in your country (in India, for example, the Digital Personal Data Protection Act, 2023). Ask a qualified adviser before you handle real personal data.
- **Your student ERP/CRM is not a product.** It is a test system. Real clients will use their own systems.
- **Clients change their mind.** Always use written scope and payment in stages.
- **Put the team agreement in writing early:** roles, time commitment, how profit is shared, and what happens if someone leaves. Talk about it before any money arrives.

# 15. First 7 Days Checklist

**PM (Aman)**

- [ ] Confirm the 48 names and fill the final roster (Chapter 5.3). Confirm the 5 marked names.
- [ ] Create the master task board, chat channels, and decision log.
- [ ] Set the date and time of all recurring meetings.
- [ ] Share this document with everyone and run a 60-minute kick-off.

**Integration Lead (from Group 11, proposed: Shubham)**

- [ ] Choose the event system (RabbitMQ or Redis Streams).
- [ ] Draft the ID Map and the shared data model.
- [ ] Create `clearshift-hub` and `clearshift-core` repositories.
- [ ] Start the OpenAPI template and the mock API plan.

**Quality and Test Manager (Raj)**

- [ ] Create the master test plan outline.
- [ ] Publish templates: test plan, test case, defect report, test summary.
- [ ] Publish the peer testing pairs and the Dirty Data Pack guide.

**DevOps and Security Lead (Pari)**

- [ ] Create the GitHub organisation and one repository per group.
- [ ] Publish the CI template and the Docker Compose template.
- [ ] Publish the "fake data only" and masking rules.

**Every group**

- [ ] Meet and confirm the four roles and backups.
- [ ] Write the group charter (template in Chapter 16).
- [ ] Set up the repository and run the first CI build.
- [ ] Start the data dictionary and the Dirty Data Pack plan.
- [ ] Read Chapter 7 (your group) and the matching SDS document.

# 16. Templates

## 16.1 Group charter (1-2 pages)

```
Group: ____   Module: ____   Side: CRM / ERP / PLT

Members and roles
 Role 1 (Team Lead + Core Dev): ____   Backup: Role 2
 Role 2 (Integration + DevOps): ____   Backup: Role 1
 Role 3 (Frontend + Review):    ____   Backup: Role 4
 Role 4 (Data + QA Lead):       ____   Backup: Role 3

Purpose of the module (3 sentences):

Must / Should / Could
 Module Must:
 Module Should/Could:
 Kit Must:
 Kit Should/Could:

Version plan
 V1 (at G4): list the features
 V2 (at G5): list the features
 V3 (at G6): list the features

Data we own:
Data we need from others (and from which group):
Data we give to others (and to which group):

Main risks (top 3) and our plan:

Dirty Data Pack plan (how many records, which problems):

Date: ____   Approved by PM: ____
```

## 16.2 Weekly status report (Team Lead sends before the Leads Meeting)

```
Group: ____   Week: ____   Status: Green / Amber / Red

Done this week:
Plan for next week:
Blocked by (who / what):
Risks and changes:
Tests: unit pass rate ___%  coverage ___%  open critical ___  open major ___
Version status: V1 __%   V2 __%   V3 __%
Need help with:
```

## 16.3 Defect report

```
ID: ____        Found by (group): ____     Owner group: ____
Severity: Critical / Major / Minor / Cosmetic
Title:
Steps to repeat:
Expected result:
Actual result:
Evidence (screenshot or log):
Status: New / In progress / Fixed / Retest / Closed
```

## 16.4 Daily stand-up questions

1. What did I finish yesterday?
2. What will I do today?
3. What is blocking me, and who can help?

## 16.5 API change request (for the Integration Lead)

```
Group: ____   API: ____   Current version: ____

What we want to change:
Why (business reason):
Who uses this API today (list groups):
Is a mock available for the old version: yes / no
Proposed new version: v__ (new field / changed field / removed field)
Impact on other groups:
Approved by Integration Lead: ____  Date: ____
```

---

*End of document. Keep this file in the `clearshift-docs` repository and update the version number whenever the PM approves a change. Next review: Gate G1.*
