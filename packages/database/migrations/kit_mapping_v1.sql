-- Migration: KIT-05 V1 Mapping Tables (kit_mappings, clean_crm)
-- Module: Migration Kit (Platform / Integration)
-- Scope: Named mapping templates, value conversion rules, and clean target module staging table.

-- 1. Mapping Templates Table (kit_mappings)
CREATE TABLE IF NOT EXISTS public.kit_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  target_entity TEXT NOT NULL DEFAULT 'contacts',
  mapping_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  value_conversions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_kit_mappings_module_name_version UNIQUE (module, name, version)
);

CREATE INDEX IF NOT EXISTS idx_kit_mappings_module ON public.kit_mappings(module);
CREATE INDEX IF NOT EXISTS idx_kit_mappings_entity ON public.kit_mappings(module, target_entity);

-- 2. Clean Target CRM Staging Table (clean_crm)
CREATE TABLE IF NOT EXISTS public.clean_crm (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.kit_batches(id) ON DELETE CASCADE,
  source_row INTEGER NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_clean_crm_batch_source_row UNIQUE (batch_id, source_row)
);

CREATE INDEX IF NOT EXISTS idx_clean_crm_batch_id ON public.clean_crm(batch_id);
