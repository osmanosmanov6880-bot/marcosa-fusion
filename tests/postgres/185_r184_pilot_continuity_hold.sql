-- R184: disposable 8+24 WAL continuity events and immutable pilot NO-GO.
-- SQL never grants production/staging write permissions.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres' OR
  to_regclass('r183_ci.pilot_holds') IS NULL OR
  to_regclass('r183_ci.pilot_audit') IS NULL OR
  to_regclass('r183_ci.synthetic_delta_markers') IS NULL THEN
   RAISE EXCEPTION 'R184 requires disposable real PG17 and completed R183 immutable NO-GO';
 END IF;
END $$;
CREATE SCHEMA r184_ci;
REVOKE ALL ON SCHEMA r184_ci FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='marcosa_r184_writer') THEN
  CREATE ROLE marcosa_r184_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA r184_ci,r183_ci TO marcosa_r184_writer;
GRANT SELECT ON r183_ci.pilot_holds,r183_ci.pilot_audit TO marcosa_r184_writer;
CREATE POLICY r184_prior_read ON r183_ci.pilot_holds
 FOR SELECT TO marcosa_r184_writer USING(production_authorized=false);
CREATE POLICY r184_prior_audit_read ON r183_ci.pilot_audit
 FOR SELECT TO marcosa_r184_writer USING(true);
CREATE TABLE r184_ci.synthetic_continuity_events(
 ordinal smallint PRIMARY KEY CHECK(ordinal BETWEEN 1 AND 32),
 phase text NOT NULL CHECK(phase IN('BASELINE','AFTER_SNAPSHOT')),
 event_sha256 char(64) NOT NULL UNIQUE CHECK(event_sha256 ~ '^[a-f0-9]{64}$'),
 commit_sha char(40) NOT NULL CHECK(commit_sha ~ '^[a-f0-9]{40}$'),
 run_id bigint NOT NULL CHECK(run_id>=10000),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false),
 CHECK((ordinal<=8 AND phase='BASELINE') OR
  (ordinal>=9 AND phase='AFTER_SNAPSHOT'))
);
ALTER TABLE r184_ci.synthetic_continuity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE r184_ci.synthetic_continuity_events FORCE ROW LEVEL SECURITY;
CREATE POLICY r184_continuity_read ON r184_ci.synthetic_continuity_events
 FOR SELECT TO marcosa_r184_writer USING(production_authorized=false);
GRANT SELECT ON r184_ci.synthetic_continuity_events TO marcosa_r184_writer;
REVOKE ALL ON r184_ci.synthetic_continuity_events
 FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
CREATE TABLE r184_ci.pilot_holds(
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1)
  REFERENCES r183_ci.pilot_holds(id),
 run_id bigint NOT NULL UNIQUE CHECK(run_id>=10000),
 sequence bigint NOT NULL CHECK(sequence BETWEEN 2 AND 32),
 nonce char(32) NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{32}$'),
 commit_sha char(40) NOT NULL CHECK(commit_sha ~ '^[a-f0-9]{40}$'),
 r183_evidence_sha256 char(64) NOT NULL CHECK(r183_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 review_history_sha256 char(64) NOT NULL CHECK(review_history_sha256 ~ '^[a-f0-9]{64}$'),
 iam_deny_sha256 char(64) NOT NULL CHECK(iam_deny_sha256 ~ '^[a-f0-9]{64}$'),
 continuity_sha256 char(64) NOT NULL CHECK(continuity_sha256 ~ '^[a-f0-9]{64}$'),
 evidence_sha256 char(64) NOT NULL UNIQUE CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 source_account_id char(12) NOT NULL CHECK(source_account_id ~ '^[0-9]{12}$'),
 offsite_account_id char(12) NOT NULL CHECK(offsite_account_id ~ '^[0-9]{12}$'),
 intentionally_missing_events smallint NOT NULL CHECK(intentionally_missing_events=24),
 measured_restore_ms integer NOT NULL CHECK(measured_restore_ms BETWEEN 1 AND 180000),
 source_mode text NOT NULL CHECK(source_mode='CI_SYNTHETIC'),
 decision text NOT NULL CHECK(decision='NO_GO_REAL_STAGING_EVIDENCE_PENDING'),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(source_account_id<>offsite_account_id)
);
CREATE TABLE r184_ci.pilot_audit(
 id smallint PRIMARY KEY REFERENCES r184_ci.pilot_holds(id),
 evidence_sha256 char(64) NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL CHECK(decision='NO_GO_REAL_STAGING_EVIDENCE_PENDING'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE r184_ci.pilot_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE r184_ci.pilot_holds FORCE ROW LEVEL SECURITY;
ALTER TABLE r184_ci.pilot_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE r184_ci.pilot_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY r184_hold_read ON r184_ci.pilot_holds FOR SELECT
 TO marcosa_r184_writer USING(production_authorized=false);
CREATE POLICY r184_hold_insert ON r184_ci.pilot_holds FOR INSERT
 TO marcosa_r184_writer WITH CHECK(production_authorized=false);
CREATE POLICY r184_audit_read ON r184_ci.pilot_audit FOR SELECT
 TO marcosa_r184_writer USING(true);
CREATE POLICY r184_audit_insert ON r184_ci.pilot_audit FOR INSERT
 TO marcosa_r184_writer WITH CHECK(true);
GRANT SELECT,INSERT ON r184_ci.pilot_holds,r184_ci.pilot_audit
 TO marcosa_r184_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA r184_ci
 FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF has_table_privilege('authenticated','r184_ci.pilot_holds','SELECT') OR
  has_table_privilege('authenticated','r184_ci.synthetic_continuity_events','SELECT') OR
  has_table_privilege('marcosa_r184_writer','r184_ci.synthetic_continuity_events','INSERT') OR
  has_table_privilege('marcosa_r184_writer','r183_ci.pilot_holds','UPDATE') OR
  has_table_privilege('marcosa_r184_writer','r184_ci.pilot_holds','UPDATE') OR
  has_table_privilege('marcosa_r184_writer','r184_ci.pilot_audit','DELETE') THEN
   RAISE EXCEPTION 'R184 real PG17 synthetic-data/NO-GO role boundary weakened';
 END IF;
END $$;
COMMIT;
SELECT 'R184_REAL_DISPOSABLE_PG17_CONTINUITY_SCHEMA_RLS=PASS';
