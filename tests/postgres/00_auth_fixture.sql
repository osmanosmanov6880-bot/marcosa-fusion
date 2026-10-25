-- Ephemeral PostgreSQL 17 CI only. NOT Supabase Auth.
-- Simulates three different JWT identities via a transaction-local GUC.
\set ON_ERROR_STOP on
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY,
 raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
 raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
 SET search_path = '' AS $$
 SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid
 $$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
