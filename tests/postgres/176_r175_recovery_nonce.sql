-- R175 disposable PostgreSQL 17, synthetic source fixtures only.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres' THEN
  RAISE EXCEPTION 'R175 refuses non-disposable PostgreSQL';
 END IF;
 IF to_regclass('r174_ci.checkpoint') IS NULL THEN
  RAISE EXCEPTION 'R174 checkpoint fixture missing';
 END IF;
END $$;
CREATE SCHEMA r175_ci;
REVOKE ALL ON SCHEMA r175_ci FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='marcosa_r175_writer') THEN
  CREATE ROLE marcosa_r175_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA r175_ci TO marcosa_r175_writer;
GRANT USAGE ON SCHEMA r174_ci TO marcosa_r175_writer;
GRANT SELECT ON r174_ci.checkpoint TO marcosa_r175_writer;
CREATE POLICY r175_checkpoint_observer ON r174_ci.checkpoint
 FOR SELECT TO marcosa_r175_writer USING(production_authorized=false);
CREATE TABLE r175_ci.recovery_leases(
 nonce char(32) PRIMARY KEY CHECK(nonce ~ '^[a-f0-9]{32}$'),
 sequence bigint NOT NULL UNIQUE CHECK(sequence>0),
 anchor_sha256 char(64) NOT NULL CHECK(anchor_sha256 ~ '^[a-f0-9]{64}$'),
 archive_sha256 char(64) NOT NULL CHECK(archive_sha256 ~ '^[a-f0-9]{64}$'),
 commit_sha char(40) NOT NULL CHECK(commit_sha ~ '^[a-f0-9]{40}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false)
);
CREATE TABLE r175_ci.recovery_audit(
 nonce char(32) PRIMARY KEY REFERENCES r175_ci.recovery_leases(nonce),
 anchor_sha256 char(64) NOT NULL CHECK(anchor_sha256 ~ '^[a-f0-9]{64}$'),
 sequence bigint NOT NULL CHECK(sequence>0),
 happened_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE r175_ci.recovery_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE r175_ci.recovery_leases FORCE ROW LEVEL SECURITY;
ALTER TABLE r175_ci.recovery_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE r175_ci.recovery_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY r175_lease_read ON r175_ci.recovery_leases
 FOR SELECT TO marcosa_r175_writer USING(production_authorized=false);
CREATE POLICY r175_lease_insert ON r175_ci.recovery_leases
 FOR INSERT TO marcosa_r175_writer WITH CHECK(production_authorized=false);
CREATE POLICY r175_audit_read ON r175_ci.recovery_audit
 FOR SELECT TO marcosa_r175_writer USING(true);
CREATE POLICY r175_audit_insert ON r175_ci.recovery_audit
 FOR INSERT TO marcosa_r175_writer WITH CHECK(true);
GRANT SELECT,INSERT ON r175_ci.recovery_leases TO marcosa_r175_writer;
GRANT SELECT,INSERT ON r175_ci.recovery_audit TO marcosa_r175_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA r175_ci
 FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$BEGIN
 IF has_table_privilege('authenticated','r175_ci.recovery_leases','SELECT') OR
    has_table_privilege('marcosa_r175_writer','r175_ci.recovery_audit','UPDATE') OR
    has_table_privilege('marcosa_r175_writer','r175_ci.recovery_audit','DELETE') THEN
  RAISE EXCEPTION 'R175 role permissions drifted';
 END IF;
END $$;
COMMIT;
SELECT 'R175_PG17_RESTORATION_NONCE_RLS=PASS';
