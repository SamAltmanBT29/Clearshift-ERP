-- ============================================================================
-- Migration: kit_rollback_journal
-- Module:    Migration Kit / Platform
-- Version:   v1.0.0
-- Issue:     #79 [KIT-12] Resumable compensating-saga rollback with conflict preflight
--
-- Design: Idempotent guarded migration.
-- Objects created:
--   Schema:      platform
--   Tables:      platform.kit_rollback_journal, platform.kit_rollback_executions
--   Views:       public.kit_rollback_journal, public.kit_rollback_executions
--   Constraints: Unique by (batch_id, idempotency_key, action),
--                action enum check ('remove_created', 'restore_updated'),
--                item status enum check ('pending', 'compensated', 'blocked', 'failed', 'resumed'),
--                batch status enum check ('idle', 'preflight_passed', 'in_progress', 'rolled_back', 'rollback_blocked', 'failed'),
--                audit and append-only trigger semantics.
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
        SELECT 1 FROM public.schema_migrations WHERE migration = 'kit_rollback_journal'
    ) THEN
        RAISE EXCEPTION 'Migration kit_rollback_journal already applied — skipping.'
            USING ERRCODE = 'GX001';
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Ensure platform schema exists
-- ────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS platform;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Table: platform.kit_rollback_executions (Durable saga batch execution status)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform.kit_rollback_executions (
    batch_id VARCHAR(128) PRIMARY KEY,
    status VARCHAR(32) NOT NULL CHECK (
        status IN ('idle', 'preflight_passed', 'in_progress', 'rolled_back', 'rollback_blocked', 'failed')
    ),
    requested_by VARCHAR(128) NOT NULL,
    reason TEXT NOT NULL,
    preflight_passed BOOLEAN NOT NULL DEFAULT false,
    total_items INTEGER NOT NULL DEFAULT 0,
    compensated_items INTEGER NOT NULL DEFAULT 0,
    blocked_items INTEGER NOT NULL DEFAULT 0,
    failed_items INTEGER NOT NULL DEFAULT 0,
    conflicts JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Table: platform.kit_rollback_journal (Append-only compensating action journal)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform.kit_rollback_journal (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id VARCHAR(128) NOT NULL,
    module VARCHAR(64) NOT NULL,
    entity VARCHAR(64) NOT NULL,
    target_id VARCHAR(128) NOT NULL,
    source_row INTEGER,
    action VARCHAR(32) NOT NULL CHECK (action IN ('remove_created', 'restore_updated')),
    target_version INTEGER NOT NULL DEFAULT 1,
    before_state JSONB,
    after_state JSONB,
    actor VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'compensated', 'blocked', 'failed', 'resumed')),
    idempotency_key VARCHAR(128) NOT NULL,
    error_reason TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT kit_rollback_journal_idempotency_action_unique UNIQUE (batch_id, idempotency_key, action)
);

CREATE INDEX IF NOT EXISTS idx_kit_rollback_journal_batch_status
    ON platform.kit_rollback_journal (batch_id, status);

CREATE INDEX IF NOT EXISTS idx_kit_rollback_journal_batch_position
    ON platform.kit_rollback_journal (batch_id, position DESC);

CREATE INDEX IF NOT EXISTS idx_kit_rollback_journal_target_id
    ON platform.kit_rollback_journal (target_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Public Schema Read-Only Views
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.kit_rollback_journal AS
    SELECT * FROM platform.kit_rollback_journal;

CREATE OR REPLACE VIEW public.kit_rollback_executions AS
    SELECT * FROM platform.kit_rollback_executions;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Record migration application
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.schema_migrations (migration, applied_at)
VALUES ('kit_rollback_journal', now())
ON CONFLICT (migration) DO NOTHING;

COMMIT;
