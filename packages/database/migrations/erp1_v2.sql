-- ============================================================================
-- Migration: erp1_v2
-- Module:    ERP-1 Products & Inventory
-- Issue:     ERP1-02 / ERP1-03 — list/read and mutation API
--
-- Design: Additive and idempotent. Extends the durable import receipt with the
-- request hash and replay payload used by opening-stock idempotency, and
-- enforces the V1 single-default-warehouse invariant in PostgreSQL.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.schema_migrations (
    id          SERIAL PRIMARY KEY,
    migration   VARCHAR(256) NOT NULL UNIQUE,
    applied_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Receipt provenance and replayable outcome (KIT-08 / Decision C4)
ALTER TABLE erp1.import_receipts
    ADD COLUMN IF NOT EXISTS source_system   VARCHAR(64),
    ADD COLUMN IF NOT EXISTS source_id       VARCHAR(128),
    ADD COLUMN IF NOT EXISTS request_hash    VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS outcome         VARCHAR(16) NOT NULL DEFAULT 'loaded',
    ADD COLUMN IF NOT EXISTS response_payload TEXT;

CREATE INDEX IF NOT EXISTS erp1_import_receipts_batch_row_idx
    ON erp1.import_receipts (batch_id, source_row);

-- FR-ERP1-05: V1 operates exactly one default warehouse.
CREATE UNIQUE INDEX IF NOT EXISTS erp1_warehouses_single_default_idx
    ON erp1.warehouses (is_default)
    WHERE is_default = true;

INSERT INTO public.schema_migrations (migration)
VALUES ('erp1_v2')
ON CONFLICT (migration) DO NOTHING;

COMMIT;
