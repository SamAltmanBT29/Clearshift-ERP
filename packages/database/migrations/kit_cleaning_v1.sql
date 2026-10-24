-- Migration: KIT-04 V1 Cleaning Tables (kit_clean_log, kit_rejects, stg_rows)
-- Module: Migration Kit (Platform / Integration)
-- Scope: Per-field audit logging, rejected row catalog, and staged cleaned records.

-- 1. Cleaning Audit Log Table (kit_clean_log)
CREATE TABLE IF NOT EXISTS public.kit_clean_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.kit_batches(id) ON DELETE CASCADE,
  source_row INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  rule_id TEXT NOT NULL,
  rule_version TEXT NOT NULL DEFAULT '1.0.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kit_clean_log_batch_id ON public.kit_clean_log(batch_id);
CREATE INDEX IF NOT EXISTS idx_kit_clean_log_batch_row ON public.kit_clean_log(batch_id, source_row);

-- 2. Migration Rejects Table (kit_rejects)
CREATE TABLE IF NOT EXISTS public.kit_rejects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.kit_batches(id) ON DELETE CASCADE,
  source_row INTEGER NOT NULL,
  entity TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_text TEXT NOT NULL,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kit_rejects_batch_id ON public.kit_rejects(batch_id);
CREATE INDEX IF NOT EXISTS idx_kit_rejects_reason_code ON public.kit_rejects(batch_id, reason_code);

-- 3. Staging Table (stg_rows)
CREATE TABLE IF NOT EXISTS public.stg_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.kit_batches(id) ON DELETE CASCADE,
  source_row INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'cleaned',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  reject_reason TEXT,
  golden_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_stg_rows_batch_source_row UNIQUE (batch_id, source_row)
);

CREATE INDEX IF NOT EXISTS idx_stg_rows_batch_id ON public.stg_rows(batch_id);
CREATE INDEX IF NOT EXISTS idx_stg_rows_batch_status ON public.stg_rows(batch_id, status);
