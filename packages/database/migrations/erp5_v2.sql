-- ============================================================================
-- Migration: erp5_v2
-- Module:    ERP-5 HR & Employees
-- Version:   v1.1.0
-- Issue:     #187 [ERP5-11] Durable import receipts (canonical request hash)
--
-- Design: Adds the request_hash, outcome, and response_payload columns to
-- erp5.import_receipts to support payload-conflict detection and result
-- persistence (KIT-08 / Decision C4).
-- ============================================================================

BEGIN;

-- Guard: skip if this migration was already applied
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.schema_migrations WHERE migration = 'erp5_v2'
    ) THEN
        RAISE NOTICE 'Migration erp5_v2 already applied — skipping.';
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Add required columns to import_receipts
-- ────────────────────────────────────────────────────────────────────────────

-- Payload hash for conflict detection
ALTER TABLE erp5.import_receipts
ADD COLUMN IF NOT EXISTS request_hash VARCHAR(64) NOT NULL DEFAULT '';

-- Result status (e.g., 'success', 'failed', 'conflict')
ALTER TABLE erp5.import_receipts
ADD COLUMN IF NOT EXISTS outcome VARCHAR(32) NOT NULL DEFAULT 'pending';

-- Serialized response for idempotent replays
ALTER TABLE erp5.import_receipts
ADD COLUMN IF NOT EXISTS response_payload JSONB;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Record migration as applied
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.schema_migrations (migration)
VALUES ('erp5_v2')
ON CONFLICT (migration) DO NOTHING;

COMMIT;
