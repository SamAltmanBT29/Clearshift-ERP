# ClearShift Contributor Quick Start

Keep this beside your GitHub issue while working. The full manual is `ClearShift_Team_Contributor_Guide.pdf` / `.md`.

## The 10-step issue loop

1. Open the **live GitHub issue**. Read context, constraints, acceptance criteria, exclusions and all dependencies.
2. Confirm dependencies are merged/done. If blocked, comment with the blocker and alert the lead; do not work around it.
3. Read repo instructions, related SDS/ADR, nearby implementation and tests. Check root/package scripts; never guess paths or commands.
4. Verify `git status --short --branch`; don't mix uncommitted work from another issue.
5. Create one issue branch: `feat/ERP1-01-product-schema` (example only).
6. Ask AI/Antigravity to **analyze and plan without edits**. Review the plan and get decisions approved before code.
7. Implement the smallest scoped change and add tests. Respect module/shared ownership.
8. Run actual repo-defined checks, inspect terminal results and the full diff; run `git diff --check`.
9. Push branch and open PR using `.github/PULL_REQUEST_TEMPLATE.md`. Include real test evidence and the live issue number.
10. Fix review comments, rerun checks, get approval, merge under repo policy, and confirm the correct issue closes.

## Non-negotiable ClearShift V1 rules

- Approved stack is pinned in the repo: Node 24 LTS patch, TypeScript, pnpm/Turborepo, Fastify 5, Zod/OpenAPI, PostgreSQL/Drizzle, BullMQ, Redis Streams/outbox, React/Vite shared UI.
- CSV UTF-8 comma/semicolon or XLSX first sheet; max 50 MB; stream; batches of 500; stop when failures exceed 10% of attempted rows.
- Dry run changes neither target business rows nor target import receipts.
- Retry with the same key: `batch ID + source row + target entity/schema version`.
- One row, one terminal outcome: loaded/rejected/merged/skipped; `source = loaded + rejected + merged + skipped`; unaccounted must be zero.
- V1 uses exact duplicate keys, not fuzzy auto-merge. Uncertain matching uses explicit human review where specified.
- V1 does not include a compensating rollback saga; stop safely, preserve receipts/evidence and use bounded retry/recovery.
- Synthetic data only. Never place secrets or real customer/employee data in AI prompts, fixtures, logs, screenshots, issues or PRs.
- No direct push to the protected base branch; use PR, reviewer, and CI.

## Prompt to start

```text
I am assigned [ISSUE ID + live GitHub URL]. Read the full issue and approved ClearShift docs.
Do not edit files. Inspect the repo and return acceptance-criteria mapping, dependency status,
real files/helpers to reuse, proposed files to change, tests for every criterion, and risks.
Do not invent paths, commands, contracts or business rules. Ask for maintainer input if a
required decision is missing. Preserve the approved stack and out-of-scope boundaries.
```

## Before opening a PR

- [ ] Tests really ran and results are recorded.
- [ ] Acceptance criteria map to tests/evidence.
- [ ] Full `git diff` reviewed; no unrelated changes/secrets/real data.
- [ ] API/schema/docs/fixtures updated where necessary.
- [ ] UI screenshots or migration reconciliation evidence attached when relevant.
- [ ] PR title contains catalog ID; body links the real GitHub issue number.
- [ ] Reviewer and required CI checks pass; all conversations resolved before merge.
