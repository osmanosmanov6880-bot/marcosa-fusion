-- R166: disposable PostgreSQL 17, zero-PII, tamper-evident operation journal.
-- SCHEMA REFERENCE ONLY. Do not deploy to a hosted Supabase project.
BEGIN;
CREATE ROLE marcosa_r166_audit_writer NOLOGIN NOBYPASSRLS;
CREATE ROLE marcosa_r166_audit_reader NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA marcosa_private TO marcosa_r166_audit_writer,marcosa_r166_audit_reader;

CREATE TABLE marcosa_private.r166_audit_head(
 id smallint PRIMARY KEY CHECK(id=1),
 seq bigint NOT NULL DEFAULT 0 CHECK(seq BETWEEN 0 AND 1000000),
 head_sha256 text NOT NULL DEFAULT repeat('0',64)
  CHECK(head_sha256 ~ '^[a-f0-9]{64}$')
);
INSERT INTO marcosa_private.r166_audit_head(id) VALUES(1);
CREATE TABLE marcosa_private.r166_audit_events(
 seq bigint PRIMARY KEY CHECK(seq BETWEEN 1 AND 1000000),
 observed_at_ms bigint NOT NULL CHECK(observed_at_ms>0),
 category text NOT NULL CHECK(category IN
  ('nonce_consumed','quarantine_closed','archive_encrypted','restore_verified',
   'restart_verified','integrity_denied')),
 outcome text NOT NULL CHECK(outcome IN('ok','deny','blocked')),
 source_commit text NOT NULL CHECK(source_commit ~ '^[a-f0-9]{40}$'),
 prev_sha256 text NOT NULL CHECK(prev_sha256 ~ '^[a-f0-9]{64}$'),
 entry_sha256 text NOT NULL CHECK(entry_sha256 ~ '^[a-f0-9]{64}$')
);
ALTER TABLE marcosa_private.r166_audit_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE marcosa_private.r166_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marcosa_private.r166_audit_head,marcosa_private.r166_audit_events
 FROM PUBLIC,anon,authenticated,marcosa_r156_writer,marcosa_r156_dispatcher,
 marcosa_r159_auth_reader;
GRANT SELECT ON marcosa_private.r166_audit_head,marcosa_private.r166_audit_events
 TO marcosa_r166_audit_reader;
GRANT SELECT ON marcosa_private.r166_audit_head TO marcosa_r166_audit_writer;
GRANT UPDATE(seq,head_sha256) ON marcosa_private.r166_audit_head TO marcosa_r166_audit_writer;
GRANT INSERT ON marcosa_private.r166_audit_events TO marcosa_r166_audit_writer;
CREATE POLICY r166_head_read ON marcosa_private.r166_audit_head
 FOR SELECT TO marcosa_r166_audit_reader,marcosa_r166_audit_writer USING (true);
CREATE POLICY r166_head_write ON marcosa_private.r166_audit_head
 FOR UPDATE TO marcosa_r166_audit_writer USING(true) WITH CHECK(true);
CREATE POLICY r166_events_read ON marcosa_private.r166_audit_events
 FOR SELECT TO marcosa_r166_audit_reader USING(true);
CREATE POLICY r166_events_insert ON marcosa_private.r166_audit_events
 FOR INSERT TO marcosa_r166_audit_writer WITH CHECK(true);
COMMENT ON TABLE marcosa_private.r166_audit_events IS
 'R166 synthetic CI private hash chain. No user/IP/email fields; external anchoring required.';
COMMIT;
