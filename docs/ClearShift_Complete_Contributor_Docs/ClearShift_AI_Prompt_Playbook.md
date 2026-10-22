# ClearShift AI Prompt Playbook

Use one prompt per phase and include the full live issue URL/body. These prompts assume the approved ClearShift V1 stack and constraints. AI output must be reviewed; do not claim a command passed unless it ran successfully.

## 1. Issue comprehension - no edits

```text
You are my senior engineer for ClearShift. I am assigned [ISSUE ID + LIVE
GITHUB URL].
Inspect the complete issue, linked SDS/ADR, repository instructions, relevant
existing code and tests. Do not modify files and do not run destructive
commands.
Return:
1. A checklist mapping each acceptance criterion to evidence needed.
2. Dependencies and whether the required PRs/issues are actually complete.
3. Existing reusable files/helpers/contracts with verified repository paths.
4. Files likely to change and files that must not change.
5. Positive, negative, permission, error, retry and edge-case tests needed.
6. Risks for data integrity, privacy, performance and cross-module ownership.
7. Any genuinely unresolved question and the exact maintainer who should
decide it.
Do not invent paths, scripts, API details or business rules. If you cannot
find something, report what you searched.
```

## 2. Repository reconnaissance

```text
For issue [ISSUE ID], search the repository read-only for existing
implementations, type/schema definitions, API routes, tests, event helpers and
similar merged patterns. Use real paths and line references where available.
Do not edit files. Tell me which implementation to reuse and why a new
abstraction is or is not necessary. Identify likely cross-team files before
any write.
```

## 3. Plan before implementation

```text
Based only on issue [ISSUE ID + URL] and the approved ClearShift documents,
propose the smallest implementation plan. For each step provide: file path,
behavior, acceptance criterion, test, dependency and risk. Preserve Node 24
LTS pinned patch, pnpm/Turborepo, Fastify 5, Zod/OpenAPI, PostgreSQL/Drizzle,
Redis Streams, BullMQ, outbox and shared React/Vite UI as already pinned in
the repository. Do not change dependencies, shared contracts, auth, queue
architecture or files owned by other teams without maintainer approval. Do not
edit yet. Stop if a design decision is missing.
```

## 4. Implement one issue

```text
Implement only the approved plan for [ISSUE ID]. Keep the diff scoped and
minimal. Follow existing repo patterns and shared helpers. Add tests for
success, invalid input, unauthorized access, missing references,
failure/retry/concurrency cases relevant to this issue. Do not change
unrelated files, weaken tests, add dependencies, use real data, expose secrets
or invent test results. Stop and ask before changing a shared contract, schema
ownership, CI, auth/RBAC, queue architecture or another team's files. At the
end report files changed, tests run with actual results, acceptance evidence
and remaining blockers.
```

## 5. Debug without making random changes

```text
Analyze this failure for issue [ISSUE ID]. Do not edit yet. Here are the exact
command, exit status, first relevant stack trace and sanitized output:
[PASTE]. Determine whether it is a code, test, contract, environment or
dependency problem. Give a short diagnostic sequence with reversible commands
first. Explain the expected signal from each command. Flag any destructive
action for explicit approval. Do not recommend deleting tests or broadly
reinstalling/resetting the project unless evidence supports it.
```

## 6. Test review

```text
Review the tests for issue [ISSUE ID]. Do not edit. Map each acceptance
criterion to at least one test/evidence item. Identify missing negative cases,
assertions that merely restate the implementation, over-mocking,
non-deterministic fixture data and untested failure paths. Check ClearShift
rules: stable idempotency keys, dry-run immutability, one terminal outcome per
source row, exact reconciliation, safe data, ownership boundaries and no V1
rollback saga. Return only actionable findings ranked by severity.
```

## 7. Independent code review

```text
Review the current branch diff for [ISSUE ID + URL] as a skeptical senior
maintainer. Do not edit files. Check correctness, data integrity,
security/privacy, API compatibility, transaction boundaries,
idempotency/retries, concurrency, event semantics, resource bounds,
accessibility, test quality and scope creep. Report each finding with
severity, exact file/line, a reproducible scenario and a concrete fix.
Separate confirmed bugs from optional suggestions. If no finding exists in an
area, say what you examined rather than claiming total certainty.
```

## 8. Explain the code to me

```text
Teach me the final diff for [ISSUE ID] as if I must defend it in code review.
Explain the request/data flow, important functions, types, validation
boundaries, persistence/transaction behavior and failure cases. For each
changed file state why it changed and which test proves it. Ask me three
review questions that test my understanding. Do not hide uncertainty.
```

## 9. Draft a PR body from evidence

```text
Draft the PR title and body from the actual issue and current git diff for
[ISSUE ID]. Do not invent commands, test results, screenshots or approvals.
Include: real issue reference, purpose, behavior, acceptance-criteria mapping,
files changed, commands actually run and outcomes, schema/API/event effects,
security/privacy review, UI screenshots when relevant, risks/recovery and
checks not run. Use `Closes #<number>` only if the actual GitHub issue number
is known and this PR should close it. Otherwise use a non-closing reference
and flag the missing number.
```

## 10. Review a failed CI run

```text
Inspect this CI failure for [PR URL]. Do not edit files. Classify each failure
as likely code, flaky test, environment/config, contract drift or unrelated
baseline failure. Cite log evidence and propose a minimal reproduction. Do not
recommend rerunning indefinitely or bypassing a required check. Identify who
owns any workflow or shared package affected.
```

## 11. Safe schema/migration review

```text
Review this Drizzle/PostgreSQL schema change for [ISSUE ID], without editing.
Check UUID/key strategy, nullability, unique/check/foreign-key constraints,
indexes, numeric precision, migration order, data loss, forward compatibility,
seed/test impact and the exact clean-install/upgrade tests required. Do not
claim schema rollback is supported unless the repository has an explicit
tested process. Identify any cross-module table ownership violation.
```

## 12. Migration pipeline review

```text
Review this migration-pipeline change for [ISSUE ID], without editing. Trace
source row identity through extract, profile, clean, map, dry run, load,
validation and reconciliation. Verify 50 MB streaming limit, CSV
UTF-8/delimiter and XLSX-first-sheet rules, 500-row batches, >10% failure
stop, stable idempotency key, dry-run immutability, atomic
target-write/receipt transaction, one terminal outcome per parsed row, reason
codes and `unaccounted_rows = 0`. Flag any unbounded buffering, silent drop,
fuzzy auto-merge or V1 rollback-saga behavior.
```
