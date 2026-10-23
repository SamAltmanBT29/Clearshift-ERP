---
trigger: always_on
description: "Non-negotiable ClearShift project, architecture, data-integrity and security rules for all code changes."
---

# ClearShift Core Rules

- Read the complete live GitHub issue and linked approved docs before editing. Work on one issue per branch/PR. Confirm dependencies are complete.
- The live GitHub issue is the work assignment; approved ClearShift Project Plan/SDS/ADRs are the design authority. Never recreate or renumber existing issues. Surface conflicts instead of guessing.
- Preserve the repository's pinned toolchain: Node.js 24 LTS patch, strict TypeScript, pnpm/Turborepo, Fastify 5, Zod/OpenAPI, PostgreSQL + Drizzle, Redis Streams, BullMQ and transactional outbox, React/Vite shared UI. Do not change versions or architecture without maintainer approval.
- No Temporal, ARQ, Celery or second queue implementation unless an approved architecture decision explicitly supersedes the baseline.
- Respect ownership boundaries. Modules own their domain schema/API/rules/adapters; Platform owns shared app/toolchain/auth/RBAC/outbox/UI primitives; Migration Kit owns generic migration engine and generic migration/review UI; PMO verifies gates and evidence.
- V1 is through Gate G4 at end of Week 8. V1 does not include a compensating rollback saga, fuzzy duplicate matching, source database connectors, real customer/employee data or outbound marketing delivery. On failure, stop safely, preserve evidence and use approved bounded retry/recovery.
- Migration input: CSV UTF-8 comma/semicolon and XLSX first sheet; max 50 MB; stream/bound memory; process batches of 500 rows; stop when failures exceed 10% of attempted rows. Never silently drop rows.
- Every parsed source row has exactly one terminal outcome: loaded, rejected, merged or skipped. Enforce `source = loaded + rejected + merged + skipped` and `unaccounted = 0`. Skipped needs an approved reason. Ignoring a column does not skip a row.
- Dry runs must not mutate target business rows or target import receipts. During a real load, target write and import receipt commit in one PostgreSQL transaction. Stable idempotency key is `batch ID + source row + target entity/schema version`; retries must reuse it.
- No fuzzy auto-merge. V1 duplicate matching is deterministic normalized exact-key matching and any required target-side merge needs the explicit human approval path.
- Use shared JWT/RBAC and error/event helpers. Keep API/OpenAPI/Zod contracts aligned. Cross-module data is read through owning APIs/approved projections; never mutate another module's tables.
- Domain mutation and outbox events must commit atomically where required. Consumers must tolerate duplicate event delivery and process idempotently.
- Financial data uses PostgreSQL NUMERIC/decimal arithmetic; ERP-4 journal entries must balance and closed periods reject posting.
- Synthetic fixtures only. Never add credentials, `.env`, real personal/company datasets, sensitive payloads or secrets to code, prompts, logs, screenshots, issues or PRs.
- Do not use destructive commands, force-push, rewrite history, reset/delete databases, change permission settings or upload files without explicit human approval. Never silently disable/loosen a test to get CI green.
- Before editing, return a bounded plan and file list. After editing, run relevant repo-defined checks, inspect the full diff, and report actual command results. Do not fabricate test evidence.
- Keep changes scoped to the issue. Stop and ask before modifying a shared contract, dependency lockfile, auth/RBAC, queue, database ownership, CI, or files owned by another team.
