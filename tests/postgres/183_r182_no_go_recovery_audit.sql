-- R182: observable isolated restoration and IAM evidence = NO-GO, not approval.
-- Safe only in disposable PostgreSQL17 started by MARCOSA CI.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres' OR
  to_regclass('r181_ci.observations') IS NULL OR
  to_regclass('r181_ci.observation_audit') IS NULL OR
  to_regclass('r180_ci.holds') IS NULL THEN
   RAISE EXCEPTION 'R182 requires disposable PG17 audited R181 and R180 NO-GO';
 END IF;
END $$;
CREATE SCHEMA r182_ci;
REVOKE ALL ON SCHEMA r182_ci FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='marcosa_r182_writer') THEN
  CREATE ROLE marcosa_r182_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA r182_ci,r181_ci,r180_ci TO marcosa_r182_writer;
GRANT SELECT ON r181_ci.observations,r181_ci.observation_audit,
 r180_ci.holds TO marcosa_r182_writer;
CREATE POLICY r182_r181_read ON r181_ci.observations FOR SELECT
 TO marcosa_r182_writer USING(production_authorized=false);
CREATE POLICY r182_r181_audit_read ON r181_ci.observation_audit FOR SELECT
 TO marcosa_r182_writer USING(true);
CREATE POLICY r182_r180_hold_read ON r180_ci.holds FOR SELECT
 TO marcosa_r182_writer USING(production_authorized=false);
CREATE TABLE r182_ci.recovery_readiness(
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1)
  REFERENCES r181_ci.observations(id),
 run_id bigint NOT NULL UNIQUE CHECK(run_id>=10000),
 sequence bigint NOT NULL CHECK(sequence BETWEEN 2 AND 32),
 nonce char(32) NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{32}$'),
 commit_sha char(40) NOT NULL CHECK(commit_sha ~ '^[a-f0-9]{40}$'),
 r181_evidence_sha256 char(64) NOT NULL CHECK(r181_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 r180_classification_sha256 char(64) NOT NULL CHECK(r180_classification_sha256 ~ '^[a-f0-9]{64}$'),
 r180_quorum_sha256 char(64) NOT NULL CHECK(r180_quorum_sha256 ~ '^[a-f0-9]{64}$'),
 iam_evidence_sha256 char(64) NOT NULL CHECK(iam_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 recovery_drill_sha256 char(64) NOT NULL CHECK(recovery_drill_sha256 ~ '^[a-f0-9]{64}$'),
 evidence_sha256 char(64) NOT NULL UNIQUE CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 source_account_id char(12) NOT NULL CHECK(source_account_id ~ '^[0-9]{12}$'),
 offsite_account_id char(12) NOT NULL CHECK(offsite_account_id ~ '^[0-9]{12}$'),
 isolated_restore_ms integer NOT NULL CHECK(isolated_restore_ms BETWEEN 1 AND 180000),
 source_mode text NOT NULL CHECK(source_mode='CI_SYNTHETIC'),
 decision text NOT NULL CHECK(decision='NO_GO_INDEPENDENT_ATTESTATION_PENDING'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false),
 CHECK(source_account_id<>offsite_account_id)
);
CREATE TABLE r182_ci.readiness_audit(
 id smallint PRIMARY KEY REFERENCES r182_ci.recovery_readiness(id),
 evidence_sha256 char(64) NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL CHECK(decision='NO_GO_INDEPENDENT_ATTESTATION_PENDING'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE r182_ci.recovery_readiness ENABLE ROW LEVEL SECURITY;
ALTER TABLE r182_ci.recovery_readiness FORCE ROW LEVEL SECURITY;
ALTER TABLE r182_ci.readiness_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE r182_ci.readiness_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY r182_evidence_read ON r182_ci.recovery_readiness
 FOR SELECT TO marcosa_r182_writer USING(production_authorized=false);
CREATE POLICY r182_evidence_insert ON r182_ci.recovery_readiness
 FOR INSERT TO marcosa_r182_writer WITH CHECK(production_authorized=false);
CREATE POLICY r182_audit_read ON r182_ci.readiness_audit
 FOR SELECT TO marcosa_r182_writer USING(true);
CREATE POLICY r182_audit_insert ON r182_ci.readiness_audit
 FOR INSERT TO marcosa_r182_writer WITH CHECK(true);
GRANT SELECT,INSERT ON r182_ci.recovery_readiness,r182_ci.readiness_audit
 TO marcosa_r182_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA r182_ci FROM
 PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF has_table_privilege('authenticated','r182_ci.recovery_readiness','SELECT') OR
  has_table_privilege('marcosa_r182_writer','r181_ci.observations','UPDATE') OR
  has_table_privilege('marcosa_r182_writer','r180_ci.holds','UPDATE') OR
  has_table_privilege('marcosa_r182_writer','r182_ci.recovery_readiness','UPDATE') OR
  has_table_privilege('marcosa_r182_writer','r182_ci.readiness_audit','DELETE') THEN
  RAISE EXCEPTION 'R182 append-only cross-generation privilege boundary weakened';
 END IF;
END $$;
COMMIT;
SELECT 'R182_NATIVE_PG17_NO_GO_IAM_RTO_AUDIT_RLS=PASS';
