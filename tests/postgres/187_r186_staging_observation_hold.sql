-- R186 disposable PostgreSQL17 staging observation, not staging admission.
-- One write-once source-bound NO-GO with a second append-only audit.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres' OR
  to_regclass('r185_ci.readiness_holds') IS NULL OR
  to_regclass('r185_ci.readiness_audit') IS NULL THEN
   RAISE EXCEPTION 'R186 requires disposable PG17 immutable R185 predecessor';
 END IF;
END $$;
CREATE SCHEMA r186_ci;
REVOKE ALL ON SCHEMA r186_ci FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='marcosa_r186_writer') THEN
  CREATE ROLE marcosa_r186_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA r186_ci,r185_ci TO marcosa_r186_writer;
GRANT SELECT ON r185_ci.readiness_holds,r185_ci.readiness_audit TO marcosa_r186_writer;
CREATE POLICY r186_read_prior ON r185_ci.readiness_holds
 FOR SELECT TO marcosa_r186_writer USING(production_authorized=false);
CREATE POLICY r186_read_prior_audit ON r185_ci.readiness_audit
 FOR SELECT TO marcosa_r186_writer USING(true);
CREATE TABLE r186_ci.staging_observation_holds(
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1)
  REFERENCES r185_ci.readiness_holds(id),
 run_id bigint NOT NULL UNIQUE CHECK(run_id>=10000),
 sequence bigint NOT NULL CHECK(sequence BETWEEN 2 AND 32),
 nonce char(32) NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{32}$'),
 commit_sha char(40) NOT NULL CHECK(commit_sha ~ '^[a-f0-9]{40}$'),
 r185_sha256 char(64) NOT NULL CHECK(r185_sha256 ~ '^[a-f0-9]{64}$'),
 github_sha256 char(64) NOT NULL CHECK(github_sha256 ~ '^[a-f0-9]{64}$'),
 https_sha256 char(64) NOT NULL CHECK(https_sha256 ~ '^[a-f0-9]{64}$'),
 evidence_sha256 char(64) NOT NULL UNIQUE CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 staging_hostname text NOT NULL CHECK(staging_hostname ~ '^staging\.[a-z0-9.-]{4,170}$'),
 observed_pr_approvals smallint NOT NULL CHECK(observed_pr_approvals BETWEEN 0 AND 400),
 environment_rule_observed boolean NOT NULL,
 http_health_passed boolean NOT NULL,
 hard_blocking_checks smallint NOT NULL CHECK(hard_blocking_checks=5),
 source_mode text NOT NULL CHECK(source_mode='CI_SYNTHETIC'),
 decision text NOT NULL CHECK(decision='NO_GO_INDEPENDENT_STAGING_EVIDENCE_PENDING'),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE r186_ci.staging_observation_audit(
 id smallint PRIMARY KEY REFERENCES r186_ci.staging_observation_holds(id),
 evidence_sha256 char(64) NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL CHECK(decision='NO_GO_INDEPENDENT_STAGING_EVIDENCE_PENDING'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE r186_ci.staging_observation_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE r186_ci.staging_observation_holds FORCE ROW LEVEL SECURITY;
ALTER TABLE r186_ci.staging_observation_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE r186_ci.staging_observation_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY r186_select_hold ON r186_ci.staging_observation_holds
 FOR SELECT TO marcosa_r186_writer USING(production_authorized=false);
CREATE POLICY r186_insert_hold ON r186_ci.staging_observation_holds
 FOR INSERT TO marcosa_r186_writer WITH CHECK(production_authorized=false);
CREATE POLICY r186_select_audit ON r186_ci.staging_observation_audit
 FOR SELECT TO marcosa_r186_writer USING(true);
CREATE POLICY r186_insert_audit ON r186_ci.staging_observation_audit
 FOR INSERT TO marcosa_r186_writer WITH CHECK(true);
GRANT SELECT,INSERT ON r186_ci.staging_observation_holds,
 r186_ci.staging_observation_audit TO marcosa_r186_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA r186_ci
 FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF has_table_privilege('authenticated','r186_ci.staging_observation_holds','SELECT') OR
  has_table_privilege('authenticated','r186_ci.staging_observation_audit','SELECT') OR
  has_table_privilege('marcosa_r186_writer','r185_ci.readiness_holds','UPDATE') OR
  has_table_privilege('marcosa_r186_writer','r186_ci.staging_observation_holds','UPDATE') OR
  has_table_privilege('marcosa_r186_writer','r186_ci.staging_observation_audit','DELETE') THEN
   RAISE EXCEPTION 'R186 PG17 immutable NO-GO and privacy boundary weakened';
 END IF;
END $$;
COMMIT;
SELECT 'R186_NATIVE_PG17_STAGING_OBSERVATION_RLS=PASS';
