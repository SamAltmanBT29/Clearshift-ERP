/**
 * ERP-4 Finance & Accounting — Drizzle ORM Schema
 *
 * Tables:
 *   erp4_accounts          — Chart of Accounts
 *   erp4_accounting_periods — Fiscal period open/close guard
 *   erp4_journal_entries   — Journal entry headers
 *   erp4_journal_lines     — Double-entry debit/credit lines
 *   erp4_opening_balances  — One-time opening balance loads
 *
 * Design decisions:
 *   - All monetary values: numeric(20,4) — no IEEE-754 float
 *   - UUID primary keys (gen_random_uuid())
 *   - Objects live inside the `erp4` PostgreSQL schema
 *   - Database-level check constraints enforce every domain invariant
 *   - No FK into another module's private tables (cross-module via API only)
 *
 * @module erp4/db/schema
 */

import {
  pgSchema,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  date,
  boolean,
  numeric,
  integer,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// Module-scoped PostgreSQL schema (namespace isolation)
// ─────────────────────────────────────────────────────────────────────────────
export const erp4Schema = pgSchema('erp4');

// ─────────────────────────────────────────────────────────────────────────────
// Enum types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Account classification per the standard chart-of-accounts taxonomy.
 * FR-ERP4-01: accounts have type asset | liability | income | expense.
 */
export const accountTypeEnum = erp4Schema.enum('account_type', [
  'asset',
  'liability',
  'income',
  'expense',
]);

/**
 * Journal entry lifecycle states.
 * BR-ERP4-01: drafts are not posted entries; posted entries are immutable.
 * Corrections use reversal entries.
 */
export const journalEntryStatusEnum = erp4Schema.enum('journal_entry_status', [
  'draft',    // Editable; not yet validated or committed to the ledger
  'posted',   // Validated (balanced), committed, immutable
  'reversed', // Closed by a compensating reversal entry
  'voided',   // Administratively cancelled while still in draft
]);

/**
 * Accounting period lifecycle.
 * BR-ERP4-02: closed month rejects posting.
 */
export const periodStatusEnum = erp4Schema.enum('period_status', [
  'open',        // Accepts new postings
  'soft_closed', // Only finance-admin may post (soft close)
  'locked',      // Immutable; no postings accepted from any role
]);

// ─────────────────────────────────────────────────────────────────────────────
// Table 1 — erp4_accounts (Chart of Accounts)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Represents one node in the chart of accounts.
 *
 * Invariants (DB-enforced):
 *   - code is unique across the chart
 *   - type is one of the four SDS-defined values
 *   - parent_id must reference another account in the same module
 *     (self-referential; cross-module FK is forbidden)
 *
 * FR-ERP4-01
 */
export const erp4Accounts = erp4Schema.table(
  'accounts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Short mnemonic code, e.g. "1010", "4100-SALES".  Must be unique. */
    code: varchar('code', { length: 32 }).notNull(),

    /** Human-readable display name for the account. */
    name: varchar('name', { length: 255 }).notNull(),

    /** Account classification — drives P&L vs Balance Sheet placement. */
    type: accountTypeEnum('type').notNull(),

    /**
     * ISO 4217 currency code. V1 single-currency; all balances in this currency.
     * Indexed for trial-balance group-by queries.
     */
    currency_code: varchar('currency_code', { length: 3 }).notNull().default('INR'),

    /**
     * Hierarchical parent for sub-account grouping.
     * Nullable — root-level accounts have no parent.
     */
    parent_id: uuid('parent_id'), // Self-ref: FK defined in migration DDL

    /**
     * Optional textual description / notes for the account.
     */
    description: text('description'),

    /** Soft-delete flag.  Archived accounts are hidden from new entries. */
    is_active: boolean('is_active').notNull().default(true),

    /** Whether this account can be directly posted to (vs. header/group only). */
    is_posting_account: boolean('is_posting_account').notNull().default(true),

    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    // DB-level uniqueness — FR-ERP4-01: "account code is unique"
    codeUniqueIdx: uniqueIndex('accounts_code_unique').on(table.code),

    // Supporting index for parent hierarchy traversal
    parentIdx: index('accounts_parent_id_idx').on(table.parent_id),

    // Supporting index for trial-balance currency grouping
    currencyIdx: index('accounts_currency_code_idx').on(table.currency_code),

    // Active accounts lookup
    activeIdx: index('accounts_is_active_idx').on(table.is_active),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 2 — erp4_accounting_periods (Fiscal Calendar)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * One row per fiscal month (or custom period).
 *
 * Invariants:
 *   - period label must be unique (e.g. "2026-04")
 *   - start_date < end_date (DB-enforced)
 *   - status transitions: open → soft_closed → locked (application-enforced)
 *
 * BR-ERP4-02
 */
export const erp4AccountingPeriods = erp4Schema.table(
  'accounting_periods',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Canonical period label.  Must match YYYY-MM for monthly periods
     * to satisfy trial-balance query parameter ?period=YYYY-MM.
     */
    period_label: varchar('period_label', { length: 16 }).notNull(),

    start_date: date('start_date').notNull(),
    end_date: date('end_date').notNull(),

    status: periodStatusEnum('status').notNull().default('open'),

    fiscal_year: varchar('fiscal_year', { length: 9 }).notNull(), // e.g. "FY2026-27"

    closed_at: timestamp('closed_at', { withTimezone: true }),

    /** UUID of the finance-admin user who closed the period. No FK to auth table. */
    closed_by_user_id: uuid('closed_by_user_id'),

    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    // Unique period label — prevents duplicate fiscal months
    labelUniqueIdx: uniqueIndex('periods_label_unique').on(table.period_label),

    // Range queries (trial-balance period lookups)
    startEndIdx: index('periods_start_end_idx').on(table.start_date, table.end_date),

    // Status filter (e.g. find all open periods)
    statusIdx: index('periods_status_idx').on(table.status),

    // DB-enforced date range validity
    dateRangeCheck: check('periods_date_range_valid', sql`start_date < end_date`),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 3 — erp4_journal_entries (Journal Entry Headers)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * One row per accounting transaction.
 *
 * Invariants (DB-enforced where possible; otherwise application-enforced):
 *   - entry_number is unique
 *   - currency_code is non-null and carried to all lines
 *   - posted entries: status = 'posted', posted_at is set, reversed_by is null
 *   - reversed entries: reversed_by references the compensating entry
 *   - posting locks the entry; post-posting edits are rejected at API layer
 *
 * FR-ERP4-02, BR-ERP4-01
 */
export const erp4JournalEntries = erp4Schema.table(
  'journal_entries',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Human-readable sequential reference, e.g. "JV-2026-0001".
     * Generated by the application via a per-period sequence; unique across the module.
     */
    entry_number: varchar('entry_number', { length: 64 }).notNull(),

    /**
     * Links to the accounting period; posting is blocked when
     * the period is soft_closed (unless finance-admin) or locked.
     */
    period_id: uuid('period_id').notNull(), // FK: erp4.accounting_periods.id

    /** Calendar date the entry is effective from an accounting standpoint. */
    posting_date: date('posting_date').notNull(),

    status: journalEntryStatusEnum('status').notNull().default('draft'),

    /**
     * Short description / narration (required).  The "description" column
     * is named per the SDS domain specification.
     */
    description: text('description').notNull(),

    /**
     * ISO 4217 currency.  ALL lines of this entry must carry this same code.
     * V1 performs no FX conversion; mixed-currency entries are rejected.
     */
    currency_code: varchar('currency_code', { length: 3 }).notNull(),

    /**
     * Source module / entity that triggered this entry automatically.
     * e.g. "PURCHASE_GRN:grn-9842"   or  "PAYROLL:run-2026-04"
     * Null for manually created entries.
     */
    source_reference: varchar('source_reference', { length: 128 }),

    /**
     * Idempotency guard for automated journal creation.
     * The source module provides a stable key; duplicate keys are silently
     * acknowledged (HTTP 200) without creating duplicate entries.
     */
    idempotency_key: varchar('idempotency_key', { length: 128 }),

    /** UUID of the user who created the draft. No FK to auth schema. */
    created_by_user_id: uuid('created_by_user_id').notNull(),

    /** UUID of the finance-admin who approved and posted the entry. */
    posted_by_user_id: uuid('posted_by_user_id'),

    posted_at: timestamp('posted_at', { withTimezone: true }),

    /**
     * Self-reference to the compensating reversal entry.
     * Populated only when status = 'reversed'.
     */
    reversed_by_entry_id: uuid('reversed_by_entry_id'), // FK: self

    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    // FR-ERP4-02: entry_number unique
    entryNumberUniqueIdx: uniqueIndex('journal_entries_number_unique').on(table.entry_number),

    // Idempotency key unique — prevents duplicate automated postings
    idempotencyKeyUniqueIdx: uniqueIndex('journal_entries_idempotency_key_unique').on(
      table.idempotency_key
    ),

    // Period-based queries (close-period validation, trial-balance)
    periodIdx: index('journal_entries_period_id_idx').on(table.period_id),

    // Status filter (e.g. list posted entries for trial-balance)
    statusIdx: index('journal_entries_status_idx').on(table.status),

    // Date-range queries
    postingDateIdx: index('journal_entries_posting_date_idx').on(table.posting_date),

    // Currency — trial balance groups within a currency
    currencyIdx: index('journal_entries_currency_code_idx').on(table.currency_code),

    // DB-enforced: posting timestamp must be set when status = 'posted'
    postedAtConsistencyCheck: check(
      'je_posted_at_consistency',
      sql`(status = 'posted' AND posted_at IS NOT NULL) OR (status != 'posted')`
    ),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 4 — erp4_journal_lines (Double-Entry Debit/Credit Lines)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * One row per debit or credit leg of a journal entry.
 *
 * Invariants (DB-enforced):
 *   - debit_amount >= 0 (non-negative)
 *   - credit_amount >= 0 (non-negative)
 *   - NOT (debit > 0 AND credit > 0) — a line is either debit OR credit, not both
 *   - debit > 0 OR credit > 0 — a zero-zero line is meaningless
 *
 * Application enforces (post-insert aggregate constraint):
 *   - SUM(debit_amount) == SUM(credit_amount) across all lines of an entry
 *     before transitioning status to 'posted'
 *
 * FR-ERP4-02, BR-ERP4-01
 */
export const erp4JournalLines = erp4Schema.table(
  'journal_lines',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Parent entry header. Cascade-delete: deleting a DRAFT entry removes its lines. */
    journal_entry_id: uuid('journal_entry_id').notNull(), // FK: erp4.journal_entries.id CASCADE

    /** The account being debited or credited. Must be a posting account. */
    account_id: uuid('account_id').notNull(), // FK: erp4.accounts.id

    /**
     * Debit amount at 4 decimal places.
     * numeric(20,4) prevents floating-point rounding drift.
     * Must be >= 0; mutually exclusive with credit_amount > 0.
     */
    debit_amount: numeric('debit_amount', { precision: 20, scale: 4 })
      .notNull()
      .default('0.0000'),

    /**
     * Credit amount at 4 decimal places.
     * Must be >= 0; mutually exclusive with debit_amount > 0.
     */
    credit_amount: numeric('credit_amount', { precision: 20, scale: 4 })
      .notNull()
      .default('0.0000'),

    /** Optional per-line narration for audit/description clarity. */
    line_narration: varchar('line_narration', { length: 255 }),

    /**
     * Department / cost-centre dimension (optional in V1).
     * Stored as opaque reference — no FK into an HR schema.
     */
    department_ref: varchar('department_ref', { length: 64 }),

    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    // Parent entry lookup (bulk-fetch all lines for a given entry)
    journalEntryIdx: index('journal_lines_entry_id_idx').on(table.journal_entry_id),

    // Account ledger view (all movements for an account)
    accountIdx: index('journal_lines_account_id_idx').on(table.account_id),

    // Compound index for trial-balance group-by (account + entry → period via join)
    accountEntryIdx: index('journal_lines_account_entry_idx').on(
      table.account_id,
      table.journal_entry_id
    ),

    // BR-ERP4-01: debit_amount non-negative
    debitNonNegativeCheck: check(
      'jl_debit_non_negative',
      sql`debit_amount >= 0`
    ),

    // BR-ERP4-01: credit_amount non-negative
    creditNonNegativeCheck: check(
      'jl_credit_non_negative',
      sql`credit_amount >= 0`
    ),

    // BR-ERP4-01: a line cannot be both debit AND credit simultaneously
    notBothCheck: check(
      'jl_not_both_debit_and_credit',
      sql`NOT (debit_amount > 0 AND credit_amount > 0)`
    ),

    // BR-ERP4-01: a line must have at least one non-zero side
    atLeastOneCheck: check(
      'jl_at_least_one_nonzero',
      sql`debit_amount > 0 OR credit_amount > 0`
    ),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 5 — erp4_opening_balances (One-Time Balance Loads)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Stores the initial (migration-period) balance for each account+currency pair.
 *
 * Invariants:
 *   - Each (account_id, currency_code) pair is unique — load once per account
 *   - balance_amount may be positive or negative (deficit / accumulated losses)
 *   - Cannot be modified after initial load (application-enforced; no UPDATE route)
 *
 * FR-ERP4-04
 */
export const erp4OpeningBalances = erp4Schema.table(
  'opening_balances',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** The account to which this opening balance belongs. */
    account_id: uuid('account_id').notNull(), // FK: erp4.accounts.id

    /** ISO 4217 currency of the balance. */
    currency_code: varchar('currency_code', { length: 3 }).notNull(),

    /**
     * Signed opening balance.
     * Positive = normal-balance side; negative = contra or deficit.
     * numeric(20,4) — same precision as journal lines.
     */
    balance_amount: numeric('balance_amount', { precision: 20, scale: 4 }).notNull(),

    /**
     * Effective date of the opening balance (usually the first day
     * of the first accounting period in the system).
     */
    as_of_date: date('as_of_date').notNull(),

    /** Reference to the source document (e.g. migration run ID, audit trail). */
    source_reference: varchar('source_reference', { length: 128 }),

    /** UUID of the finance-admin who loaded the opening balance. */
    loaded_by_user_id: uuid('loaded_by_user_id').notNull(),

    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    // FR-ERP4-04: each opening balance is loaded ONCE per account+currency
    accountCurrencyUniqueIdx: uniqueIndex('opening_balances_account_currency_unique').on(
      table.account_id,
      table.currency_code
    ),

    // Supporting query index
    accountIdx: index('opening_balances_account_id_idx').on(table.account_id),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 6 — erp4_import_receipts (Idempotency & Migration Audit Receipts)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Durable import receipts table (Decision C4 & KIT-08).
 * Persisted in the same PostgreSQL transaction as the target mutation.
 */
export const erp4ImportReceipts = erp4Schema.table(
  'import_receipts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    batch_id: uuid('batch_id').notNull(),
    source_row: integer('source_row').notNull(),
    entity: varchar('entity', { length: 64 }).notNull(),
    schema_version: integer('schema_version').notNull().default(1),
    idempotency_key: varchar('idempotency_key', { length: 128 }).notNull(),
    target_id: uuid('target_id').notNull(),
    kind: varchar('kind', { length: 16 }).notNull().default('created'),

    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    // Unique idempotency key — guarantees zero duplicate mutations
    idempotencyKeyUniqueIdx: uniqueIndex('import_receipts_idempotency_key_unique').on(
      table.idempotency_key
    ),
    batchRowIdx: index('import_receipts_batch_row_idx').on(table.batch_id, table.source_row),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Relation type helpers (used by the application layer for type inference)
// ─────────────────────────────────────────────────────────────────────────────
export type Erp4Account = typeof erp4Accounts.$inferSelect;
export type NewErp4Account = typeof erp4Accounts.$inferInsert;

export type Erp4AccountingPeriod = typeof erp4AccountingPeriods.$inferSelect;
export type NewErp4AccountingPeriod = typeof erp4AccountingPeriods.$inferInsert;

export type Erp4JournalEntry = typeof erp4JournalEntries.$inferSelect;
export type NewErp4JournalEntry = typeof erp4JournalEntries.$inferInsert;

export type Erp4JournalLine = typeof erp4JournalLines.$inferSelect;
export type NewErp4JournalLine = typeof erp4JournalLines.$inferInsert;

export type Erp4OpeningBalance = typeof erp4OpeningBalances.$inferSelect;
export type NewErp4OpeningBalance = typeof erp4OpeningBalances.$inferInsert;

export type Erp4ImportReceipt = typeof erp4ImportReceipts.$inferSelect;
export type NewErp4ImportReceipt = typeof erp4ImportReceipts.$inferInsert;
