-- ClearShift Migration Kit — Column Profile Reports Schema (KIT-03)
-- Version: v1.0.0
-- Forward-only, idempotent migration for PostgreSQL 18+

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Kit Profile Reports Table
CREATE TABLE IF NOT EXISTS public.kit_profile_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES public.kit_batches(id) ON DELETE CASCADE,
    column_name TEXT NOT NULL,
    empty_count INTEGER NOT NULL DEFAULT 0,
    invalid_count INTEGER NOT NULL DEFAULT 0,
    distinct_count INTEGER NOT NULL DEFAULT 0,
    inferred_type TEXT NOT NULL DEFAULT 'string',
    top_values_json JSONB NOT NULL DEFAULT '[]',
    min_value TEXT,
    max_value TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_kit_profile_reports_batch_col UNIQUE (batch_id, column_name)
);

CREATE INDEX IF NOT EXISTS idx_kit_profile_reports_batch_id ON public.kit_profile_reports(batch_id);
