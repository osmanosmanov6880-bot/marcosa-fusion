-- R190: disposable PG17-only immutable evidence hold; no production write or GO.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
 IF current_database() <> 'postgres' OR
    current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN
  RAISE EXCEPTION 'R190 only disposable PG17 primary may be changed';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  CREATE ROLE authenticated NOLOGIN NOINHERIT;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  CREATE ROLE anon NOLOGIN NOINHERIT;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='marcosa_r190_writer') THEN
  CREATE ROLE marcosa_r190_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
CREATE SCHEMA r190_ci;
REVOKE ALL ON SCHEMA r190_ci FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA r190_ci TO marcosa_r190_writer;
CREATE TABLE r190_ci.immutable_hold(
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1),
 source_commit char(40) NOT NULL CHECK(source_commit ~ '^[a-f0-9]{40}$'),
 r189_commit char(40) NOT NULL CHECK(r189_commit ~ '^[a-f0-9]{40}$'),
 bundle_sha256 char(64) NOT NULL CHECK(bundle_sha256 ~ '^[a-f0-9]{64}$'),
 github_sha256 char(64) NOT NULL CHECK(github_sha256 ~ '^[a-f0-9]{64}$'),
 signature_sha256 char(64) NOT NULL CHECK(signature_sha256 ~ '^[a-f0-9]{64}$'),
 tls_sha256 char(64) NOT NULL CHECK(tls_sha256 ~ '^[a-f0-9]{64}$'),
 source_mode text NOT NULL CHECK(source_mode='CI_SYNTHETIC'),
 decision text NOT NULL CHECK(decision='NO_GO_EXTERNAL_STAGING_APPROVAL_PENDING'),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE r190_ci.immutable_audit(
 id smallint PRIMARY KEY REFERENCES r190_ci.immutable_hold(id),
 source_commit char(40) NOT NULL CHECK(source_commit ~ '^[a-f0-9]{40}$'),
 decision text NOT NULL CHECK(decision='NO_GO_EXTERNAL_STAGING_APPROVAL_PENDING'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE r190_ci.immutable_hold ENABLE ROW LEVEL SECURITY;
ALTER TABLE r190_ci.immutable_hold FORCE ROW LEVEL SECURITY;
ALTER TABLE r190_ci.immutable_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE r190_ci.immutable_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY r190_writer_hold_select ON r190_ci.immutable_hold
 FOR SELECT TO marcosa_r190_writer USING(production_authorized=false);
CREATE POLICY r190_writer_hold_append ON r190_ci.immutable_hold
 FOR INSERT TO marcosa_r190_writer WITH CHECK(production_authorized=false);
CREATE POLICY r190_writer_audit_select ON r190_ci.immutable_audit
 FOR SELECT TO marcosa_r190_writer USING(true);
CREATE POLICY r190_writer_audit_append ON r190_ci.immutable_audit
 FOR INSERT TO marcosa_r190_writer WITH CHECK(true);
GRANT SELECT,INSERT ON r190_ci.immutable_hold,r190_ci.immutable_audit
 TO marcosa_r190_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA r190_ci FROM PUBLIC,anon,authenticated;
DO $$
BEGIN
 IF has_table_privilege('authenticated','r190_ci.immutable_hold','SELECT') OR
    has_table_privilege('anon','r190_ci.immutable_hold','INSERT') OR
    has_table_privilege('marcosa_r190_writer','r190_ci.immutable_hold','UPDATE') OR
    has_table_privilege('marcosa_r190_writer','r190_ci.immutable_audit','DELETE') THEN
  RAISE EXCEPTION 'R190 privilege/immutable boundary widened';
 END IF;
END $$;
COMMIT;
SELECT 'R190_NATIVE_PG17_IMMUTABLE_NO_GO_RLS=PASS';
