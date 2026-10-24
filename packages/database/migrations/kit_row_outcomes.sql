-- ============================================================================
-- Migration: kit_row_outcomes
-- Module:    Migration Kit / Platform
-- Version:   v1.0.0
-- Issue:     #76 [KIT-09] Terminal outcome ledger and mathematically exact reconciliation
--
-- Design: Idempotent guarded migration.
-- Objects created:
--   Schema:      platform
--   Tables:      platform.kit_row_outcomes, platform.kit_reconciliations
--   Views:       public.kit_row_outcomes, public.kit_reconciliations
--   Constraints: Unique by (batch_id, source_row) enforcing single terminal outcome,
--                outcome enum check ('loaded', 'rejected', 'merged', 'skipped'),
--                skip policy check (policy_code 'operator_approved_skip' and >= 10 non-whitespace chars),
--                append-only trigger strictly blocking UPDATE and DELETE.
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
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.schema_migrations WHERE migration = 'kit_row_outcomes'
    ) THEN
        RAISE EXCEPTION 'Migration kit_row_outcomes already applied — skipping.'
            USING ERRCODE = 'GX001';
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Ensure platform schema exists
-- ────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS platform;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Table: platform.kit_row_outcomes (Append-only terminal outcome ledger)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform.kit_row_outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id VARCHAR(128) NOT NULL,
    source_row INTEGER NOT NULL CHECK (source_row >= 1),
    outcome VARCHAR(32) NOT NULL CHECK (outcome IN ('loaded', 'rejected', 'merged', 'skipped')),
    target_id VARCHAR(128),
    reason_code VARCHAR(64),
    reason_text TEXT,
    operator VARCHAR(128),
    operator_role VARCHAR(64),
    policy_code VARCHAR(64),
    idempotency_key VARCHAR(128),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT kit_row_outcomes_batch_source_row_unique UNIQUE (batch_id, source_row),
    CONSTRAINT kit_row_outcomes_skip_reason_check CHECK (
        outcome != 'skipped' OR (
            policy_code = 'operator_approved_skip' AND
            reason_text IS NOT NULL AND
            length(regexp_replace(reason_text, '\s+', '', 'g')) >= 10
        )
    )
);

CREATE INDEX IF NOT EXISTS idx_kit_row_outcomes_batch_outcome
    ON platform.kit_row_outcomes (batch_id, outcome);

CREATE INDEX IF NOT EXISTS idx_kit_row_outcomes_idempotency_key
    ON platform.kit_row_outcomes (idempotency_key);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Trigger: Strictly append-only enforcement (No UPDATE or DELETE)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION platform.trg_fn_kit_row_outcomes_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'platform.kit_row_outcomes is append-only: UPDATE and DELETE operations are prohibited (KIT-09)'
        USING ERRCODE = 'GX002';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kit_row_outcomes_append_only ON platform.kit_row_outcomes;
CREATE TRIGGER trg_kit_row_outcomes_append_only
    BEFORE UPDATE OR DELETE ON platform.kit_row_outcomes
    FOR EACH ROW
    EXECUTE FUNCTION platform.trg_fn_kit_row_outcomes_append_only();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Table: platform.kit_reconciliations (Durable batch reconciliation state)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform.kit_reconciliations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id VARCHAR(128) NOT NULL UNIQUE,
    source_count INTEGER NOT NULL CHECK (source_count >= 0),
    loaded_count INTEGER NOT NULL CHECK (loaded_count >= 0),
    rejected_count INTEGER NOT NULL CHECK (rejected_count >= 0),
    merged_count INTEGER NOT NULL CHECK (merged_count >= 0),
    skipped_count INTEGER NOT NULL CHECK (skipped_count >= 0),
    unaccounted_count INTEGER NOT NULL,
    result VARCHAR(32) NOT NULL CHECK (result IN ('OK', 'NOT_OK', 'reconciliation_failed')),
    signoff_disabled BOOLEAN NOT NULL DEFAULT false,
    formula_holds BOOLEAN NOT NULL DEFAULT false,
    failure_reasons JSONB,
    reconciled_by VARCHAR(128),
    reconciled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Public views for cross-schema visibility
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.kit_row_outcomes AS
    SELECT * FROM platform.kit_row_outcomes;

CREATE OR REPLACE VIEW public.kit_reconciliations AS
    SELECT * FROM platform.kit_reconciliations;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Record migration in schema_migrations ledger
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.schema_migrations (migration)
VALUES ('kit_row_outcomes')
ON CONFLICT (migration) DO NOTHING;

COMMIT;
