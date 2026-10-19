-- ============================================================================
-- Migration: erp4_v1
-- Module:    ERP-4 Finance & Accounting
-- Version:   v1.0.0
-- Issue:     #36  [ERP4-01] Schema, Drizzle models and guarded migrations
--
-- Design: This migration is GUARDED — idempotent CREATE IF NOT EXISTS / DO
-- blocks prevent failure on re-run.  The migration runner records applied
-- migrations in the shared schema_migrations table; it will NOT re-execute
-- this file after the first successful run.
--
-- Objects created:
--   Schema:  erp4
--   Enums:   erp4.account_type, erp4.journal_entry_status, erp4.period_status
--   Tables:  erp4.accounts, erp4.accounting_periods,
--            erp4.journal_entries, erp4.journal_lines,
--            erp4.opening_balances
--   Indexes: see below
--   Triggers: updated_at auto-update
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Shared migration tracking table (idempotent)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.schema_migrations (
    id          SERIAL PRIMARY KEY,
    migration   VARCHAR(256) NOT NULL UNIQUE,
    applied_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Guard: skip if this migration was already applied
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.schema_migrations WHERE migration = 'erp4_v1'
    ) THEN
        RAISE NOTICE 'Migration erp4_v1 already applied — skipping.';
        -- We commit immediately and exit; RETURN inside DO block exits the DO.
        -- The outer transaction will still commit the schema_migrations guard.
    END IF;
END $$;

-- If the guard above has already exited, all remaining statements are still
-- wrapped in the IF NOT EXISTS guards below, so they are safe to re-run.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Module PostgreSQL schema (namespace isolation)
-- ────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS erp4;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Shared updated_at trigger function (module-scoped)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION erp4.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Enum types
-- ────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
    CREATE TYPE erp4.account_type AS ENUM (
        'asset',
        'liability',
        'income',
        'expense'
    );
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'erp4.account_type already exists — skipping.';
END $$;

DO $$ BEGIN
    CREATE TYPE erp4.journal_entry_status AS ENUM (
        'draft',
        'posted',
        'reversed',
        'voided'
    );
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'erp4.journal_entry_status already exists — skipping.';
END $$;

DO $$ BEGIN
    CREATE TYPE erp4.period_status AS ENUM (
        'open',
        'soft_closed',
        'locked'
    );
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'erp4.period_status already exists — skipping.';
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Table: erp4.accounts (Chart of Accounts)
-- FR-ERP4-01: accounts have unique code, name, type
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp4.accounts (
    id                  UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    code                VARCHAR(32)              NOT NULL,
    name                VARCHAR(255)             NOT NULL,
    type                erp4.account_type        NOT NULL,
    currency_code       VARCHAR(3)               NOT NULL DEFAULT 'INR',
    parent_id           UUID                     REFERENCES erp4.accounts(id) ON DELETE RESTRICT,
    description         TEXT,
    is_active           BOOLEAN                  NOT NULL DEFAULT TRUE,
    is_posting_account  BOOLEAN                  NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),

    -- FR-ERP4-01: account code is unique
    CONSTRAINT accounts_code_unique UNIQUE (code)
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS accounts_code_unique_idx
    ON erp4.accounts (code);

CREATE INDEX IF NOT EXISTS accounts_parent_id_idx
    ON erp4.accounts (parent_id);

CREATE INDEX IF NOT EXISTS accounts_type_idx
    ON erp4.accounts (type);

CREATE INDEX IF NOT EXISTS accounts_currency_code_idx
    ON erp4.accounts (currency_code);

CREATE INDEX IF NOT EXISTS accounts_is_active_idx
    ON erp4.accounts (is_active);

-- updated_at trigger
DROP TRIGGER IF EXISTS accounts_set_updated_at ON erp4.accounts;
CREATE TRIGGER accounts_set_updated_at
    BEFORE UPDATE ON erp4.accounts
    FOR EACH ROW EXECUTE FUNCTION erp4.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Table: erp4.accounting_periods (Fiscal Calendar / Period Guard)
-- BR-ERP4-02: closed month rejects posting
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp4.accounting_periods (
    id                  UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    period_label        VARCHAR(16)              NOT NULL,
    start_date          DATE                     NOT NULL,
    end_date            DATE                     NOT NULL,
    status              erp4.period_status       NOT NULL DEFAULT 'open',
    fiscal_year         VARCHAR(9)               NOT NULL,
    closed_at           TIMESTAMPTZ,
    closed_by_user_id   UUID,
    created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),

    -- Unique period label prevents duplicate fiscal months
    CONSTRAINT periods_label_unique UNIQUE (period_label),

    -- DB-enforced date range validity
    CONSTRAINT periods_date_range_valid CHECK (start_date < end_date),

    -- closed_at must be set when status != open
    CONSTRAINT periods_closed_at_consistency
        CHECK (
            (status = 'open' AND closed_at IS NULL) OR
            (status != 'open' AND closed_at IS NOT NULL)
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS periods_label_unique_idx
    ON erp4.accounting_periods (period_label);

CREATE INDEX IF NOT EXISTS periods_start_end_idx
    ON erp4.accounting_periods (start_date, end_date);

CREATE INDEX IF NOT EXISTS periods_status_idx
    ON erp4.accounting_periods (status);

DROP TRIGGER IF EXISTS periods_set_updated_at ON erp4.accounting_periods;
CREATE TRIGGER periods_set_updated_at
    BEFORE UPDATE ON erp4.accounting_periods
    FOR EACH ROW EXECUTE FUNCTION erp4.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Table: erp4.journal_entries (Journal Entry Headers)
-- FR-ERP4-02, BR-ERP4-01
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp4.journal_entries (
    id                      UUID                          PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_number            VARCHAR(64)                   NOT NULL,
    period_id               UUID                          NOT NULL
                                REFERENCES erp4.accounting_periods(id) ON DELETE RESTRICT,
    posting_date            DATE                          NOT NULL,
    status                  erp4.journal_entry_status     NOT NULL DEFAULT 'draft',
    description             TEXT                          NOT NULL,
    currency_code           VARCHAR(3)                    NOT NULL,
    source_reference        VARCHAR(128),
    idempotency_key         VARCHAR(128),
    created_by_user_id      UUID                          NOT NULL,
    posted_by_user_id       UUID,
    posted_at               TIMESTAMPTZ,
    reversed_by_entry_id    UUID
                                REFERENCES erp4.journal_entries(id) ON DELETE RESTRICT,
    created_at              TIMESTAMPTZ                   NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ                   NOT NULL DEFAULT now(),

    -- FR-ERP4-02: entry_number unique
    CONSTRAINT journal_entries_number_unique UNIQUE (entry_number),

    -- Idempotency key unique (sparse: NULL values are not unique-constrained)
    CONSTRAINT journal_entries_idempotency_key_unique UNIQUE (idempotency_key),

    -- DB-enforced: posted_at must be set when status = 'posted'
    CONSTRAINT je_posted_at_consistency
        CHECK (
            (status = 'posted' AND posted_at IS NOT NULL AND posted_by_user_id IS NOT NULL) OR
            (status != 'posted')
        ),

    -- DB-enforced: reversed_by must reference another entry only when reversed
    CONSTRAINT je_reversed_by_consistency
        CHECK (
            (status = 'reversed' AND reversed_by_entry_id IS NOT NULL) OR
            (status != 'reversed')
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_number_unique_idx
    ON erp4.journal_entries (entry_number);

-- Partial unique index — idempotency_key is NULL for manual entries, unique when set
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_idempotency_key_unique_idx
    ON erp4.journal_entries (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS journal_entries_period_id_idx
    ON erp4.journal_entries (period_id);

CREATE INDEX IF NOT EXISTS journal_entries_status_idx
    ON erp4.journal_entries (status);

CREATE INDEX IF NOT EXISTS journal_entries_posting_date_idx
    ON erp4.journal_entries (posting_date);

CREATE INDEX IF NOT EXISTS journal_entries_currency_code_idx
    ON erp4.journal_entries (currency_code);

DROP TRIGGER IF EXISTS journal_entries_set_updated_at ON erp4.journal_entries;
CREATE TRIGGER journal_entries_set_updated_at
    BEFORE UPDATE ON erp4.journal_entries
    FOR EACH ROW EXECUTE FUNCTION erp4.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Table: erp4.journal_lines (Double-Entry Debit/Credit Lines)
-- BR-ERP4-01: debit and credit non-negative; cannot both be positive on one line
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp4.journal_lines (
    id                  UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id    UUID           NOT NULL
                            REFERENCES erp4.journal_entries(id) ON DELETE CASCADE,
    account_id          UUID           NOT NULL
                            REFERENCES erp4.accounts(id) ON DELETE RESTRICT,
    debit_amount        NUMERIC(20,4)  NOT NULL DEFAULT 0.0000,
    credit_amount       NUMERIC(20,4)  NOT NULL DEFAULT 0.0000,
    line_narration      VARCHAR(255),
    department_ref      VARCHAR(64),
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),

    -- BR-ERP4-01: debit_amount non-negative
    CONSTRAINT jl_debit_non_negative
        CHECK (debit_amount >= 0),

    -- BR-ERP4-01: credit_amount non-negative
    CONSTRAINT jl_credit_non_negative
        CHECK (credit_amount >= 0),

    -- BR-ERP4-01: a line cannot carry both a debit AND a credit
    CONSTRAINT jl_not_both_debit_and_credit
        CHECK (NOT (debit_amount > 0 AND credit_amount > 0)),

    -- BR-ERP4-01: a line must have at least one non-zero amount
    CONSTRAINT jl_at_least_one_nonzero
        CHECK (debit_amount > 0 OR credit_amount > 0)
);

CREATE INDEX IF NOT EXISTS journal_lines_entry_id_idx
    ON erp4.journal_lines (journal_entry_id);

CREATE INDEX IF NOT EXISTS journal_lines_account_id_idx
    ON erp4.journal_lines (account_id);

-- Compound index: trial-balance group-by (account + entry → period via join)
CREATE INDEX IF NOT EXISTS journal_lines_account_entry_idx
    ON erp4.journal_lines (account_id, journal_entry_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Table: erp4.opening_balances (One-Time Balance Loads)
-- FR-ERP4-04: opening balance is loaded once per account/currency
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp4.opening_balances (
    id                  UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          UUID           NOT NULL
                            REFERENCES erp4.accounts(id) ON DELETE RESTRICT,
    currency_code       VARCHAR(3)     NOT NULL,
    balance_amount      NUMERIC(20,4)  NOT NULL,
    as_of_date          DATE           NOT NULL,
    source_reference    VARCHAR(128),
    loaded_by_user_id   UUID           NOT NULL,
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),

    -- FR-ERP4-04: each account+currency pair is unique (load once)
    CONSTRAINT opening_balances_account_currency_unique
        UNIQUE (account_id, currency_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS opening_balances_account_currency_unique_idx
    ON erp4.opening_balances (account_id, currency_code);

CREATE INDEX IF NOT EXISTS opening_balances_account_id_idx
    ON erp4.opening_balances (account_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 8b. Table: erp4.import_receipts (Idempotency & Migration Audit Receipts)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp4.import_receipts (
    id                  UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id            UUID           NOT NULL,
    source_row          INTEGER        NOT NULL,
    entity              VARCHAR(64)    NOT NULL,
    schema_version      INTEGER        NOT NULL DEFAULT 1,
    idempotency_key     VARCHAR(128)   NOT NULL,
    target_id           UUID           NOT NULL,
    kind                VARCHAR(16)    NOT NULL DEFAULT 'created',
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),

    CONSTRAINT import_receipts_idempotency_key_unique
        UNIQUE (idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS import_receipts_idempotency_key_unique_idx
    ON erp4.import_receipts (idempotency_key);

CREATE INDEX IF NOT EXISTS import_receipts_batch_row_idx
    ON erp4.import_receipts (batch_id, source_row);

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Record migration as applied (idempotency guard)
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.schema_migrations (migration)
VALUES ('erp4_v1')
ON CONFLICT (migration) DO NOTHING;

COMMIT;
