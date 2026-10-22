-- ============================================================================
-- Migration: erp1_v1
-- Module:    ERP-1 Products & Inventory
-- Version:   v1.0.0
-- Issue:     #6  [ERP1-01] Products and Inventory V1 schema, migrations, and seed data
--
-- Design: Idempotent guarded migration.
-- Objects created:
--   Schema:  erp1
--   Enums:   erp1.unit_of_measure
--   Tables:  erp1.categories, erp1.warehouses, erp1.products,
--            erp1.stock_levels, erp1.import_receipts
--   Constraints: SKU uniqueness, non-negative price, non-negative tax,
--                explicit currency format, non-negative stock quantity
--                (BR-ERP1-02), one warehouse (FR-ERP1-05), and the
--                KIT-08 import receipt idempotency key.
--   Seeds:   Default warehouse (WH-01), default category (GEN)
--
-- The table names follow the module schema convention used by ERP-4/ERP-5:
-- the SDS logical names `erp1_categories`, `erp1_products`, etc. are the
-- schema-qualified tables `erp1.categories`, `erp1.products`, etc.
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

-- Guard: skip if this migration was already applied.
-- RAISE EXCEPTION aborts the transaction so no DDL is re-applied when the
-- SQL file is executed directly (e.g. via psql).  The JS migration runner
-- holds an advisory lock, checks schema_migrations BEFORE executing the file,
-- and verifies the ledger after execution.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.schema_migrations WHERE migration = 'erp1_v1'
    ) THEN
        RAISE EXCEPTION 'Migration erp1_v1 already applied — skipping.'
            USING ERRCODE = 'GX001';
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Module PostgreSQL schema (namespace isolation)
-- ────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS erp1;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Enums
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'unit_of_measure' AND n.nspname = 'erp1'
    ) THEN
        CREATE TYPE erp1.unit_of_measure AS ENUM (
            'pcs',
            'kg',
            'g',
            'litre',
            'metre',
            'box'
        );
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Categories (FR-ERP1-03: one level only, name & code)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp1.categories (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    code        VARCHAR(64)  NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS erp1_categories_code_idx
    ON erp1.categories (code);

CREATE INDEX IF NOT EXISTS erp1_categories_name_idx
    ON erp1.categories (name);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Warehouses (FR-ERP1-05: one warehouse in V1)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp1.warehouses (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    code        VARCHAR(64)  NOT NULL,
    is_default  BOOLEAN      NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS erp1_warehouses_code_idx
    ON erp1.warehouses (code);

-- Exactly one warehouse may exist in V1. The constant-expression unique index
-- is enforced by PostgreSQL, regardless of application-layer validation.
CREATE UNIQUE INDEX IF NOT EXISTS erp1_warehouses_single_idx
    ON erp1.warehouses ((true));

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Products (FR-ERP1-01, FR-ERP1-02, BR-ERP1-01)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp1.products (
    id              UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255)         NOT NULL,
    sku             VARCHAR(128)         NOT NULL,
    normalized_sku  VARCHAR(128)         NOT NULL,
    category_id     UUID                 REFERENCES erp1.categories (id) ON DELETE SET NULL,
    unit_of_measure erp1.unit_of_measure NOT NULL,
    price           NUMERIC(19, 4)       NOT NULL,
    currency        VARCHAR(3)           NOT NULL,
    tax_rate        NUMERIC(5, 2)        NOT NULL DEFAULT 0.00,
    source_system   VARCHAR(64),
    source_id       VARCHAR(128),
    created_at      TIMESTAMPTZ          NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ          NOT NULL DEFAULT now(),
    CONSTRAINT check_erp1_products_price_non_negative CHECK (price >= 0),
    CONSTRAINT check_erp1_products_tax_rate_non_negative CHECK (tax_rate >= 0),
    CONSTRAINT check_erp1_products_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS erp1_products_sku_idx
    ON erp1.products (sku);

CREATE UNIQUE INDEX IF NOT EXISTS erp1_products_normalized_sku_idx
    ON erp1.products (normalized_sku);

CREATE INDEX IF NOT EXISTS erp1_products_name_idx
    ON erp1.products (name);

CREATE INDEX IF NOT EXISTS erp1_products_category_id_idx
    ON erp1.products (category_id);

CREATE INDEX IF NOT EXISTS erp1_products_source_idx
    ON erp1.products (source_system, source_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Stock Levels (FR-ERP1-06, BR-ERP1-02: quantity >= 0)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp1.stock_levels (
    id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id    UUID           NOT NULL REFERENCES erp1.products (id) ON DELETE CASCADE,
    warehouse_id  UUID           NOT NULL REFERENCES erp1.warehouses (id) ON DELETE CASCADE,
    quantity      NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    updated_at    TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT check_erp1_stock_quantity_non_negative CHECK (quantity >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS erp1_stock_levels_product_warehouse_idx
    ON erp1.stock_levels (product_id, warehouse_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Import Receipts (Decision C4 & KIT-08)
--    Idempotency key = sha256(batch_id, source_row, entity, schema_version).
--    Written in the same transaction as the target product/stock mutation.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp1.import_receipts (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id          UUID         NOT NULL,
    source_row        INTEGER      NOT NULL,
    entity            VARCHAR(64)  NOT NULL,
    schema_version    INTEGER      NOT NULL DEFAULT 1,
    idempotency_key   VARCHAR(128) NOT NULL,
    target_id         UUID         NOT NULL,
    kind              VARCHAR(16)  NOT NULL DEFAULT 'created',
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT check_erp1_import_receipts_source_row_positive CHECK (source_row >= 1),
    CONSTRAINT check_erp1_import_receipts_schema_version_positive CHECK (schema_version >= 1),
    CONSTRAINT check_erp1_import_receipts_kind_allowed CHECK (kind IN ('created', 'linked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS erp1_import_receipts_idempotency_key_unique
    ON erp1.import_receipts (idempotency_key);

CREATE INDEX IF NOT EXISTS erp1_import_receipts_batch_row_idx
    ON erp1.import_receipts (batch_id, source_row);

-- ────────────────────────────────────────────────────────────────────────────
-- 8. updated_at triggers
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION erp1.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS categories_set_updated_at ON erp1.categories;
CREATE TRIGGER categories_set_updated_at
    BEFORE UPDATE ON erp1.categories
    FOR EACH ROW EXECUTE FUNCTION erp1.set_updated_at();

DROP TRIGGER IF EXISTS warehouses_set_updated_at ON erp1.warehouses;
CREATE TRIGGER warehouses_set_updated_at
    BEFORE UPDATE ON erp1.warehouses
    FOR EACH ROW EXECUTE FUNCTION erp1.set_updated_at();

DROP TRIGGER IF EXISTS products_set_updated_at ON erp1.products;
CREATE TRIGGER products_set_updated_at
    BEFORE UPDATE ON erp1.products
    FOR EACH ROW EXECUTE FUNCTION erp1.set_updated_at();

DROP TRIGGER IF EXISTS stock_levels_set_updated_at ON erp1.stock_levels;
CREATE TRIGGER stock_levels_set_updated_at
    BEFORE UPDATE ON erp1.stock_levels
    FOR EACH ROW EXECUTE FUNCTION erp1.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Seed Initial V1 Data (Default warehouse & Category)
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO erp1.categories (id, name, code)
VALUES ('00000000-0000-4000-8000-000000000001', 'General', 'GEN')
ON CONFLICT (code) DO NOTHING;

INSERT INTO erp1.warehouses (id, name, code, is_default)
VALUES ('00000000-0000-4000-8000-000000000002', 'Main Warehouse', 'WH-01', true)
ON CONFLICT (code) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. Record Migration
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.schema_migrations (migration)
VALUES ('erp1_v1')
ON CONFLICT (migration) DO NOTHING;

COMMIT;
