-- R159: review-only server-side Supabase auth.sessions lookup contract.
-- This file is executed only in disposable PostgreSQL 17 GitHub CI.
-- Production application MUST review Supabase project Auth schema and grants
-- with the DB owner; do not auto-apply this to managed auth.sessions.
BEGIN;
CREATE ROLE marcosa_r159_auth_reader NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA auth TO marcosa_r159_auth_reader;
GRANT SELECT (id,user_id) ON auth.sessions TO marcosa_r159_auth_reader;
-- The disposable test fixture adds the read-only RLS policy separately.
-- Actual managed auth.sessions policies must be reviewed by Supabase operator.
REVOKE ALL ON auth.sessions FROM PUBLIC,anon,authenticated;
COMMENT ON ROLE marcosa_r159_auth_reader IS
 'R159 disposable CI only. Production requires independently reviewed permissions on managed Supabase Auth.';
COMMIT;
