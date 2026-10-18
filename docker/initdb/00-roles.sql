-- ClearShift V1 Database Roles and Schema Bootstrap (PLT-03 / Decision M8)
-- Enforces clean schema isolation and role boundaries

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Create Core Schemas
CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS kit;
CREATE SCHEMA IF NOT EXISTS crm1;
CREATE SCHEMA IF NOT EXISTS crm2;
CREATE SCHEMA IF NOT EXISTS crm3;
CREATE SCHEMA IF NOT EXISTS crm4;
CREATE SCHEMA IF NOT EXISTS crm5;
CREATE SCHEMA IF NOT EXISTS erp1;
CREATE SCHEMA IF NOT EXISTS erp2;
CREATE SCHEMA IF NOT EXISTS erp3;
CREATE SCHEMA IF NOT EXISTS erp4;
CREATE SCHEMA IF NOT EXISTS erp5;

-- 2. Create the 4 Standard DB Roles (Decision M8 / Section 4.7)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'migrator') THEN
    CREATE ROLE migrator WITH NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app') THEN
    CREATE ROLE app WITH NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_append') THEN
    CREATE ROLE audit_append WITH NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'reports_ro') THEN
    CREATE ROLE reports_ro WITH NOLOGIN;
  END IF;
END $$;

-- 3. Schema Usage Grants
GRANT USAGE, CREATE ON SCHEMA platform, kit, crm1, crm2, crm3, crm4, crm5, erp1, erp2, erp3, erp4, erp5 TO migrator;
GRANT USAGE ON SCHEMA platform, kit, crm1, crm2, crm3, crm4, crm5, erp1, erp2, erp3, erp4, erp5 TO app;
GRANT USAGE ON SCHEMA platform TO audit_append;
GRANT USAGE ON SCHEMA platform, kit, crm5 TO reports_ro;

-- 4. Default Privileges for Tables created by Migrator
ALTER DEFAULT PRIVILEGES IN SCHEMA platform, kit, crm1, crm2, crm3, crm4, crm5, erp1, erp2, erp3, erp4, erp5
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;

ALTER DEFAULT PRIVILEGES IN SCHEMA platform, kit, crm1, crm2, crm3, crm4, crm5, erp1, erp2, erp3, erp4, erp5
  GRANT USAGE, SELECT ON SEQUENCES TO app;

ALTER DEFAULT PRIVILEGES IN SCHEMA platform
  GRANT INSERT ON TABLES TO audit_append;

ALTER DEFAULT PRIVILEGES IN SCHEMA platform, kit, crm5
  GRANT SELECT ON TABLES TO reports_ro;

-- 5. Immutability Protections (Section 4.4 & 4.7)
-- Raw staging rows (C5) and audit trail must be strictly append-only
CREATE TABLE IF NOT EXISTS platform.audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id UUID,
  diff_redacted JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kit.raw_rows (
  batch_id UUID NOT NULL,
  source_row INT NOT NULL,
  payload JSONB NOT NULL,
  row_hash TEXT NOT NULL,
  PRIMARY KEY (batch_id, source_row)
);

-- Revoke mutation rights on immutable tables from app role
REVOKE UPDATE, DELETE, TRUNCATE ON platform.audit FROM app;
REVOKE UPDATE, DELETE, TRUNCATE ON kit.raw_rows FROM app;
GRANT INSERT ON platform.audit TO audit_append;

-- 6. Create Default Application Users for Local Development
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cs_app') THEN
    CREATE USER cs_app WITH PASSWORD 'app_secret_123';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cs_migrator') THEN
    CREATE USER cs_migrator WITH PASSWORD 'migrator_secret_123';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cs_reports') THEN
    CREATE USER cs_reports WITH PASSWORD 'reports_secret_123';
  END IF;
END $$;

GRANT app TO cs_app;
GRANT migrator TO cs_migrator;
GRANT reports_ro TO cs_reports;
