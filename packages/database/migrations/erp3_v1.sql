-- ============================================================================
-- Migration: erp3_v1
-- Module:    ERP-3 Sales Orders & Invoices
-- Version:   v1.0.0
-- Issue:     #26  [ERP3-01] ERP-3 Sales Orders and Invoices: Schema, Drizzle models and guarded migrations
--
-- Design: This migration is GUARDED — idempotent CREATE IF NOT EXISTS / DO
-- blocks prevent failure on re-run. The migration runner records applied
-- migrations in the shared schema_migrations table; it will NOT re-execute
-- this file after the first successful run.
--
-- Objects created:
--   Schema:  erp3
--   Enums:   erp3.sales_order_status, erp3.invoice_status, erp3.payment_method
--   Tables:  erp3.sales_orders, erp3.so_lines, erp3.invoices, erp3.invoice_lines,
--            erp3.payments, erp3.import_receipts
--   Indexes: see below
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
        SELECT 1 FROM public.schema_migrations WHERE migration = 'erp3_v1'
    ) THEN
        RAISE NOTICE 'Migration erp3_v1 already applied — skipping.';
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Module PostgreSQL schema (namespace isolation)
-- ────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS erp3;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Shared updated_at trigger function (module-scoped)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION erp3.set_updated_at()
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
    CREATE TYPE erp3.sales_order_status AS ENUM (
        'Open',
        'Invoiced',
        'Closed'
    );
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'erp3.sales_order_status already exists — skipping.';
END $$;

DO $$ BEGIN
    CREATE TYPE erp3.invoice_status AS ENUM (
        'Open',
        'Paid',
        'Overdue'
    );
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'erp3.invoice_status already exists — skipping.';
END $$;

DO $$ BEGIN
    CREATE TYPE erp3.payment_method AS ENUM (
        'cash',
        'bank',
        'card'
    );
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'erp3.payment_method already exists — skipping.';
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Table: erp3.sales_orders
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp3.sales_orders (
    id                  UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number        VARCHAR(64)              NOT NULL,
    customer_golden_id  UUID                     NOT NULL,
    order_date          DATE                     NOT NULL,
    status              erp3.sales_order_status  NOT NULL DEFAULT 'Open',
    currency            VARCHAR(3)               NOT NULL DEFAULT 'USD',
    subtotal            NUMERIC(19, 4)           NOT NULL DEFAULT 0.0000,
    tax_total           NUMERIC(19, 4)           NOT NULL DEFAULT 0.0000,
    total               NUMERIC(19, 4)           NOT NULL DEFAULT 0.0000,
    source_system       VARCHAR(64),
    source_id           VARCHAR(128),
    created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),

    CONSTRAINT sales_orders_order_number_unique UNIQUE (order_number),
    CONSTRAINT sales_orders_number_not_empty CHECK (length(trim(order_number)) > 0),
    CONSTRAINT sales_orders_subtotal_non_negative CHECK (subtotal >= 0),
    CONSTRAINT sales_orders_tax_total_non_negative CHECK (tax_total >= 0),
    CONSTRAINT sales_orders_total_non_negative CHECK (total >= 0)
);

CREATE INDEX IF NOT EXISTS sales_orders_customer_idx ON erp3.sales_orders (customer_golden_id);
CREATE INDEX IF NOT EXISTS sales_orders_status_idx ON erp3.sales_orders (status);
CREATE INDEX IF NOT EXISTS sales_orders_date_idx ON erp3.sales_orders (order_date);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Table: erp3.so_lines
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp3.so_lines (
    id                  UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id            UUID                     NOT NULL REFERENCES erp3.sales_orders(id) ON DELETE CASCADE,
    line_number         INTEGER                  NOT NULL,
    product_id          UUID                     NOT NULL,
    quantity            NUMERIC(12, 4)           NOT NULL,
    unit_price          NUMERIC(19, 4)           NOT NULL,
    tax_rate            NUMERIC(6, 4)            NOT NULL DEFAULT 0.0000,
    tax_amount          NUMERIC(19, 4)           NOT NULL DEFAULT 0.0000,
    line_total          NUMERIC(19, 4)           NOT NULL,
    created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),

    CONSTRAINT so_lines_order_line_unique UNIQUE (order_id, line_number),
    CONSTRAINT so_lines_quantity_positive CHECK (quantity > 0),
    CONSTRAINT so_lines_unit_price_non_negative CHECK (unit_price >= 0),
    CONSTRAINT so_lines_tax_rate_range CHECK (tax_rate >= 0 AND tax_rate <= 100),
    CONSTRAINT so_lines_tax_amount_non_negative CHECK (tax_amount >= 0),
    CONSTRAINT so_lines_line_total_non_negative CHECK (line_total >= 0)
);

CREATE INDEX IF NOT EXISTS so_lines_order_id_idx ON erp3.so_lines (order_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Table: erp3.invoices
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp3.invoices (
    id                  UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number      VARCHAR(64)              NOT NULL,
    order_id            UUID                     REFERENCES erp3.sales_orders(id),
    customer_golden_id  UUID                     NOT NULL,
    invoice_date        DATE                     NOT NULL,
    due_date            DATE                     NOT NULL,
    status              erp3.invoice_status      NOT NULL DEFAULT 'Open',
    currency            VARCHAR(3)               NOT NULL DEFAULT 'USD',
    subtotal            NUMERIC(19, 4)           NOT NULL DEFAULT 0.0000,
    tax_total           NUMERIC(19, 4)           NOT NULL DEFAULT 0.0000,
    total               NUMERIC(19, 4)           NOT NULL DEFAULT 0.0000,
    source_system       VARCHAR(64),
    source_id           VARCHAR(128),
    created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),

    CONSTRAINT invoices_invoice_number_unique UNIQUE (invoice_number),
    CONSTRAINT invoices_order_id_unique UNIQUE (order_id),
    CONSTRAINT invoices_number_not_empty CHECK (length(trim(invoice_number)) > 0),
    CONSTRAINT invoices_due_date_after_or_equal_invoice_date CHECK (due_date >= invoice_date),
    CONSTRAINT invoices_subtotal_non_negative CHECK (subtotal >= 0),
    CONSTRAINT invoices_tax_total_non_negative CHECK (tax_total >= 0),
    CONSTRAINT invoices_total_non_negative CHECK (total >= 0)
);

CREATE INDEX IF NOT EXISTS invoices_customer_idx ON erp3.invoices (customer_golden_id);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON erp3.invoices (status);
CREATE INDEX IF NOT EXISTS invoices_due_date_idx ON erp3.invoices (due_date);

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Table: erp3.invoice_lines
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp3.invoice_lines (
    id                  UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id          UUID                     NOT NULL REFERENCES erp3.invoices(id) ON DELETE CASCADE,
    line_number         INTEGER                  NOT NULL,
    product_id          UUID                     NOT NULL,
    quantity            NUMERIC(12, 4)           NOT NULL,
    unit_price          NUMERIC(19, 4)           NOT NULL,
    tax_rate            NUMERIC(6, 4)            NOT NULL DEFAULT 0.0000,
    tax_amount          NUMERIC(19, 4)           NOT NULL DEFAULT 0.0000,
    line_total          NUMERIC(19, 4)           NOT NULL,
    created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),

    CONSTRAINT invoice_lines_invoice_line_unique UNIQUE (invoice_id, line_number),
    CONSTRAINT invoice_lines_quantity_positive CHECK (quantity > 0),
    CONSTRAINT invoice_lines_unit_price_non_negative CHECK (unit_price >= 0),
    CONSTRAINT invoice_lines_tax_rate_range CHECK (tax_rate >= 0 AND tax_rate <= 100),
    CONSTRAINT invoice_lines_tax_amount_non_negative CHECK (tax_amount >= 0),
    CONSTRAINT invoice_lines_line_total_non_negative CHECK (line_total >= 0)
);

CREATE INDEX IF NOT EXISTS invoice_lines_invoice_id_idx ON erp3.invoice_lines (invoice_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Table: erp3.payments
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp3.payments (
    id                  UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id          UUID                     NOT NULL REFERENCES erp3.invoices(id),
    amount              NUMERIC(19, 4)           NOT NULL,
    currency            VARCHAR(3)               NOT NULL DEFAULT 'USD',
    payment_date        DATE                     NOT NULL,
    payment_method      erp3.payment_method      NOT NULL,
    reference           VARCHAR(128),
    idempotency_key     VARCHAR(128),
    created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),

    CONSTRAINT payments_amount_positive CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS payments_invoice_id_idx ON erp3.payments (invoice_id);
CREATE INDEX IF NOT EXISTS payments_date_idx ON erp3.payments (payment_date);

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Table: erp3.import_receipts
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp3.import_receipts (
    id                  UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id            UUID                     NOT NULL,
    source_row          INTEGER                  NOT NULL,
    source_system       VARCHAR(64),
    source_id           VARCHAR(128),
    entity              VARCHAR(64)              NOT NULL,
    schema_version      INTEGER                  NOT NULL DEFAULT 1,
    idempotency_key     VARCHAR(128)             NOT NULL,
    request_hash        VARCHAR(64)              NOT NULL,
    target_id           UUID                     NOT NULL,
    kind                VARCHAR(16)              NOT NULL DEFAULT 'created',
    outcome             VARCHAR(16)              NOT NULL DEFAULT 'loaded',
    response_payload    TEXT,
    created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),

    CONSTRAINT import_receipts_erp3_idempotency_key_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS import_receipts_erp3_batch_row_idx ON erp3.import_receipts (batch_id, source_row);

-- ────────────────────────────────────────────────────────────────────────────
-- 10. Permissions (least-privilege model)
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA erp3 TO app';
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA erp3 TO app';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA erp3 GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrator') THEN
        EXECUTE 'GRANT ALL ON SCHEMA erp3 TO migrator';
        EXECUTE 'GRANT ALL ON ALL TABLES IN SCHEMA erp3 TO migrator';
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 11. Record migration as applied (idempotency guard)
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.schema_migrations (migration)
VALUES ('erp3_v1')
ON CONFLICT (migration) DO NOTHING;

COMMIT;
