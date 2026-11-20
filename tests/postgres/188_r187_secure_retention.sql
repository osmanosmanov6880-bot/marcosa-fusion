-- R187: disposable PG17 synthetic privacy retention and NO-GO.
-- No real PII/financial/customer data, no live DB, no production rights.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres' OR
   to_regclass('r186_ci.staging_observation_holds') IS NULL OR
   to_regclass('r186_ci.staging_observation_audit') IS NULL THEN
   RAISE EXCEPTION 'R187 requires real disposable PG17 completed R186 NO-GO';
 END IF;
END $$;
CREATE SCHEMA r187_ci;
REVOKE ALL ON SCHEMA r187_ci FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='marcosa_r187_retention_worker') THEN
  CREATE ROLE marcosa_r187_retention_worker NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='marcosa_r187_hold_writer') THEN
  CREATE ROLE marcosa_r187_hold_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA r187_ci TO marcosa_r187_retention_worker;
GRANT USAGE ON SCHEMA r187_ci,r186_ci TO marcosa_r187_hold_writer;
GRANT SELECT ON r186_ci.staging_observation_holds,
 r186_ci.staging_observation_audit TO marcosa_r187_hold_writer;
CREATE POLICY r187_prior_hold_read ON r186_ci.staging_observation_holds
 FOR SELECT TO marcosa_r187_hold_writer USING(production_authorized=false);
CREATE POLICY r187_prior_audit_read ON r186_ci.staging_observation_audit
 FOR SELECT TO marcosa_r187_hold_writer USING(true);

CREATE TABLE r187_ci.synthetic_retention(
 ordinal smallint PRIMARY KEY CHECK(ordinal BETWEEN 1 AND 12),
 kind text NOT NULL CHECK(kind IN('PAGE_VIEW','PUBLIC_EVENT','CHECKOUT_INTENT')),
 event_sha256 char(64) NOT NULL UNIQUE CHECK(event_sha256 ~ '^[a-f0-9]{64}$'),
 source_commit char(40) NOT NULL CHECK(source_commit ~ '^[a-f0-9]{40}$'),
 run_id bigint NOT NULL CHECK(run_id>=10000),
 expires_at timestamptz NOT NULL,
 synthetic_only boolean NOT NULL DEFAULT true CHECK(synthetic_only=true),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false)
);
ALTER TABLE r187_ci.synthetic_retention ENABLE ROW LEVEL SECURITY;
ALTER TABLE r187_ci.synthetic_retention FORCE ROW LEVEL SECURITY;
CREATE POLICY r187_retention_select ON r187_ci.synthetic_retention
 FOR SELECT TO marcosa_r187_retention_worker
 USING(synthetic_only=true AND production_authorized=false);
CREATE POLICY r187_retention_delete ON r187_ci.synthetic_retention
 FOR DELETE TO marcosa_r187_retention_worker
 USING(synthetic_only=true AND production_authorized=false
  AND expires_at < statement_timestamp());
GRANT SELECT,DELETE ON r187_ci.synthetic_retention
 TO marcosa_r187_retention_worker;
CREATE POLICY r187_hold_retention_read ON r187_ci.synthetic_retention
 FOR SELECT TO marcosa_r187_hold_writer
 USING(synthetic_only=true AND production_authorized=false);
GRANT SELECT ON r187_ci.synthetic_retention TO marcosa_r187_hold_writer;
REVOKE ALL ON r187_ci.synthetic_retention
 FROM PUBLIC,anon,authenticated,marcosa_r167_reader;

CREATE TABLE r187_ci.observation_holds(
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1)
 REFERENCES r186_ci.staging_observation_holds(id),
 run_id bigint NOT NULL UNIQUE CHECK(run_id>=10000),
 sequence bigint NOT NULL CHECK(sequence BETWEEN 2 AND 32),
 nonce char(32) NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{32}$'),
 source_commit char(40) NOT NULL CHECK(source_commit ~ '^[a-f0-9]{40}$'),
 r186_evidence_sha256 char(64) NOT NULL CHECK(r186_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 retention_sha256 char(64) NOT NULL CHECK(retention_sha256 ~ '^[a-f0-9]{64}$'),
 dual_attestation_sha256 char(64) NOT NULL CHECK(dual_attestation_sha256 ~ '^[a-f0-9]{64}$'),
 tls_pin_sha256 char(64) NOT NULL CHECK(tls_pin_sha256 ~ '^[a-f0-9]{64}$'),
 evidence_sha256 char(64) NOT NULL UNIQUE CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 records_deleted smallint NOT NULL CHECK(records_deleted=4),
 records_retained smallint NOT NULL CHECK(records_retained=8),
 verified_signatures smallint NOT NULL CHECK(verified_signatures=2),
 source_mode text NOT NULL CHECK(source_mode='CI_SYNTHETIC'),
 decision text NOT NULL CHECK(decision='NO_GO_REAL_STAGING_ATTESTATION_PENDING'),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE r187_ci.observation_audit(
 id smallint PRIMARY KEY REFERENCES r187_ci.observation_holds(id),
 evidence_sha256 char(64) NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL CHECK(decision='NO_GO_REAL_STAGING_ATTESTATION_PENDING'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE r187_ci.observation_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE r187_ci.observation_holds FORCE ROW LEVEL SECURITY;
ALTER TABLE r187_ci.observation_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE r187_ci.observation_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY r187_hold_select ON r187_ci.observation_holds FOR SELECT
 TO marcosa_r187_hold_writer USING(production_authorized=false);
CREATE POLICY r187_hold_insert ON r187_ci.observation_holds FOR INSERT
 TO marcosa_r187_hold_writer WITH CHECK(production_authorized=false);
CREATE POLICY r187_audit_select ON r187_ci.observation_audit FOR SELECT
 TO marcosa_r187_hold_writer USING(true);
CREATE POLICY r187_audit_insert ON r187_ci.observation_audit FOR INSERT
 TO marcosa_r187_hold_writer WITH CHECK(true);
GRANT SELECT,INSERT ON r187_ci.observation_holds,
 r187_ci.observation_audit TO marcosa_r187_hold_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA r187_ci
 FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF has_table_privilege('authenticated','r187_ci.observation_holds','SELECT') OR
  has_table_privilege('authenticated','r187_ci.synthetic_retention','SELECT') OR
  has_table_privilege('marcosa_r187_hold_writer','r187_ci.observation_holds','UPDATE') OR
  has_table_privilege('marcosa_r187_retention_worker','r187_ci.synthetic_retention','INSERT') OR
  has_table_privilege('marcosa_r187_hold_writer','r187_ci.synthetic_retention','DELETE') OR
  has_table_privilege('marcosa_r187_retention_worker','r187_ci.observation_holds','INSERT') THEN
  RAISE EXCEPTION 'R187 retention or immutable NO-GO role boundary widened';
 END IF;
END $$;
COMMIT;
SELECT 'R187_SYNTHETIC_RETENTION_FORCE_RLS=PASS';
