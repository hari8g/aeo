-- Create local AEO / AVP role for Studio (plain Postgres, no Docker).
-- Run as superuser (usually "postgres") against the default "postgres" database.
--
-- Preferred (Windows PowerShell from repo root):
--   .\deploy\local-postgres\setup.ps1
--
-- Or manually:
--   1) Run this file in psql / pgAdmin (creates role)
--   2) CREATE DATABASE avp OWNER avp;   -- skip if database already exists

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'avp') THEN
    CREATE ROLE avp LOGIN PASSWORD 'avp_dev_password';
  ELSE
    ALTER ROLE avp WITH LOGIN PASSWORD 'avp_dev_password';
  END IF;
END
$$;
