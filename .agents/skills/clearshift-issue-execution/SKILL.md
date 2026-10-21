---
name: clearshift-issue-execution
description: Execute one ClearShift GitHub issue safely from specification to tests, reviewable diff, and PR packet without crossing project boundaries.
---

# ClearShift Issue Execution Skill

## Inputs
- A live GitHub issue URL and permanent catalog ID.
- Current repository/worktree and approved base branch.
- Relevant SDS/ADR and package instructions.

## Procedure

### 1. Inspect (read-only)
1. Check `git status --short --branch` and identify uncommitted work.
2. Read the full issue, acceptance criteria, dependencies, out-of-scope section and comments.
3. Confirm dependencies are merged/done; stop if blocked.
4. Read repository instructions, the relevant package `package.json`, types/contracts, implementation and tests.
5. Locate existing shared helpers and code-owner boundaries. Do not assume paths.

### 2. Plan (no edits)
Return:
- acceptance criteria and evidence mapping;
- files to inspect/change and files to avoid;
- smallest implementation plan;
- required unit/API/UI/integration tests;
- risk, migration, security and recovery considerations;
- any unresolved decision requiring a maintainer.

Do not edit until the user approves the plan. Do not invent missing business rules.

### 3. Implement (scoped)
- Implement only the approved plan and one issue outcome.
- Reuse established shared helpers; don't duplicate platform/migration UI or add a second queue.
- Add/update tests and docs/contracts/fixtures affected by the change.
- Stop for approval before modifying shared contracts, dependency versions, lockfiles, authentication, CI or files owned by another team.

### 4. Verify
- Discover exact commands from repo docs and `package.json`; do not guess script names.
- Run the narrow relevant tests first, then all required package/repository checks feasible locally.
- Report the exact command and actual result. Never claim a test passed if it was not run.
- Run `git diff --check`, `git status --short` and inspect the entire diff.
- For UI changes capture screenshots/recording; for migration changes prove row outcomes and exact reconciliation.

### 5. Review
Check scope, types, error handling, auth/RBAC, secret/sensitive-data exposure, database constraints/transactions, idempotency, concurrency, event handling, performance limits, accessibility and negative tests.

### 6. Prepare PR packet (do not merge)
Draft title using the catalog ID. Summarize behavior, acceptance evidence, actual tests, schema/API/events, privacy/security, visual evidence, risks and checks not run. Use `Closes #<actual GitHub issue number>` only if the exact issue number is known and should close on merge. Do not merge, push forcefully or close issues unless explicitly authorized by the maintainer.

## Stop conditions
Stop and ask when:
- an issue dependency is incomplete;
- the issue contradicts an approved SDS/ADR;
- the proposed implementation requires an unapproved dependency/architecture change;
- two teams own the same changed contract/file;
- test or recovery requires a destructive action;
- real sensitive data is present;
- acceptance criteria cannot be met from the documented specification.
