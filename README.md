<div align="center">

# <span style="color: #FDA4AF;">ClearShift</span> <span style="color: #9CA3AF;">ERP</span>

<p>
  <img src="https://img.shields.io/badge/Node.js-24_LTS-FDA4AF?style=for-the-badge&logo=nodedotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-Strict-9CA3AF?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/PostgreSQL-18-FDA4AF?style=for-the-badge&logo=postgresql&logoColor=white" />
  <img src="https://img.shields.io/badge/Drizzle-ORM-9CA3AF?style=for-the-badge&logo=drizzle&logoColor=white" />
  <img src="https://img.shields.io/badge/Fastify-5-FDA4AF?style=for-the-badge&logo=fastify&logoColor=white" />
  <img src="https://img.shields.io/badge/Vitest-Testing-9CA3AF?style=for-the-badge&logo=vitest&logoColor=white" />
</p>

</div>

---

### <span style="color: #fda4af;">✦ Overview</span>

<span style="color: #9ca3af;">ClearShift ERP serves as the core operational and financial target system in the ClearShift data transformation ecosystem. It provides isolated, contract-first business modules coupled with automated Migration Kit adapters to profile, clean, and reliably ingest legacy enterprise data.</span>

---

### <span style="color: #fda4af;">✦ Module Teams & Architecture</span>

Each module operates in an isolated workspace under `apps/erp/modules/` communicating exclusively via public contracts and outbox events:

| Team | Module Name | Scope & Responsibilities |
| :--- | :--- | :--- |
| <span style="color: #fda4af; font-weight: bold;">ERP-1</span> | **Products & Inventory** | <span style="color: #9ca3af;">Manages SKU catalogs, categories, units of measure, and non-negative warehouse stock invariants.</span> |
| <span style="color: #fda4af; font-weight: bold;">ERP-2</span> | **Vendors & Purchasing** | <span style="color: #9ca3af;">Handles vendor onboarding, purchase orders, receiving workflows, and sensitive bank detail masking.</span> |
| <span style="color: #fda4af; font-weight: bold;">ERP-3</span> | **Sales Orders & Invoices** | <span style="color: #9ca3af;">Processes order line fulfillment, sales invoices, tax calculations, and payment tracking.</span> |
| <span style="color: #fda4af; font-weight: bold;">ERP-4</span> | **Finance & Accounting** | <span style="color: #9ca3af;">Enforces strict double-entry ledger bookkeeping, 4dp fixed-precision math, trial balances, and period locks.</span> |
| <span style="color: #fda4af; font-weight: bold;">ERP-5</span> | **HR & Employees** | <span style="color: #9ca3af;">Oversees employee directories, departmental hierarchies, system roles, and sensitive payroll data protection.</span> |
| <span style="color: #fda4af; font-weight: bold;">PTL</span> | **Platform & Governance** | <span style="color: #9ca3af;">Monorepo tooling, CI pipeline gates, transactional outbox relays, and release coordination.</span> |

---

### <span style="color: #fda4af;">✦ The 7-Step Migration Pipeline</span>

<span style="color: #9ca3af;">Every ERP module implements the standardized 7-step Migration Kit:</span>

1. <span style="color: #fda4af; font-weight: bold;">Extract</span>: <span style="color: #9ca3af;">Read legacy source data (CSV/Excel) into `raw_<module>` without altering source values.</span>
2. <span style="color: #fda4af; font-weight: bold;">Profile</span>: <span style="color: #9ca3af;">Analyze data health, counting empty values, syntax anomalies, and duplicate rows.</span>
3. <span style="color: #fda4af; font-weight: bold;">Clean</span>: <span style="color: #9ca3af;">Standardize units, trim whitespaces, normalize dates/currencies, and deduplicate entities.</span>
4. <span style="color: #fda4af; font-weight: bold;">Map</span>: <span style="color: #9ca3af;">Map legacy attributes to target domain models with human-in-the-loop review.</span>
5. <span style="color: #fda4af; font-weight: bold;">Load</span>: <span style="color: #9ca3af;">Execute atomic database writes with dry-run and transaction rollback support.</span>
6. <span style="color: #fda4af; font-weight: bold;">Validate</span>: <span style="color: #9ca3af;">Assert post-load business invariants (e.g. balanced debits/credits, valid links).</span>
7. <span style="color: #fda4af; font-weight: bold;">Reconcile</span>: <span style="color: #9ca3af;">Mathematically verify: <code>Source Count = Loaded + Rejected + Merged (100%)</code>.</span>

---

### <span style="color: #fda4af;">✦ Shared Packages</span>

* **`packages/contracts`**: <span style="color: #9ca3af;">Shared Zod validation schemas and OpenAPI 3.1 specifications.</span>
* **`packages/database`**: <span style="color: #9ca3af;">Shared Drizzle models, schema migrations, and idempotent migration runner.</span>
* **`packages/ui`**: <span style="color: #9ca3af;">Accessible UI design tokens and shared React components.</span>

---

### <span style="color: #fda4af;">✦ Getting Started</span>

```bash
# 1. Install dependencies across all workspaces
npm install

# 2. Configure environment variables
cp .env.example .env

# 3. Common developer commands
npm run typecheck   # Typecheck TypeScript across all workspaces
npm run lint        # Lint codebase with ESLint
npm test            # Run Vitest test suite
npm run db:migrate  # Run database migrations
```

---

### <span style="color: #fda4af;">✦ Pull Request Rules for Teams</span>

* <span style="color: #9ca3af;">Always link your issue: <code>Closes #<ID></code> in your PR description.</span>
* <span style="color: #9ca3af;">Follow PR title format: <code>[MODULE-ID] Brief description of changes</code></span>
* <span style="color: #9ca3af;">Ensure all automated CI checks pass before requesting review.</span>
