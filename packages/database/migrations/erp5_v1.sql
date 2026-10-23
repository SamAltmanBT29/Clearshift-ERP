-- ============================================================================
-- Migration: erp5_v1
-- Module:    ERP-5 HR & Employees
-- Version:   v1.0.0
-- Issue:     #46  [ERP5-01] Schema, Drizzle models and guarded migrations
--
-- Design: This migration is GUARDED — idempotent CREATE IF NOT EXISTS / DO
-- blocks prevent failure on re-run.  The migration runner records applied
-- migrations in the shared schema_migrations table; it will NOT re-execute
-- this file after the first successful run.
--
-- Objects created:
--   Schema:  erp5
--   Enums:   erp5.leave_type, erp5.leave_status
--   Tables:  erp5.departments, erp5.employees, erp5.leave,
--            erp5.payroll_totals, erp5.import_receipts
--   View:    erp5.identity_users (read-only Hub Identity projection)
--   Trigger: updated_at auto-update
--
-- Ownership boundary: every writable object lives in the `erp5` schema.
-- The single cross-schema object is the read-only `erp5.identity_users`
-- view over `platform.hub_users` (Master Architecture Spec C3).  No
-- foreign key crosses a schema boundary.
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
        SELECT 1 FROM public.schema_migrations WHERE migration = 'erp5_v1'
    ) THEN
        RAISE NOTICE 'Migration erp5_v1 already applied — skipping.';
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Module PostgreSQL schema (namespace isolation)
-- ────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS erp5;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Shared updated_at trigger function (module-scoped)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION erp5.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Enum types
-- ────────────────────────────────────────────────────────────────────────────

-- FR-ERP5-04: leave type is sick / holiday / other
DO $$ BEGIN
    CREATE TYPE erp5.leave_type AS ENUM (
        'sick',
        'holiday',
        'other'
    );
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'erp5.leave_type already exists — skipping.';
END $$;

-- Leave record status. V1 records the status only; the V2 workflow
-- (FR-ERP5-10) reuses the same states.
DO $$ BEGIN
    CREATE TYPE erp5.leave_status AS ENUM (
        'pending',
        'approved',
        'rejected'
    );
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'erp5.leave_status already exists — skipping.';
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Table: erp5.departments (Department Hierarchy)
-- FR-ERP5-03: departments have name, code, optional parent department
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp5.departments (
    id                  UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255)             NOT NULL,
    code                VARCHAR(32)              NOT NULL,
    parent_id           UUID                     REFERENCES erp5.departments(id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),

    -- FR-ERP5-03: department code is unique
    CONSTRAINT departments_code_unique UNIQUE (code),

    -- DB-enforced: a department can never be its own parent
    CONSTRAINT departments_not_self_parent
        CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS departments_parent_id_idx
    ON erp5.departments (parent_id);

DROP TRIGGER IF EXISTS departments_set_updated_at ON erp5.departments;
CREATE TRIGGER departments_set_updated_at
    BEFORE UPDATE ON erp5.departments
    FOR EACH ROW EXECUTE FUNCTION erp5.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Table: erp5.employees (Employee Master)
-- FR-ERP5-01, FR-ERP5-02, BR-ERP5-01, BR-ERP5-02
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp5.employees (
    id                  UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_no         VARCHAR(32)              NOT NULL,
    first_name          VARCHAR(120)             NOT NULL,
    last_name           VARCHAR(120)             NOT NULL,
    birth_date          DATE                     NOT NULL,
    join_date           DATE                     NOT NULL,
    department_id       UUID                     NOT NULL
                            REFERENCES erp5.departments(id) ON DELETE RESTRICT,
    job_title           VARCHAR(120)             NOT NULL,
    salary              NUMERIC(20,4)            NOT NULL,
    currency_code       VARCHAR(3)               NOT NULL DEFAULT 'INR',
    source_system       VARCHAR(64),
    source_id           VARCHAR(128),
    created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),

    -- Declared employee identity key (Master Architecture Spec ERD: employee_no UK)
    CONSTRAINT employees_employee_no_unique UNIQUE (employee_no),

    -- BR-ERP5-01: join date can never be before the birth date
    CONSTRAINT employees_join_date_after_birth_date
        CHECK (join_date >= birth_date),

    -- Salary is a non-negative amount
    CONSTRAINT employees_salary_non_negative
        CHECK (salary >= 0)
);

-- Partial unique index — source identity is unique when the source id is present.
-- NULL source_id rows (manually created employees) are not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS employees_source_identity_unique
    ON erp5.employees (source_system, source_id)
    WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS employees_department_id_idx
    ON erp5.employees (department_id);

CREATE INDEX IF NOT EXISTS employees_last_first_name_idx
    ON erp5.employees (last_name, first_name);

CREATE INDEX IF NOT EXISTS employees_job_title_idx
    ON erp5.employees (job_title);

DROP TRIGGER IF EXISTS employees_set_updated_at ON erp5.employees;
CREATE TRIGGER employees_set_updated_at
    BEFORE UPDATE ON erp5.employees
    FOR EACH ROW EXECUTE FUNCTION erp5.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Table: erp5.leave (Leave Records)
-- FR-ERP5-04: employee link, date range, type, status
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp5.leave (
    id                  UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id         UUID                     NOT NULL
                            REFERENCES erp5.employees(id) ON DELETE CASCADE,
    date_from           DATE                     NOT NULL,
    date_to             DATE                     NOT NULL,
    type                erp5.leave_type          NOT NULL,
    status              erp5.leave_status        NOT NULL DEFAULT 'pending',
    created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),

    -- DB-enforced: leave end date can never precede the start date
    CONSTRAINT leave_date_range_valid
        CHECK (date_to >= date_from)
);

CREATE INDEX IF NOT EXISTS leave_employee_id_idx
    ON erp5.leave (employee_id);

CREATE INDEX IF NOT EXISTS leave_status_date_from_idx
    ON erp5.leave (status, date_from);

DROP TRIGGER IF EXISTS leave_set_updated_at ON erp5.leave;
CREATE TRIGGER leave_set_updated_at
    BEFORE UPDATE ON erp5.leave
    FOR EACH ROW EXECUTE FUNCTION erp5.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Table: erp5.payroll_totals (Department / Month Aggregates)
-- FR-ERP5-06: one aggregate per department per month, no personal data
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp5.payroll_totals (
    id                  UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id       UUID                     NOT NULL
                            REFERENCES erp5.departments(id) ON DELETE RESTRICT,
    month               VARCHAR(7)               NOT NULL,
    total_amount        NUMERIC(20,4)            NOT NULL,
    currency_code       VARCHAR(3)               NOT NULL DEFAULT 'INR',
    headcount           INTEGER                  NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),

    -- One aggregate per department per month
    CONSTRAINT payroll_totals_department_month_unique UNIQUE (department_id, month),

    -- DB-enforced: month label must be YYYY-MM with a valid month number
    CONSTRAINT payroll_totals_month_format_valid
        CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),

    -- DB-enforced: aggregate amount and headcount are never negative
    CONSTRAINT payroll_totals_total_non_negative
        CHECK (total_amount >= 0),

    CONSTRAINT payroll_totals_headcount_non_negative
        CHECK (headcount >= 0)
);

CREATE INDEX IF NOT EXISTS payroll_totals_month_idx
    ON erp5.payroll_totals (month);

DROP TRIGGER IF EXISTS payroll_totals_set_updated_at ON erp5.payroll_totals;
CREATE TRIGGER payroll_totals_set_updated_at
    BEFORE UPDATE ON erp5.payroll_totals
    FOR EACH ROW EXECUTE FUNCTION erp5.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Table: erp5.import_receipts (Idempotency & Migration Audit Receipts)
-- Master Architecture Spec §6.1 (slot 01) / KIT-08
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp5.import_receipts (
    id                  UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id            UUID           NOT NULL,
    source_row          INTEGER        NOT NULL,
    entity              VARCHAR(64)    NOT NULL,
    schema_version      INTEGER        NOT NULL DEFAULT 1,
    idempotency_key     VARCHAR(128)   NOT NULL,
    target_id           UUID           NOT NULL,
    kind                VARCHAR(16)    NOT NULL DEFAULT 'created',
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),

    CONSTRAINT import_receipts_idempotency_key_unique
        UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS import_receipts_batch_row_idx
    ON erp5.import_receipts (batch_id, source_row);

-- ────────────────────────────────────────────────────────────────────────────
-- 9. View: erp5.identity_users (READ-ONLY Hub Identity projection)
--
-- Master Architecture Spec (C3): "erp5_users is a read-only projection/view".
-- HR does not own users, does not store credentials and does not grant
-- application roles.  The view exposes identity attributes only:
--   id, username, roles, employee_ref, status
-- No password / hash / token / refresh-token column is exposed.
--
-- The view is created only when `platform.hub_users` exists, so a clean
-- database migration succeeds while PLT-05 (Hub Identity) is still open.
-- Write privileges are revoked from PUBLIC: the projection is read-only for
-- every application role.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF to_regclass('platform.hub_users') IS NOT NULL THEN
        EXECUTE 'DROP VIEW IF EXISTS erp5.identity_users';
        EXECUTE $view$
            CREATE VIEW erp5.identity_users AS
            SELECT u.id,
                   u.username,
                   u.roles,
                   u.employee_ref,
                   u.status
            FROM platform.hub_users u
        $view$;
        EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON erp5.identity_users FROM PUBLIC';

        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
            EXECUTE 'GRANT SELECT ON erp5.identity_users TO app';
        END IF;

        RAISE NOTICE 'erp5.identity_users read-only Hub Identity projection created.';
    ELSE
        RAISE NOTICE 'platform.hub_users absent — erp5.identity_users view skipped (PLT-05 pending).';
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. Record migration as applied (idempotency guard)
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.schema_migrations (migration)
VALUES ('erp5_v1')
ON CONFLICT (migration) DO NOTHING;

COMMIT;
