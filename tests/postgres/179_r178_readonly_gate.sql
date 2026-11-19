-- R178: native disposable PG17 double-checked read-only staging evidence.
-- This is NOT a migration for production or live Supabase.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres' OR
    to_regclass('r177_ci.roots') IS NULL OR
    to_regclass('r177_ci.outcomes') IS NULL THEN
  RAISE EXCEPTION 'R178 requires disposable postgres and restored R177 evidence';
 END IF;
END $$;
CREATE SCHEMA r178_ci;
REVOKE ALL ON SCHEMA r178_ci FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='marcosa_r178_writer') THEN
  CREATE ROLE marcosa_r178_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA r178_ci,r174_ci,r177_ci TO marcosa_r178_writer;
GRANT SELECT ON r174_ci.checkpoint,
 r177_ci.roots,r177_ci.outcomes TO marcosa_r178_writer;
CREATE POLICY r178_checkpoint_observer ON r174_ci.checkpoint
 FOR SELECT TO marcosa_r178_writer USING(production_authorized=false);
CREATE POLICY r178_root_observer ON r177_ci.roots
 FOR SELECT TO marcosa_r178_writer USING(production_authorized=false);
CREATE POLICY r178_outcome_observer ON r177_ci.outcomes
 FOR SELECT TO marcosa_r178_writer USING(production_authorized=false);
CREATE TABLE r178_ci.staging_evidence(
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1),
 sequence bigint NOT NULL UNIQUE CHECK(sequence BETWEEN 2 AND 32),
 nonce char(32) NOT NULL UNIQUE REFERENCES r177_ci.outcomes(nonce),
 commit_sha char(40) NOT NULL CHECK(commit_sha ~ '^[a-f0-9]{40}$'),
 root_sha256 char(64) NOT NULL CHECK(root_sha256 ~ '^[a-f0-9]{64}$'),
 archive_sha256 char(64) NOT NULL CHECK(archive_sha256 ~ '^[a-f0-9]{64}$'),
 probe_sha256 char(64) NOT NULL CHECK(probe_sha256 ~ '^[a-f0-9]{64}$'),
 restored_state_sha256 char(64) NOT NULL CHECK(restored_state_sha256 ~ '^[a-f0-9]{64}$'),
 source_account_id char(12) NOT NULL CHECK(source_account_id ~ '^[0-9]{12}$'),
 offsite_account_id char(12) NOT NULL CHECK(offsite_account_id ~ '^[0-9]{12}$'),
 identity_sha256 char(64) NOT NULL CHECK(identity_sha256 ~ '^[a-f0-9]{64}$'),
 iam_plan_sha256 char(64) NOT NULL CHECK(iam_plan_sha256 ~ '^[a-f0-9]{64}$'),
 replica_sha256 char(64) NOT NULL CHECK(replica_sha256 ~ '^[a-f0-9]{64}$'),
 evidence_sha256 char(64) NOT NULL UNIQUE CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL DEFAULT 'CI_SIMULATION_COMPLETE'
  CHECK(decision='CI_SIMULATION_COMPLETE'),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false),
 CHECK(source_account_id<>offsite_account_id)
);
CREATE TABLE r178_ci.staging_audit(
 id smallint PRIMARY KEY REFERENCES r178_ci.staging_evidence(id),
 evidence_sha256 char(64) NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 audited_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE r178_ci.staging_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE r178_ci.staging_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE r178_ci.staging_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE r178_ci.staging_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY r178_evidence_read ON r178_ci.staging_evidence
 FOR SELECT TO marcosa_r178_writer USING(production_authorized=false);
CREATE POLICY r178_evidence_append ON r178_ci.staging_evidence
 FOR INSERT TO marcosa_r178_writer WITH CHECK(production_authorized=false);
CREATE POLICY r178_audit_read ON r178_ci.staging_audit
 FOR SELECT TO marcosa_r178_writer USING(true);
CREATE POLICY r178_audit_append ON r178_ci.staging_audit
 FOR INSERT TO marcosa_r178_writer WITH CHECK(true);
GRANT SELECT,INSERT ON r178_ci.staging_evidence,
 r178_ci.staging_audit TO marcosa_r178_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA r178_ci FROM
 PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF has_table_privilege('authenticated','r178_ci.staging_evidence','SELECT') OR
    has_table_privilege('marcosa_r178_writer','r174_ci.checkpoint','UPDATE') OR
    has_table_privilege('marcosa_r178_writer','r177_ci.outcomes','INSERT') OR
    has_table_privilege('marcosa_r178_writer','r178_ci.staging_evidence','UPDATE') OR
    has_table_privilege('marcosa_r178_writer','r178_ci.staging_audit','DELETE')
 THEN RAISE EXCEPTION 'R178 staging evidence role allowed mutation'; END IF;
END $$;
COMMIT;
SELECT 'R178_NATIVE_PG17_READONLY_STAGING_EVIDENCE_RLS=PASS';
