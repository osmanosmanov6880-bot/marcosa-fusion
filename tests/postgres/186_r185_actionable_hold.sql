-- R185 disposable native PG17. Durable one-use evidence of staging blockers.
-- No production data, no staging write access, no release/GO statements.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres' OR
  to_regclass('r184_ci.pilot_holds') IS NULL OR
  to_regclass('r184_ci.pilot_audit') IS NULL THEN
  RAISE EXCEPTION 'R185 requires real disposable PG17 R184 NO-GO predecessor';
 END IF;
END $$;
CREATE SCHEMA r185_ci;
REVOKE ALL ON SCHEMA r185_ci FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='marcosa_r185_writer') THEN
  CREATE ROLE marcosa_r185_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA r185_ci,r184_ci TO marcosa_r185_writer;
GRANT SELECT ON r184_ci.pilot_holds,r184_ci.pilot_audit TO marcosa_r185_writer;
CREATE POLICY r185_prior_read ON r184_ci.pilot_holds
 FOR SELECT TO marcosa_r185_writer USING(production_authorized=false);
CREATE POLICY r185_prior_audit_read ON r184_ci.pilot_audit
 FOR SELECT TO marcosa_r185_writer USING(true);
CREATE TABLE r185_ci.readiness_holds(
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1)
 REFERENCES r184_ci.pilot_holds(id),
 run_id bigint NOT NULL UNIQUE CHECK(run_id>=10000),
 sequence bigint NOT NULL CHECK(sequence BETWEEN 2 AND 32),
 nonce char(32) NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{32}$'),
 commit_sha char(40) NOT NULL CHECK(commit_sha ~ '^[a-f0-9]{40}$'),
 r184_evidence_sha256 char(64) NOT NULL CHECK(r184_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 intake_sha256 char(64) NOT NULL CHECK(intake_sha256 ~ '^[a-f0-9]{64}$'),
 rehearsal_sha256 char(64) NOT NULL CHECK(rehearsal_sha256 ~ '^[a-f0-9]{64}$'),
 safe_evidence_sha256 char(64) NOT NULL CHECK(safe_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 safe_file_sha256 char(64) NOT NULL CHECK(safe_file_sha256 ~ '^[a-f0-9]{64}$'),
 evidence_sha256 char(64) NOT NULL UNIQUE CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 blocking_count smallint NOT NULL CHECK(blocking_count=5),
 synthetic_canary_windows smallint NOT NULL CHECK(synthetic_canary_windows=4),
 rollback_simulation_verified boolean NOT NULL CHECK(rollback_simulation_verified=true),
 quarantine_closed boolean NOT NULL CHECK(quarantine_closed=true),
 source_mode text NOT NULL CHECK(source_mode='CI_SYNTHETIC'),
 decision text NOT NULL CHECK(decision='NO_GO_STAGING_BLOCKERS_UNRESOLVED'),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE r185_ci.readiness_audit(
 id smallint PRIMARY KEY REFERENCES r185_ci.readiness_holds(id),
 evidence_sha256 char(64) NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL CHECK(decision='NO_GO_STAGING_BLOCKERS_UNRESOLVED'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE r185_ci.readiness_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE r185_ci.readiness_holds FORCE ROW LEVEL SECURITY;
ALTER TABLE r185_ci.readiness_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE r185_ci.readiness_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY r185_hold_read ON r185_ci.readiness_holds FOR SELECT
 TO marcosa_r185_writer USING(production_authorized=false);
CREATE POLICY r185_hold_insert ON r185_ci.readiness_holds FOR INSERT
 TO marcosa_r185_writer WITH CHECK(production_authorized=false);
CREATE POLICY r185_audit_read ON r185_ci.readiness_audit FOR SELECT
 TO marcosa_r185_writer USING(true);
CREATE POLICY r185_audit_insert ON r185_ci.readiness_audit FOR INSERT
 TO marcosa_r185_writer WITH CHECK(true);
GRANT SELECT,INSERT ON r185_ci.readiness_holds,r185_ci.readiness_audit
 TO marcosa_r185_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA r185_ci
 FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF has_table_privilege('authenticated','r185_ci.readiness_holds','SELECT') OR
  has_table_privilege('marcosa_r185_writer','r184_ci.pilot_holds','UPDATE') OR
  has_table_privilege('marcosa_r185_writer','r185_ci.readiness_holds','UPDATE') OR
  has_table_privilege('marcosa_r185_writer','r185_ci.readiness_audit','DELETE') THEN
   RAISE EXCEPTION 'R185 native PG17 NO-GO FORCE RLS boundary weakened';
 END IF;
END $$;
COMMIT;
SELECT 'R185_NATIVE_PG17_ACTIONABLE_HOLD_RLS=PASS';
