-- MARCOSA R180: SYNTHETIC infrastructure evidence -> durable NO-GO hold.
-- Disposable PostgreSQL 17, no customer data or production write privileges.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres' OR
  to_regclass('r179_ci.review_evidence') IS NULL OR
  to_regclass('r179_ci.review_audit') IS NULL OR
  to_regclass('r178_ci.staging_evidence') IS NULL THEN
   RAISE EXCEPTION 'R180 refuses live DB or missing prior R178/R179 audits';
 END IF;
END $$;
CREATE SCHEMA r180_ci;
REVOKE ALL ON SCHEMA r180_ci FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='marcosa_r180_writer') THEN
  CREATE ROLE marcosa_r180_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA r180_ci,r179_ci,r178_ci TO marcosa_r180_writer;
GRANT SELECT ON r179_ci.review_evidence,r179_ci.review_audit,
 r178_ci.staging_evidence TO marcosa_r180_writer;
CREATE POLICY r180_read_r179 ON r179_ci.review_evidence FOR SELECT
 TO marcosa_r180_writer USING(production_authorized=false);
CREATE POLICY r180_read_r179_audit ON r179_ci.review_audit FOR SELECT
 TO marcosa_r180_writer USING(true);
CREATE POLICY r180_read_r178 ON r178_ci.staging_evidence FOR SELECT
 TO marcosa_r180_writer USING(production_authorized=false);
CREATE TABLE r180_ci.holds(
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1)
  REFERENCES r179_ci.review_evidence(id),
 run_id bigint NOT NULL UNIQUE CHECK(run_id>=10000),
 sequence bigint NOT NULL CHECK(sequence BETWEEN 2 AND 32),
 nonce char(32) NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{32}$'),
 commit_sha char(40) NOT NULL CHECK(commit_sha ~ '^[a-f0-9]{40}$'),
 history_root_sha256 char(64) NOT NULL CHECK(history_root_sha256 ~ '^[a-f0-9]{64}$'),
 archive_sha256 char(64) NOT NULL CHECK(archive_sha256 ~ '^[a-f0-9]{64}$'),
 restored_state_sha256 char(64) NOT NULL CHECK(restored_state_sha256 ~ '^[a-f0-9]{64}$'),
 review_evidence_sha256 char(64) NOT NULL CHECK(review_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 classification_sha256 char(64) NOT NULL CHECK(classification_sha256 ~ '^[a-f0-9]{64}$'),
 quorum_receipt_sha256 char(64) NOT NULL CHECK(quorum_receipt_sha256 ~ '^[a-f0-9]{64}$'),
 operator_pin_sha256 char(64) NOT NULL CHECK(operator_pin_sha256 ~ '^[a-f0-9]{64}$'),
 auditor_pin_sha256 char(64) NOT NULL CHECK(auditor_pin_sha256 ~ '^[a-f0-9]{64}$'),
 blocker_count smallint NOT NULL CHECK(blocker_count=5),
 decision text NOT NULL CHECK(decision='NO_GO_EXTERNAL_EVIDENCE_PENDING'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false),
 CHECK(operator_pin_sha256<>auditor_pin_sha256)
);
CREATE TABLE r180_ci.hold_audit(
 id smallint PRIMARY KEY REFERENCES r180_ci.holds(id),
 classification_sha256 char(64) NOT NULL CHECK(classification_sha256 ~ '^[a-f0-9]{64}$'),
 quorum_receipt_sha256 char(64) NOT NULL CHECK(quorum_receipt_sha256 ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL CHECK(decision='NO_GO_EXTERNAL_EVIDENCE_PENDING'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE r180_ci.holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE r180_ci.holds FORCE ROW LEVEL SECURITY;
ALTER TABLE r180_ci.hold_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE r180_ci.hold_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY r180_holds_read ON r180_ci.holds
 FOR SELECT TO marcosa_r180_writer USING(production_authorized=false);
CREATE POLICY r180_holds_insert ON r180_ci.holds
 FOR INSERT TO marcosa_r180_writer WITH CHECK(production_authorized=false);
CREATE POLICY r180_hold_audit_read ON r180_ci.hold_audit
 FOR SELECT TO marcosa_r180_writer USING(true);
CREATE POLICY r180_hold_audit_insert ON r180_ci.hold_audit
 FOR INSERT TO marcosa_r180_writer WITH CHECK(true);
GRANT SELECT,INSERT ON r180_ci.holds,r180_ci.hold_audit TO marcosa_r180_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA r180_ci
 FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF has_table_privilege('authenticated','r180_ci.holds','SELECT') OR
  has_table_privilege('marcosa_r180_writer','r179_ci.review_evidence','UPDATE') OR
  has_table_privilege('marcosa_r180_writer','r178_ci.staging_evidence','INSERT') OR
  has_table_privilege('marcosa_r180_writer','r180_ci.holds','UPDATE') OR
  has_table_privilege('marcosa_r180_writer','r180_ci.hold_audit','DELETE')
 THEN RAISE EXCEPTION 'R180 fail-closed append-only role boundary weakened'; END IF;
END $$;
COMMIT;
SELECT 'R180_NATIVE_PG17_APPEND_ONLY_NO_GO_RLS=PASS';
