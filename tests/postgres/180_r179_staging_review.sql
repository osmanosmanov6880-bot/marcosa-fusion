-- R179: append-only GitHub approvals and S3 replication status evidence.
-- Disposable PG17 fixtures only, never live Supabase/production.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres' OR
  to_regclass('r178_ci.staging_evidence') IS NULL THEN
  RAISE EXCEPTION 'R179 requires disposable PG17 and R178 audited staging evidence';
 END IF;
END $$;
CREATE SCHEMA r179_ci;
REVOKE ALL ON SCHEMA r179_ci FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='marcosa_r179_writer') THEN
  CREATE ROLE marcosa_r179_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA r179_ci,r178_ci,r177_ci TO marcosa_r179_writer;
GRANT SELECT ON r178_ci.staging_evidence,r178_ci.staging_audit,
 r177_ci.outcomes TO marcosa_r179_writer;
CREATE POLICY r179_r178_evidence_reader ON r178_ci.staging_evidence
 FOR SELECT TO marcosa_r179_writer USING(production_authorized=false);
CREATE POLICY r179_r178_audit_reader ON r178_ci.staging_audit
 FOR SELECT TO marcosa_r179_writer USING(true);
CREATE POLICY r179_r177_outcome_reader ON r177_ci.outcomes
 FOR SELECT TO marcosa_r179_writer USING(production_authorized=false);
CREATE TABLE r179_ci.review_evidence(
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1)
  REFERENCES r178_ci.staging_evidence(id),
 run_id bigint NOT NULL UNIQUE CHECK(run_id>=10000),
 actor_id bigint NOT NULL CHECK(actor_id>0),
 sequence bigint NOT NULL CHECK(sequence BETWEEN 2 AND 32),
 nonce char(32) NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{32}$'),
 commit_sha char(40) NOT NULL CHECK(commit_sha ~ '^[a-f0-9]{40}$'),
 history_root_sha256 char(64) NOT NULL CHECK(history_root_sha256 ~ '^[a-f0-9]{64}$'),
 archive_sha256 char(64) NOT NULL CHECK(archive_sha256 ~ '^[a-f0-9]{64}$'),
 restored_state_sha256 char(64) NOT NULL CHECK(restored_state_sha256 ~ '^[a-f0-9]{64}$'),
 probe_sha256 char(64) NOT NULL CHECK(probe_sha256 ~ '^[a-f0-9]{64}$'),
 source_account_id char(12) NOT NULL CHECK(source_account_id ~ '^[0-9]{12}$'),
 offsite_account_id char(12) NOT NULL CHECK(offsite_account_id ~ '^[0-9]{12}$'),
 r178_evidence_sha256 char(64) NOT NULL CHECK(r178_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 github_evidence_sha256 char(64) NOT NULL CHECK(github_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 replica_evidence_sha256 char(64) NOT NULL CHECK(replica_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 evidence_sha256 char(64) NOT NULL UNIQUE CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL DEFAULT 'CI_SIMULATED_REVIEW_ONLY'
  CHECK(decision='CI_SIMULATED_REVIEW_ONLY'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false),
 CHECK(source_account_id<>offsite_account_id)
);
CREATE TABLE r179_ci.review_audit(
 id smallint PRIMARY KEY REFERENCES r179_ci.review_evidence(id),
 evidence_sha256 char(64) NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE r179_ci.review_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE r179_ci.review_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE r179_ci.review_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE r179_ci.review_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY r179_evidence_read ON r179_ci.review_evidence
 FOR SELECT TO marcosa_r179_writer USING(production_authorized=false);
CREATE POLICY r179_evidence_insert ON r179_ci.review_evidence
 FOR INSERT TO marcosa_r179_writer WITH CHECK(production_authorized=false);
CREATE POLICY r179_audit_read ON r179_ci.review_audit
 FOR SELECT TO marcosa_r179_writer USING(true);
CREATE POLICY r179_audit_insert ON r179_ci.review_audit
 FOR INSERT TO marcosa_r179_writer WITH CHECK(true);
GRANT SELECT,INSERT ON r179_ci.review_evidence,r179_ci.review_audit
 TO marcosa_r179_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA r179_ci FROM
 PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF has_table_privilege('authenticated','r179_ci.review_evidence','SELECT') OR
  has_table_privilege('marcosa_r179_writer','r178_ci.staging_evidence','UPDATE') OR
  has_table_privilege('marcosa_r179_writer','r177_ci.outcomes','INSERT') OR
  has_table_privilege('marcosa_r179_writer','r179_ci.review_evidence','UPDATE') OR
  has_table_privilege('marcosa_r179_writer','r179_ci.review_audit','DELETE') THEN
   RAISE EXCEPTION 'R179 append-only read/insert security boundary violated';
 END IF;
END $$;
COMMIT;
SELECT 'R179_NATIVE_PG17_APPROVAL_REPLICA_REVIEW_RLS=PASS';
