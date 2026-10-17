<div align="center">

# <span style="color: #fda4af;">ClearShift</span> <span style="color: #9ca3af;">ERP</span>

<p style="font-size: 16px;">
  <span style="color: #fda4af; font-weight: 600;">Enterprise Resource Planning</span>
  <span style="color: #6b7280;">&bull;</span>
  <span style="color: #9ca3af;">Data Migration & Cleanup Target System</span>
</p>

<p>
  <span style="background-color: #2b1b24; color: #fda4af; padding: 4px 10px; border-radius: 6px; font-size: 12px; border: 1px solid #4a2838;">Node 24 LTS</span>
  <span style="background-color: #1f242c; color: #9ca3af; padding: 4px 10px; border-radius: 6px; font-size: 12px; border: 1px solid #374151;">TypeScript Strict</span>
  <span style="background-color: #2b1b24; color: #fda4af; padding: 4px 10px; border-radius: 6px; font-size: 12px; border: 1px solid #4a2838;">PostgreSQL 18</span>
  <span style="background-color: #1f242c; color: #9ca3af; padding: 4px 10px; border-radius: 6px; font-size: 12px; border: 1px solid #374151;">Drizzle ORM</span>
  <span style="background-color: #2b1b24; color: #fda4af; padding: 4px 10px; border-radius: 6px; font-size: 12px; border: 1px solid #4a2838;">Fastify 5</span>
  <span style="background-color: #1f242c; color: #9ca3af; padding: 4px 10px; border-radius: 6px; font-size: 12px; border: 1px solid #374151;">Vitest</span>
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
