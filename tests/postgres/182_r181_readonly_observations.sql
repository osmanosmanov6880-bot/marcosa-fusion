-- R181 write-once provider observation != trusted staging deployment approval.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres' OR
  to_regclass('r180_ci.holds') IS NULL OR
  to_regclass('r180_ci.hold_audit') IS NULL THEN
   RAISE EXCEPTION 'R181 requires disposable PG17 and immutable R180 NO-GO';
 END IF;
END $$;
CREATE SCHEMA r181_ci;
REVOKE ALL ON SCHEMA r181_ci FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='marcosa_r181_writer') THEN
  CREATE ROLE marcosa_r181_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA r181_ci,r180_ci TO marcosa_r181_writer;
GRANT SELECT ON r180_ci.holds,r180_ci.hold_audit TO marcosa_r181_writer;
CREATE POLICY r181_read_r180 ON r180_ci.holds
 FOR SELECT TO marcosa_r181_writer USING(production_authorized=false);
CREATE POLICY r181_read_r180_audit ON r180_ci.hold_audit
 FOR SELECT TO marcosa_r181_writer USING(true);
CREATE TABLE r181_ci.observations(
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1)
  REFERENCES r180_ci.holds(id),
 run_id bigint NOT NULL UNIQUE CHECK(run_id>=10000),
 sequence bigint NOT NULL CHECK(sequence BETWEEN 2 AND 32),
 nonce char(32) NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{32}$'),
 commit_sha char(40) NOT NULL CHECK(commit_sha ~ '^[a-f0-9]{40}$'),
 classification_sha256 char(64) NOT NULL CHECK(classification_sha256 ~ '^[a-f0-9]{64}$'),
 quorum_receipt_sha256 char(64) NOT NULL CHECK(quorum_receipt_sha256 ~ '^[a-f0-9]{64}$'),
 history_root_sha256 char(64) NOT NULL CHECK(history_root_sha256 ~ '^[a-f0-9]{64}$'),
 archive_sha256 char(64) NOT NULL CHECK(archive_sha256 ~ '^[a-f0-9]{64}$'),
 source_account_id char(12) NOT NULL CHECK(source_account_id ~ '^[0-9]{12}$'),
 offsite_account_id char(12) NOT NULL CHECK(offsite_account_id ~ '^[0-9]{12}$'),
 github_evidence_sha256 char(64) NOT NULL CHECK(github_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 aws_evidence_sha256 char(64) NOT NULL CHECK(aws_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 evidence_sha256 char(64) NOT NULL UNIQUE CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 source_mode text NOT NULL CHECK(source_mode IN('CI_SYNTHETIC','MANUAL_READONLY')),
 decision text NOT NULL CHECK(decision='NO_GO_PROVIDER_ATTESTATION_PENDING'),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false),
 CHECK(source_account_id<>offsite_account_id)
);
CREATE TABLE r181_ci.observation_audit(
 id smallint PRIMARY KEY REFERENCES r181_ci.observations(id),
 evidence_sha256 char(64) NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL CHECK(decision='NO_GO_PROVIDER_ATTESTATION_PENDING'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE r181_ci.observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE r181_ci.observations FORCE ROW LEVEL SECURITY;
ALTER TABLE r181_ci.observation_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE r181_ci.observation_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY r181_read ON r181_ci.observations FOR SELECT
 TO marcosa_r181_writer USING(production_authorized=false);
CREATE POLICY r181_insert ON r181_ci.observations FOR INSERT
 TO marcosa_r181_writer WITH CHECK(production_authorized=false);
CREATE POLICY r181_audit_read ON r181_ci.observation_audit FOR SELECT
 TO marcosa_r181_writer USING(true);
CREATE POLICY r181_audit_insert ON r181_ci.observation_audit FOR INSERT
 TO marcosa_r181_writer WITH CHECK(true);
GRANT SELECT,INSERT ON r181_ci.observations,r181_ci.observation_audit
 TO marcosa_r181_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA r181_ci
 FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF has_table_privilege('authenticated','r181_ci.observations','SELECT') OR
  has_table_privilege('marcosa_r181_writer','r180_ci.holds','UPDATE') OR
  has_table_privilege('marcosa_r181_writer','r181_ci.observations','UPDATE') OR
  has_table_privilege('marcosa_r181_writer','r181_ci.observation_audit','DELETE') THEN
  RAISE EXCEPTION 'R181 staging observer may not mutate previous evidence';
 END IF;
END $$;
COMMIT;
SELECT 'R181_REAL_PG17_OBSERVATION_NO_GO_APPEND_ONLY=PASS';
