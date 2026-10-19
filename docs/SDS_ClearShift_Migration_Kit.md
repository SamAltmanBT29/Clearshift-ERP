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
    #text(size: 19pt, weight: "bold")[ClearShift Migration Kit]
    #v(6pt)
    #text(size: 12pt)[White paper — Version 1.0]
    #v(30pt)
    #text(size: 10.5pt)[Prepared by: ClearShift PMO + all 11 groups + Integration Lead]
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

This document is the **Software Design Specification (SDS)** for the **ClearShift Migration Kit**. It describes the engine that moves and cleans data: the steps, the rules, the tables, the APIs, the screens and the proofs.

Read it together with:

| Document | What it gives you |
|---|---|
| Project Plan and Team Guide | People, roles, dates, gates, quality rules |
| SDS: ClearShift CRM | The target system on the CRM side |
| SDS: ClearShift ERP | The target system on the ERP side |

## 1.2 What the Migration Kit is

The **Migration Kit** is a data pipeline (a fixed sequence of steps that data moves through). It takes messy data from an old place (Excel, CSV, an old database), cleans it, maps it to the new structure, loads it into the target system, and then **proves** with counts that nothing was lost.

**This is the main product of ClearShift.** The CRM and the ERP are the test targets where we practise.

The Kit works the same way for every module. Each of the 11 groups builds the Kit **for its own module** using this specification, and the shared parts (connectors, rules, matching engine) live in the shared library `clearshift-core`, owned by the Platform Group.

## 1.3 The 7 steps (the heart of the Kit)

| Step | Name | What it does | Output |
|---|---|---|---|
| 1 | **Extract** | Read the source file or database into the raw area. **Never change raw data.** | `raw_<module>` + counts |
| 2 | **Profile** | Count the problems: empty values, strange formats, possible duplicates. | Data health report |
| 3 | **Clean** | Fix the data with rules: trim, standardise, validate. | `stg_<module>` with status |
| 4 | **Map** | Connect old fields to new fields. Convert values (old status -> new status). | `clean_<module>` |
| 5 | **Load** | Put clean data into the target module. Supports **dry run** (test run, saves nothing) and **rollback** (undo). | Target tables + load report |
| 6 | **Validate** | Check the business rules after loading ("every order has a customer"). | Validation report |
| 7 | **Reconcile** | Count: **source = loaded + rejected + merged**. Prove nothing was lost. | Reconciliation report |

Every step writes a log and sends an event to the Hub.

## 1.4 Users of the Kit

| User | What they do with the Kit |
|---|---|
| **Migration runner** (technical) | Runs the pipeline, checks the logs, fixes mappings. |
| **Editor** (business user) | Reviews duplicates, approves merges, reads reports. |
| **Analyst / client** | Reads the quality reports and the reconciliation. |
| **Admin** | Manages rules, templates and users. |

## 1.5 What is out of scope (not in this SDS)

- Migrating real files or real databases of real companies (fake data only in this project).
- Sending data anywhere outside our systems (no cloud upload in the student version).
- Machine learning models that need training data (V3 uses simple statistics, not trained models).

# 2. How to Read This Specification

## 2.1 The three parts

| Part | Chapter | Ready at | Gate |
|---|---|---|---|
| **V1 — Minimum deliverable** (small, but looks complete) | 4 | End of Week 8 | G4 |
| **V2 — Better enhancements** | 5 | End of Week 10 | G5 |
| **V3 — Complete version** (final demo) | 6 | End of Week 12 | G6 |

**Rule: never start V2 requirements while V1 requirements still have open critical bugs.** For the Kit this rule is even stronger: the Kit is the product, so V1 of the Kit is the first promise to a client.

## 2.2 Requirement IDs

| Prefix | Meaning | Example |
|---|---|---|
| `FR-<step>-nn` | Functional requirement of a step: `EX` Extract, `PR` Profile, `CL` Clean, `MP` Map, `LD` Load, `VA` Validate, `RC` Reconcile, `EN` Engine | `FR-CL-04` |
| `RL-<domain>-nn` | Cleaning rule in the shared library | `RL-EMAIL-01` |
| `MT-<method>-nn` | Matching method (duplicate detection) | `MT-EXACT-01` |
| `BR-KIT-nn` | Business rule of the whole Kit | `BR-KIT-01` |
| `NFR-nn` | Non-functional requirement | `NFR-03` |
| `EV-nn` | Event sent to the Hub | `EV-05` |
| `TS-nn` | Test scenario (proof) | `TS-05` |

Priority words: **Must**, **Should**, **Could** (same meaning as in the Project Plan).

## 2.3 B1 note

This document uses simple English (level B1). Technical words are explained the first time or in the glossary (Chapter 10).

# 3. Overall Architecture (all three versions)

## 3.1 The shape of the Kit

```
 Source                      Kit engine                        Target
+-----------+   extract   +------------------+   load   +-----------------+
| CSV/Excel | ----------> | raw / stg / clean| -------> | CRM or ERP      |
| old DB    |             | + rule library   |          | target tables   |
+-----------+             +--------+---------+          +-----------------+
                                   |
                                   v
                          ClearShift Hub
                     (batch events, Golden ID,
                      logs, CRM-5 dashboard)
```

The engine is a **state machine**: a batch (one run on one file) moves through states, and it can only move forward when the previous step finished and wrote its counts.

## 3.2 Batch states

```
 created -> extracted -> profiled -> cleaned -> mapped
                                              |
                            +-----------------+-----------------+
                            |                                   |
                       dry_run_ok                         loaded
                            |                                   |
                            +-----------------+-----------------+
                                              |
                                        validated -> reconciled

 Any state can move to: failed (with a reason).
 A loaded batch can move to: rolled_back (V2).
```

| Rule | Meaning |
|---|---|
| BR-KIT-01 | A batch cannot skip a state. You cannot load what was not cleaned. |
| BR-KIT-02 | Every state change writes an event and a log row with counts in and out. |
| BR-KIT-03 | Raw data is never edited. If cleaning finds an error, the row moves to `stg` with a status, not the raw copy. |
| BR-KIT-04 | A rejected row always has a `reject_reason` in simple language. |
| BR-KIT-05 | Reconciliation must be exact: source = loaded + rejected + merged. If it is not, the batch is marked NOT OK and cannot be signed off. |

## 3.3 Data layers

| Layer | Schema | Rule |
|---|---|---|
| Raw | `raw_<module>` | Exact copy of the source, plus `batch_id`, `source_row`. Never edited. |
| Staging | `stg_<module>` | Raw plus cleaning results, `status`, `reject_reason`, `golden_id`. |
| Clean | `clean_<module>` | Mapped and ready to load: only target fields. |
| Target | `<module>` tables | The real module (CRM-1, ERP-1, ...). |
| Engine | `kit_*` | The Kit's own tables: batches, mappings, rejects, reports. |

## 3.4 The shared rule library `clearshift-core`

Every group uses the same rule functions, so a phone number is cleaned the same way in every module. The Platform Group owns the library; groups request new rules in the `#integration` channel.

| Rule ID | What it does (V1) |
|---|---|
| RL-TEXT-01 | Trim spaces at the start and end; replace multiple spaces with one. |
| RL-TEXT-02 | Remove control characters and strange symbols. |
| RL-NAME-01 | Proper case for names ("john smith" -> "John Smith"); keep a list of special cases (O'Brien, McDonald). |
| RL-EMAIL-01 | Trim, lower case, check for exactly one "@" and one dot after it, check the domain has a dot. |
| RL-PHONE-01 | Keep only digits and "+"; if the number has 10 digits and no country code, add the country code of the file (declared at upload). |
| RL-DATE-01 | Read dates in the declared format (for example DD-MM-YYYY); store as ISO 8601 (yyyy-mm-dd); anything else = reject. |
| RL-CURRENCY-01 | Remove currency symbols and spaces; replace "," thousand separators; parse as an exact decimal. |
| RL-ADDR-01 | Standardise city and country from a small dictionary ("Bombay" -> "Mumbai" is a client decision, so the dictionary is editable). |
| RL-REQ-01 | Check that required fields are not empty. |
| RL-FORMAT-01 | Check formats: email, phone, tax number (per country pattern), date. |
| RL-DUP-01 | Exact duplicate on a normalised key (see Chapter 4.7). |
| RL-TAX-01 | Check the tax number format for the chosen country; flag "unknown" instead of rejecting when unsure. |

V2 and V3 add: fuzzy matching, address parsing, unit conversion, currency conversion, IBAN check, and per-industry rule packs.

# 4. Part V1 — Minimum Deliverable Specification

V1 of the Kit: **CSV and Excel in, cleaned data out, with proof.** One file, one module, one run at a time. Small, but complete and trustworthy.

## 4.1 V1 scope

| In V1 | Out of V1 (moves to V2/V3) |
|---|---|
| CSV and Excel (.xlsx) upload | Old database connectors |
| Profile report with problem counts | Trends over runs |
| 12 cleaning rules from `clearshift-core` | Fuzzy matching, address parsing |
| Mapping screen (manual, saved templates) | Auto-mapping suggestions |
| Exact duplicate detection + review list | Fuzzy pairs, auto-merge |
| Dry run and load | Rollback |
| Validation rules per module | Rule builder UI |
| Reconciliation report (CSV) | PDF, run comparison |

## 4.2 Functional requirements V1 — Extract (step 1)

| ID | Requirement | Priority |
|---|---|---|
| FR-EX-01 | Upload one file: CSV (comma or semicolon, UTF-8) or Excel (.xlsx, first sheet). Max 50 MB in V1. | Must |
| FR-EX-02 | At upload, the user declares: source system name, date format of the file, country code for phones. | Must |
| FR-EX-03 | Copy every row into `raw_<module>` with `batch_id` and `source_row` (the row number). **Raw is never edited.** | Must |
| FR-EX-04 | Extract report: rows read, columns found, file name, checksum (a fingerprint of the file). | Must |
| FR-EX-05 | A file that cannot be read stops the batch with a clear message (not a crash). | Must |

## 4.3 Functional requirements V1 — Profile (step 2)

| ID | Requirement | Priority |
|---|---|---|
| FR-PR-01 | Per column: how many values are empty, how many have the wrong format, the 5 most common values. | Must |
| FR-PR-02 | Count of exact duplicates per declared key (email for contacts, SKU for products, tax number for companies). | Must |
| FR-PR-03 | The profile is shown as a table and downloadable as CSV ("data health report"). | Must |
| FR-PR-04 | The profile never changes any data. It only counts. | Must |

## 4.4 Functional requirements V1 — Clean (step 3)

| ID | Requirement | Priority |
|---|---|---|
| FR-CL-01 | Apply the 12 V1 rules (Chapter 3.4) to every row; each row gets a status: new / cleaned / rejected. | Must |
| FR-CL-02 | A row with a problem in a required field is rejected with a reason in simple language. | Must |
| FR-CL-03 | A row with a problem in an optional field is cleaned when a rule can fix it, otherwise flagged but kept. | Must |
| FR-CL-04 | Every change is logged per row: field, old value, new value, rule ID (the cleaning audit). | Must |
| FR-CL-05 | The user can turn rules on or off for this run (a rule that does not fit the file must be switchable). | Must |

## 4.5 Functional requirements V1 — Map (step 4)

| ID | Requirement | Priority |
|---|---|---|
| FR-MP-01 | Mapping screen: source columns on the left, target fields on the right, the user connects them. | Must |
| FR-MP-02 | Value conversion lists: old value -> new value (for example "WON" -> "Won", "kg" -> "kg"). | Must |
| FR-MP-03 | Save the mapping as a named template and load it for the next file. | Must |
| FR-MP-04 | A required target field without a source column blocks the load with a clear message. | Must |
| FR-MP-05 | Mapped rows move into `clean_<module>` with only target fields. | Must |

## 4.6 Functional requirements V1 — Load (step 5)

| ID | Requirement | Priority |
|---|---|---|
| FR-LD-01 | **Dry run**: the full load is simulated; nothing is saved; the report shows exactly what would happen. | Must |
| FR-LD-02 | Real load: rows are written to the target module through its API with the role `migration_runner`. | Must |
| FR-LD-03 | Loading happens in batches of 500 rows; if one row fails, the run continues and the row is rejected with a reason. | Must |
| FR-LD-04 | The load stops immediately if more than 10% of rows fail (a safety rule: something is wrong with the file). | Must |
| FR-LD-05 | Load report: loaded, rejected, skipped, duration, and the target IDs of the new records. | Must |

## 4.7 Functional requirements V1 — Duplicate detection and merge (part of Clean + Load)

| ID | Requirement | Priority |
|---|---|---|
| FR-DUP-01 | Exact duplicate detection (V1 methods only): same normalised email; same normalised phone + same normalised name; same tax number. | Must |
| FR-DUP-02 | Duplicates inside one file are merged into one row before the load (the first row wins; the others are counted as merged). | Must |
| FR-DUP-03 | Duplicates against data already in the target go to a **review list**: a human decides Keep both / Merge. | Must |
| FR-DUP-04 | The merge keeps the oldest record ID and stores the merged IDs in `merged_into_id` (so a merge can be undone later, V2). | Must |
| FR-DUP-05 | Every merge is written into the audit log with user, time and both IDs. | Must |

**Matching formula V1 (exact):** a value is normalised first (trim, lower case, remove spaces and punctuation), then compared exactly. No fuzzy (similar but not equal) matching in V1 — that is V2, because a wrong merge destroys data.

## 4.8 Functional requirements V1 — Validate (step 6)

| ID | Requirement | Priority |
|---|---|---|
| FR-VA-01 | After the load, run the module's validation rules (for example ERP-3: line totals equal order total). | Must |
| FR-VA-02 | Validation failures are listed per record with the rule ID and a simple message. | Must |
| FR-VA-03 | Link integrity check: every loaded record's links (order -> customer, deal -> contact) exist. | Must |
| FR-VA-04 | The validation result is sent to CRM-5 as `batch.validated`. | Must |

## 4.9 Functional requirements V1 — Reconcile (step 7)

| ID | Requirement | Priority |
|---|---|---|
| FR-RC-01 | Count the source rows, the loaded rows, the rejected rows and the merged rows. | Must |
| FR-RC-02 | Show the equation **source = loaded + rejected + merged** with the actual numbers and OK / NOT OK. | Must |
| FR-RC-03 | Download the reconciliation as CSV (and in V2 as PDF). | Must |
| FR-RC-04 | If NOT OK, the batch status becomes "reconciliation failed" and the PM and Test Manager are alerted. | Must |

## 4.10 Engine tables V1

| Table | Key columns |
|---|---|
| `kit_batches` | id, module, source_system, file_name, checksum, status, started_at, finished_at, created_by |
| `kit_batch_steps` | id, batch_id, step, status, records_in, records_out, records_rejected, started_at, finished_at, message |
| `kit_mappings` | id, module, name, mapping_json, value_conversions_json, created_by, created_at |
| `kit_profile_reports` | id, batch_id, column_name, empty_count, invalid_count, top_values_json |
| `kit_rejects` | id, batch_id, source_row, entity, reason_code, reason_text, raw_json |
| `kit_clean_log` | id, batch_id, source_row, field_name, old_value, new_value, rule_id |
| `kit_merges` | id, batch_id, kept_id, merged_ids_json, method, decided_by, decided_at |
| `kit_load_reports` | id, batch_id, loaded, rejected, merged, skipped, duration_seconds |
| `kit_reconciliations` | id, batch_id, source_count, loaded_count, rejected_count, merged_count, result (OK / NOT OK) |

## 4.11 API and CLI V1

The Kit is controlled from its own screen **and** from the command line (CLI), so a technical user can run it without a browser.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/migration-kit/batches` | Create a batch (module, file, declared formats) |
| POST | `/api/v1/migration-kit/batches/{id}/extract` | Run step 1 |
| POST | `/api/v1/migration-kit/batches/{id}/profile` | Run step 2 |
| POST | `/api/v1/migration-kit/batches/{id}/clean` | Run step 3 (body: rules on/off) |
| POST | `/api/v1/migration-kit/batches/{id}/map` | Run step 4 (body: mapping template id) |
| POST | `/api/v1/migration-kit/batches/{id}/dry-run` | Simulate the load |
| POST | `/api/v1/migration-kit/batches/{id}/load` | Real load |
| POST | `/api/v1/migration-kit/batches/{id}/validate` | Run step 6 |
| GET | `/api/v1/migration-kit/batches/{id}/reconcile` | Step 7 result |
| GET | `/api/v1/migration-kit/batches/{id}/rejects` | Reject list (paged) |
| GET | `/api/v1/migration-kit/mappings` | List mapping templates |

CLI examples (the same engine, from the terminal):

```
cs-kit batch create --module crm1 --file contacts.xlsx --date-format DD-MM-YYYY --phone-country +91
cs-kit run --batch B-00042 --steps extract,profile,clean,map,dry-run
cs-kit run --batch B-00042 --steps load,validate,reconcile
cs-kit report reconcile --batch B-00042 --out report.csv
```

## 4.12 Screens V1

| Screen | What it shows |
|---|---|
| Batch list | All runs: module, file, status, counts, times |
| New batch (4 steps) | Upload file, declare formats, choose module |
| Profile report | Problem counts per column, CSV download |
| Mapping screen | Source columns -> target fields, value conversions, save template |
| Rules screen | The rule list with on/off switches for this run |
| Review list | Duplicate pairs: Keep both / Merge, with field comparison |
| Run result | Loaded / rejected / merged / skipped, duration |
| Reconciliation | The equation with numbers and OK / NOT OK |
| Reject list | Every rejected row with reason, CSV download |

## 4.13 Events V1

| ID | Event | Payload (main fields) |
|---|---|---|
| EV-01 | `batch.extracted` | batch_id, module, rows_read |
| EV-02 | `batch.profiled` | batch_id, module, empty_count, invalid_count, duplicate_count |
| EV-03 | `batch.cleaned` | batch_id, cleaned, rejected |
| EV-04 | `batch.mapped` | batch_id, mapped, missing_required |
| EV-05 | `batch.loaded` | batch_id, loaded, rejected, merged |
| EV-06 | `batch.validated` | batch_id, validation_failures |
| EV-07 | `batch.failed` | batch_id, step, reason |

## 4.14 Acceptance criteria V1 (the demo must pass these)

| ID | Criterion |
|---|---|
| TS-01 | A 1,000-row CSV (the Dirty Data Pack) runs through all 7 steps in one command line. |
| TS-02 | The profile finds exactly the known problems: 80 duplicates, 60 bad formats, 50 empty required fields. |
| TS-03 | Exact duplicates inside the file are merged; the merge count equals the known number. |
| TS-04 | Dry run changes nothing in the target tables (verified by counts before and after). |
| TS-05 | A row with an invalid email is rejected with the reason "Email is not valid: value has no @ sign". |
| TS-06 | Reconciliation is exact: 1000 = loaded + rejected + merged, and the screen shows OK. |
| TS-07 | The raw tables are unchanged after the whole run (checksum comparison). |
| TS-08 | A file with 40% broken rows stops the load at 10% failures with a clear safety message. |

# 5. Part V2 — Better Enhancements Specification

V2 makes the Kit **safer and smarter**: it can read from an old database, it suggests similar duplicates for a human to decide, it can undo a load, and it can run at night.

## 5.1 V2 scope

| In V2 | Out of V2 (moves to V3) |
|---|---|
| Read-only connectors for PostgreSQL and MySQL | Incremental change capture |
| Fuzzy matching + merge review with scores | Auto-merge of fuzzy pairs |
| Golden ID assignment from the Hub | Cross-system matching across 3+ systems |
| Rollback of a load | Cutover rehearsal mode |
| Scheduler (runs at a fixed time) | Distributed workers |
| PDF reports, run comparison | Trend dashboard with alerts |

## 5.2 Functional requirements V2

| ID | Area | Requirement | Priority |
|---|---|---|---|
| FR-EX-10 | Extract | Connect to a read-only PostgreSQL or MySQL database: the user gives host, database, user, password (stored safely), and a SELECT statement. The Kit reads the result as the source. | Must |
| FR-EX-11 | Extract | Table mode: choose a table and optional WHERE filter instead of writing SQL. | Should |
| FR-PR-10 | Profile | Profile comparison: show this run's problem counts next to the previous run of the same module. | Should |
| FR-CL-10 | Clean | Rule templates: save a set of on/off rules per client and reuse it. | Should |
| FR-DUP-10 | Matching | Fuzzy matching with a **similarity score** (a number from 0 to 100). Pairs above 85 go to the review list; 70-84 are shown as "possible" and never auto-merged. | Must |
| FR-DUP-11 | Matching | Name similarity: compare first name and last name separately, ignoring case, spaces and known nicknames (Bob = Robert). | Must |
| FR-DUP-12 | Matching | Phone similarity: same country code and the last 7 digits equal. | Should |
| FR-DUP-13 | Merge | The review screen shows the score, the matching fields, and the differing fields highlighted. | Must |
| FR-DUP-14 | Merge | Undo the last merge (restores both records). | Must |
| FR-GID-10 | Golden ID | After a successful load, ask the Hub for the Golden ID of every customer and store it on the record. | Must |
| FR-GID-11 | Golden ID | Send possible cross-system matches (CRM contact vs ERP customer with the same tax number) to the Hub review list. | Should |
| FR-LD-10 | Load | **Rollback**: undo a load of a batch. The Kit restores the target tables to the state before the load and marks the records as rolled back. | Must |
| FR-LD-11 | Load | Dry run result comparison: compare a dry run with the previous real load (rows more, rows less). | Should |
| FR-EN-10 | Engine | Scheduler: a batch can run at a fixed time (for example every night at 02:00). | Should |
| FR-EN-11 | Engine | Run API: create and start a batch from another program (headless, without screens). | Must |
| FR-RC-10 | Reconcile | PDF report of the whole run (black and white, with the ClearShift header, numbers and rules applied). | Must |
| FR-RC-11 | Reconcile | Run comparison: compare two batches of the same module. | Should |

## 5.3 Matching formula V2 (fuzzy)

The score is a weighted sum of matching parts. All parts are between 0 and 1.

| Part | Weight | How it is calculated |
|---|---|---|
| Email | 0.40 | Exact match after normalisation = 1, otherwise 0 |
| Phone | 0.20 | Same country code and last 7 digits = 1; only last 7 digits = 0.6 |
| Name | 0.25 | Text similarity of first + last name (0 to 1) |
| City | 0.15 | Same city after dictionary standardisation = 1 |

| Score | What happens |
|---|---|
| 85 - 100 | Merge candidate: goes to the review list (a human still decides in V2). |
| 70 - 84 | Possible: shown in a separate list, never merged automatically. |
| Below 70 | New record. |

> **Why a human always decides:** a wrong merge destroys data and is very hard to undo. A duplicate costs time. ClearShift chooses the safe side — this is a selling point to clients.

## 5.4 Data model changes V2

| Change | Table | New columns / new tables |
|---|---|---|
| Sources | `kit_sources` (new) | id, kind (file/postgres/mysql), host, database, select_sql, secret_ref |
| Scores | `kit_match_scores` | id, batch_id, left_id, right_id, score, parts_json, status |
| Rollback | `kit_rollback_journal` (new) | id, batch_id, table_name, row_json, action (insert/update), position |
| Schedule | `kit_schedules` (new) | id, module, mapping_id, cron_text, active |
| Golden ID | `kit_gid_log` (new) | id, batch_id, record_id, golden_id, assigned_at |

## 5.5 API changes V2

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/migration-kit/sources` | Register a database source |
| GET | `/api/v1/migration-kit/batches/{id}/matches` | Fuzzy pairs with scores |
| POST | `/api/v1/migration-kit/merges` | Decide a merge (keep / merge) |
| POST | `/api/v1/migration-kit/merges/undo` | Undo the last merge |
| POST | `/api/v1/migration-kit/batches/{id}/rollback` | Roll back a load |
| POST | `/api/v1/migration-kit/schedules` | Create a scheduled run |
| POST | `/api/v1/migration-kit/reports/pdf` | PDF report of a run |
| GET | `/api/v1/migration-kit/compare?a={batch}&b={batch}` | Compare two runs |

## 5.6 Events V2

| ID | Event | When |
|---|---|---|
| EV-10 | `batch.rolled_back` | A load was undone |
| EV-11 | `merge.decided` | A human decided a merge pair |
| EV-12 | `gid.assigned` | Golden IDs were stored after a load |
| EV-13 | `run.alert` | Failure or a limit was exceeded |

## 5.7 Acceptance criteria V2

| ID | Criterion |
|---|---|
| TS-10 | Database source: the Kit reads 5,000 rows from a test PostgreSQL database with one SELECT statement. |
| TS-11 | Fuzzy matching: in the test file, "John Smith" and "jon smith" with the same email score above 85 and appear in the review list; "John Smith" and "Jane Smith" score below 70 and stay separate. |
| TS-12 | Rollback: load 1,000 rows, roll back, verify the target counts are exactly as before and `kit_rollback_journal` has one entry per changed row. |
| TS-13 | Scheduler: a nightly run starts without a human and writes its report. |
| TS-14 | The PDF report opens, is black and white, and shows the same numbers as the screen. |
| TS-15 | Performance: 10,000 records run through all steps in under 10 minutes on the demo machine; the time is published. |

# 6. Part V3 — Complete Version Specification

V3 is the **complete Kit**: it suggests mappings, follows changes in the source, watches data quality over time, and rehearses the cutover day.

## 6.1 V3 scope

| In V3 |
|---|
| Auto-mapping suggestions (the Kit proposes the mapping, the human confirms) |
| Incremental migration (only rows that changed since the last run) |
| Quality monitoring: score trends per module and per source |
| Custom rule builder (a user builds a new rule without code) |
| Target connectors (Odoo, Zoho, HubSpot — mock versions in the student project) |
| Cutover rehearsal mode (a full dry run of the real day, including timing) |
| Multi-target runs (one source, two targets) |
| Distributed workers for very large files (1,000,000 rows) |

## 6.2 Functional requirements V3

| ID | Area | Requirement | Priority |
|---|---|---|---|
| FR-MP-20 | Map | Auto-mapping: the Kit compares column names and sample values with the target fields and proposes a mapping with a confidence number. The human confirms or changes every line. | Must |
| FR-MP-21 | Map | Value conversion suggestions: the Kit lists the distinct old values and proposes the new values (for example all 14 spellings of "Won"). | Must |
| FR-EX-20 | Extract | Incremental mode: the source has a "last changed" column; only newer rows are read. The Kit remembers the last position per source. | Should |
| FR-PR-20 | Profile | Quality monitoring: the score of every run is stored; a trend chart per module and per source shows completeness, duplicate rate and reject rate over time. | Must |
| FR-PR-21 | Profile | Warning when the quality of a new file drops more than 10 points below the last run ("the client's data is getting worse — check the export"). | Should |
| FR-CL-20 | Clean | Rule builder: a user builds a rule without code: when [field] [condition] then [action], with a test on 10 sample rows before saving. | Should |
| FR-CL-21 | Clean | Rule packs per industry: a downloadable set of rules (for example "distributors" with SKU and unit rules). | Could |
| FR-LD-20 | Load | Target connectors: a connector interface, with mock implementations for Odoo, Zoho CRM and HubSpot (the student project uses mocks with the same behaviour). | Should |
| FR-LD-21 | Load | Multi-target: one source, two targets, with one reconciliation per target. | Could |
| FR-EN-20 | Engine | Distributed workers: very large files (1,000,000 rows) are split into parts and processed by several workers; the reports are combined. | Should |
| FR-EN-21 | Engine | Cutover rehearsal: run the whole plan of the cutover day on a copy, measure the time per step, and print a checklist with the real times. | Must |
| FR-EN-22 | Engine | Audit log screen: every action of every user in the Kit, filterable. | Must |
| FR-EN-23 | Engine | Single sign-on with the shared login, session timeout after 30 minutes, and a lock after 5 failed logins. | Must |

## 6.3 Data model changes V3

| Change | Table | New columns / new tables |
|---|---|---|
| Suggestions | `kit_mapping_suggestions` (new) | id, source_column, target_field, confidence, accepted |
| Incremental | `kit_source_positions` (new) | id, source_id, last_row_ref, last_run_at |
| Rule builder | `kit_custom_rules` (new) | id, module, name, condition_json, action_json, active |
| Workers | `kit_work_parts` (new) | id, batch_id, part_number, status, rows |
| Cutover | `kit_rehearsals` (new) | id, plan_json, started_at, finished_at, step_times_json |

## 6.4 API changes V3

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/migration-kit/batches/{id}/mapping-suggestions` | Proposed mapping with confidence |
| POST | `/api/v1/migration-kit/sources/{id}/position` | Get or set the incremental position |
| GET | `/api/v1/migration-kit/quality/trends?module={m}` | Quality trend data |
| POST | `/api/v1/migration-kit/rules` | Create a custom rule |
| POST | `/api/v1/migration-kit/rules/{id}/test` | Test a rule on 10 sample rows |
| POST | `/api/v1/migration-kit/rehearsals` | Start a cutover rehearsal |
| GET | `/api/v1/migration-kit/audit` | Audit log |

## 6.5 Events V3

| ID | Event | When |
|---|---|---|
| EV-20 | `quality.dropped` | Quality of a new file dropped more than 10 points |
| EV-21 | `rehearsal.finished` | A cutover rehearsal finished with its times |
| EV-22 | `run.alert` | Worker failure, limit exceeded, or security event |

## 6.6 Acceptance criteria V3

| ID | Criterion |
|---|---|
| TS-20 | Auto-mapping: on a file with 20 columns, at least 16 columns are proposed correctly; every proposal can be changed by the human. |
| TS-21 | Incremental: run 1 on 10,000 rows; change 50 rows in the source; run 2 reads exactly 50 rows and updates them. |
| TS-22 | Rule builder: a user creates a rule "when city = 'bombay' then set city = 'Mumbai'" without code, tests it, activates it, and it runs in the next batch. |
| TS-23 | Cutover rehearsal: the rehearsal runs the full plan of 6 steps on 50,000 rows and prints the time per step plus the total; the total matches the sum. |
| TS-24 | Performance: 1,000,000 rows are processed with workers; the report combines all parts and the reconciliation is exact. |
| TS-25 | Security: 5 wrong passwords lock the account; the session ends after 30 minutes of no action; both events appear in the audit log. |

# 7. Non-Functional Requirements (all versions)

| ID | Requirement | V1 | V2 | V3 |
|---|---|---|---|---|
| NFR-01 | Process 10,000 records through all steps in under 10 minutes (demo machine). | Target | Must | Must |
| NFR-02 | Process 50,000 records in one batch; publish the time. | — | Target | Must |
| NFR-03 | Process 1,000,000 rows with workers; reconciliation stays exact. | — | — | Should |
| NFR-04 | Only logged-in users with role `migration_runner` can start runs (401/403 otherwise). | Must | Must | Must |
| NFR-05 | Secrets (database passwords) are stored by the DevOps Lead's secret tool, never in code or logs. | Must | Must | Must |
| NFR-06 | Raw data is never edited (verified by checksum at every gate). | Must | Must | Must |
| NFR-07 | Every reject has a reason in simple language, never a stack trace (technical error text). | Must | Must | Must |
| NFR-08 | Logs contain no full personal data: values are shortened or masked. | Must | Must | Must |
| NFR-09 | Only fake or synthetic data in every environment. | Must | Must | Must |
| NFR-10 | A failed batch can always be restarted from the step that failed (no "start from zero" after a crash). | Should | Must | Must |

# 8. Interfaces with Other Systems

| System | Direction | What flows | How |
|---|---|---|---|
| ClearShift Hub | Kit -> Hub | All `batch.*` events, run status | Event bus |
| ClearShift Hub | Hub -> Kit | Golden IDs, login (JWT) | API `/api/v1/hub/id-map` |
| ClearShift CRM | Kit -> CRM | Clean records | Module APIs, role `migration_runner` |
| ClearShift ERP | Kit -> ERP | Clean records | Module APIs, role `migration_runner` |
| CRM-5 | Kit -> CRM-5 | Counts, scores, rejects | Via Hub events |
| Old database | DB -> Kit | Source rows (read-only) | PostgreSQL / MySQL connection (V2) |
| `clearshift-core` | library -> Kit | Cleaning and matching rules | Code library, same version for all groups |

# 9. Test and Verification Plan Summary

| Level | Tool | Who | V1 | V2 | V3 |
|---|---|---|---|---|---|
| Unit tests of every rule | Vitest | Role 4 + rule authors | 100% pass | 100% | 100% |
| Pipeline tests on the Dirty Data Pack | Vitest + scripts | Role 4 | All 7 steps | + rollback | + incremental |
| API tests | Postman/Newman | Role 2 | All Kit endpoints | All | All |
| UI tests | Playwright | Role 3 | Wizard and mapping screen | Review and rollback | Rule builder |
| Reconciliation proof | Script comparing counts | Role 4 | Every run | Every run | Every run |
| Performance test | k6 or a script | Role 4 + DevOps Lead | — | 10,000 rows | 1,000,000 rows |
| Security test | Checklist + OWASP ZAP | DevOps Lead | — | Secrets and roles | Lock, timeout, audit |

# 10. Glossary (B1 explanations)

| Term | Simple meaning |
|---|---|
| Batch | One run of the pipeline on one file or one set of records. |
| Checksum | A short fingerprint of a file, used to prove the file did not change. |
| CLI | Command Line Interface: running the Kit by typing commands, without screens. |
| Connector | A small program part that reads from one system or writes to another. |
| Cutover | The day the company stops using the old system and starts using the new one. |
| Dry run | A test run that saves nothing. |
| Fuzzy matching | Finding records that are similar but not exactly equal. |
| Golden ID | One main ID for one real customer, even in many systems. |
| Incremental migration | Moving only the rows that changed since the last run. |
| Reconciliation | Proving with counts that nothing was lost: source = loaded + rejected + merged. |
| Reject | A record that cannot be loaded, with a written reason. |
| Rollback | Undo a load safely, row by row. |
| Similarity score | A number from 0 to 100 that says how close two records are. |
| Staging | A safe temporary area where data waits while it is cleaned. |
| State machine | A system that can only move from one defined state to the next. |
| Worker | One of several programs that process a big file in parallel. |

---

*End of document. Keep this file in the `clearshift-docs` repository. Owner: all 11 groups together with the Integration Lead (the Kit is shared work). Update the version number when the PM approves a change.*
