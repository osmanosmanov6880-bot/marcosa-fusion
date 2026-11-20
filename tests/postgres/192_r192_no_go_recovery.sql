-- R192: source/rotation/risk NO-GO is immutable under FORCE RLS.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
 IF current_database()<>'postgres' OR
    current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN
  RAISE EXCEPTION 'R192 requires disposable postgres PG17 database';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  CREATE ROLE anon NOLOGIN NOINHERIT;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  CREATE ROLE authenticated NOLOGIN NOINHERIT;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='marcosa_r192_writer') THEN
  CREATE ROLE marcosa_r192_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
CREATE SCHEMA r192_ci;
REVOKE ALL ON SCHEMA r192_ci FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA r192_ci TO marcosa_r192_writer;
CREATE TABLE r192_ci.release_holds(
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1),
 source_commit char(40) NOT NULL CHECK(source_commit ~ '^[a-f0-9]{40}$'),
 parent_r191_commit char(40) NOT NULL CHECK(parent_r191_commit ~ '^[a-f0-9]{40}$'),
 source_bundle_sha256 char(64) NOT NULL CHECK(source_bundle_sha256 ~ '^[a-f0-9]{64}$'),
 review_sha256 char(64) NOT NULL CHECK(review_sha256 ~ '^[a-f0-9]{64}$'),
 iam_risk_sha256 char(64) NOT NULL CHECK(iam_risk_sha256 ~ '^[a-f0-9]{64}$'),
 rotation_sha256 char(64) NOT NULL CHECK(rotation_sha256 ~ '^[a-f0-9]{64}$'),
 release_sha256 char(64) NOT NULL UNIQUE CHECK(release_sha256 ~ '^[a-f0-9]{64}$'),
 source_mode text NOT NULL CHECK(source_mode='CI_DISPOSABLE'),
 decision text NOT NULL CHECK(decision='NO_GO_EXTERNAL_APPROVALS_AND_LIVE_STAGING_REQUIRED'),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE r192_ci.release_audit(
 id smallint PRIMARY KEY REFERENCES r192_ci.release_holds(id),
 release_sha256 char(64) NOT NULL CHECK(release_sha256 ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL CHECK(decision='NO_GO_EXTERNAL_APPROVALS_AND_LIVE_STAGING_REQUIRED'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE r192_ci.release_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE r192_ci.release_holds FORCE ROW LEVEL SECURITY;
ALTER TABLE r192_ci.release_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE r192_ci.release_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY r192_select_hold ON r192_ci.release_holds FOR SELECT
 TO marcosa_r192_writer USING(production_authorized=false);
CREATE POLICY r192_insert_hold ON r192_ci.release_holds FOR INSERT
 TO marcosa_r192_writer WITH CHECK(production_authorized=false);
CREATE POLICY r192_select_audit ON r192_ci.release_audit FOR SELECT
 TO marcosa_r192_writer USING(true);
CREATE POLICY r192_insert_audit ON r192_ci.release_audit FOR INSERT
 TO marcosa_r192_writer WITH CHECK(true);
GRANT SELECT,INSERT ON r192_ci.release_holds,r192_ci.release_audit
 TO marcosa_r192_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA r192_ci FROM PUBLIC,anon,authenticated;
DO $$
BEGIN
 IF has_table_privilege('authenticated','r192_ci.release_holds','SELECT') OR
    has_table_privilege('anon','r192_ci.release_audit','INSERT') OR
    has_table_privilege('marcosa_r192_writer','r192_ci.release_holds','UPDATE') OR
    has_table_privilege('marcosa_r192_writer','r192_ci.release_audit','DELETE') THEN
  RAISE EXCEPTION 'R192 immutable roles or FORCE RLS broadened';
 END IF;
END $$;
COMMIT;
SELECT 'R192_NATIVE_PG17_IMMUTABLE_NO_GO=PASS';
