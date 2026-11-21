-- R183: source-bound synthetic staging pilot NO-GO with delta marker table.
-- Can run only on disposable PostgreSQL 17 with existing R182 evidence.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres' OR
  to_regclass('r182_ci.recovery_readiness') IS NULL OR
  to_regclass('r182_ci.readiness_audit') IS NULL THEN
  RAISE EXCEPTION 'R183 requires disposable PG17 and verified R182 no-go';
 END IF;
END $$;
CREATE SCHEMA r183_ci;
REVOKE ALL ON SCHEMA r183_ci FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='marcosa_r183_writer') THEN
  CREATE ROLE marcosa_r183_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA r183_ci,r182_ci TO marcosa_r183_writer;
GRANT SELECT ON r182_ci.recovery_readiness,r182_ci.readiness_audit
 TO marcosa_r183_writer;
CREATE POLICY r183_read_prior_evidence ON r182_ci.recovery_readiness
 FOR SELECT TO marcosa_r183_writer USING(production_authorized=false);
CREATE POLICY r183_read_prior_audit ON r182_ci.readiness_audit
 FOR SELECT TO marcosa_r183_writer USING(true);
-- Disposable synthetic markers written solely by isolated CI's postgres
-- superuser; not by authenticated apps or R183 evidence-writer role.
CREATE TABLE r183_ci.synthetic_delta_markers(
 ordinal smallint PRIMARY KEY CHECK(ordinal IN(1,2)),
 kind text NOT NULL UNIQUE CHECK(kind IN('BASELINE','POST_BACKUP')),
 marker_sha256 char(64) NOT NULL UNIQUE CHECK(marker_sha256 ~ '^[a-f0-9]{64}$'),
 commit_sha char(40) NOT NULL CHECK(commit_sha ~ '^[a-f0-9]{40}$'),
 run_id bigint NOT NULL CHECK(run_id>=10000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false),
 CHECK ((ordinal=1 AND kind='BASELINE') OR
        (ordinal=2 AND kind='POST_BACKUP'))
);
ALTER TABLE r183_ci.synthetic_delta_markers ENABLE ROW LEVEL SECURITY;
ALTER TABLE r183_ci.synthetic_delta_markers FORCE ROW LEVEL SECURITY;
CREATE POLICY r183_markers_read ON r183_ci.synthetic_delta_markers
 FOR SELECT TO marcosa_r183_writer USING(production_authorized=false);
GRANT SELECT ON r183_ci.synthetic_delta_markers TO marcosa_r183_writer;
REVOKE ALL ON r183_ci.synthetic_delta_markers
 FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
CREATE TABLE r183_ci.pilot_holds(
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1)
  REFERENCES r182_ci.recovery_readiness(id),
 run_id bigint NOT NULL UNIQUE CHECK(run_id>=10000),
 sequence bigint NOT NULL CHECK(sequence BETWEEN 2 AND 32),
 nonce char(32) NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{32}$'),
 commit_sha char(40) NOT NULL CHECK(commit_sha ~ '^[a-f0-9]{40}$'),
 r182_evidence_sha256 char(64) NOT NULL CHECK(r182_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 boundary_evidence_sha256 char(64) NOT NULL CHECK(boundary_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 pr_review_evidence_sha256 char(64) NOT NULL CHECK(pr_review_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 delta_evidence_sha256 char(64) NOT NULL CHECK(delta_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 evidence_sha256 char(64) NOT NULL UNIQUE CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 source_account_id char(12) NOT NULL CHECK(source_account_id ~ '^[0-9]{12}$'),
 offsite_account_id char(12) NOT NULL CHECK(offsite_account_id ~ '^[0-9]{12}$'),
 synthetic_lost_delta_events smallint NOT NULL CHECK(synthetic_lost_delta_events=1),
 isolated_restore_ms integer NOT NULL CHECK(isolated_restore_ms BETWEEN 1 AND 180000),
 source_mode text NOT NULL CHECK(source_mode='CI_SYNTHETIC'),
 decision text NOT NULL CHECK(decision='NO_GO_REAL_PILOT_EVIDENCE_PENDING'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false),
 CHECK(source_account_id<>offsite_account_id)
);
CREATE TABLE r183_ci.pilot_audit(
 id smallint PRIMARY KEY REFERENCES r183_ci.pilot_holds(id),
 evidence_sha256 char(64) NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL CHECK(decision='NO_GO_REAL_PILOT_EVIDENCE_PENDING'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE r183_ci.pilot_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE r183_ci.pilot_holds FORCE ROW LEVEL SECURITY;
ALTER TABLE r183_ci.pilot_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE r183_ci.pilot_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY r183_pilot_read ON r183_ci.pilot_holds FOR SELECT
 TO marcosa_r183_writer USING(production_authorized=false);
CREATE POLICY r183_pilot_insert ON r183_ci.pilot_holds FOR INSERT
 TO marcosa_r183_writer WITH CHECK(production_authorized=false);
CREATE POLICY r183_pilot_audit_read ON r183_ci.pilot_audit FOR SELECT
 TO marcosa_r183_writer USING(true);
CREATE POLICY r183_pilot_audit_insert ON r183_ci.pilot_audit FOR INSERT
 TO marcosa_r183_writer WITH CHECK(true);
GRANT SELECT,INSERT ON r183_ci.pilot_holds,r183_ci.pilot_audit
 TO marcosa_r183_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA r183_ci
 FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF has_table_privilege('authenticated','r183_ci.pilot_holds','SELECT') OR
  has_table_privilege('authenticated','r183_ci.synthetic_delta_markers','SELECT') OR
  has_table_privilege('marcosa_r183_writer','r183_ci.synthetic_delta_markers','INSERT') OR
  has_table_privilege('marcosa_r183_writer','r182_ci.recovery_readiness','UPDATE') OR
  has_table_privilege('marcosa_r183_writer','r183_ci.pilot_holds','UPDATE') OR
  has_table_privilege('marcosa_r183_writer','r183_ci.pilot_audit','DELETE') THEN
  RAISE EXCEPTION 'R183 source-bound NO-GO and synthetic delta role boundary weakened';
 END IF;
END $$;
COMMIT;
SELECT 'R183_NATIVE_PG17_DELTA_NO_GO_APPEND_ONLY_RLS=PASS';
