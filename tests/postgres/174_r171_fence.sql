-- R171 isolated disposable PostgreSQL 17 fencing experiment ONLY.
-- Apply exclusively after tests/postgres/173_r167_synthetic_source.sql.
-- Never install this synthetic fixture in real Supabase/production.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
 IF current_database()<>'postgres' THEN
  RAISE EXCEPTION 'R171 refuses non-disposable PostgreSQL';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='marcosa_r171_writer') THEN
  CREATE ROLE marcosa_r171_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
CREATE SCHEMA r171_ci;
REVOKE ALL ON SCHEMA r171_ci FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
GRANT USAGE ON SCHEMA r171_ci TO marcosa_r171_writer;

CREATE TABLE r171_ci.fenced_runs (
 nonce text PRIMARY KEY CHECK(nonce ~ '^[a-f0-9]{32}$'),
 source_commit text NOT NULL CHECK(source_commit ~ '^[a-f0-9]{40}$'),
 archive_sha256 text NOT NULL CHECK(archive_sha256 ~ '^[a-f0-9]{64}$'),
 reviewer_digest text NOT NULL CHECK(reviewer_digest ~ '^[a-f0-9]{64}$'),
 role_arn text NOT NULL CHECK(
  role_arn ~ '^arn:aws:iam::[0-9]{12}:role/marcosa-staging-backup-role$'),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE r171_ci.fenced_audit (
 nonce text PRIMARY KEY REFERENCES r171_ci.fenced_runs(nonce),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 category text NOT NULL DEFAULT 'readonly-staging'
  CHECK(category='readonly-staging'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE r171_ci.fenced_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE r171_ci.fenced_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE r171_ci.fenced_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE r171_ci.fenced_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA r171_ci FROM
 PUBLIC,anon,authenticated,marcosa_r167_reader;
GRANT SELECT,INSERT ON r171_ci.fenced_runs TO marcosa_r171_writer;
GRANT SELECT,INSERT ON r171_ci.fenced_audit TO marcosa_r171_writer;
CREATE POLICY r171_writer_view ON r171_ci.fenced_runs
 FOR SELECT TO marcosa_r171_writer USING (production_authorized=false);
CREATE POLICY r171_writer_insert ON r171_ci.fenced_runs
 FOR INSERT TO marcosa_r171_writer WITH CHECK(production_authorized=false);
CREATE POLICY r171_writer_audit_view ON r171_ci.fenced_audit
 FOR SELECT TO marcosa_r171_writer USING (category='readonly-staging');
CREATE POLICY r171_writer_audit_insert ON r171_ci.fenced_audit
 FOR INSERT TO marcosa_r171_writer WITH CHECK(category='readonly-staging');
DO $$
BEGIN
 IF has_table_privilege('anon','r171_ci.fenced_runs','SELECT') OR
    has_table_privilege('authenticated','r171_ci.fenced_runs','SELECT') OR
    has_table_privilege('marcosa_r167_reader','r171_ci.fenced_runs','SELECT') OR
    has_table_privilege('marcosa_r171_writer','r171_ci.fenced_runs','UPDATE') OR
    has_table_privilege('marcosa_r171_writer','r171_ci.fenced_runs','DELETE') OR
    has_table_privilege('marcosa_r171_writer','r171_ci.fenced_audit','DELETE')
 THEN RAISE EXCEPTION 'R171 writer/RLS role fencing violation'; END IF;
END $$;
COMMIT;
SELECT 'R171_DISPOSABLE_PG17_FENCED_ONE_TIME_RUNS_RLS=PASS';
