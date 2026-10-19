```{=typst}
#page(header: none, numbering: none)[
  #align(center + horizon)[
    #text(size: 32pt, weight: "bold")[ClearShift]
    #v(8pt)
    #text(size: 14pt)[Data Migration and Cleanup for ERP and CRM]
    #v(26pt)
    #line(length: 38%, stroke: 0.8pt + black)
    #v(26pt)
    #text(size: 19pt, weight: "bold")[Project Plan and Team Guide]
    #v(6pt)
    #text(size: 12pt)[White paper — Version 2.0]
    #v(30pt)
    #text(size: 10.5pt)[Prepared by: ClearShift Project Management Office (PMO)]
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
#align(center)[#outline(title: [Table of Contents], depth: 2)]
#pagebreak()
```

# 1. Summary

## 1.1 What is ClearShift?

ClearShift is a student team that becomes a real company. The company helps other companies **move their data from old systems into new ERP and CRM systems, and clean the data on the way**.

Many companies keep data in Excel files, in old software, or on paper. The data is often messy. There are duplicate customers, wrong phone numbers, missing prices, and broken links between records. When a company moves messy data into a new system without cleaning it, the new system fails too. People lose trust in the new system, and the project fails.

ClearShift fixes this problem. This is why the domain is valuable: **every company that changes its system has this problem.**

## 1.2 The problem (business view)

| # | Problem the client has | What it costs the client |
|---|---|---|
| 1 | Data lives in many places: Excel, old software, paper notes. | People work twice. Data is never correct. |
| 2 | The same customer exists 3 times with 2 different phone numbers. | Wrong invoices, angry customers, wasted time. |
| 3 | The company buys a new ERP or CRM and copies the old data in. | The new system is full of bad data after one week. |
| 4 | Nobody can prove that data was not lost during the move. | Management does not trust the new system. |
| 5 | Migration projects are expensive because consultancies work for months by hand. | Small companies cannot afford to move. |

## 1.3 The solution (business view)

ClearShift sells **proof**, not just work. Every migration we do comes with numbers:

- How many records went in (source).
- How many were cleaned, merged, rejected, and loaded.
- A reconciliation report where *source = loaded + rejected + merged* must be exactly true.

Our offer to a client has 5 services (see Chapter 14): Data Health Check, Data Cleanup, Migration, Validation and Cutover Support, and a monthly Support Plan.

## 1.4 What we build in this project

We build **a small ERP system, a small CRM system, and a Migration Kit** that moves and cleans data for each part of these systems.

Why build both ERP and CRM? Because to migrate data well, you must understand how the target system (the new system) works. Our own ERP and CRM become the **test systems** where we practise and prove our work.

> **The Migration Kit is our main product.** The ERP and CRM are the test beds. In the real company later, clients use their own ERP/CRM (for example Odoo, ERPNext, Zoho, HubSpot), and our Kit moves data into those systems.

Each group builds **two things** for its module:

| Part | What it is | Priority |
|---|---|---|
| **A. Module** | A lean (small) business module, for example "Contacts" or "Products". Only the must-have features. | Medium |
| **B. Migration Kit** | Tools that take messy data for this module, clean it, and load it into the module safely. | **High — this is our main product** |

## 1.5 Honest note about scope

Every group has 4 people who are doing software development for the first time. Building a full module and a full migration kit is a lot of work. So we use three versions and three priority levels for every feature.

**Priority levels**

- **Must** — everyone delivers this. It is the promise.
- **Should** — deliver if time allows.
- **Could** — bonus. Do not start these before all "Must" items work.

**Rule: the Migration Kit "Must" items come first. If time is short, make the module smaller, not the kit.**

**Version levels (the heart of this document)**

- **V1 (Version 1)** — the minimum deliverable. Small, but it **looks complete** and it works end to end.
- **V2 (Version 2)** — better enhancements. The product becomes pleasant and stronger.
- **V3 (Version 3)** — the complete version of the student project. This is the version in the final demo.

Chapter 4 explains exactly what each version contains for the whole product. Chapter 7 explains it for each of the 11 groups. The three Software Design Specification (SDS) documents (CRM, ERP, Migration Kit) give the full technical detail for V1, V2 and V3.

## 1.6 Company name

**ClearShift** = *clear* (clean data) + *shift* (move data).

Other name ideas, if you do not like it: **CleanCutover**, **DataPort Labs**, **MoveWell Data**. Before you decide, check that the domain name and the social media names are free, and that no other company uses the same name in your country.

# 2. How to Read This Document

This document is written for people who build software for the first time. It uses **B1 English** (simple English). Technical words are used, but every technical word is explained the first time it appears. A full list is in Chapter 3.

## 2.1 What each chapter gives you

| Chapter | What you learn | Main reader |
|---|---|---|
| 1. Summary | Why ClearShift exists and what we build. | Everyone |
| 2. How to read | How to use this document. | Everyone |
| 3. Key words | The meaning of technical words. | Everyone |
| 4. Three versions | What V1, V2 and V3 contain. | Everyone |
| 5. Team structure | Who is in which group. | Everyone |
| 6. Roles | The 4 roles in every group + PMO roles. | Everyone |
| 7. Groups and modules | Deep dive: how each team works, its interface, its deliverables. | Group members |
| 8. ERP + CRM together | How the two sides connect, the Hub, the Golden ID, the waves. | Role 2, Integration Lead |
| 9. Technical framework | The 7-step pipeline, the data layers, the tools, the standards. | Everyone |
| 10. Project plan | The 12 weeks, 6 sprints, 6 gates. | Everyone |
| 11. Testing and quality | How we prove the data is correct. | Everyone (QA Lead leads) |
| 12. Project management | Meetings, risks, changes, grading. | Everyone |
| 13. Working with AI tools | How to use AI assistants responsibly. | Everyone |
| 14. Project to company | How this project becomes a real business. | Everyone |
| 15. First 7 days | The checklist for week 1. | Everyone |
| 16. Templates | Ready-to-copy templates. | Team Leads, QA Leads |

## 2.2 The three documents of the project

| Document | What it is | Status |
|---|---|---|
| **Project Plan and Team Guide** (this document) | The plan: people, roles, versions, schedule, rules. | Living document, updated by the PM |
| **SDS: ClearShift CRM** | Software Design Specification for the CRM: every feature, table, screen, API for V1, V2, V3. | Living document, owned by CRM groups + Integration Lead |
| **SDS: ClearShift ERP** | Same for the ERP. | Living document, owned by ERP groups + Integration Lead |
| **SDS: ClearShift Migration Kit** | Same for the Migration Kit (our main product). | Living document, owned by all groups + Integration Lead |

> **SDS** means *Software Design Specification*. It is a detailed description of a software system: what it does, what data it keeps, what screens it shows, and what APIs it offers. "Specification" means a precise promise: this system will do exactly this.

## 2.3 Rules for reading

1. Read Chapters 1-4 once, in the first week.
2. Read your own group's part of Chapter 7 very carefully. Read it again before Gate G1.
3. Keep Chapters 9-12 open while you work. They contain the rules you must follow every day.
4. When this document and the SDS disagree, the **SDS wins for technical detail**, and this document wins for **process, people and dates**.
5. Nothing in this document is magic. If something is wrong, use the change control process (Chapter 12.4) to fix it.

# 3. Key Words

These words are used again and again in this project. Learn them in the first week.

| Word | Simple meaning |
|---|---|
| **ERP** | Enterprise Resource Planning. Software that runs the inside of a business: stock, buying, orders, invoices, money, staff. |
| **CRM** | Customer Relationship Management. Software that manages customers: leads, deals, support, marketing. |
| **Data migration** | Moving data from one system to another. |
| **Data cleaning** | Fixing bad data: duplicates, wrong formats, missing values. |
| **Source system** | The old place where the data is now (Excel, old software). |
| **Target system** | The new place where the data must go (our ERP or CRM). |
| **Mapping** | A rule that says "this old field goes to that new field". |
| **Field** | One piece of data in a record, for example "phone number". |
| **Record** | One row of data, for example one customer. |
| **Staging area** | A safe temporary database where data waits and is cleaned before loading. |
| **Golden ID** | One main ID (identification number) for one real customer or product, even if it appears in many systems. |
| **Reconciliation** | Counting and comparing records before and after migration to prove nothing was lost. |
| **API** | Application Programming Interface. A way for two programs to talk to each other with fixed rules. |
| **OpenAPI file** | A standard description file that documents an API. Tools can read it. |
| **Event** | A message that says "something happened", for example "batch cleaned". |
| **Event bus** | A central system that carries events between programs (our Hub). |
| **Cutover** | The day the company stops using the old system and starts using the new one. |
| **Dry run** | A test run that does everything but saves nothing. Also called "test run". |
| **Rollback** | Undo a load, and return the target system to the state before the load. |
| **Batch** | One run of the pipeline on one file or one set of records. Every batch has a **batch_id**. |
| **PMO** | Project Management Office. The people who manage the whole project. |
| **Sprint** | A work period of 2 weeks with a clear goal. |
| **Gate** | A checkpoint with conditions. The Project Manager decides Go or No-Go. |
| **Unit test** | A small automatic test that checks one small piece of code. |
| **CI** | Continuous Integration. An automatic process that builds and tests the code every time someone shares changes. |
| **Repository (repo)** | A stored place for code with full history (we use GitHub). |
| **Pull request (PR)** | A request to merge (join) code into the main code. Another person must review it first. |
| **Contract test** | A test that checks that an API really follows its OpenAPI file. |
| **Mock API** | A fake version of an API, used while the real one is not ready. |
| **Schema** | The structure of a database: tables, columns, types. |
| **Dashboard** | One screen that shows the important numbers. |
| **RAG** | Red / Amber / Green. A simple status colour: Red = blocked, Amber = risk, Green = on track. |
| **DoD** | Definition of Done. The list of conditions that make a task really finished. |
| **SDS** | Software Design Specification. The detailed technical description of a system. |

# 4. The Three Versions: V1, V2, V3

## 4.1 Why versions matter (release thinking)

Beginners try to build everything at once. This almost always fails. Professionals build in **versions**. Each version is small, works completely, and can be shown to other people. This idea is called **release thinking**: every version is a real release, not a broken half-product.

Think of it like a house:

- **V1** = a small house that is finished: walls, roof, one kitchen, one bathroom. You can live in it.
- **V2** = more rooms, a better kitchen, a garden.
- **V3** = the full house from the drawing.

You never live in a house without a roof. In the same way, V1 is never a broken program. V1 is small, but it is **complete**: login works, data saves, reports show numbers, and the demo works.

> **This is the most important rule of the project: never start V2 features while V1 still has open critical bugs.**

## 4.2 V1 — Minimum deliverable (small, but looks complete)

V1 is the version that makes the project **presentable**. A stranger must look at it and say: "This is a complete product."

**V1 promise (product level)**

| # | V1 promise | Owner |
|---|---|---|
| 1 | One shared login with roles works for all modules. | Integration Lead + DevOps Lead |
| 2 | The ClearShift Hub runs: ID Map (Golden IDs), event bus, batch registry. | Integration Lead + Group 11 |
| 3 | Every group's module has its **core entity** working: list, search, add, edit, with a clean empty state. | Group Role 3 + Role 1 |
| 4 | Every group's Migration Kit works on its **Dirty Data Pack** with the 7 steps: Extract, Profile, Clean, Map, Load (dry run + real), Validate, Reconcile. | Group Role 4 + Role 1 + Role 2 |
| 5 | The CRM-5 Migration Control Center shows runs, quality scores, rejects, and reconciliation for all groups. | Group 5 (CRM-5) |
| 6 | Wave 1 (master data) runs end to end through the Hub with 2-3 groups connected. | Integration Lead |
| 7 | The demo script works from start to finish, with fake data only. | Role 1 + Role 3 |

**V1 rule: fewer features, but every feature works completely.** A short list that works is better than a long list that is broken.

## 4.3 V2 — Better enhancements

V2 makes the product **pleasant and stronger**. V2 adds what users miss in V1, and it adds safety (rollback, merge review, better reports).

**V2 promise (product level)**

| # | V2 promise | Owner |
|---|---|---|
| 1 | Duplicate merge review screens in the key modules (human decides: merge or keep). | CRM-1, ERP-1, ERP-2 + kit |
| 2 | Rollback works for every load (undo without damage). | Role 2 of each group |
| 3 | Mapping screen: the user connects old fields to new fields without code. | Role 3 of each group |
| 4 | Better reports: quality trends, PDF export, top problem lists. | CRM-5 |
| 5 | Waves 1-3 run end to end through the Hub (business data + money + history). | All groups |
| 6 | Basic performance check: 10,000 records in one run, time is measured and reported. | Role 4 + DevOps Lead |
| 7 | Basic security check: login, roles, input checks, masking of sensitive data. | DevOps Lead + QA Leads |

## 4.4 V3 — Complete version (the final demo)

V3 is the **complete student product**. It is what you show in the final demo and in your portfolio.

**V3 promise (product level)**

| # | V3 promise | Owner |
|---|---|---|
| 1 | All 5 CRM modules and all 5 ERP modules have their "Must" features complete. | All groups |
| 2 | All 4 waves run end to end, including cutover rehearsal (Wave 4). | Integration Lead + Test Manager |
| 3 | Full reconciliation passes on the test data: source = loaded + rejected + merged, exactly. | Role 4 of each group |
| 4 | End-to-end scenarios pass (customer journey, product to quote, order to money, consent safety, fail-safe). | Test Manager |
| 5 | All documents delivered: user manuals, test reports, OpenAPI files, data dictionaries. | All groups |
| 6 | Quality numbers are published (completeness, validity, duplicate rate, reject rate, link integrity, speed). | CRM-5 |

## 4.5 Where the versions meet the 12 weeks

The three versions are not three separate projects. They are the **same project, delivered in three steps**, aligned with the gates from Chapter 10:

| Version | Ready at | Gate | What you can show |
|---|---|---|---|
| **V1** | End of Week 8 (Sprint 4) | **G4 Build Complete** | A complete small product: login, modules, full pipeline on the Dirty Data Pack, Control Center with numbers. |
| **V2** | End of Week 10 (Sprint 5) | **G5 Release Candidate** | Everything from V1, plus merge review, rollback, mapping screen, waves 1-3 through the Hub, security and speed checks. |
| **V3** | End of Week 12 (Sprint 6) | **G6 Final Demo** | Everything from V2, plus all "Must" features, all 4 waves, end-to-end proof, full documents. |

> **If a group is late:** it stays at the previous version. A group that delivers a strong V1 and a weak V2 is still successful. A group that skips V1 and builds V3 features is not — because it will have nothing to show if the complex work fails.

# 5. Team Structure and Roster

## 5.1 The numbers

The roster sheet lists **48 names**: 10 module groups of 4 people, one platform group (Group 11) of 5 people, and a project management box with 3 names. The plan in this document is written for **10 module groups + 1 platform group + a PMO (project management team)**. The PM confirms the final headcount in Week 1 (Section 5.5 explains how to adapt).

| Team | Groups | People |
|---|---|---|
| CRM module groups | 5 | 20 |
| ERP module groups | 5 | 20 |
| Platform group (Group 11: Hub, shared library, DevOps support) | 1 | 5 |
| PMO (project management) | 1 | 3 |
| **Total** | **11 groups + PMO** | **48** |

> **Why 10 module groups and not 12?** The earlier plan had 12 modules. With the real numbers from the roster sheet, two small modules (Production, and Quotes as a separate module) are removed. Quotes are now part of the Deals module (CRM-2). If your real numbers are different, see Section 5.5.

## 5.2 Structure picture

```
+----------------------------------------+
|  PMO (3 people)                        |
|  Project Manager: Aman                 |
|  Quality & Test Manager: Raj           |
|  DevOps & Security Lead: Pari          |
+--------------------+-------------------+
                     |
                     v
+----------------------------------------+
|  Integration Lead (from Group 11)      |
+--------------------+-------------------+
                     |
                     v
+----------------------------------------+
|  ClearShift Hub                        |
|  ID Map | Events | Batches             |
+--------------------+-------------------+
                     |
                     v
+----------------------------------------+
|  CRM SIDE                              |
|  Group 1  -> CRM-1  Contacts & Leads   |
|  Group 2  -> CRM-2  Deals & Quotes     |
|  Group 3  -> CRM-3  Tickets            |
|  Group 4  -> CRM-4  Marketing          |
|  Group 5  -> CRM-5  Control Center     |
+--------------------+-------------------+
                     |
                     v
+----------------------------------------+
|  ERP SIDE                              |
|  Group 6  -> ERP-1  Products           |
|  Group 7  -> ERP-2  Vendors            |
|  Group 8  -> ERP-3  Orders             |
|  Group 9  -> ERP-4  Finance            |
|  Group 10 -> ERP-5  HR                 |
+----------------------------------------+
```

The **ClearShift Hub** is the central part that connects CRM and ERP. The Integration Lead owns it, and Group 11 helps build and run it. Chapter 8 explains the Hub in detail.

## 5.3 Roster (proposed mapping — confirm in Week 1)

The names come from the roster sheet. The mapping from group number to module is **proposed** by the PMO. The Project Manager confirms or changes it in the first week, and then writes the final roster into `clearshift-docs`.

| Sheet group | Our group | Module | Proposed members (4 roles: Lead, Integration, Frontend, QA) |
|---|---|---|---|
| Group 1 | **CRM-1** | Contacts, Companies and Leads | Arya, Janmesh, Ajit, Yuvraj |
| Group 2 | **CRM-2** | Deals, Pipeline and Quotes | Aditya Yadav, Saudamini, Devanshee, Daksh |
| Group 3 | **CRM-3** | Support Tickets and Activities | Ashutosh, Zoha, Anant, Aditya Kumbhar |
| Group 4 | **CRM-4** | Marketing Lists and Campaign History | Kartik, Manan, Harish, Jui |
| Group 5 | **CRM-5** | Migration Control Center and Reports | Dhruv, Alina, Ashish, Dharmit |
| Group 6 | **ERP-1** | Products and Inventory | Atharva D, Samarth, Pratik, Aditya C |
| Group 7 | **ERP-2** | Vendors and Purchasing | Mahek, Ninad, Rishi, Shankar |
| Group 8 | **ERP-3** | Sales Orders and Invoices | Prince, Tanmay Sherkar, Pranav, Hazel |
| Group 9 | **ERP-4** | Finance and Accounting | Tejas, Kaushal, Aaroh, Harsh Kumar |
| Group 10 | **ERP-5** | HR and Employees | Aditya Kadam, Antara, Ayush Singh, Saad |
| Group 11 | **PLT-1** | Platform Group: ClearShift Hub, shared cleaning library, mock APIs, DevOps templates | Shubham, Vaishnavi, Saiyash, Kunwar, Tanay Shelar |

**PMO**

| Role | Name |
|---|---|
| Project Manager | Aman |
| Quality and Test Manager | Raj |
| DevOps and Security Lead | Pari |
| Integration Lead | To be chosen from Group 11 (proposed: one member of Group 11; the PM decides in Week 1) |

> **Note on the roster sheet:** some names are marked in the sheet. The Project Manager confirms the availability of every person in Week 1. Every role has a backup (Chapter 6), so one absence does not stop a group.

## 5.4 Inside a group: who sits next to whom

Every group of 4 works the same way, so help can move easily between groups:

```
   Role 1                Role 2                 Role 3                Role 4
 Team Lead +         Integration +           Frontend +            Data + QA Lead
 Core Developer        DevOps Engineer       Review Screens
   |                     |                     |                     |
 build logic          build connectors       build screens         build tables
 cleaning rules       APIs, events, CI       review screens        profile step
 approve release      mocks for others       user manual           test plan
```

Every person writes unit tests (automatic small tests) for their own code. The QA Lead leads the testing process, but does not do all testing alone.

## 5.5 If the numbers change

- **48 people (as in the sheet):** the structure above works. Group 11 becomes the Platform Group. PMO has 3 people; the Integration Lead role is filled from Group 11.
- **If 3-5 people are not available:** keep the same structure. Merge two small tasks, do not merge groups. The PM reduces scope (Chapter 12.4) instead of removing people.
- **If the PMO cannot be staffed:** use the 11 Team Leads as a steering committee and appoint the best leader as Project Manager. This adds load to that student, so reduce that person's module scope.
- **Smaller groups (3 people):** merge Role 3 into Role 2 for backend-heavy modules, and keep QA as a named duty of one person.

# 6. Roles and Decision Rules

## 6.1 The four roles in every module group

Every group has the same four roles. This makes it easy to work across groups: everybody knows who to talk to.

### Role 1 — Team Lead and Core Developer

**Main job:** lead the group and build the business logic and cleaning rules.

- Plan each sprint and give tasks to the team.
- Go to the weekly Leads Meeting with the PMO.
- Own the module's rules: what is a duplicate? what is a valid record?
- Build the **cleaning rules** and the business logic of the module.
- Write unit tests for own code.
- Approve each release to the integration environment.
- Sign the group's final test report.

**Backup:** Role 2.

### Role 2 — Integration and DevOps Engineer

**Main job:** connect the module to the world: files, databases, other modules, and the Hub.

- Build the **Extract** and **Load** connectors (read CSV and Excel files, read an old database, write into the module).
- Write the API and the OpenAPI document (the API description file).
- Send and receive events to and from the Hub.
- Set up Docker and the automatic test pipeline (CI) for the group's repository.
- Write API tests and **contract tests** (tests that check the API follows the agreed description).
- Build **mock APIs** (fake versions of other groups' APIs) so the group is never blocked.

**Backup:** Role 1.

### Role 3 — Frontend and Review-Screen Engineer

**Main job:** build what users see, especially the screens where a human checks the data.

- Build the module screens (list, search, add, edit).
- Build **review screens**: where a user sees "possible duplicates" or "problem records" and decides what to do.
- Build the **mapping screen**: the user connects old fields to new fields.
- Write component tests and UI tests.
- Write the user manual with screenshots.
- Prepare the demo screens.

**Backup:** Role 4.

### Role 4 — Data and QA Lead

**Main job:** know the data, create dirty test data, and prove the quality.

- Design the database tables and the staging tables.
- Build the **Profile** step: find problems in data (empty fields, strange values, duplicates).
- Build the **Validate** and **Reconcile** steps (count and compare before and after).
- Create the **Dirty Data Pack**: a set of fake but realistic messy data with known problems (Chapter 11.4).
- Write the test plan, the test cases, and the defect log.
- Run regression tests (tests that check old features still work) and basic security checks.
- Write the test summary report.

**Backup:** Role 3.

> **Important rules for roles**
>
> - **Everybody writes unit tests for their own code.** The QA Lead leads testing, but does not do all the testing alone.
> - **QA is a real role, not a side job.** In small teams, testing is the first thing people drop. We grade the QA Lead's work separately.
> - **Rotate Role 1 and Role 4** at the middle of the project (end of Sprint 3) only if the documents are complete. If not, keep the roles to save time.
> - **Backups are real.** Every backup reads the documents of the main person every week. If the main person is absent on Friday, the backup can work on Monday.

## 6.2 Roles in the PMO and the Platform Group

| Role | Main job | Key tasks |
|---|---|---|
| **Project Manager (PM)** | Own time, scope, risks, and people. Act as the "client" for the groups. | Run the plan and the Leads Meeting. Track progress and risks. Decide scope changes. Remove blockers. Approve every gate (Chapter 10.3). |
| **Integration Lead** | Own the **ClearShift Hub** and the shared data model. | Build and run the Hub, the ID Map (Golden IDs), the event system, and the **shared cleaning library**. Review every group's API description. Run the integration environment. |
| **Quality and Test Manager** | Own quality across all groups. | Write the master test plan. Organise peer testing. Run the end-to-end scenarios. Manage defect triage (decide which bug is fixed first). Give Go/No-Go advice for each gate. |
| **DevOps and Security Lead** | Own tools, servers, and data safety. | Give every group a repository, CI template, and Docker setup. Keep the shared environment running. Manage passwords and secrets. Make sure only fake data is used. Run security checks. |
| **Platform Group (Group 11)** | Build and run the shared parts, under the Integration Lead. | Hub features, shared cleaning library `clearshift-core`, mock APIs, CI templates, demo environment, support to any group that is blocked. |

If one PMO person is away, the others cover as follows: PM covers for the Test Manager (reports), Test Manager covers for the DevOps Lead (templates), and the Integration Lead (from Group 11) covers for the PM in meetings.

## 6.3 Who decides what (simple decision rules)

| Decision | Who decides | Who must be asked first |
|---|---|---|
| Change inside one module (code, screens, rules) | Group Team Lead | — |
| Change to a module's API or events | Group Team Lead + Integration Lead | All groups that use this API |
| Change to the shared data model or the Hub | Integration Lead | PM, affected Team Leads |
| Change to scope, dates, or the plan | Project Manager | Integration Lead, Test Manager |
| Release to the integration environment | Group Team Lead | Group QA Lead says "tests pass" |
| Go/No-Go for a gate | Project Manager | Test Manager gives advice |
| Disagreement between two groups | Project Manager | Integration Lead gives technical advice |

> **Rule: no decision without a written note.** Important decisions go into the shared decision log (a simple document in `clearshift-docs`), not only into chat. Chat messages disappear; the decision log stays.
