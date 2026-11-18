-- MARCOSA R158: disposable PostgreSQL 17 session confirmation boundary.
-- Additive after R157. This is NOT the actual Supabase Auth sessions table.
-- Only an independently trusted backend may activate a role with access.
BEGIN;
CREATE ROLE marcosa_r158_session_reader NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA marcosa_private TO marcosa_r158_session_reader;
CREATE TABLE marcosa_private.r158_sessions(
 session_id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(expires_at>created_at)
);
CREATE INDEX r158_sessions_owner_idx ON marcosa_private.r158_sessions(user_id,expires_at DESC);
ALTER TABLE marcosa_private.r158_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marcosa_private.r158_sessions FROM PUBLIC,anon,authenticated,
 marcosa_r156_writer,marcosa_r156_dispatcher;
GRANT SELECT ON marcosa_private.r158_sessions TO marcosa_r158_session_reader;
CREATE POLICY r158_session_checker_read ON marcosa_private.r158_sessions
 FOR SELECT TO marcosa_r158_session_reader USING(true);
COMMENT ON TABLE marcosa_private.r158_sessions IS
 'R158 synthetic stand-in only. Not real Supabase Auth or a production revocation service.';
-- In CI ONLY create a low-privilege LOGIN role outside this reference file:
-- GRANT marcosa_r156_writer TO synthetic_gateway WITH INHERIT FALSE;
-- GRANT marcosa_r158_session_reader TO synthetic_gateway WITH INHERIT FALSE;
COMMIT;
