-- ClearShift Migration Kit — Batch Registry & Immutable Step Ledger Schema (KIT-01)
-- Version: v1.0.0
-- Forward-only, idempotent migration for PostgreSQL 18+

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Batch Registry Table
CREATE TABLE IF NOT EXISTS public.kit_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_number VARCHAR(64) NOT NULL UNIQUE,
    module VARCHAR(64) NOT NULL,
    source_system VARCHAR(64),
    file_name VARCHAR(255),
    file_size_bytes BIGINT,
    checksum VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'created',
    previous_status VARCHAR(32),
    checkpoint VARCHAR(64) NOT NULL DEFAULT 'created',
    attempt INTEGER NOT NULL DEFAULT 1,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    total_rows INTEGER NOT NULL DEFAULT 0,
    loaded_rows INTEGER NOT NULL DEFAULT 0,
    rejected_rows INTEGER NOT NULL DEFAULT 0,
    merged_rows INTEGER NOT NULL DEFAULT 0,
    skipped_rows INTEGER NOT NULL DEFAULT 0,
    unaccounted_rows INTEGER NOT NULL DEFAULT 0,
    rule_version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    code_version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    error_code VARCHAR(64),
    error_message TEXT,
    correlation_id VARCHAR(128) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by VARCHAR(128) NOT NULL DEFAULT 'system',
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_kit_batches_status CHECK (
        status IN (
            'created', 'extracting', 'extracted', 'profiled',
            'cleaned', 'mapped', 'dry_run_passed', 'loading',
            'loaded', 'validating', 'validated', 'reconciled',
            'failed', 'load_failed_partial', 'rollback_pending',
            'rollback_blocked', 'rolled_back'
        )
    ),
    CONSTRAINT chk_kit_batches_attempt CHECK (attempt >= 1),
    CONSTRAINT chk_kit_batches_max_attempts CHECK (max_attempts >= 1),
    CONSTRAINT chk_kit_batches_total_rows CHECK (total_rows >= 0),
    CONSTRAINT chk_kit_batches_loaded_rows CHECK (loaded_rows >= 0),
    CONSTRAINT chk_kit_batches_rejected_rows CHECK (rejected_rows >= 0),
    CONSTRAINT chk_kit_batches_merged_rows CHECK (merged_rows >= 0),
    CONSTRAINT chk_kit_batches_skipped_rows CHECK (skipped_rows >= 0),
    CONSTRAINT chk_kit_batches_unaccounted_rows CHECK (unaccounted_rows >= 0)
);

CREATE INDEX IF NOT EXISTS idx_kit_batches_module ON public.kit_batches(module);
CREATE INDEX IF NOT EXISTS idx_kit_batches_status ON public.kit_batches(status);
CREATE INDEX IF NOT EXISTS idx_kit_batches_correlation_id ON public.kit_batches(correlation_id);
CREATE INDEX IF NOT EXISTS idx_kit_batches_batch_number ON public.kit_batches(batch_number);

-- 2. Immutable Step Ledger Table
CREATE TABLE IF NOT EXISTS public.kit_batch_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES public.kit_batches(id) ON DELETE RESTRICT,
    step_number INTEGER NOT NULL,
    step_name VARCHAR(32) NOT NULL,
    from_status VARCHAR(32) NOT NULL,
    to_status VARCHAR(32) NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    checkpoint VARCHAR(64) NOT NULL,
    records_in INTEGER NOT NULL DEFAULT 0,
    records_out INTEGER NOT NULL DEFAULT 0,
    records_rejected INTEGER NOT NULL DEFAULT 0,
    records_merged INTEGER NOT NULL DEFAULT 0,
    records_skipped INTEGER NOT NULL DEFAULT 0,
    rule_version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    code_version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    error_code VARCHAR(64),
    error_message TEXT,
    correlation_id VARCHAR(128) NOT NULL,
    actor VARCHAR(128) NOT NULL DEFAULT 'system',
    duration_ms INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_kit_batch_steps_step_name CHECK (
        step_name IN (
            'extract', 'profile', 'clean', 'map',
            'dry_run', 'load', 'validate', 'reconcile'
        )
    ),
    CONSTRAINT chk_kit_batch_steps_attempt CHECK (attempt >= 1),
    CONSTRAINT chk_kit_batch_steps_records_in CHECK (records_in >= 0),
    CONSTRAINT chk_kit_batch_steps_records_out CHECK (records_out >= 0),
    CONSTRAINT chk_kit_batch_steps_records_rejected CHECK (records_rejected >= 0),
    CONSTRAINT chk_kit_batch_steps_records_merged CHECK (records_merged >= 0),
    CONSTRAINT chk_kit_batch_steps_records_skipped CHECK (records_skipped >= 0)
);

CREATE INDEX IF NOT EXISTS idx_kit_batch_steps_batch_id ON public.kit_batch_steps(batch_id);
CREATE INDEX IF NOT EXISTS idx_kit_batch_steps_correlation_id ON public.kit_batch_steps(correlation_id);
CREATE INDEX IF NOT EXISTS idx_kit_batch_steps_step_name ON public.kit_batch_steps(step_name);

-- 3. Database Guard: State Transition Enforcement Trigger Function
CREATE OR REPLACE FUNCTION public.fn_guard_kit_batch_transition()
RETURNS TRIGGER AS $$
DECLARE
    is_valid BOOLEAN := false;
BEGIN
    -- Idempotent update: if status did not change, allow
    IF OLD.status = NEW.status THEN
        NEW.updated_at := now();
        RETURN NEW;
    END IF;

    -- Invariant: retries cannot restart from created implicitly
    IF NEW.status = 'created' THEN
        RAISE EXCEPTION 'Illegal state transition: batch % cannot restart from created implicitly; must resume from committed checkpoint', OLD.id
            USING ERRCODE = '22000';
    END IF;

    -- Invariant: terminal states cannot transition to any other state
    IF OLD.status IN ('reconciled', 'rolled_back') THEN
        RAISE EXCEPTION 'Illegal state transition: batch % is in terminal state % and cannot be transitioned', OLD.id, OLD.status
            USING ERRCODE = '22000';
    END IF;

    -- Transition Matrix Validation
    CASE OLD.status
        WHEN 'created' THEN
            is_valid := (NEW.status IN ('extracting', 'failed'));
        WHEN 'extracting' THEN
            is_valid := (NEW.status IN ('extracted', 'failed'));
        WHEN 'extracted' THEN
            is_valid := (NEW.status IN ('profiled', 'failed'));
        WHEN 'profiled' THEN
            is_valid := (NEW.status IN ('cleaned', 'failed'));
        WHEN 'cleaned' THEN
            is_valid := (NEW.status IN ('mapped', 'failed'));
        WHEN 'mapped' THEN
            is_valid := (NEW.status IN ('dry_run_passed', 'failed'));
        WHEN 'dry_run_passed' THEN
            is_valid := (NEW.status IN ('loading', 'failed'));
        WHEN 'loading' THEN
            is_valid := (NEW.status IN ('loaded', 'failed', 'load_failed_partial'));
        WHEN 'load_failed_partial' THEN
            is_valid := (NEW.status IN ('loading', 'failed', 'rollback_pending'));
        WHEN 'loaded' THEN
            is_valid := (NEW.status IN ('validating', 'failed'));
        WHEN 'validating' THEN
            is_valid := (NEW.status IN ('validated', 'failed'));
        WHEN 'validated' THEN
            is_valid := (NEW.status IN ('reconciled', 'failed'));
        WHEN 'rollback_pending' THEN
            is_valid := (NEW.status IN ('rolled_back', 'rollback_blocked', 'failed'));
        WHEN 'rollback_blocked' THEN
            is_valid := (NEW.status = 'failed');
        WHEN 'failed' THEN
            is_valid := (NEW.status IN (
                'extracting', 'profiled', 'cleaned', 'mapped',
                'dry_run_passed', 'loading', 'validating', 'reconciled',
                'rollback_pending'
            ));
        ELSE
            is_valid := false;
    END CASE;

    IF NOT is_valid THEN
        RAISE EXCEPTION 'Illegal state transition from % to % for batch %', OLD.status, NEW.status, OLD.id
            USING ERRCODE = '22000';
    END IF;

    -- Reconciliation mathematical invariant
    IF NEW.status = 'reconciled' THEN
        IF (NEW.loaded_rows + NEW.rejected_rows + NEW.merged_rows + NEW.skipped_rows + NEW.unaccounted_rows != NEW.total_rows)
           OR (NEW.unaccounted_rows != 0) THEN
            RAISE EXCEPTION 'Reconciliation invariant violation: source = loaded + rejected + merged + skipped and unaccounted = 0 required for batch %', OLD.id
                USING ERRCODE = '22000';
        END IF;
    END IF;

    -- Store previous status and timestamp
    NEW.previous_status := OLD.status;
    NEW.updated_at := now();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_kit_batch_transition ON public.kit_batches;
CREATE TRIGGER trg_guard_kit_batch_transition
    BEFORE UPDATE OF status ON public.kit_batches
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_guard_kit_batch_transition();

-- 4. Database Guard: Immutable Step Ledger (Append-Only Trigger)
CREATE OR REPLACE FUNCTION public.fn_guard_kit_batch_steps_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Mutation violation: kit_batch_steps is an immutable append-only ledger and cannot be modified or deleted'
        USING ERRCODE = '22000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_kit_batch_steps_immutable ON public.kit_batch_steps;
CREATE TRIGGER trg_guard_kit_batch_steps_immutable
    BEFORE UPDATE OR DELETE ON public.kit_batch_steps
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_guard_kit_batch_steps_immutable();
