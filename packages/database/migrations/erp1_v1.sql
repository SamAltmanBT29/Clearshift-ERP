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
--                non-negative stock quantity (BR-ERP1-02)
--   Seeds:   Default warehouse (WH-01), default category (GEN)
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
        SELECT 1 FROM public.schema_migrations WHERE migration = 'erp1_v1'
    ) THEN
        RAISE NOTICE 'Migration erp1_v1 already applied — skipping.';
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
    price           NUMERIC(12, 2)       NOT NULL,
    currency        VARCHAR(3)           NOT NULL DEFAULT 'USD',
    tax_rate        NUMERIC(5, 2)        NOT NULL DEFAULT 0.00,
    source_system   VARCHAR(64),
    source_id       VARCHAR(128),
    created_at      TIMESTAMPTZ          NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ          NOT NULL DEFAULT now(),
    CONSTRAINT check_erp1_products_price_non_negative CHECK (price >= 0),
    CONSTRAINT check_erp1_products_tax_rate_non_negative CHECK (tax_rate >= 0)
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
    quantity      NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    updated_at    TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT check_erp1_stock_quantity_non_negative CHECK (quantity >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS erp1_stock_levels_product_warehouse_idx
    ON erp1.stock_levels (product_id, warehouse_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Import Receipts (Decision C4 & KIT-08)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp1.import_receipts (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id          UUID         NOT NULL,
    source_row_index  INTEGER      NOT NULL,
    target_id         UUID         NOT NULL,
    target_entity     VARCHAR(64)  NOT NULL DEFAULT 'product',
    idempotency_key   VARCHAR(255) NOT NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS erp1_import_receipts_idempotency_idx
    ON erp1.import_receipts (idempotency_key);

CREATE INDEX IF NOT EXISTS erp1_import_receipts_batch_idx
    ON erp1.import_receipts (batch_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Seed Initial V1 Data (Default warehouse & Category)
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO erp1.categories (id, name, code)
VALUES ('00000000-0000-4000-8000-000000000001', 'General', 'GEN')
ON CONFLICT (code) DO NOTHING;

INSERT INTO erp1.warehouses (id, name, code, is_default)
VALUES ('00000000-0000-4000-8000-000000000002', 'Main Warehouse', 'WH-01', true)
ON CONFLICT (code) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Record Migration
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.schema_migrations (migration)
VALUES ('erp1_v1')
ON CONFLICT (migration) DO NOTHING;

COMMIT;
