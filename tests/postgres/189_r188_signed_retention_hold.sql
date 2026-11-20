-- R188: two independently checkable NO-GO receipts; no live staging writes.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres' OR
  to_regclass('r187_ci.observation_holds') IS NULL OR
  to_regclass('r187_ci.observation_audit') IS NULL THEN
   RAISE EXCEPTION 'R188 requires native disposable PG17 immutable R187';
 END IF;
END $$;
CREATE SCHEMA r188_ci;
REVOKE ALL ON SCHEMA r188_ci FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='marcosa_r188_writer') THEN
  CREATE ROLE marcosa_r188_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA r188_ci,r187_ci TO marcosa_r188_writer;
GRANT SELECT ON r187_ci.observation_holds,r187_ci.observation_audit
 TO marcosa_r188_writer;
CREATE POLICY r188_read_prior ON r187_ci.observation_holds
 FOR SELECT TO marcosa_r188_writer USING(production_authorized=false);
CREATE POLICY r188_read_prior_audit ON r187_ci.observation_audit
 FOR SELECT TO marcosa_r188_writer USING(true);
CREATE TABLE r188_ci.attested_holds(
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1)
 REFERENCES r187_ci.observation_holds(id),
 run_id bigint NOT NULL UNIQUE CHECK(run_id>=10000),
 sequence bigint NOT NULL CHECK(sequence BETWEEN 2 AND 32),
 nonce char(32) NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{32}$'),
 commit_sha char(40) NOT NULL CHECK(commit_sha ~ '^[a-f0-9]{40}$'),
 r187_sha256 char(64) NOT NULL CHECK(r187_sha256 ~ '^[a-f0-9]{64}$'),
 retention_sha256 char(64) NOT NULL CHECK(retention_sha256 ~ '^[a-f0-9]{64}$'),
 transcript_sha256 char(64) NOT NULL CHECK(transcript_sha256 ~ '^[a-f0-9]{64}$'),
 transcript_file_sha256 char(64) NOT NULL CHECK(transcript_file_sha256 ~ '^[a-f0-9]{64}$'),
 evidence_sha256 char(64) NOT NULL UNIQUE CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 synthetic_signatures smallint NOT NULL CHECK(synthetic_signatures=2),
 source_rows smallint NOT NULL CHECK(source_rows=8),
 restored_rows smallint NOT NULL CHECK(restored_rows=8),
 expired_rows_absent smallint NOT NULL CHECK(expired_rows_absent=4),
 native_rls_verified boolean NOT NULL CHECK(native_rls_verified=true),
 quarantine_closed boolean NOT NULL CHECK(quarantine_closed=true),
 source_mode text NOT NULL CHECK(source_mode='CI_SYNTHETIC'),
 decision text NOT NULL CHECK(decision='NO_GO_INDEPENDENT_LIVE_STAGING_APPROVAL_PENDING'),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE r188_ci.attested_audit(
 id smallint PRIMARY KEY REFERENCES r188_ci.attested_holds(id),
 evidence_sha256 char(64) NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL CHECK(decision='NO_GO_INDEPENDENT_LIVE_STAGING_APPROVAL_PENDING'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE r188_ci.attested_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE r188_ci.attested_holds FORCE ROW LEVEL SECURITY;
ALTER TABLE r188_ci.attested_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE r188_ci.attested_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY r188_select_hold ON r188_ci.attested_holds FOR SELECT
 TO marcosa_r188_writer USING(production_authorized=false);
CREATE POLICY r188_insert_hold ON r188_ci.attested_holds FOR INSERT
 TO marcosa_r188_writer WITH CHECK(production_authorized=false);
CREATE POLICY r188_select_audit ON r188_ci.attested_audit FOR SELECT
 TO marcosa_r188_writer USING(true);
CREATE POLICY r188_insert_audit ON r188_ci.attested_audit FOR INSERT
 TO marcosa_r188_writer WITH CHECK(true);
GRANT SELECT,INSERT ON r188_ci.attested_holds,r188_ci.attested_audit
 TO marcosa_r188_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA r188_ci
 FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF has_table_privilege('authenticated','r188_ci.attested_holds','SELECT') OR
  has_table_privilege('authenticated','r188_ci.attested_audit','SELECT') OR
  has_table_privilege('marcosa_r188_writer','r187_ci.observation_holds','UPDATE') OR
  has_table_privilege('marcosa_r188_writer','r188_ci.attested_holds','UPDATE') OR
  has_table_privilege('marcosa_r188_writer','r188_ci.attested_audit','DELETE') THEN
   RAISE EXCEPTION 'R188 immutable NO-GO FORCE RLS role boundary widened';
 END IF;
END $$;
COMMIT;
SELECT 'R188_NATIVE_PG17_SIGNED_RETENTION_NO_GO_RLS=PASS';
