# ClearShift ERP: Local Development & Infrastructure Runbook (PLT-02)

This runbook documents the clean-clone local development workflow for ClearShift ERP. It satisfies the non-negotiable architectural requirement that a fresh machine can start dependencies, apply schema migrations, seed synthetic data, and pass all automated tests using pinned tools.

---

## 1. Prerequisites

- **Node.js**: `v24.x LTS` (or `v22.x LTS`)
- **npm**: `>= 10.x`
- **Docker & Docker Compose**: Compose v2 with health check support
- Pinned runtime dependencies:
  - PostgreSQL `18.6-alpine`
  - Redis `8.10.1-alpine`

---

## 2. Environment Setup

1. **Clone and Install**:
   ```bash
   git clone git@github.com:SamAltmanBT29/Clearshift-ERP.git
   cd Clearshift-ERP
   npm install
   ```

2. **Configure Environment Variables**:
   Copy the sample environment file. Never check in `.env` or real credentials:
   ```bash
   cp .env.example .env
   ```

---

## 3. Infrastructure & Services (Docker Compose)

The local services are defined with pinned image tags and persistent named volumes in `infra/compose.yaml`.

- **Start Services**:
  Spins up PostgreSQL and Redis in the background and waits for health checks to pass:
  ```bash
  npm run compose:up
  ```

- **Stop Services**:
  Stops containers without deleting persistent database volumes:
  ```bash
  docker compose -f infra/compose.yaml down
  ```

- **Teardown & Clean Volumes**:
  Removes containers and resets persistent data volumes:
  ```bash
  npm run compose:down
  ```

---

## 4. Controlled Database Migrations & Seeding

Per ClearShift Core Rules, application servers **never** auto-race schema migrations on startup. Schema migrations are executed once via a dedicated controlled migration process.

1. **Run Controlled Schema Migrations**:
   Executes all pending DDL migrations in `packages/database/migrations/` and updates `public.schema_migrations`:
   ```bash
   npm run db:migrate
   ```

2. **Seed Synthetic Test Data**:
   Populates standard synthetic chart of accounts and reference fixtures:
   ```bash
   npm run db:seed
   ```

3. **Complete Database Reset & Re-seed**:
   Wipes containers, recreates volumes, reapplies schema migrations, and seeds synthetic fixtures:
   ```bash
   npm run db:reset
   ```

---

## 5. Verification & Testing

Run all repository quality gates locally before pushing changes:

```bash
# 1. Typecheck (Strict TypeScript)
npm run typecheck

# 2. ESLint
npm run lint

# 3. Test Suites
npm test
```

---

## 6. Secret & Security Governance

- `.env` is explicitly ignored in `.gitignore`.
- `.env.example` contains only synthetic placeholders.
- Never commit credentials, private keys, or real company datasets (BR-SEC-01).
- All PRs are gated by automated secret scanning in CI.
