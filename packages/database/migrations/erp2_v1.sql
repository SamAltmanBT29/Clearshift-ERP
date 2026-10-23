-- ============================================================================
-- Migration: erp2_v1
-- Module:    ERP-2 Vendors & Purchasing
-- Version:   v1.0.0
-- Issue:     #16  [ERP2-01] Schema, Drizzle models and guarded migrations
--
-- Design: This migration is GUARDED — idempotent CREATE IF NOT EXISTS / DO
-- blocks prevent failure on re-run. The migration runner records applied
-- migrations in the shared schema_migrations table; it will NOT re-execute
-- this file after the first successful run.
--
-- Objects created:
--   Schema:  erp2
--   Enums:   erp2.purchase_order_status
--   Tables:  erp2.vendors, erp2.purchase_orders, erp2.po_lines, erp2.import_receipts
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
        SELECT 1 FROM public.schema_migrations WHERE migration = 'erp2_v1'
    ) THEN
        RAISE NOTICE 'Migration erp2_v1 already applied — skipping.';
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Module PostgreSQL schema (namespace isolation)
-- ────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS erp2;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Shared updated_at trigger function (module-scoped)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION erp2.set_updated_at()
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
    CREATE TYPE erp2.purchase_order_status AS ENUM (
        'draft',
        'sent',
        'received',
        'closed'
    );
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'erp2.purchase_order_status already exists — skipping.';
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Table: erp2.vendors (Vendor Master)
-- FR-ERP2-01: vendor list with search by name
-- FR-ERP2-02: create and edit vendor
-- FR-ERP2-06: bank details masked everywhere (screens and logs: XXXX-XXXX-7890)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp2.vendors (
    id                  UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255)             NOT NULL,
    tax_number          VARCHAR(64)              NOT NULL,
    email               VARCHAR(255),
    phone               VARCHAR(64),
    address_line        VARCHAR(255),
    city                VARCHAR(120),
    country             VARCHAR(64),
    bank_masked         VARCHAR(32),
    currency            VARCHAR(3)               NOT NULL DEFAULT 'USD',
    source_system       VARCHAR(64),
    source_id           VARCHAR(128),
    created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),

    CONSTRAINT vendors_tax_number_unique UNIQUE (tax_number),
    CONSTRAINT vendors_name_not_empty CHECK (length(trim(name)) > 0),
    CONSTRAINT vendors_tax_number_not_empty CHECK (length(trim(tax_number)) > 0),
    CONSTRAINT vendors_bank_masked_format CHECK (bank_masked IS NULL OR bank_masked ~ '^XXXX-XXXX-[0-9]{4}$')
);

CREATE INDEX IF NOT EXISTS vendors_name_idx ON erp2.vendors (name);
CREATE INDEX IF NOT EXISTS vendors_source_idx ON erp2.vendors (source_system, source_id);

DROP TRIGGER IF EXISTS trg_vendors_updated_at ON erp2.vendors;
CREATE TRIGGER trg_vendors_updated_at
    BEFORE UPDATE ON erp2.vendors
    FOR EACH ROW EXECUTE FUNCTION erp2.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Table: erp2.purchase_orders (Purchase Order Header)
-- FR-ERP2-03: purchase order header (vendor, date, status, total)
-- FR-ERP2-04: status Draft / Sent / Received / Closed
-- FR-ERP2-05: order total calculated from lines
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp2.purchase_orders (
    id                  UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number           VARCHAR(64)              NOT NULL,
    vendor_id           UUID                     NOT NULL REFERENCES erp2.vendors(id) ON DELETE RESTRICT,
    order_date          DATE                     NOT NULL DEFAULT CURRENT_DATE,
    status              erp2.purchase_order_status NOT NULL DEFAULT 'draft',
    currency            VARCHAR(3)               NOT NULL DEFAULT 'INR',
    total               NUMERIC(18, 2)           NOT NULL DEFAULT 0.00,
    notes               TEXT,
    source_system       VARCHAR(64),
    source_id           VARCHAR(128),
    created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),

    CONSTRAINT purchase_orders_po_number_unique UNIQUE (po_number),
    CONSTRAINT purchase_orders_po_number_not_empty CHECK (length(trim(po_number)) > 0),
    CONSTRAINT purchase_orders_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT purchase_orders_total_non_negative CHECK (total >= 0)
);

CREATE INDEX IF NOT EXISTS purchase_orders_vendor_id_idx ON erp2.purchase_orders (vendor_id);
CREATE INDEX IF NOT EXISTS purchase_orders_status_idx ON erp2.purchase_orders (status);
CREATE INDEX IF NOT EXISTS purchase_orders_order_date_idx ON erp2.purchase_orders (order_date);

DROP TRIGGER IF EXISTS trg_purchase_orders_updated_at ON erp2.purchase_orders;
CREATE TRIGGER trg_purchase_orders_updated_at
    BEFORE UPDATE ON erp2.purchase_orders
    FOR EACH ROW EXECUTE FUNCTION erp2.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Table: erp2.po_lines (Purchase Order Lines)
-- FR-ERP2-03: lines with product link, quantity, price, line_total
-- BR-ERP2-01: line references product; cross-module FK is logical (C7)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp2.po_lines (
    id                  UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id               UUID                     NOT NULL REFERENCES erp2.purchase_orders(id) ON DELETE CASCADE,
    product_id          UUID                     NOT NULL,
    line_number         INTEGER                  NOT NULL,
    quantity            NUMERIC(18, 4)           NOT NULL,
    price               NUMERIC(18, 2)           NOT NULL,
    line_total          NUMERIC(18, 2)           NOT NULL,
    created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),

    CONSTRAINT po_lines_po_line_number_unique UNIQUE (po_id, line_number),
    CONSTRAINT po_lines_quantity_positive CHECK (quantity > 0),
    CONSTRAINT po_lines_price_non_negative CHECK (price >= 0),
    CONSTRAINT po_lines_line_total_non_negative CHECK (line_total >= 0)
);

CREATE INDEX IF NOT EXISTS po_lines_po_id_idx ON erp2.po_lines (po_id);
CREATE INDEX IF NOT EXISTS po_lines_product_id_idx ON erp2.po_lines (product_id);

DROP TRIGGER IF EXISTS trg_po_lines_updated_at ON erp2.po_lines;
CREATE TRIGGER trg_po_lines_updated_at
    BEFORE UPDATE ON erp2.po_lines
    FOR EACH ROW EXECUTE FUNCTION erp2.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Table: erp2.import_receipts (Idempotency & Migration Audit Receipts)
-- KIT-08 / Master Architecture Spec §6.1 slot 01
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp2.import_receipts (
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

    CONSTRAINT import_receipts_idempotency_key_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS import_receipts_batch_row_idx ON erp2.import_receipts (batch_id, source_row);

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Permissions (least-privilege model)
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA erp2 TO app';
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA erp2 TO app';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA erp2 GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrator') THEN
        EXECUTE 'GRANT ALL ON SCHEMA erp2 TO migrator';
        EXECUTE 'GRANT ALL ON ALL TABLES IN SCHEMA erp2 TO migrator';
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Record migration as applied (idempotency guard)
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.schema_migrations (migration)
VALUES ('erp2_v1')
ON CONFLICT (migration) DO NOTHING;

COMMIT;
