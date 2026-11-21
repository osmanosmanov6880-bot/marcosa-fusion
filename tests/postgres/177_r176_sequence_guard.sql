-- R176 disposable PostgreSQL17: two append-only one-use archive admission gates.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres' THEN
  RAISE EXCEPTION 'R176 refuses non-disposable PostgreSQL';
 END IF;
 IF to_regclass('r174_ci.checkpoint') IS NULL OR
    to_regclass('r175_ci.recovery_leases') IS NULL THEN
  RAISE EXCEPTION 'R174/R175 fixtures required';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint
  WHERE conrelid='r175_ci.recovery_leases'::regclass AND contype='u'
 ) THEN RAISE EXCEPTION 'R175 UNIQUE(sequence) high-water fix absent'; END IF;
END $$;
CREATE SCHEMA r176_ci;
REVOKE ALL ON SCHEMA r176_ci FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='marcosa_r176_writer') THEN
  CREATE ROLE marcosa_r176_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA r176_ci,r175_ci,r174_ci TO marcosa_r176_writer;
GRANT SELECT ON r175_ci.recovery_leases,r174_ci.checkpoint TO marcosa_r176_writer;
CREATE POLICY r176_lease_observer ON r175_ci.recovery_leases
 FOR SELECT TO marcosa_r176_writer USING(production_authorized=false);
CREATE POLICY r176_checkpoint_observer ON r174_ci.checkpoint
 FOR SELECT TO marcosa_r176_writer USING(production_authorized=false);
CREATE TABLE r176_ci.admissions(
 nonce char(32) PRIMARY KEY REFERENCES r175_ci.recovery_leases(nonce),
 sequence bigint NOT NULL UNIQUE CHECK(sequence>0),
 anchor_sha256 char(64) NOT NULL CHECK(anchor_sha256 ~ '^[a-f0-9]{64}$'),
 archive_sha256 char(64) NOT NULL CHECK(archive_sha256 ~ '^[a-f0-9]{64}$'),
 checkpoint_sha256 char(64) NOT NULL CHECK(checkpoint_sha256 ~ '^[a-f0-9]{64}$'),
 commit_sha char(40) NOT NULL CHECK(commit_sha ~ '^[a-f0-9]{40}$'),
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false)
);
CREATE TABLE r176_ci.admission_audit(
 nonce char(32) PRIMARY KEY REFERENCES r176_ci.admissions(nonce),
 sequence bigint NOT NULL UNIQUE CHECK(sequence>0),
 happened_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE r176_ci.admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE r176_ci.admissions FORCE ROW LEVEL SECURITY;
ALTER TABLE r176_ci.admission_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE r176_ci.admission_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY r176_admissions_read ON r176_ci.admissions
 FOR SELECT TO marcosa_r176_writer USING(production_authorized=false);
CREATE POLICY r176_admissions_insert ON r176_ci.admissions
 FOR INSERT TO marcosa_r176_writer WITH CHECK(production_authorized=false);
CREATE POLICY r176_audit_read ON r176_ci.admission_audit
 FOR SELECT TO marcosa_r176_writer USING(true);
CREATE POLICY r176_audit_insert ON r176_ci.admission_audit
 FOR INSERT TO marcosa_r176_writer WITH CHECK(true);
GRANT SELECT,INSERT ON r176_ci.admissions,r176_ci.admission_audit
 TO marcosa_r176_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA r176_ci
 FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF has_table_privilege('authenticated','r176_ci.admissions','SELECT') OR
    has_table_privilege('marcosa_r176_writer','r174_ci.checkpoint','UPDATE') OR
    has_table_privilege('marcosa_r176_writer','r175_ci.recovery_leases','INSERT') OR
    has_table_privilege('marcosa_r176_writer','r176_ci.admissions','UPDATE') OR
    has_table_privilege('marcosa_r176_writer','r176_ci.admission_audit','DELETE') THEN
  RAISE EXCEPTION 'R176 append-only privileges drifted';
 END IF;
END $$;
COMMIT;
SELECT 'R176_PG17_DOUBLE_HIGHWATER_ADMISSION_RLS=PASS';
