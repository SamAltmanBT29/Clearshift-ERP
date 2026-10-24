-- ClearShift Migration Kit — Raw Landing Immutability Schema (KIT-02)
-- Version: v1.0.0
-- Forward-only, idempotent migration for PostgreSQL 18+

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Raw Rows Landing Table
CREATE TABLE IF NOT EXISTS public.raw_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES public.kit_batches(id) ON DELETE CASCADE,
    source_row INTEGER NOT NULL,
    headers TEXT[] NOT NULL,
    cells TEXT[] NOT NULL,
    payload JSONB NOT NULL,
    row_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_raw_rows_batch_source UNIQUE (batch_id, source_row)
);

CREATE INDEX IF NOT EXISTS idx_raw_rows_batch_id ON public.raw_rows(batch_id);

-- 2. Database Guard: Raw Rows Immutability Trigger Function
CREATE OR REPLACE FUNCTION public.fn_guard_raw_rows_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Mutation violation: raw_rows is an immutable landing table and cannot be modified or deleted'
        USING ERRCODE = '22000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_raw_rows_immutable ON public.raw_rows;
CREATE TRIGGER trg_guard_raw_rows_immutable
    BEFORE UPDATE OR DELETE ON public.raw_rows
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_guard_raw_rows_immutable();
