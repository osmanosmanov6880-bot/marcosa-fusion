-- R174 isolated source/archive monotonic checkpoint. Synthetic PG17 fixture ONLY.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres' THEN
  RAISE EXCEPTION 'R174 requires disposable postgres database';
 END IF;
END $$;
CREATE SCHEMA r174_ci;
REVOKE ALL ON SCHEMA r174_ci FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='marcosa_r174_writer') THEN
  CREATE ROLE marcosa_r174_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA r174_ci TO marcosa_r174_writer;
CREATE TABLE r174_ci.checkpoint (
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1),
 sequence bigint NOT NULL CHECK(sequence>0),
 source_commit char(40) NOT NULL CHECK(source_commit ~ '^[a-f0-9]{40}$'),
 archive_sha256 char(64) NOT NULL CHECK(archive_sha256 ~ '^[a-f0-9]{64}$'),
 escrow_sha256 char(64) NOT NULL CHECK(escrow_sha256 ~ '^[a-f0-9]{64}$'),
 evidence_sha256 char(64) NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 archived_at_ms bigint NOT NULL CHECK(archived_at_ms>0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false)
);
CREATE TABLE r174_ci.checkpoint_events (
 sequence bigint PRIMARY KEY CHECK(sequence>0),
 archive_sha256 char(64) NOT NULL CHECK(archive_sha256 ~ '^[a-f0-9]{64}$'),
 evidence_sha256 char(64) NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 written_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE r174_ci.checkpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE r174_ci.checkpoint FORCE ROW LEVEL SECURITY;
ALTER TABLE r174_ci.checkpoint_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE r174_ci.checkpoint_events FORCE ROW LEVEL SECURITY;
CREATE POLICY checkpoint_read ON r174_ci.checkpoint FOR SELECT
 TO marcosa_r174_writer USING(production_authorized=false);
CREATE POLICY checkpoint_insert ON r174_ci.checkpoint FOR INSERT
 TO marcosa_r174_writer WITH CHECK(production_authorized=false);
CREATE POLICY checkpoint_update ON r174_ci.checkpoint FOR UPDATE
 TO marcosa_r174_writer USING(production_authorized=false)
 WITH CHECK(production_authorized=false);
CREATE POLICY events_read ON r174_ci.checkpoint_events FOR SELECT
 TO marcosa_r174_writer USING(true);
CREATE POLICY events_insert ON r174_ci.checkpoint_events FOR INSERT
 TO marcosa_r174_writer WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE(sequence,source_commit,archive_sha256,
 escrow_sha256,evidence_sha256,archived_at_ms,updated_at)
 ON r174_ci.checkpoint TO marcosa_r174_writer;
GRANT SELECT,INSERT ON r174_ci.checkpoint_events TO marcosa_r174_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA r174_ci FROM
 PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$BEGIN
 IF has_table_privilege('authenticated','r174_ci.checkpoint','SELECT') OR
    has_table_privilege('marcosa_r174_writer','r174_ci.checkpoint_events','UPDATE') OR
    has_table_privilege('marcosa_r174_writer','r174_ci.checkpoint_events','DELETE') THEN
  RAISE EXCEPTION 'R174 checkpoint access violation';
 END IF;
END $$;
COMMIT;
SELECT 'R174_PG17_MONOTONIC_CHECKPOINT_RLS=PASS';
